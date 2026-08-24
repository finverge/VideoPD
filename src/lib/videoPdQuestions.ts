import type { LangCode } from "@/types";

/**
 * VideoPD Step 2 — Intent & Skill Assessment Q&A (BRD BR-24).
 *
 * Per BR-43 the scoring model must be "configurable against a lending
 * partner's own credit parameters and questionnaire, not a single fixed
 * model shared across all clients". The question set itself now lives in
 * VideoPdQuestionConfig (DB-backed, admin-managed via /staff/questions —
 * draft -> translate -> review -> approve, see api/staff/questions/) rather
 * than hardcoded here; this file was the original seed source (see
 * scripts/seed-videopd-questions.js) and still holds the pieces that stay
 * genuinely code, not content: the prompt-resolution helper and scoring.
 *
 * Scoring is intentionally simple and transparent (see scoreAnswer below) —
 * a rule-based placeholder for the real scoring model BR-43 describes, which
 * needs Lakshya's actual credit questionnaire (BRD Section 12, Dependencies:
 * "pending their baseline credit questionnaire and risk parameters") before
 * it can be built for real. Swapping this function's body is the seam.
 */

export interface DbQuestion {
  id: string;
  key: string;
  promptEn: string;
  promptHi: string | null;
  promptTe: string | null;
  promptTa: string | null;
  promptKn: string | null;
  promptMl: string | null;
}

const PROMPT_FIELD: Record<LangCode, keyof DbQuestion> = {
  en: "promptEn", hi: "promptHi", te: "promptTe", ta: "promptTa", kn: "promptKn", ml: "promptMl",
};

/** Admin-entered translations can be blank if a translation call failed at
 * creation time (see lib/translate.ts) — always fall back to English rather
 * than show an empty question. */
export function questionPrompt(q: DbQuestion, lang: LangCode): string {
  return (q[PROMPT_FIELD[lang]] as string | null) || q.promptEn;
}

/** 0-100. A real, answered-in-their-own-words response scores well; empty,
 * near-empty, or single-word non-answers score low. This is deliberately not
 * trying to judge the CONTENT of the answer (that needs the real scoring
 * model) — only whether the borrower engaged meaningfully, which is the
 * honest ceiling for a rule-based stand-in. */
export function scoreAnswer(answer: string): number {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return 0;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 1) return 20;
  if (wordCount <= 3) return 50;
  if (wordCount <= 6) return 75;
  return 100;
}

export function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
