import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PROMPT_FIELDS = ["promptEn", "promptHi", "promptTe", "promptTa", "promptKn", "promptMl"] as const;

// Edits a question's prompt text/order. Editing any prompt text on an
// APPROVED question resets it to DRAFT — an edited question must be
// re-approved before it goes back out to borrowers, same governance
// principle as the rest of the staff workspace's review gates.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  const existing = await db.videoPdQuestionConfig.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const promptChanged = PROMPT_FIELDS.some((f) => f in body && body[f] !== (existing as any)[f]);
  const data: Record<string, unknown> = {};
  for (const f of PROMPT_FIELDS) if (f in body) data[f] = body[f];
  if ("orderIndex" in body) data.orderIndex = body.orderIndex;
  if (promptChanged && existing.status === "APPROVED") {
    data.status = "DRAFT";
    data.approvedBy = null;
    data.approvedAt = null;
  }

  const question = await db.videoPdQuestionConfig.update({ where: { id }, data });
  return NextResponse.json({ question });
}
