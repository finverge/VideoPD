import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { averageScore } from "@/lib/videoPdQuestions";
import { translateText } from "@/lib/translate";
import {
  answerSimilarity, ANSWER_SIMILARITY_THRESHOLD, ANSWER_SIMILARITY_MIN_LENGTH, answerEchoesQuestion,
  isIncomeQuestion, extractStatedIncomeFromAnswer, checkIncomeConsistency,
} from "@/lib/mockChecks";
import type { LangCode } from "@/types";

interface DossierFlag {
  type: "consistency" | "completeness" | "engagement";
  label: string;
  detail: string;
}

// Compiles the VideoPD 2.0 Actionable Dossier (BRD BR-44) and closes the
// session. Everything here is advisory input for the underwriter's existing
// maker-checker review — nothing here approves or rejects anything (BRD
// Section 7.2 explicitly excludes automated, non-underwriter decisioning).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({
    where: { token },
    include: {
      answers: true,
      bankStatements: { orderBy: { createdAt: "desc" }, take: 1 },
      lead: { include: { application: { include: { evidence: true, borrower: true } } } },
    },
  });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  if (session.status === "COMPLETE") return NextResponse.json({ session });

  const app = session.lead.application;
  const flags: DossierFlag[] = [];
  // Moved up from where the bilingual-transcript step used to compute this —
  // the new Q&A income consistency check below needs it too, and both should
  // read the same value rather than deriving it twice.
  const borrowerLang = (session.lead.application.borrower.language as LangCode) ?? "en";

  const livenessCaptured = app.evidence.some((e) => e.type === "VIDEOPD_LIVENESS");
  const businessVerificationCaptured = app.evidence.some((e) => e.type === "VIDEOPD_BUSINESS_VERIFICATION");
  if (!livenessCaptured) flags.push({ type: "completeness", label: "Liveness capture missing", detail: "No identity/liveness video was recorded during this session." });
  if (!businessVerificationCaptured) flags.push({ type: "completeness", label: "Business verification capture missing", detail: "No live workplace/asset video was recorded during this session." });

  const statement = session.bankStatements[0];
  let bankStatementSummary: {
    status: string; eligibilityFlag: string | null; reasons: string[]; metrics: Record<string, number> | null;
  } | null = null;
  if (statement) {
    const metrics = statement.metricsJson ? JSON.parse(statement.metricsJson) : null;
    const reasons = statement.eligibilityReasonsJson ? JSON.parse(statement.eligibilityReasonsJson) : [];
    bankStatementSummary = { status: statement.status, eligibilityFlag: statement.eligibilityFlag, reasons, metrics };

    // Live Consistency Engine (BR-42) — the one cross-check this prototype can
    // do honestly with real data on both sides: stated income on the original
    // application vs. the income pattern found in the uploaded bank statement.
    // Broader answer-vs-application NLP consistency checking on the free-text
    // Q&A is future work (see docs/videopd-future-work.md) — matching numbers
    // is reliable; matching free-text claims isn't, without a real NLU model.
    if (metrics?.estimatedMonthlyIncome > 0 && app.monthlyIncome) {
      const declared = app.monthlyIncome;
      const observed = metrics.estimatedMonthlyIncome;
      const diff = Math.abs(declared - observed) / declared;
      if (diff > 0.4) {
        flags.push({
          type: "consistency",
          label: "Income mismatch",
          detail: `Declared monthly income (₹${declared.toLocaleString("en-IN")}) differs by ${Math.round(diff * 100)}% from the bank statement's estimated monthly income (₹${observed.toLocaleString("en-IN")}).`,
        });
      }
    }
  } else {
    flags.push({ type: "completeness", label: "Bank statement not provided", detail: "The borrower did not upload a bank statement during this session." });
  }

  // Cross-applicant answer reuse (BR-36's "similar transcripts across
  // applicants") — real lexical similarity (src/lib/mockChecks.ts's
  // answerSimilarity, Dice coefficient on bigrams), not NLU/semantic
  // matching: catches a canned answer literally reused or lightly reworded
  // across different applicants, not two genuinely different phrasings of
  // the same idea. One flag per question is enough — don't spam duplicates
  // if several other applicants happen to match.
  for (const a of session.answers) {
    if (a.answerText.trim().length < ANSWER_SIMILARITY_MIN_LENGTH) continue;
    const others = await db.videoPdAnswer.findMany({
      where: {
        questionKey: a.questionKey,
        session: { lead: { application: { borrowerId: { not: app.borrowerId } } } },
      },
      include: { session: { include: { lead: { include: { application: true } } } } },
    });
    for (const other of others) {
      const sim = answerSimilarity(a.answerText, other.answerText);
      if (sim >= ANSWER_SIMILARITY_THRESHOLD) {
        const otherName = other.session.lead.application.fullName ?? "another applicant";
        flags.push({
          type: "consistency",
          label: "Answer closely matches another applicant",
          detail: `The answer to "${a.questionText}" is a ${Math.round(sim * 100)}% lexical match to an answer from ${otherName} — possible scripted/coached response, worth a manual look.`,
        });
        break;
      }
    }
  }

  // The one honest partial slice of "judging Q&A answer content" this
  // prototype attempts (docs/videopd-future-work.md item 9) — real,
  // deterministic word-overlap (src/lib/mockChecks.ts's
  // answerEchoesQuestion), NOT a judgment of whether the content is
  // credit-relevant or plausible. Catches an answer that's substantially
  // just repeating the question's own wording back — a real low-effort/
  // scripted-response pattern — nothing more.
  for (const a of session.answers) {
    if (answerEchoesQuestion(a.answerText, a.questionText)) {
      flags.push({
        type: "engagement",
        label: "Answer closely echoes the question",
        detail: `The answer to "${a.questionText}" largely repeats the question's own wording rather than contributing new content — may indicate a low-effort or scripted response. A lexical pattern check only, not a judgment of whether the content itself is credible or relevant.`,
      });
    }
  }

  // Live Consistency Engine (BR-42), Q&A half — stated income spoken during
  // the session vs. the income the borrower already declared on their loan
  // application (the bank-statement half above covers a different data
  // source; this is the genuinely new signal — cross-verifying the session
  // itself against the application, in real time as answers come in during
  // the session, per BR-42's own wording). Advisory only, same as every
  // other flag here — never blocks the session.
  for (const a of session.answers) {
    if (!isIncomeQuestion(a.questionKey)) continue;
    if (!app.monthlyIncome) continue;
    const stated = extractStatedIncomeFromAnswer(a.answerText, borrowerLang, app.segment);
    if (stated === null) continue;
    const { flagged, diffPct } = checkIncomeConsistency(app.monthlyIncome, stated);
    if (flagged) {
      flags.push({
        type: "consistency",
        label: "Stated income differs from application",
        detail: `The borrower's spoken answer to "${a.questionText}" implies a monthly income of ~₹${stated.toLocaleString("en-IN")}, which differs by ${diffPct}% from the ₹${app.monthlyIncome.toLocaleString("en-IN")} declared on the loan application.`,
      });
    }
  }

  const skillIntentScore = averageScore(session.answers.map((a) => a.score));

  // Bilingual transcript (BR-45) — translate each answer to English so a
  // credit manager who doesn't read the borrower's language can still review
  // it. Real machine translation (see lib/translate.ts), not a stub; a
  // failed call is surfaced honestly via translationAvailable: false rather
  // than silently omitted or left looking identical to a successful one.
  const answers = await Promise.all(
    session.answers.map(async (a) => {
      if (borrowerLang === "en") {
        return { questionKey: a.questionKey, questionText: a.questionText, answerText: a.answerText, score: a.score, answerTextEn: null, translationAvailable: true };
      }
      const result = await translateText(a.answerText, borrowerLang, "en");
      return {
        questionKey: a.questionKey, questionText: a.questionText, answerText: a.answerText, score: a.score,
        answerTextEn: result.ok ? result.text : null,
        translationAvailable: result.ok,
      };
    })
  );

  const dossier = {
    skillIntentScore,
    answers,
    livenessCaptured,
    businessVerificationCaptured,
    bankStatement: bankStatementSummary,
    flags,
    generatedAt: new Date().toISOString(),
  };

  const updated = await db.videoPdSession.update({
    where: { id: session.id },
    data: {
      status: "COMPLETE",
      completedAt: new Date(),
      skillIntentScore,
      dossierJson: JSON.stringify(dossier),
    },
  });

  // Only advance the lead to VIDEOPD_COMPLETE if it's still in a pre-decision
  // state. Found via testing: this used to unconditionally overwrite lead
  // status, which meant completing a session on an already-decided case (a
  // stale link revisited, or — as happened here — re-running VideoPD on a
  // case for testing) silently reopened an APPROVED/REJECTED case back to
  // an in-progress-looking state, undoing a real maker-checker decision.
  const PRE_DECISION_STATUSES = ["NEW", "UNDER_REVIEW", "VIDEOPD_SCHEDULED", "SENT_BACK"];
  const lead = await db.lead.findUnique({ where: { id: session.leadId } });
  if (lead && PRE_DECISION_STATUSES.includes(lead.status)) {
    await db.lead.update({ where: { id: session.leadId }, data: { status: "VIDEOPD_COMPLETE" } });
  }

  return NextResponse.json({ session: updated, dossier });
}
