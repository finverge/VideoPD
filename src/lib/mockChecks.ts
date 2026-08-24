import type { RiskFlag, LangCode, SegmentCode } from "@/types";
import { estimateMonthlyEmi, DEFAULT_RISK_PARAMETERS } from "@/lib/riskParameters";
import { extractFieldValue } from "@/lib/dialogManager";

/**
 * Real lexical similarity between two VideoPD Q&A answers — Sørensen–Dice
 * coefficient on word bigrams after normalizing case/punctuation/whitespace.
 * Used to catch literally reused or lightly-reworded answers across
 * DIFFERENT applicants (a real, if crude, scripted-fraud signal — the same
 * canned answer to "why do you need this loan" from two unrelated people).
 *
 * Deliberately NOT semantic/NLU similarity — that's a different, harder
 * capability (docs/videopd-future-work.md item 8's "extracting comparable
 * claims from free-text needs real NLU, not attempted"). This only catches
 * near-identical wording, not two genuinely different phrasings of the same
 * idea, and says so rather than overclaiming.
 */
export const ANSWER_SIMILARITY_THRESHOLD = 0.85;
export const ANSWER_SIMILARITY_MIN_LENGTH = 25; // normalized chars — below this, short generic answers ("yes I can", "no issues") collide between unrelated people all the time and aren't a signal

function normalizeAnswerText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(words: string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) set.add(`${words[i]} ${words[i + 1]}`);
  return set;
}

export function answerSimilarity(a: string, b: string): number {
  const na = normalizeAnswerText(a);
  const nb = normalizeAnswerText(b);
  if (na.length < ANSWER_SIMILARITY_MIN_LENGTH || nb.length < ANSWER_SIMILARITY_MIN_LENGTH) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na.split(" "));
  const bb = bigrams(nb.split(" "));
  if (ba.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const bg of ba) if (bb.has(bg)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

/**
 * A generic, real "low-effort echo" signal — the one honest partial slice
 * of "judging Q&A answer content" this prototype attempts. It is NOT
 * judging whether an answer is credit-relevant, truthful, or plausible —
 * that's the real scoring model BR-43 describes, which still needs
 * Lakshya's own rubric or real NLU (see docs/videopd-future-work.md item 9;
 * unchanged by this function). What this DOES catch, honestly: an answer
 * that's substantially just repeating the question's own words back rather
 * than contributing new content — e.g. "Why do you need this loan?" -> "I
 * need this loan for my needs." Deterministic word-overlap, same
 * lexical-not-semantic tier as answerSimilarity above.
 */
export const ANSWER_ECHO_OVERLAP_THRESHOLD = 0.6;
export const ANSWER_ECHO_MIN_QUESTION_WORDS = 4; // below this, a short question makes "overlap" meaningless — almost anything overlaps a 2-3 word question

export function answerEchoesQuestion(answer: string, questionText: string): boolean {
  const answerWords = normalizeAnswerText(answer).split(" ").filter(Boolean);
  const questionWordSet = new Set(normalizeAnswerText(questionText).split(" ").filter(Boolean));
  if (questionWordSet.size < ANSWER_ECHO_MIN_QUESTION_WORDS || answerWords.length === 0) return false;
  const overlap = answerWords.filter((w) => questionWordSet.has(w)).length;
  // Relative to the ANSWER's own word count — a short answer that's almost
  // entirely question-words is the low-effort pattern worth flagging; a
  // long, substantive answer that happens to reuse a few question words
  // (normal — people echo phrasing when answering) isn't.
  return overlap / answerWords.length >= ANSWER_ECHO_OVERLAP_THRESHOLD;
}

/**
 * Live Consistency Engine (BRD BR-42) — the Q&A-side half. Cross-verifies a
 * stated number spoken during VideoPD against the same figure the borrower
 * already typed into their loan application, exactly the BRD's own worked
 * example ("stated income vs. declared household cash flow").
 *
 * A question is only treated as an income question by its KEY, not by
 * matching words in its displayed text — VideoPdAnswer.questionText is
 * captured verbatim in whatever language the borrower actually saw (see the
 * schema's own comment on that column), so an English keyword check against
 * it would silently never fire for a Hindi/Telugu/Tamil/Kannada/Malayalam
 * borrower. The `key` is a stable, code-level identifier independent of
 * display language (VideoPdQuestionConfig.key), which is exactly what it's
 * for — the same reason api routes key off it rather than prompt text.
 * None of the 9 originally-seeded questions ask about income; this only
 * activates once a question exists whose key marks it as one (see
 * scripts/seed-income-questions.ts, added through the same admin
 * draft -> translate -> approve pipeline as any other question).
 *
 * Number extraction reuses dialogManager's real multiplier-aware parser
 * (extractFieldValue against the "monthlyIncome" form field) rather than a
 * separate regex — the same lakh/crore/thousand-word and Indic-digit
 * handling already proven on the application form itself, in the borrower's
 * own language, not just bare English digits.
 */
export const INCOME_QUESTION_KEY_PATTERN = /income/i;
export const INCOME_QA_CONSISTENCY_THRESHOLD = 0.3; // 30% relative difference — a starting default, not a Lakshya-calibrated number; same honest footing as ANSWER_SIMILARITY_THRESHOLD above

export function isIncomeQuestion(questionKey: string): boolean {
  return INCOME_QUESTION_KEY_PATTERN.test(questionKey);
}

export function extractStatedIncomeFromAnswer(answerText: string, lang: LangCode, segment?: SegmentCode): number | null {
  const result = extractFieldValue("monthlyIncome", answerText, lang, segment);
  return result.ok && typeof result.value === "number" ? result.value : null;
}

export function checkIncomeConsistency(declaredMonthlyIncome: number, statedMonthlyIncome: number): { flagged: boolean; diffPct: number } {
  const diff = Math.abs(declaredMonthlyIncome - statedMonthlyIncome) / declaredMonthlyIncome;
  return { flagged: diff > INCOME_QA_CONSISTENCY_THRESHOLD, diffPct: Math.round(diff * 100) };
}

/**
 * Mock document quality / authenticity checks (FSD Section 6.3, FR-DOC-05/06).
 * A real build wires this to actual blur/glare detection and document
 * authenticity models. Here we do lightweight, honest heuristics so the
 * prototype's "flagged" path is actually reachable, not just decorative.
 */
export function mockQualityCheck(fileSizeBytes: number, mimeType: string) {
  const MIN_BYTES = 15_000; // suspiciously small file → likely blank/corrupt
  if (fileSizeBytes < MIN_BYTES) {
    return { status: "FLAGGED" as const, notes: "File is unusually small — please re-capture with better lighting/focus." };
  }
  if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
    return { status: "FLAGGED" as const, notes: "Unsupported file type." };
  }
  return { status: "PASSED" as const, notes: null };
}

