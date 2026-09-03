import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { translateToAllLanguages } from "@/lib/translate";

// Edits a question's English prompt (and/or its order) — the other 5
// launch languages are never accepted as direct input here, only ever
// derived from promptEn via the same translateToAllLanguages call the
// create endpoint (api/staff/questions/route.ts) already uses. Reported
// live: the edit UI used to expose all 6 language fields as independently
// editable free text, which is backwards — staff drafting these questions
// generally can't read Hindi/Telugu/Tamil/Kannada/Malayalam well enough to
// safely hand-edit them, and a hand-edited translation could drift from
// the English prompt with nothing to notice. Editing any prompt text on an
// APPROVED question still resets it to DRAFT — an edited question must be
// re-approved before it goes back out to borrowers, same governance
// principle as the rest of the staff workspace's review gates.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  const existing = await db.videoPdQuestionConfig.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  const promptEnChanged = typeof body.promptEn === "string" && body.promptEn.trim() !== existing.promptEn;

  if (promptEnChanged) {
    const promptEn = (body.promptEn as string).trim();
    const translations = await translateToAllLanguages(promptEn);
    data.promptEn = promptEn;
    // A failed translation keeps whatever was already stored for that
    // language rather than blanking it out — unlike a brand-new question
    // (nothing to fall back to there), this is an edit to one that may
    // already have a perfectly good, previously-approved translation; a
    // transient translation-API hiccup shouldn't regress it to blank.
    data.promptHi = translations.hi.ok ? translations.hi.text : existing.promptHi;
    data.promptTe = translations.te.ok ? translations.te.text : existing.promptTe;
    data.promptTa = translations.ta.ok ? translations.ta.text : existing.promptTa;
    data.promptKn = translations.kn.ok ? translations.kn.text : existing.promptKn;
    data.promptMl = translations.ml.ok ? translations.ml.text : existing.promptMl;
  }
  if ("orderIndex" in body) data.orderIndex = body.orderIndex;
  if (promptEnChanged && existing.status === "APPROVED") {
    data.status = "DRAFT";
    data.approvedBy = null;
    data.approvedAt = null;
  }

  const question = await db.videoPdQuestionConfig.update({ where: { id }, data });
  return NextResponse.json({ question });
}
