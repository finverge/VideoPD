import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runVoiceCheck } from "@/lib/runVoiceCheck";

// Staff-triggered voice-biometrics + deepfake check (see
// voice-service/README.md). Full scope — every block that has inputs, all
// admin-toggleable checks respected. Three independent groups of checks,
// each run only if its inputs exist (and, for deepfake/lip-sync, only if
// enabled):
//   1. Guided-flow: VIDEOPD_LIVENESS vs VIDEOPD_BUSINESS_VERIFICATION
//      consistency, plus a multi-speaker scan of each.
//   2. Live-call (Tier 1, see LiveCallRoom's recordForVoiceCheck prop):
//      LIVE_CALL_RECORDING vs VIDEOPD_LIVENESS consistency (the selfie-step
//      recording as the reference voice), plus a multi-speaker scan of the
//      call recording. This same pair ALSO now runs automatically the
//      moment a live-call recording finishes uploading (see
//      api/upload/route.ts's call into runVoiceCheck with a live-call-only
//      scope) — this manual "Run voice check" button stays as the way to
//      (re-)run everything, including guided-flow and deepfake/lip-sync,
//      which the auto-trigger deliberately skips (see runVoiceCheck.ts's
//      doc comment for why).
//   3. Deepfake/lip-sync (admin-toggleable — see src/lib/featureSettings.ts):
//      frame-level/lip-region scans of each guided-flow clip. Not run
//      against LIVE_CALL_RECORDING — that's deliberately audio-only,
//      nothing to scan.
//   4. Asset detection (admin-toggleable, Phase 1 — see
//      voice-service/asset_detection.py): a work-premises object checklist
//      of VIDEOPD_BUSINESS_VERIFICATION only, no liveness or live-call
//      counterpart. Advisory checklist, not a risk check — nothing folded
//      into riskFlags. Runs alongside a second, genuinely different
//      detector (voice-service/custom_asset_detection.py) that queries
//      the segment's own configured object names in real time (zero-shot,
//      no training) rather than being limited to the first detector's
//      fixed 80-category vocabulary.
//   5. Signage OCR (admin-toggleable — see voice-service/signage_ocr.py):
//      reads text off signboards/hoardings/neighboring storefronts in
//      VIDEOPD_BUSINESS_VERIFICATION — genuinely different from #4, which
//      detects object presence, not printed text. Advisory checklist,
//      same as #4.
// The actual pipeline lives in src/lib/runVoiceCheck.ts, shared with the
// call-end auto-trigger.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const check = await db.voiceBiometricCheck.findUnique({ where: { applicationId } });
  return NextResponse.json({ check });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const result = await runVoiceCheck(applicationId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { ok: _ok, ...rest } = result;
  return NextResponse.json({
    check: rest.check, ...rest.responseBody,
    guidedFlowError: rest.guidedFlowError, liveCallError: rest.liveCallError, deepfakeError: rest.deepfakeError, lipSyncError: rest.lipSyncError,
    assetDetectionError: rest.assetDetectionError, customAssetDetectionError: rest.customAssetDetectionError, signageOcrError: rest.signageOcrError,
    deepfakeCheckEnabled: rest.deepfakeCheckEnabled, lipSyncCheckEnabled: rest.lipSyncCheckEnabled, assetDetectionCheckEnabled: rest.assetDetectionCheckEnabled,
    signageOcrCheckEnabled: rest.signageOcrCheckEnabled,
  });
}
