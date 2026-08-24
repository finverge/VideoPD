import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { evaluateLivenessResult, identityVerificationRiskFlag, IDENTITY_RISK_FLAG_CODE, riskSeverityOf } from "@/lib/mockChecks";
import type { InitialSummary } from "@/types";

// Persists the real, on-device liveness/face-match signals gathered during
// VideoPD Step 1 (src/components/CameraCapture.tsx's analyzeLiveness mode)
// onto that step's own UploadedEvidence row — authenticityStatus/Notes
// existed in the schema and were already rendered on the staff case page,
// but nothing had ever computed them; they sat at PENDING forever. This is
// the write side. Advisory only: this never blocks or gates the borrower's
// own flow (the upload + step-advance already happened before this call),
// it only gives the underwriter a real signal instead of a permanent PENDING.
//
// A FLAGGED verdict also gets folded into the Lead's own risk flags — the
// same summary.riskFlags array /api/submit populates and the queue's
// riskSeverity badge reads — so it surfaces on the underwriter queue, not
// only on the case detail page's Identity verification panel. Keyed by
// IDENTITY_RISK_FLAG_CODE so a later verdict replaces rather than duplicates
// (and drops the flag again if a later analysis somehow comes back clean).
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await req.json()) as {
    evidenceId?: string;
    blinkCount?: number;
    framesAnalyzed?: number;
    noFacePct?: number;
    lookedAwayPct?: number;
    offCameraGlances?: number;
    recordingSeconds?: number;
    faceMatch?: { attempted: boolean; distance: number | null; matched: boolean | null; skippedReason?: string };
  };
  const { evidenceId, blinkCount, framesAnalyzed, noFacePct, lookedAwayPct, offCameraGlances, recordingSeconds, faceMatch } = body;

  if (
    typeof evidenceId !== "string" ||
    typeof blinkCount !== "number" ||
    typeof framesAnalyzed !== "number" ||
    typeof noFacePct !== "number" ||
    typeof lookedAwayPct !== "number" ||
    typeof offCameraGlances !== "number" ||
    typeof recordingSeconds !== "number" ||
    !faceMatch
  ) {
    return NextResponse.json(
      { error: "evidenceId, blinkCount, framesAnalyzed, noFacePct, lookedAwayPct, offCameraGlances, recordingSeconds, and faceMatch are required." },
      { status: 400 }
    );
  }

  const session = await db.videoPdSession.findUnique({
    where: { token },
    include: { lead: { include: { summary: true } } },
  });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });

  // The evidence row belongs to this token's own application, and must
  // actually be the Step 1 liveness capture — otherwise a borrower's own
  // session (or a replayed request) could write an authenticity verdict onto
  // unrelated evidence just by passing a different id.
  const evidence = await db.uploadedEvidence.findUnique({ where: { id: evidenceId } });
  if (!evidence || evidence.applicationId !== session.lead.applicationId || evidence.type !== "VIDEOPD_LIVENESS") {
    return NextResponse.json({ error: "Evidence not found for this session." }, { status: 404 });
  }

  const { status, notes } = evaluateLivenessResult({ blinkCount, framesAnalyzed, noFacePct, lookedAwayPct, offCameraGlances, recordingSeconds, faceMatch });

  const writes: Prisma.PrismaPromise<any>[] = [
    db.uploadedEvidence.update({
      where: { id: evidenceId },
      data: {
        authenticityStatus: status,
        authenticityNotes: notes,
        livenessBlinkCount: blinkCount,
        livenessNoFacePct: noFacePct,
        livenessLookedAwayPct: lookedAwayPct,
        livenessOffCameraGlances: offCameraGlances,
        livenessRecordingSeconds: recordingSeconds,
        faceMatchDistance: faceMatch.attempted ? faceMatch.distance : null,
        faceMatchResult: faceMatch.attempted ? faceMatch.matched : null,
      },
    }),
  ];

  if (session.lead.summary) {
    const summary: InitialSummary = JSON.parse(session.lead.summary.summaryJson);
    const otherFlags = summary.riskFlags.filter((f) => f.code !== IDENTITY_RISK_FLAG_CODE);
    summary.riskFlags = status === "FLAGGED" ? [...otherFlags, identityVerificationRiskFlag(notes)] : otherFlags;
    writes.push(
      db.initialSummaryDocument.update({ where: { id: session.lead.summary.id }, data: { summaryJson: JSON.stringify(summary) } }),
      db.lead.update({
        where: { id: session.lead.id },
        data: { riskFlagCount: summary.riskFlags.length, riskSeverity: riskSeverityOf(summary.riskFlags) },
      })
    );
  }

  const [updated] = await db.$transaction(writes);

  return NextResponse.json({ evidence: updated });
}
