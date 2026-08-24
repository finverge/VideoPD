import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// APPROVER role only, enforced server-side — same as the case maker-checker
// flow, a question never goes live to borrowers on the drafting staff
// member's own say-so.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staffName, staffRole } = (await req.json()) as { staffName?: string; staffRole?: string };
  if (!staffName || !staffRole) return NextResponse.json({ error: "staffName and staffRole are required." }, { status: 400 });
  if (staffRole !== "APPROVER") {
    return NextResponse.json({ error: "Only an Approver can approve a question." }, { status: 403 });
  }

  const existing = await db.videoPdQuestionConfig.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status === "ARCHIVED") return NextResponse.json({ error: "This question is archived." }, { status: 409 });

  const question = await db.videoPdQuestionConfig.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: staffName, approvedAt: new Date() },
  });
  return NextResponse.json({ question });
}