/**
 * Mock LOS Auto-Analysis (FSD Section 7.2, FR-LOS-01 to 03).
 * Runs completeness + a few plausible consistency/outlier heuristics over
 * whatever the borrower actually submitted. Deterministic and explainable —
 * no black-box scoring — matching FR-LOS-03's "advisory only" framing.
 */
export function runAutoAnalysis(input: {
  fields: Record<string, unknown>;
  evidenceCount: number;
  requiredEvidenceCount: number;
  flaggedEvidenceCount: number;
  otherLeadCount?: number;
  sharedDeviceLeadCount?: number;
  // BR-43 — real, staff-editable numbers (src/lib/riskParameters.ts,
  // /staff/risk-parameters), generic industry-standard defaults until
  // Lakshya provides their own. Optional so existing callers/tests that
  // don't pass one still get sensible generic behavior.
  riskParameters?: { maxLoanToIncomeMultiple: number; assumedAnnualInterestRatePct: number; maxEmiToIncomeRatioPct: number };
}): { riskFlags: RiskFlag[]; completenessScore: number } {
  const flags: RiskFlag[] = [];
  const {
    fields, evidenceCount, requiredEvidenceCount, flaggedEvidenceCount,
    otherLeadCount = 0, sharedDeviceLeadCount = 0, riskParameters = DEFAULT_RISK_PARAMETERS,
  } = input;

  const requiredFields = ["fullName", "idNumber", "requestedAmount", "monthlyIncome", "currentAddress"];
  const missing = requiredFields.filter((f) => !fields[f]);
  const completenessScore = Math.round(
    ((requiredFields.length - missing.length) / requiredFields.length) * 60 +
      (Math.min(evidenceCount, requiredEvidenceCount) / requiredEvidenceCount) * 40
  );

  if (missing.length > 0) {
    flags.push({
      code: "INCOMPLETE",
      label: "Incomplete application",
      severity: missing.length > 2 ? "high" : "medium",
      detail: `Missing: ${missing.join(", ")}`,
    });
  }

  if (flaggedEvidenceCount > 0) {
    flags.push({
      code: "DOC_QUALITY",
      label: "Document quality flagged",
      severity: "medium",
      detail: `${flaggedEvidenceCount} document(s) failed the automated quality check.`,
    });
  }

  const amount = Number(fields.requestedAmount ?? 0);
  const income = Number(fields.monthlyIncome ?? 0);
  if (amount > 0 && income > 0 && amount > income * riskParameters.maxLoanToIncomeMultiple) {
    flags.push({
      code: "AMOUNT_OUTLIER",
      label: "Requested amount is a high multiple of stated income",
      severity: "low",
      detail: `Requested ₹${amount.toLocaleString("en-IN")} vs. ~₹${income.toLocaleString("en-IN")}/month stated income (threshold: ${riskParameters.maxLoanToIncomeMultiple}x).`,
    });
  }

  // Real, generic industry-standard affordability check — FOIR-style (Fixed
  // Obligation to Income Ratio), a standard Indian retail/microfinance
  // underwriting convention, not Lakshya's own calibrated risk appetite
  // (BRD Section 12, see src/lib/riskParameters.ts for the citation and the
  // honest scope of what this is/isn't). Uses a standard reducing-balance
  // EMI estimate off a generic assumed interest rate, since no actual quoted
  // rate is captured elsewhere in this application's data.
  const tenureMonths = Number(fields.tenureMonths ?? 0);
  if (amount > 0 && income > 0 && tenureMonths > 0) {
    const estimatedEmi = estimateMonthlyEmi(amount, riskParameters.assumedAnnualInterestRatePct, tenureMonths);
    if (estimatedEmi !== null) {
      const emiToIncomeRatioPct = Math.round((estimatedEmi / income) * 100);
      if (emiToIncomeRatioPct > riskParameters.maxEmiToIncomeRatioPct) {
        flags.push({
          code: "EMI_AFFORDABILITY",
          label: "Estimated EMI is a high share of stated income",
          severity: emiToIncomeRatioPct > riskParameters.maxEmiToIncomeRatioPct * 1.5 ? "high" : "medium",
          detail: `Estimated EMI ₹${Math.round(estimatedEmi).toLocaleString("en-IN")}/month (at an assumed ${riskParameters.assumedAnnualInterestRatePct}% p.a., not a quoted rate) is ~${emiToIncomeRatioPct}% of stated monthly income — above the ${riskParameters.maxEmiToIncomeRatioPct}% threshold. Does not account for existing obligations (free-text, not structured data).`,
        });
      }
    }
  }

  // Nothing previously checked whether this same borrower (same mobile,
  // hence same Borrower row) already has another application in the system
  // — a fresh DRAFT gets reused automatically (see /api/application), but
  // once that one is SUBMITTED, the next application is a genuinely new
  // Lead with zero connection back to the earlier one. An underwriter
  // reviewing it had no way to know the borrower had applied before at all.
  // Advisory only, like every other flag here — a repeat applicant isn't
  // inherently a problem, just something worth a look.
  if (otherLeadCount > 0) {
    flags.push({
      code: "MULTIPLE_APPLICATIONS",
      label: "Borrower has other applications on file",
      severity: "low",
      detail: `This borrower has ${otherLeadCount} other application${otherLeadCount === 1 ? "" : "s"} in the system.`,
    });
  }

  // The mirror of MULTIPLE_APPLICATIONS above — same device (real client-side
  // fingerprint, src/lib/deviceFingerprint.ts), different borrower. A single
  // shared device isn't inherently suspicious (a family phone, a cyber cafe,
  // an agent legitimately helping several applicants) but repeated reuse
  // across otherwise-unrelated identities is a real loan-stacking/device-farm
  // pattern worth an underwriter's attention — higher severity than a repeat
  // applicant on their own device, since there's no benign single reading
  // that fully explains it away.
  if (sharedDeviceLeadCount > 0) {
    flags.push({
      code: "SHARED_DEVICE",
      label: "Same device used for other applicants",
      severity: sharedDeviceLeadCount > 1 ? "high" : "medium",
      detail: `This device's fingerprint matches ${sharedDeviceLeadCount} other applicant${sharedDeviceLeadCount === 1 ? "'s" : "s'"} submission${sharedDeviceLeadCount === 1 ? "" : "s"}.`,
    });
  }

  return { riskFlags: flags, completenessScore: Math.max(0, Math.min(100, completenessScore)) };
}

