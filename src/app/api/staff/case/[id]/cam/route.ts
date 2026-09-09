import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildCamSnapshot } from "@/lib/camSnapshot";

// Credit Appraisal Memo — generate (POST) and get-latest (GET). Matched to
// DLP/LOS's real underwriting-decisioning service's own CAM endpoints
// (POST/GET /cases/{id}/cam) — see camSnapshot.ts's own doc comment for the
// full field-mapping rationale. POST always creates a NEW row, never
// updates one — a document used to justify a sanction decision must stay
// exactly as it was at generation time, same principle as LeadDecision
// never being edited in place elsewhere in this app.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staffName } = (await req.json()) as { staffName?: string };
  if (!staffName) return NextResponse.json({ error: "staffName is required." }, { status: 400 });

  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const snapshot = await buildCamSnapshot(id);
  const memo = await db.creditAppraisalMemo.create({
    data: { leadId: id, generatedBy: staffName, snapshotJson: JSON.stringify(snapshot) },
  });

  return NextResponse.json({ id: memo.id, generatedBy: memo.generatedBy, generatedAt: memo.generatedAt }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const latest = await db.creditAppraisalMemo.findFirst({
    where: { leadId: id },
    orderBy: { generatedAt: "desc" },
    select: { id: true, generatedBy: true, generatedAt: true },
  });
  if (!latest) return NextResponse.json({ error: "No CAM generated yet for this case." }, { status: 404 });
  return NextResponse.json(latest);
}
