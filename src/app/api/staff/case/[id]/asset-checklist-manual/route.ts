import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getAssetDetectionSegmentSettings, resolveAssetDetectionCategories,
  resolveAssetDetectionWeights, computeAssetChecklistScore,
} from "@/lib/assetDetectionSegmentSettings";
import type { SegmentCode } from "@/types";

// Lets the underwriter record which of a segment's manual reference items
// (AssetDetectionSegmentSettings.manualItemsJson — India-relevant
// equipment the AI detector can never recognize, see that field's own doc
// comment) they've personally confirmed seeing in the business-
// verification video. A human tick, not a detection — independent of
// when/whether the AI check last ran, and recomputes the combined
// weighted score (VoiceBiometricCheck.assetChecklistScore) every time.
// [id] here is the LEAD id, same as the rest of api/staff/case/[id] — not
// the LoanApplication id.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { ticks?: string[] };
  const { ticks } = body;

  if (!Array.isArray(ticks) || ticks.some((t) => typeof t !== "string")) {
    return NextResponse.json({ error: "ticks must be an array of strings." }, { status: 400 });
  }

  const lead = await db.lead.findUnique({ where: { id }, include: { application: true } });
  if (!lead?.application) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }
  const applicationId = lead.application.id;
  const segment = lead.application.segment as SegmentCode;

  const segmentSettings = await getAssetDetectionSegmentSettings(segment);
  const manualItems = resolveAssetDetectionCategories(segmentSettings.manualItemsJson) ?? [];
  // Silently drop anything not currently a configured manual item for this
  // segment (e.g. it was removed after the underwriter's tab was loaded)
  // rather than erroring — forgiving, same spirit as the rest of this
  // prototype-grade staff tooling.
  const validTicks = ticks.filter((t) => manualItems.includes(t));

  const existingCheck = await db.voiceBiometricCheck.findUnique({
    where: { applicationId },
    select: { assetDetectionChecklistJson: true },
  });
  let aiLabels: string[] = [];
  if (existingCheck?.assetDetectionChecklistJson) {
    try {
      const parsed = JSON.parse(existingCheck.assetDetectionChecklistJson);
      if (Array.isArray(parsed)) aiLabels = parsed.map((item: { label: string }) => item.label);
    } catch {
      // leave aiLabels empty — malformed stored JSON shouldn't block a manual-tick save
    }
  }

  const weights = resolveAssetDetectionWeights(segmentSettings.weightsJson);
  const score = computeAssetChecklistScore(aiLabels, validTicks, weights);

  const updated = await db.voiceBiometricCheck.upsert({
    where: { applicationId },
    create: {
      applicationId,
      assetChecklistManualTicksJson: JSON.stringify(validTicks),
      assetChecklistScore: score,
    },
    update: {
      assetChecklistManualTicksJson: JSON.stringify(validTicks),
      assetChecklistScore: score,
    },
  });

  return NextResponse.json({ check: updated });
}
