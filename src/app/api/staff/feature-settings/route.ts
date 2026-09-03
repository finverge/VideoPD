import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFeatureSettings, DEFAULT_FEATURE_SETTINGS } from "@/lib/featureSettings";

// Admin on/off switch for the experimental deepfake check
// (src/lib/featureSettings.ts) — same pattern as api/staff/risk-parameters:
// GET returns current values, PUT updates them, Approver-only. Requested
// live specifically so this genuinely research-grade check (see
// voice-service/README.md) can be turned off later without an engineering
// change. Which asset-detection CATEGORIES are allowed through is a
// separate, per-segment concern — see api/staff/asset-detection-categories
// instead; this route only owns the on/off switches and app-wide numbers.
export async function GET() {
  const settings = await getFeatureSettings();
  return NextResponse.json({ settings, defaults: DEFAULT_FEATURE_SETTINGS });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    staffName?: string;
    staffRole?: string;
    deepfakeCheckEnabled?: boolean;
    lipSyncCheckEnabled?: boolean;
    applicationExpiryDays?: number;
    assetDetectionCheckEnabled?: boolean;
  };
  const { staffName, staffRole, deepfakeCheckEnabled, lipSyncCheckEnabled, applicationExpiryDays, assetDetectionCheckEnabled } = body;

  if (staffRole !== "APPROVER") {
    return NextResponse.json({ error: "Only an Approver can update feature settings." }, { status: 403 });
  }
  if (typeof deepfakeCheckEnabled !== "boolean" || typeof lipSyncCheckEnabled !== "boolean" || typeof assetDetectionCheckEnabled !== "boolean") {
    return NextResponse.json({ error: "deepfakeCheckEnabled, lipSyncCheckEnabled, and assetDetectionCheckEnabled are all required booleans." }, { status: 400 });
  }
  if (typeof applicationExpiryDays !== "number" || !Number.isInteger(applicationExpiryDays) || applicationExpiryDays < 1) {
    return NextResponse.json({ error: "applicationExpiryDays must be a whole number of at least 1." }, { status: 400 });
  }

  const updated = await db.featureSettings.upsert({
    where: { id: "global" },
    create: { id: "global", deepfakeCheckEnabled, lipSyncCheckEnabled, applicationExpiryDays, assetDetectionCheckEnabled, updatedBy: staffName ?? null },
    update: { deepfakeCheckEnabled, lipSyncCheckEnabled, applicationExpiryDays, assetDetectionCheckEnabled, updatedBy: staffName ?? null },
  });

  return NextResponse.json({ settings: updated });
}
