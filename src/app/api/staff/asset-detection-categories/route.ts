import { NextRequest, NextResponse } from "next/server";
import { getAssetDetectionSegmentSettings } from "@/lib/assetDetectionSegmentSettings";
import { ASSET_DETECTION_CATEGORIES } from "@/lib/assetDetectionCategories";
import type { SegmentCode } from "@/types";

const VALID_SEGMENTS: SegmentCode[] = ["FARMER", "VOCATIONAL_STUDENT", "BUSINESS_OWNER"];

// Read-only lookup of a segment's LIVE asset-detection settings
// (categories/weights/manual items) — used by the case page
// (VoiceBiometricsCard) to render the manual-tick checklist and by
// anything else that just needs to read the current config. There is
// deliberately NO write endpoint here anymore: bulk edits go through
// maker-checker (api/staff/asset-scorecard — see AssetScorecardRevision's
// schema doc comment), and single custom-category approvals go through
// api/staff/asset-detection-category-requests. Writing directly here
// would bypass both review flows.
export async function GET(req: NextRequest) {
  const segment = new URL(req.url).searchParams.get("segment") as SegmentCode | null;
  if (!segment || !VALID_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  const settings = await getAssetDetectionSegmentSettings(segment);
  return NextResponse.json({ settings, allCategories: ASSET_DETECTION_CATEGORIES });
}
