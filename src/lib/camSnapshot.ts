import { db } from "./db";
import type { CamSnapshot } from "./camPdf";
import type { InitialSummary } from "@/types";

/**
 * Assembles one CamSnapshot from a case's CURRENT state — called exactly
 * once per "Generate CAM" action (see api/staff/case/[id]/cam/route.ts),
 * never on read. The resulting object is what gets persisted verbatim as
 * CreditAppraisalMemo.snapshotJson — see that model's own doc comment in
 * schema.prisma for why this must never be recomputed from live data again
 * once generated.
 *
 * Field-by-field source mapping, mirrored against DLP/LOS's real
 * _build_cam_snapshot (services/underwriting-decisioning/app/routers/
 * cases.py) so the shape is an honest port, not a guess:
 *   - financials: DLP splits self-declared-vs-verified by product family
 *     (GST turnover for Business Loan, AA-verified income for Personal).
 *     VideoPD has neither a GST nor Account Aggregator integration — its
 *     one real equivalent is self-declared income (LoanApplication.
 *     monthlyIncome) vs. bank-statement-parsed income (from the uploaded
 *     statement's own OCR/metricsJson), so that's what this maps instead.
 *   - obligations.bureauScore/Band: DLP reads these from a real credit-
 *     bureau pull (CIBIL). VideoPD has no bureau integration at all —
 *     always null here, rendered as an explicit "not available" line by
 *     camPdf.ts, never silently omitted.
 *   - obligations.dtiRatio: DLP computes this from the bureau's own
 *     reported obligations. VideoPD computes a real (if narrower) version
 *     from its own bank-statement parse: EMI outflow ÷ estimated income —
 *     same ratio, different, honestly-scoped source.
 *   - eligibility.assumptions: DLP's are product-specific underwriting
 *     facts (MSME classification, CGTMSE, sanctions-screening) pulled from
 *     its own business-profile/AML checks, which don't exist in this app.
 *     VideoPD's equivalent is what its own real checks actually produced —
 *     identity verification, voice-biometrics, bank-statement authenticity
 *     — restated as plain assumption statements rather than the dense
 *     per-check summary this data was in before this rewrite.
 */
export async function buildCamSnapshot(leadId: string): Promise<CamSnapshot> {
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      summary: true,
      decisions: { orderBy: { decidedAt: "asc" } },
      videoPdSession: { include: { bankStatements: { orderBy: { createdAt: "desc" } } } },
      application: { include: { borrower: true, evidence: true, voiceBiometricCheck: true } },
    },
  });

  const summary: InitialSummary | null = lead.summary ? JSON.parse(lead.summary.summaryJson) : null;
  const statement = lead.videoPdSession?.bankStatements[0] ?? null;
  const statementMetrics: { avgBalance?: number; emiOutflow?: number; estimatedMonthlyIncome?: number } | null =
    statement?.metricsJson ? JSON.parse(statement.metricsJson) : null;
  const liveness = lead.application.evidence.find((e) => e.type === "VIDEOPD_LIVENESS");
  const vb = lead.application.voiceBiometricCheck;
  const app = lead.application;

  const selfDeclared = app.monthlyIncome;
  const bankEstimated = statementMetrics?.estimatedMonthlyIncome ?? null;
  const incomeVariancePct =
    selfDeclared && bankEstimated && selfDeclared > 0 ? (Math.abs(selfDeclared - bankEstimated) / selfDeclared) * 100 : null;
  const dtiRatio =
    statementMetrics?.emiOutflow != null && bankEstimated && bankEstimated > 0 ? statementMetrics.emiOutflow / bankEstimated : null;

  // Real assumption statements — what actually fed the recommendation,
  // restated plainly. Only includes a check when it actually ran (has a
  // real status), same "don't claim a check happened when it didn't"
  // discipline as underwriterAgent.ts.
  const assumptions: string[] = [];
  if (liveness) {
    assumptions.push(
      liveness.faceMatchResult === true
        ? `Identity: face match confirmed (distance ${liveness.faceMatchDistance?.toFixed(2) ?? "—"}).`
        : liveness.faceMatchResult === false
          ? `Identity: face match did NOT confirm (distance ${liveness.faceMatchDistance?.toFixed(2) ?? "—"}).`
          : "Identity: face match not attempted."
    );
  }
  if (vb && vb.consistencyStatus !== "PENDING") {
    assumptions.push(`Voice consistency (guided-flow): ${vb.consistencyStatus}, similarity ${vb.consistencySimilarity?.toFixed(2) ?? "—"}.`);
  }
  if (vb && (vb.livenessMultiSpeakerStatus === "FLAGGED" || vb.businessMultiSpeakerStatus === "FLAGGED")) {
    assumptions.push("Multiple voices detected in at least one guided-flow recording — reviewed and not treated as disqualifying on its own.");
  }
  if (statement) {
    assumptions.push(`Bank statement authenticity: ${statement.authenticityStatus}. Eligibility: ${statement.eligibilityFlag ?? "not assessed"}.`);
  }
  assumptions.push("No credit bureau, GST, ITR, or core-banking (CBS/ETB) check was performed — this build has no such integration.");

  return {
    // This app's own case reference (last 8 chars of the Lead id,
    // uppercased) — not styled as a formatted "application number" the way
    // DLP's real sequence-generated one is (e.g. "PL180820260000001"),
    // since VideoPD has no such numbering scheme of its own. Adopting that
    // exact format here would look official without being real; once
    // VideoPD is wired into DLP/LOS's own application-onboarding service
    // (see the earlier integration plan), a real application_number would
    // come from there instead.
    applicationRef: lead.id.slice(-8).toUpperCase(),
    productFamily: app.segment,
    applicantName: app.fullName || "—",
    applicantPan: app.idType === "pan" ? app.idNumber : null,
    etbStatus: null,
    mobile: lead.application.borrower?.mobile ?? "—",
    requestedAmount: app.requestedAmount,
    tenureMonths: app.tenureMonths,
    loanPurpose: app.loanPurpose,
    productType: app.productType,
    documents: lead.application.evidence.map((e) => ({ documentType: e.type, status: e.authenticityStatus !== "PENDING" ? e.authenticityStatus : e.qualityStatus })),
    financials: {
      selfDeclaredMonthlyIncome: selfDeclared,
      bankStatementEstimatedMonthlyIncome: bankEstimated,
      incomeVariancePct,
      averageMonthlyBalance: statementMetrics?.avgBalance ?? null,
      emiOutflow: statementMetrics?.emiOutflow ?? null,
    },
    obligations: { bureauScore: null, bureauScoreBand: null, dtiRatio },
    eligibility: {
      recommendedDecision: lead.underwriterRecommendation,
      underwriterName: lead.underwriterName,
      approverDecision: lead.approverDecision,
      approverName: lead.approverName,
      assumptions,
    },
    riskFlags: summary?.riskFlags ?? [],
    riskSeverity: lead.riskSeverity,
    decisionTrail: lead.decisions.map((d) => ({ actorRole: d.actorRole, actorName: d.actorName, action: d.action, notes: d.notes, decidedAt: d.decidedAt.toISOString() })),
    skillIntentScore: lead.videoPdSession?.skillIntentScore ?? null,
  };
}
