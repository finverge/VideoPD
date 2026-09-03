import { NextRequest, NextResponse } from "next/server";
import { getAssetDetectionSegmentSettings } from "@/lib/assetDetectionSegmentSettings";
import { listScorecardRevisions, proposeScorecardRevision } from "@/lib/assetScorecardRevisions";
import { ASSET_DETECTION_CATEGORIES } from "@/lib/assetDetectionCategories";
import type { SegmentCode } from "@/types";

const VALID_SEGMENTS: SegmentCode[] = ["FARMER", "VOCATIONAL_STUDENT", "BUSINESS_OWNER"];

// The Asset Scorecard's own endpoint — separate from
// api/staff/asset-detection-categories (which still exists for the
// individual category-request flow's addApprovedCategory writes, but is
// no longer used for direct bulk edits). GET returns the LIVE settings
// for a segment plus its revision history; POST files a new maker-checker
// proposal (any staff role — see AssetScorecardRevision's schema doc
// comment). Deciding a proposal is a separate endpoint
// (api/staff/asset-scorecard/[revisionId]).
export async function GET(req: NextRequest) {
  const segment = new URL(req.url).searchParams.get("segment") as SegmentCode | null;
  if (!segment || !VALID_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  const [settings, revisions] = await Promise.all([
    getAssetDetectionSegmentSettings(segment),
    listScorecardRevisions(segment),
  ]);
  return NextResponse.json({ settings, revisions, allCategories: ASSET_DETECTION_CATEGORIES });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    segment?: string;
    staffName?: string;
    categories?: string[];
    weights?: Record<string, number>;
    manualItems?: string[];
    note?: string;
  };
  const { segment, staffName, categories, weights, manualItems, note } = body;

  if (!segment || !VALID_SEGMENTS.includes(segment as SegmentCode)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  if (!staffName) {
    return NextResponse.json({ error: "staffName is required." }, { status: 400 });
  }
  if (!Array.isArray(categories) || categories.some((c) => typeof c !== "string")) {
    return NextResponse.json({ error: "categories must be an array of strings." }, { status: 400 });
  }
  if (!Array.isArray(manualItems) || manualItems.some((c) => typeof c !== "string")) {
    return NextResponse.json({ error: "manualItems must be an array of strings." }, { status: 400 });
  }
  if (typeof weights !== "object" || weights === null || Array.isArray(weights)) {
    return NextResponse.json({ error: "weights must be an object of {label: number}." }, { status: 400 });
  }
  for (const [label, value] of Object.entries(weights)) {
    if (typeof label !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
      return NextResponse.json({ error: "Every weight entry must be a string label mapped to a finite number." }, { status: 400 });
    }
  }

  const revision = await proposeScorecardRevision(
    segment as SegmentCode, categories, weights, manualItems, staffName, note?.trim() || null,
  );
  return NextResponse.json({ revision });
}
