import { db } from "@/lib/db";

/**
 * Global on/off switch for the experimental deepfake check (requested
 * live, explicitly asked to be admin-toggleable — see
 * voice-service/README.md's "Deepfake/lip-sync" section for exactly what
 * this checks and its real, stated limitations, and for why lip-sync
 * itself isn't shipped here). Same singleton-row pattern as
 * riskParameters.ts's getRiskParameters, just a boolean.
 *
 * Checked server-side before every deepfake call — turning the toggle off
 * here genuinely stops the check from running (and from reaching the
 * voice service at all), not just hides it in the UI.
 */
export const DEFAULT_FEATURE_SETTINGS = {
  deepfakeCheckEnabled: true,
  lipSyncCheckEnabled: true,
  applicationExpiryDays: 30,
  assetDetectionCheckEnabled: true,
  signageOcrCheckEnabled: true,
};

export async function getFeatureSettings() {
  const existing = await db.featureSettings.findUnique({ where: { id: "global" } });
  if (existing) return existing;
  return db.featureSettings.create({ data: { id: "global", ...DEFAULT_FEATURE_SETTINGS } });
}
