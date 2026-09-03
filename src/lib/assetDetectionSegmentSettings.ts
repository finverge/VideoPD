import { db } from "@/lib/db";
import {
  ASSET_DETECTION_DEFAULT_CATEGORIES_BY_SEGMENT,
  ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT,
  ASSET_DETECTION_DEFAULT_WEIGHTS_BY_SEGMENT,
} from "@/lib/assetDetectionCategories";
import type { SegmentCode } from "@/types";

/**
 * Per-segment allow-list of which of the 80 COCO categories
 * (src/lib/assetDetectionCategories.ts) the work-premises asset checklist
 * may surface — requested live: what's worth listing genuinely differs by
 * segment (a farmer's premises checklist cares about categories like
 * "cow"/"truck", a vocational student's about "laptop"/"book"/"chair").
 * Same one-row-per-segment pattern as riskParameters.ts's
 * getRiskParameters. The on/off switch for the check itself
 * (FeatureSettings.assetDetectionCheckEnabled) stays global/app-wide —
 * this only controls WHICH categories a segment's checklist may list once
 * the check is on.
 *
 * Also owns two related, in-house-configurable pieces (requested live, so
 * this isn't dependent on Lakshya supplying anything): a per-label point
 * value (weightsJson) feeding computeAssetChecklistScore below, and a
 * curated list of India-relevant equipment names the AI can never detect
 * (manualItemsJson) for the underwriter to manually confirm.
 *
 * Every segment is seeded on first touch with that segment's curated
 * starting values (ASSET_DETECTION_DEFAULT_* in assetDetectionCategories.ts
 * — NOT "all 80"/empty, see those constants' own doc comments for why)
 * until an Approver customizes them further at /staff/risk-parameters.
 */
export async function getAssetDetectionSegmentSettings(segment: SegmentCode) {
  const existing = await db.assetDetectionSegmentSettings.findUnique({ where: { segment } });
  if (existing) return existing;
  const categories = ASSET_DETECTION_DEFAULT_CATEGORIES_BY_SEGMENT[segment] ?? [];
  const manualItems = ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT[segment] ?? [];
  const weights = ASSET_DETECTION_DEFAULT_WEIGHTS_BY_SEGMENT[segment] ?? {};
  return db.assetDetectionSegmentSettings.create({
    data: {
      segment,
      categoriesJson: JSON.stringify(categories),
      manualItemsJson: JSON.stringify(manualItems),
      weightsJson: JSON.stringify(weights),
    },
  });
}

// Resolves a segment's categoriesJson (or manualItemsJson — same shape) to
// an actual string array — null/unparseable means "no filter configured
// yet", i.e. every category is allowed (categoriesJson) or no manual items
// exist (manualItemsJson, where the caller should treat null the same as
// []). Centralized here so runVoiceCheck.ts and the risk-parameters UI
// agree on exactly the same fallback.
export function resolveAssetDetectionCategories(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : null;
  } catch {
    return null;
  }
}

// Resolves weightsJson to a plain {label: number} map — unparseable or
// missing reads as {} (every label defaults to weight 0, i.e.
// "contributes nothing until configured" rather than erroring).
export function resolveAssetDetectionWeights(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [label, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) out[label] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// The weighted checklist score — an admin-configured rubric total, NOT an
// outcome-calibrated valuation (that still needs Lakshya's real
// loan-performance data; see the feasibility note and
// VoiceBiometricCheck.assetChecklistScore's own doc comment). Sums the
// weight for every DISTINCT label present across the AI-detected
// checklist and the underwriter's manual ticks — deduped once per label
// (not multiplied by detection count, since the detector's count
// reliability on cluttered handheld footage is itself unvalidated; see
// asset_detection.py). A label present in both the AI checklist and the
// manual ticks (e.g. an Approver added a formerly-manual item to the AI
// category list) still counts once.
export function computeAssetChecklistScore(
  aiChecklistLabels: string[],
  manualTickLabels: string[],
  weights: Record<string, number>,
): number {
  const distinctLabels = new Set([...aiChecklistLabels, ...manualTickLabels]);
  let total = 0;
  for (const label of distinctLabels) total += weights[label] ?? 0;
  return total;
}

// Adds one approved custom label onto a segment's allow-list — called when
// an Approver approves an AssetDetectionCategoryRequest
// (api/staff/asset-detection-category-requests/[id]/route.ts). Does NOT
// make the label actually detectable (see that model's own doc comment
// for why) — this only means the label is already allow-listed if a
// future model swap ever can output it, and gets a starting weight of 1
// (present-but-unconfigured, not 0/invisible) so it isn't silently inert
// in the score the moment it's approved. No-op if already present.
export async function addApprovedCategory(segment: SegmentCode, label: string) {
  const settings = await getAssetDetectionSegmentSettings(segment);
  const current = resolveAssetDetectionCategories(settings.categoriesJson) ?? [];
  if (current.includes(label)) return settings;
  const weights = resolveAssetDetectionWeights(settings.weightsJson);
  if (!(label in weights)) weights[label] = 1;
  return db.assetDetectionSegmentSettings.update({
    where: { segment },
    data: { categoriesJson: JSON.stringify([...current, label]), weightsJson: JSON.stringify(weights) },
  });
}
