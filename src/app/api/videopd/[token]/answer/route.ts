import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scoreAnswer } from "@/lib/videoPdQuestions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { questionKey, questionText, answerText } = (await req.json()) as {
    questionKey?: string;
    questionText?: string;
    answerText?: string;
  };
  if (!questionKey || !questionText || answerText === undefined) {
    return NextResponse.json({ error: "questionKey, questionText, and answerText are required." }, { status: 400 });
  }

  const session = await db.videoPdSession.findUnique({ where: { token } });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  if (session.status === "COMPLETE") {
    return NextResponse.json({ error: "This verification is already complete." }, { status: 409 });
  }

  const score = scoreAnswer(answerText);
  const answer = await db.videoPdAnswer.upsert({
    where: { sessionId_questionKey: { sessionId: session.id, questionKey } },
    update: { answerText, score },
    create: { sessionId: session.id, questionKey, questionText, answerText, score },
  });

  return NextResponse.json({ answer });
}