/**
 * Turns the raw, real, on-device liveness/face-match signals gathered during
 * VideoPD Step 1 (src/lib/liveness.ts, src/lib/faceMatch.ts — actual blink
 * detection and face-recognition-model distance, not a placeholder) into the
 * same PASSED/FLAGGED verdict + human-readable notes shape as every other
 * check in this file. Deterministic, explainable, advisory only — a FLAGGED
 * result means "an underwriter should look at this clip," never an
 * auto-block of the borrower, matching FR-LOS-03's framing above.
 */
const FACE_MATCH_DISTANCE_THRESHOLD = 0.6; // must match src/lib/faceMatch.ts's constant of the same name

// Glance flagging is normalized to a rate (per 30s of recording) rather than
// a flat count, because "4 glances" means something very different in a 20s
// clip than in a 90s one — a flat threshold either over-flags long, entirely
// normal recordings or under-flags short, actually-suspicious ones. A rate
// of 1 glance roughly every 10s sustained across the clip is the repeated-
// checking pattern worth a look; occasional single glances aren't.
const SUSPICIOUS_GLANCE_RATE_PER_30S = 3;
// Floor the denominator so a near-zero-length clip (a borrower who barely
// recorded anything) can't inflate a couple of glances into an extreme rate.
const MIN_SECONDS_FOR_GLANCE_RATE = 5;

