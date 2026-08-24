import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Checker step: the approver confirms, rejects, or sends the case back to the
// underwriter for rework. Enforces the "two eyes" rule server-side (not just
// hiding the button in the UI) — the approver can never be the same person
// who made the recommendation, same as the claim/decision split above.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staffName, decision, notes } = (await req.json()) as {
    staffName?: string;
    decision?: "APPROVED" | "REJECTED" | "SENT_BACK";
    notes?: string;
  };
  if (!staffName || !decision) {
    return NextResponse.json({ error: "staffName and decision are required." }, { status: 400 });
  }

  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lead.status !== "AWAITING_CHECKER_REVIEW") {
    return NextResponse.json({ error: `Case is not awaiting checker review (currently ${lead.status}).` }, { status: 409 });
  }
  if (lead.assignedUnderwriter === staffName) {
    return NextResponse.json({ error: "The approver must be different from the underwriter who recommended this case." }, { status: 403 });
  }

  const decidedAt = new Date();
  const updated = await db.lead.update({
    where: { id },
    data: {
      status: decision,
      approverName: staffName,
      approverDecision: decision,
      approverNotes: notes ?? null,
      approverDecidedAt: decidedAt,
    },
  });
  // LeadDecision is the real audit trail (every round); the fields above are
  // kept in sync as a "current round" convenience but get overwritten on the
  // next round after a send-back — see the model's doc comment.
  await db.leadDecision.create({
    data: { leadId: id, actorRole: "APPROVER", actorName: staffName, action: decision, notes: notes ?? null, decidedAt },
  });
  return NextResponse.json({ lead: updated });
}
