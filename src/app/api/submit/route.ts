import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runAutoAnalysis, riskSeverityOf } from "@/lib/mockChecks";
import { getRiskParameters } from "@/lib/riskParameters";
import type { InitialSummary } from "@/types";

const REQUIRED_EVIDENCE_TYPES = ["ID_PROOF", "ADDRESS_PROOF", "SELFIE"] as const;

// FSD Section 7 — LOS Auto-Analysis, Summary & Lead Creation (FR-LOS-01..07).
export async function POST(req: NextRequest) {
  const { applicationId, consent, deviceFingerprint, deviceSignals } = (await req.json()) as {
    applicationId?: string;
    consent?: { dataUsage?: boolean; bureauPull?: boolean; media?: boolean };
    deviceFingerprint?: string;
    deviceSignals?: Record<string, unknown>;
  };
  if (!applicationId) return NextResponse.json({ error: "applicationId is required." }, { status: 400 });

  const application = await db.loanApplication.findUnique({
    where: { id: applicationId },
    include: { evidence: true, borrower: true },
  });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (application.status !== "DRAFT") {
    return NextResponse.json({ error: "Application already submitted." }, { status: 409 });
  }

  // Server-side enforcement, not just the wizard's disabled Submit button —
  // the three consents (data usage, bureau pull, media capture) were
  // previously tracked only in client React state and never sent here at
  // all, so a legitimately-consenting borrower's consent was silently
  // discarded and never recorded (consentDataUsage etc. on Borrower stayed
  // false forever), and nothing stopped a submit call that skipped consent
  // entirely.
  if (!consent?.dataUsage || !consent?.bureauPull || !consent?.media) {
    return NextResponse.json({ error: "All three consents are required before submitting." }, { status: 400 });
  }
  await db.borrower.update({
    where: { id: application.borrowerId },
    data: { consentDataUsage: true, consentBureauPull: true, consentMediaCapture: true },
  });

  const presentTypes = new Set(application.evidence.map((e) => e.type));
  const missingRequired = REQUIRED_EVIDENCE_TYPES.filter((t) => !presentTypes.has(t));
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: `Missing required evidence: ${missingRequired.join(", ")}` },
      { status: 400 }
    );
  }

  await db.loanApplication.update({
    where: { id: applicationId },
    data: {
      status: "SUBMITTED",
      deviceFingerprint: deviceFingerprint ?? null,
      deviceSignalsJson: deviceSignals ? JSON.stringify(deviceSignals) : null,
    },
  });

  const flaggedEvidenceCount = application.evidence.filter((e) => e.qualityStatus === "FLAGGED").length;
  // Same borrower (same Borrower row, i.e. same verified mobile), any other
  // application that's already become a Lead — regardless of that lead's
  // status, since even an already-decided one is worth an underwriter
  // knowing about on this new case.
  const otherLeadCount = await db.lead.count({
    where: { application: { borrowerId: application.borrowerId, id: { not: applicationId } } },
  });
  // The mirror case of otherLeadCount above — not the same borrower applying
  // twice, but the same *device* (real fingerprint, see
  // src/lib/deviceFingerprint.ts) behind different borrowers' applications.
  // A classic loan-stacking/device-farm signal, distinct from a borrower
  // legitimately reapplying on their own phone.
  const sharedDeviceLeadCount = deviceFingerprint
    ? await db.lead.count({
        where: {
          application: {
            deviceFingerprint,
            borrowerId: { not: application.borrowerId },
          },
        },
      })
    : 0;
  const riskParameters = await getRiskParameters(application.segment);
  const { riskFlags, completenessScore } = runAutoAnalysis({
    fields: application as unknown as Record<string, unknown>,
    evidenceCount: application.evidence.length,
    requiredEvidenceCount: REQUIRED_EVIDENCE_TYPES.length,
    flaggedEvidenceCount,
    otherLeadCount,
    sharedDeviceLeadCount,
    riskParameters,
  });

  const summary: InitialSummary = {
    borrowerProfile: {
      name: application.fullName ?? undefined,
      segment: application.segment as any,
      language: application.borrower.language as any,
      mobile: application.borrower.mobile,
    },
    loanAsk: {
      productType: application.productType ?? undefined,
      amount: application.requestedAmount ?? undefined,
      tenureMonths: application.tenureMonths ?? undefined,
      purpose: application.loanPurpose ?? undefined,
    },
    documentChecklist: application.evidence.map((e) => ({ type: e.type, status: e.qualityStatus })),
    riskFlags,
    completenessScore,
    generatedAt: new Date().toISOString(),
  };

  const lead = await db.lead.create({
    data: {
      applicationId,
      status: "NEW",
      riskFlagCount: riskFlags.length,
      riskSeverity: riskSeverityOf(riskFlags),
      summary: { create: { summaryJson: JSON.stringify(summary) } },
    },
    include: { summary: true },
  });

  await db.loanApplication.update({ where: { id: applicationId }, data: { status: "ANALYZED" } });

  return NextResponse.json({ lead, summary });
}