export function evaluateLivenessResult(input: {
  blinkCount: number;
  framesAnalyzed: number;
  noFacePct: number; // 0-100
  lookedAwayPct: number; // 0-100
  offCameraGlances: number; // discrete look-away-then-back events (src/lib/liveness.ts's AttentionTracker) — the actual coaching-detection signal, distinct from lookedAwayPct's cumulative time
  recordingSeconds: number; // clip length, used to normalize offCameraGlances into a rate rather than judging it as a flat count
  faceMatch: { attempted: boolean; distance: number | null; matched: boolean | null; skippedReason?: string };
}): { status: "PASSED" | "FLAGGED"; notes: string } {
  const { blinkCount, framesAnalyzed, noFacePct, lookedAwayPct, offCameraGlances, recordingSeconds, faceMatch } = input;

  if (framesAnalyzed === 0) {
    return { status: "FLAGGED", notes: "Liveness check could not run — no frames were analyzed during recording." };
  }

  const notes: string[] = [];
  let flagged = false;

  if (blinkCount > 0) {
    notes.push(`${blinkCount} blink${blinkCount === 1 ? "" : "s"} detected during recording.`);
  } else {
    flagged = true;
    notes.push("No blink detected during the recording — recommend manual review.");
  }

  if (noFacePct > 40) {
    flagged = true;
    notes.push(`No face detected for ${noFacePct}% of the recording.`);
  }
  if (lookedAwayPct > 40) {
    flagged = true;
    notes.push(`Borrower appeared to look away from the camera for ${lookedAwayPct}% of the recording.`);
  }

  const glanceRatePer30s = (offCameraGlances / Math.max(recordingSeconds, MIN_SECONDS_FOR_GLANCE_RATE)) * 30;
  if (offCameraGlances > 0 && glanceRatePer30s >= SUSPICIOUS_GLANCE_RATE_PER_30S) {
    flagged = true;
    notes.push(
      `Borrower glanced off-camera ${offCameraGlances} separate time${offCameraGlances === 1 ? "" : "s"} during a ${recordingSeconds}s recording (~${glanceRatePer30s.toFixed(1)} per 30s) — a pattern that can indicate reading from another screen or prompting off-camera; recommend manual review.`
    );
  } else if (offCameraGlances > 0) {
    notes.push(`Looked away from the camera ${offCameraGlances} time${offCameraGlances === 1 ? "" : "s"} during a ${recordingSeconds}s recording.`);
  }

  if (faceMatch.attempted && faceMatch.distance !== null) {
    if (faceMatch.matched) {
      notes.push(`Face match vs. ID proof: distance ${faceMatch.distance.toFixed(2)} (same person, threshold ${FACE_MATCH_DISTANCE_THRESHOLD.toFixed(2)}).`);
    } else {
      flagged = true;
      notes.push(`Face match vs. ID proof did not pass: distance ${faceMatch.distance.toFixed(2)} (threshold ${FACE_MATCH_DISTANCE_THRESHOLD.toFixed(2)}) — recommend manual review.`);
    }
  } else {
    notes.push(faceMatch.skippedReason ?? "Face-match vs. ID proof was skipped.");
  }

  return { status: flagged ? "FLAGGED" : "PASSED", notes: notes.join(" ") };
}

// Stable code so api/videopd/[token]/liveness-result can replace (not
// duplicate) this flag in a Lead's summary.riskFlags across calls, and so a
// later clean result can remove it again rather than leaving a stale flag
// behind.
export const IDENTITY_RISK_FLAG_CODE = "IDENTITY_VERIFICATION";

/** Wraps an evaluateLivenessResult FLAGGED verdict as a RiskFlag, so it can
 * join summary.riskFlags — the same array /api/submit populates and the
 * underwriter queue's riskSeverity badge is derived from — putting a failed
 * liveness/face-match/glance check in front of an underwriter browsing the
 * queue, not only one who has already opened this specific case. */
export function identityVerificationRiskFlag(notes: string): RiskFlag {
  return { code: IDENTITY_RISK_FLAG_CODE, label: "Identity verification flagged", severity: "medium", detail: notes };
}

export function riskSeverityOf(flags: RiskFlag[]): "none" | "low" | "medium" | "high" {
  if (flags.some((f) => f.severity === "high")) return "high";
  if (flags.some((f) => f.severity === "medium")) return "medium";
  if (flags.some((f) => f.severity === "low")) return "low";
  return "none";
}
