import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({
    where: { token },
    include: {
      answers: true,
      bankStatements: true,
      lead: { include: { application: { include: { borrower: true } } } },
    },
  });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });

  // Auto-transition NOT_STARTED -> IN_PROGRESS on first real load, so the
  // underwriter's case view can distinguish "link sent" from "borrower opened it".
  if (session.status === "NOT_STARTED") {
    await db.videoPdSession.update({ where: { id: session.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    session.status = "IN_PROGRESS";
  }

  // Only APPROVED questions ever reach a borrower — a DRAFT question mid-review
  // (or one an admin just edited back into DRAFT) must never appear live.
  const questions = await db.videoPdQuestionConfig.findMany({
    where: { segment: session.lead.application.segment, status: "APPROVED" },
    orderBy: { orderIndex: "asc" },
  });

  return NextResponse.json({ session, questions });
}

// Session step-resume (see docs/videopd-future-work.md item 13): each
// completed step's actual data (answers, captures, statement) was already
// safely persisted, but the guided-flow UI always restarted at "welcome" on
// reload — VideoPdSession.currentStep existed in the schema for exactly this
// but nothing ever wrote to it. This is the write side; the borrower page
// reads it back on load to resume at the right step instead.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { currentStep } = (await req.json()) as { currentStep?: number };
  if (typeof currentStep !== "number" || !Number.isInteger(currentStep) || currentStep < 0) {
    return NextResponse.json({ error: "currentStep must be a non-negative integer." }, { status: 400 });
  }

  const session = await db.videoPdSession.findUnique({ where: { token } });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  if (session.status === "COMPLETE") {
    return NextResponse.json({ error: "This verification is already complete." }, { status: 409 });
  }

  const updated = await db.videoPdSession.update({ where: { id: session.id }, data: { currentStep } });
  return NextResponse.json({ session: updated });
}
