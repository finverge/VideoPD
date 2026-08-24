/**
 * Draft underwriter recommendation — synthesizes the real signals already
 * computed elsewhere in this app (risk flags, dossier flags, bank statement
 * eligibility/authenticity, identity verification) into a suggested
 * APPROVE/REJECT with written reasoning, to pre-fill the underwriter's own
 * decision form. This NEVER decides anything on its own — the underwriter
 * still has to read it and explicitly click Recommend Approve/Reject
 * themselves; nothing here writes to the database or advances a case.
 * BRD Section 7.2 excludes "automated, non-underwriter-reviewed credit
 * decisioning" outright (see docs/videopd-future-work.md's "Permanent scope
 * boundaries" section) — this is advisory input to that human decision,
 * same as every other check in this codebase, not a decision itself.
 *
 * Honest about what "AI agent" means here: this is deterministic,
 * transparent rule synthesis over real, already-computed signals — not a
 * language model. This app has never called a real LLM (every other "real"
 * technique used — translation, OCR, face recognition, speech — is genuinely
 * free/keyless; there's no equivalent free LLM API to honestly claim one is
 * running here), so rather than fake an "AI-generated" writeup, this states
 * plainly what it actually is: explainable rules over real data, the same
 * footing as computeEligibility/evaluateLivenessResult elsewhere.
 */

export interface DraftRecommendationInput {
  riskSeverity: "none" | "low" | "medium" | "high" | string;
  riskFlags: { code: string; label: string; severity: string; detail: string }[];
  skillIntentScore: number | null;
  videoPdComplete: boolean;
  dossierFlags: { type: string; label: string; detail: string }[];
  bankStatement: { eligibilityFlag: string | null; authenticityStatus: string | null; authenticityReasons: string[] } | null;
  identityVerification: { authenticityStatus: string | null; notes: string | null; faceMatchResult: boolean | null } | null;
}

export interface DraftRecommendation {
  recommendation: "APPROVE" | "REJECT" | null; // null when there isn't enough completed verification to draft anything
  reasoning: string;
}

const SEVERE_BANK_FLAGS = new Set(["NOT_ELIGIBLE"]);

export function draftUnderwriterRecommendation(input: DraftRecommendationInput): DraftRecommendation {
  const {
    riskSeverity, riskFlags, skillIntentScore, videoPdComplete, dossierFlags, bankStatement, identityVerification,
  } = input;

  if (!videoPdComplete) {
    return {
      recommendation: null,
      reasoning: "VideoPD verification isn't complete yet — no draft recommendation until identity/liveness, the Q&A, and the bank statement have all been captured.",
    };
  }

  const blockers: string[] = [];
  const cautions: string[] = [];
  const positives: string[] = [];

  // Bank statement authenticity — a confirmed tamper signal is treated as
  // severe on its own, same weight as it gets on the queue's own risk flag
  // (src/lib/mockChecks.ts's bankStatementAuthenticityRiskFlag uses "high").
  if (bankStatement?.authenticityStatus === "FLAGGED") {
    blockers.push(`Bank statement authenticity was flagged: ${bankStatement.authenticityReasons.join(" ")}`);
  } else if (bankStatement?.authenticityStatus === "PASSED") {
    positives.push("Bank statement authenticity verified — no signs of tampering.");
  }

  if (bankStatement?.eligibilityFlag && SEVERE_BANK_FLAGS.has(bankStatement.eligibilityFlag)) {
    blockers.push("Bank statement eligibility check came back NOT_ELIGIBLE.");
  } else if (bankStatement?.eligibilityFlag === "NEEDS_REVIEW") {
    cautions.push("Bank statement eligibility flagged NEEDS_REVIEW.");
  } else if (bankStatement?.eligibilityFlag === "ELIGIBLE") {
    positives.push("Bank statement eligibility check passed.");
  }

  // Identity verification — a clear face-match failure or a FLAGGED
  // liveness verdict is treated as severe (this is literally the check
  // this whole app's liveness/face-match pipeline exists to surface).
  if (identityVerification?.faceMatchResult === false) {
    blockers.push(`Face match against ID proof did not pass. ${identityVerification.notes ?? ""}`.trim());
  } else if (identityVerification?.authenticityStatus === "FLAGGED") {
    cautions.push(identityVerification.notes ?? "Identity verification was flagged for manual review.");
  } else if (identityVerification?.authenticityStatus === "PASSED") {
    positives.push("Identity verification (liveness + face match) passed.");
  }

  // Every other queue-level risk flag (SHARED_DEVICE, AMOUNT_OUTLIER,
  // EMI_AFFORDABILITY, MULTIPLE_APPLICATIONS, etc.) — bucketed by its own
  // already-assigned severity rather than re-judging it here.
  for (const f of riskFlags) {
    if (f.code === "BANK_STATEMENT_AUTHENTICITY" || f.code === "IDENTITY_VERIFICATION") continue; // already handled above with the fuller context
    if (f.severity === "high") blockers.push(`${f.label}: ${f.detail}`);
    else cautions.push(`${f.label}: ${f.detail}`);
  }

  // Consistency-type dossier flags (Live Consistency Engine, cross-applicant
  // answer similarity) are a real fraud signal, not just incompleteness —
  // weighted as a caution, not automatically a blocker on their own.
  for (const f of dossierFlags) {
    if (f.type === "consistency") cautions.push(`${f.label}: ${f.detail}`);
  }

  if (skillIntentScore !== null) {
    if (skillIntentScore < 40) cautions.push(`Skill/intent Q&A score is low (${skillIntentScore}/100).`);
    else positives.push(`Skill/intent Q&A score: ${skillIntentScore}/100.`);
  }

  const recommendation: "APPROVE" | "REJECT" = blockers.length > 0 ? "REJECT" : "APPROVE";

  const parts: string[] = [];
  parts.push(`Draft recommendation: ${recommendation}.`);
  if (blockers.length > 0) {
    parts.push(`Reason: ${blockers.join(" ")}`);
  } else {
    parts.push(positives.length > 0 ? `Basis: ${positives.join(" ")}` : "No completed checks produced a clear positive or negative signal — review the case directly.");
  }
  if (cautions.length > 0) {
    parts.push(`Also worth noting before confirming: ${cautions.join(" ")}`);
  }
  parts.push(riskSeverity !== "none" ? `Overall risk severity: ${riskSeverity}.` : "Overall risk severity: none.");
  parts.push("— Drafted by rule-based synthesis of the checks above, not a language model. Review and edit before confirming.");

  return { recommendation, reasoning: parts.join(" ") };
}
