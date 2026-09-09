import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Every prior CAM generation for a case, newest first — a document used to
// justify and audit a sanction decision must stay individually retrievable,
// not just the latest, same "history is never rewritten" principle as
// LeadDecision (the maker-checker audit trail) elsewhere in this app.
// Matched to DLP/LOS's own GET /cases/{id}/cam/history endpoint.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const history = await db.creditAppraisalMemo.findMany({
    where: { leadId: id },
    orderBy: { generatedAt: "desc" },
    select: { id: true, generatedBy: true, generatedAt: true },
  });
  return NextResponse.json(history);
}
