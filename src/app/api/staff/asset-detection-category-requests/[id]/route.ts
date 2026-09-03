import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addApprovedCategory } from "@/lib/assetDetectionSegmentSettings";
import type { SegmentCode } from "@/types";

// Approver decides one underwriter-filed category request (approve/
// reject) — see AssetDetectionCategoryRequest's schema doc comment for
// the full picture. Approving adds the label onto that segment's
// AssetDetectionSegmentSettings allow-list (addApprovedCategory) but does
// NOT make it actually detectable — the underlying model's vocabulary is
// fixed at 80 COCO categories. This is a governance/audit action, not a
// live capability toggle.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as {
    staffName?: string;
    staffRole?: string;
    decision?: "APPROVED" | "REJECTED";
  };
  const { staffName, staffRole, decision } = body;

  if (staffRole !== "APPROVER") {
    return NextResponse.json({ error: "Only an Approver can decide a category request." }, { status: 403 });
  }
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return NextResponse.json({ error: "decision must be APPROVED or REJECTED." }, { status: 400 });
  }

  const existing = await db.assetDetectionCategoryRequest.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (existing.status !== "PENDING") {
    return NextResponse.json({ error: `This request was already ${existing.status.toLowerCase()}.` }, { status: 409 });
  }
  // Maker-checker: block approving your own request, same as
  // decideScorecardRevision (src/lib/assetScorecardRevisions.ts).
  if (decision === "APPROVED" && existing.requestedBy === staffName) {
    return NextResponse.json({ error: "Maker-checker: the person who filed a request can't also approve it — ask another Approver to review it." }, { status: 403 });
  }

  const updated = await db.assetDetectionCategoryRequest.update({
    where: { id },
    data: { status: decision, decidedBy: staffName ?? null, decidedAt: new Date() },
  });

  if (decision === "APPROVED") {
    await addApprovedCategory(existing.segment as SegmentCode, existing.label);
  }

  return NextResponse.json({ request: updated });
}
