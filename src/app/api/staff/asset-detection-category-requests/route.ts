import { NextRequest, NextResponse } from "next/server";
import { listCategoryRequests, createCategoryRequest } from "@/lib/assetDetectionCategoryRequests";
import type { SegmentCode } from "@/types";

const VALID_SEGMENTS: SegmentCode[] = ["FARMER", "VOCATIONAL_STUDENT", "BUSINESS_OWNER"];

// Underwriter-proposed additions to a segment's asset-detection category
// list (src/lib/assetDetectionCategoryRequests.ts) — GET lists a segment's
// requests (any status), POST files a new one. Open to any staff role,
// not Approver-only — an underwriter is exactly who'd notice a category
// worth tracking while reviewing a case. Deciding a request (approve/
// reject) is Approver-only — see the [id] route.
export async function GET(req: NextRequest) {
  const segment = new URL(req.url).searchParams.get("segment") as SegmentCode | null;
  if (!segment || !VALID_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  const requests = await listCategoryRequests(segment);
  return NextResponse.json({ requests });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    segment?: string;
    staffName?: string;
    label?: string;
    note?: string;
  };
  const { segment, staffName, label, note } = body;

  if (!segment || !VALID_SEGMENTS.includes(segment as SegmentCode)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  if (!staffName) {
    return NextResponse.json({ error: "staffName is required." }, { status: 400 });
  }
  if (!label || !label.trim()) {
    return NextResponse.json({ error: "label is required." }, { status: 400 });
  }

  const request = await createCategoryRequest(segment as SegmentCode, label, staffName, note?.trim() || null);
  return NextResponse.json({ request });
}
