import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Maker step: the underwriter records a recommendation, which moves the case
// to the checker's queue rather than deciding it outright — the whole point
// of maker-checker is that the same person never both recommends and confirms.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staffName, recommendation, notes } = (await req.json()) as {
    staffName?: string;
    recommendation?: "APPROVE" | "REJECT";
    notes?: string;
  };
  if (!staffName || !recommendation) {
    return NextResponse.json({ error: "staffName and recommendation are required." }, { status: 400 });
  }

  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lead.status !== "UNDER_REVIEW") {
    return NextResponse.json({ error: `Case must be claimed and under review (currently ${lead.status}).` }, { status: 409 });
  }
  if (lead.assignedUnderwriter !== staffName) {
    return NextResponse.json({ error: "This case is claimed by a different underwriter." }, { status: 403 });
  }

  const decidedAt = new Date();
  const updated = await db.lead.update({
    where: { id },
    data: {
      status: "AWAITING_CHECKER_REVIEW",
      underwriterName: staffName,
      underwriterRecommendation: recommendation,
      underwriterNotes: notes ?? null,
      underwriterDecidedAt: decidedAt,
    },
  });
  // LeadDecision is the real audit trail (every round); the fields above are
  // kept in sync as a "current round" convenience but get overwritten on the
  // next round after a send-back — see the model's doc comment.
  await db.leadDecision.create({
    data: { leadId: id, actorRole: "UNDERWRITER", actorName: staffName, action: recommendation, notes: notes ?? null, decidedAt },
  });
  return NextResponse.json({ lead: updated });
}
