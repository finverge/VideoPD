import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { translateToAllLanguages } from "@/lib/translate";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const segment = searchParams.get("segment");
  const questions = await db.videoPdQuestionConfig.findMany({
    where: segment ? { segment: segment as any } : undefined,
    orderBy: [{ segment: "asc" }, { orderIndex: "asc" }],
  });
  return NextResponse.json({ questions });
}

// Drafts a new question — auto-translates the English prompt into the other
// 5 launch languages as a starting point (BR-43's "configurable" ask,
// extended per this conversation to draft -> review -> approve). Every
// translation is editable before approval; a failed translation just leaves
// that language blank rather than blocking creation, so a translation-API
// hiccup never stops staff from drafting a question.
export async function POST(req: NextRequest) {
  const { staffName, segment, key, promptEn, orderIndex } = (await req.json()) as {
    staffName?: string; segment?: string; key?: string; promptEn?: string; orderIndex?: number;
  };
  if (!staffName || !segment || !key || !promptEn?.trim()) {
    return NextResponse.json({ error: "staffName, segment, key, and promptEn are required." }, { status: 400 });
  }

  const existing = await db.videoPdQuestionConfig.findUnique({ where: { segment_key: { segment: segment as any, key } } });
  if (existing) return NextResponse.json({ error: "A question with this key already exists for this segment." }, { status: 409 });

  const translations = await translateToAllLanguages(promptEn.trim());

  const question = await db.videoPdQuestionConfig.create({
    data: {
      segment: segment as any,
      key,
      orderIndex: orderIndex ?? 0,
      status: "DRAFT",
      promptEn: promptEn.trim(),
      promptHi: translations.hi.ok ? translations.hi.text : null,
      promptTe: translations.te.ok ? translations.te.text : null,
      promptTa: translations.ta.ok ? translations.ta.text : null,
      promptKn: translations.kn.ok ? translations.kn.text : null,
      promptMl: translations.ml.ok ? translations.ml.text : null,
      createdBy: staffName,
    },
  });

  const translationWarnings = Object.entries(translations)
    .filter(([, r]) => !r.ok)
    .map(([lang]) => lang);

  return NextResponse.json({ question, translationWarnings });
}
