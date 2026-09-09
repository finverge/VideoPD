import { readFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  checkVoiceConsistency, checkMultiSpeaker, checkDeepfake, checkLipSync,
  checkAssetDetection, checkCustomAssetDetection, checkSignageOcr, voiceServiceHealthy,
} from "@/lib/voiceBiometrics";
import {
  voiceConsistencyRiskFlag, multiSpeakerRiskFlag,
  VOICE_CONSISTENCY_RISK_FLAG_CODE, MULTI_SPEAKER_RISK_FLAG_CODE,
  liveCallVoiceConsistencyRiskFlag, liveCallMultiSpeakerRiskFlag,
  LIVE_CALL_VOICE_CONSISTENCY_RISK_FLAG_CODE, LIVE_CALL_MULTI_SPEAKER_RISK_FLAG_CODE,
  deepfakeRiskFlag, DEEPFAKE_RISK_FLAG_CODE,
  lipSyncRiskFlag, LIP_SYNC_RISK_FLAG_CODE,
  riskSeverityOf,
} from "@/lib/mockChecks";
import { getFeatureSettings } from "@/lib/featureSettings";
import {
  getAssetDetectionSegmentSettings, resolveAssetDetectionCategories,
  resolveAssetDetectionWeights, computeAssetChecklistScore,
} from "@/lib/assetDetectionSegmentSettings";
import type { InitialSummary, RiskFlag } from "@/types";

// Shared core of the voice-biometrics/deepfake/lip-sync pipeline — used by
// two callers with different scopes:
//   1. The underwriter's manual "Run voice check" button
//      (api/staff/voice-check/[applicationId]/route.ts) — full scope, every
//      block that has inputs, same behavior as before this was extracted.
//   2. An automatic trigger fired server-side the moment a live-call
//      recording is uploaded (api/upload/route.ts) — live-call scope only
//      (voice-consistency + multi-speaker against the just-uploaded call).
//      Deliberately does NOT also re-run the guided-flow/deepfake/lip-sync
//      blocks: those only ever look at the two guided-flow clips, which
//      haven't changed just because a call ended — re-running them on every
//      call-end would be pure redundant cost (lip-sync alone measured ~45s
//      total for a full run against real evidence). See RunVoiceCheckOptions.
export interface RunVoiceCheckOptions {
  /** Guided-flow voice-consistency + multi-speaker (selfie-step vs
   * business-verification). Default true — the manual button's full run. */
  runGuidedFlow?: boolean;
  /** Deepfake scan of the guided-flow clips. Default follows the admin
   * feature toggle (src/lib/featureSettings.ts); pass false to force-skip
   * regardless of the toggle (used by the call-end auto-trigger, since
   * nothing new for it to scan exists). */
  runDeepfake?: boolean;
  /** Lip-sync scan of the guided-flow clips. Same defaulting as runDeepfake. */
  runLipSync?: boolean;
  /** Phase 1 asset-detection checklist of the business-verification clip
   * only — no liveness-clip counterpart, the selfie-step recording isn't a
   * premises video, nothing to detect assets in. Same defaulting as
   * runDeepfake/runLipSync. */
  runAssetDetection?: boolean;
  /** Storefront/signage text recognition (EasyOCR) of the business-
   * verification clip only — same scope as runAssetDetection, genuinely
   * different check (reads text, not object presence). Same defaulting. */
  runSignageOcr?: boolean;
}

export type RunVoiceCheckResult =
  | { ok: true; check: unknown; responseBody: Record<string, unknown>; guidedFlowError: string | null; liveCallError: string | null; deepfakeError: string | null; lipSyncError: string | null; assetDetectionError: string | null; customAssetDetectionError: string | null; signageOcrError: string | null; deepfakeCheckEnabled: boolean; lipSyncCheckEnabled: boolean; assetDetectionCheckEnabled: boolean; signageOcrCheckEnabled: boolean }
  | { ok: false; error: string; status: number };

async function readEvidenceBuffer(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), filePath));
  } catch {
    return null;
  }
}

export async function runVoiceCheck(applicationId: string, opts: RunVoiceCheckOptions = {}): Promise<RunVoiceCheckResult> {
  const featureSettings = await getFeatureSettings();
  const runGuidedFlow = opts.runGuidedFlow ?? true;
  const runDeepfake = (opts.runDeepfake ?? featureSettings.deepfakeCheckEnabled) && featureSettings.deepfakeCheckEnabled;
  const runLipSync = (opts.runLipSync ?? featureSettings.lipSyncCheckEnabled) && featureSettings.lipSyncCheckEnabled;
  const runAssetDetection = (opts.runAssetDetection ?? featureSettings.assetDetectionCheckEnabled) && featureSettings.assetDetectionCheckEnabled;
  const runSignageOcr = (opts.runSignageOcr ?? featureSettings.signageOcrCheckEnabled) && featureSettings.signageOcrCheckEnabled;

  const healthy = await voiceServiceHealthy();
  if (!healthy) {
    return { ok: false, error: "Voice biometrics service isn't reachable — it must be started separately (see voice-service/README.md) before this check can run.", status: 503 };
  }

  const application = await db.loanApplication.findUnique({
    where: { id: applicationId },
    include: { evidence: true, lead: { include: { summary: true } } },
  });
  if (!application) return { ok: false, error: "Application not found.", status: 404 };

  const livenessEvidence = application.evidence.find((e) => e.type === "VIDEOPD_LIVENESS" && e.mimeType.startsWith("video/"));
  const businessEvidence = application.evidence.find((e) => e.type === "VIDEOPD_BUSINESS_VERIFICATION" && e.mimeType.startsWith("video/"));
  const liveCallEvidence = application.evidence.find((e) => e.type === "LIVE_CALL_RECORDING");

  const canCheckGuidedFlow = runGuidedFlow && !!livenessEvidence && !!businessEvidence;
  const canCheckLiveCall = !!liveCallEvidence;
  const canCheckDeepfakeOrLipSync = (runDeepfake || runLipSync) && !!livenessEvidence && !!businessEvidence;
  // Asset-detection scans the business-verification clip only — no
  // liveness-clip counterpart, the selfie-step recording isn't a premises
  // video, nothing to detect assets in.
  const canCheckAssetDetection = runAssetDetection && !!businessEvidence;
  // Signage OCR scans the business-verification clip only, same reasoning
  // as asset detection — no liveness-clip counterpart.
  const canCheckSignageOcr = runSignageOcr && !!businessEvidence;
  if (!canCheckGuidedFlow && !canCheckLiveCall && !canCheckDeepfakeOrLipSync && !canCheckAssetDetection && !canCheckSignageOcr) {
    return { ok: false, error: "Nothing to check yet — need either both guided-flow recordings, or a live-call recording.", status: 422 };
  }

  // Liveness/business buffers are read whenever guided-flow, deepfake, or
  // lip-sync might run, AND whenever a live-call check needs the selfie-step
  // clip as its reference voice — so read them whenever any of those could
  // apply, not just when runGuidedFlow is true.
  const needLivenessBuf = canCheckGuidedFlow || canCheckDeepfakeOrLipSync || canCheckLiveCall;
  const [livenessBuf, businessBuf, liveCallBuf] = await Promise.all([
    livenessEvidence && needLivenessBuf ? readEvidenceBuffer(livenessEvidence.filePath) : Promise.resolve(null),
    businessEvidence && (canCheckGuidedFlow || canCheckDeepfakeOrLipSync || canCheckAssetDetection || canCheckSignageOcr) ? readEvidenceBuffer(businessEvidence.filePath) : Promise.resolve(null),
    liveCallEvidence ? readEvidenceBuffer(liveCallEvidence.filePath) : Promise.resolve(null),
  ]);

  const updateData: Record<string, unknown> = { checkedAt: new Date() };
  const newFlags: RiskFlag[] = [];
  const responseBody: Record<string, unknown> = {};

  // --- Guided-flow checks ---
  let guidedFlowError: string | null = null;
  if (canCheckGuidedFlow) {
    if (!livenessBuf || !businessBuf) {
      guidedFlowError = "One of the guided-flow recording files is missing on disk.";
    } else {
      const [consistencyResult, livenessSpeakerResult, businessSpeakerResult] = await Promise.all([
        checkVoiceConsistency(livenessBuf, livenessEvidence!.fileName, livenessEvidence!.mimeType, businessBuf, businessEvidence!.fileName, businessEvidence!.mimeType),
        checkMultiSpeaker(livenessBuf, livenessEvidence!.fileName, livenessEvidence!.mimeType),
        checkMultiSpeaker(businessBuf, businessEvidence!.fileName, businessEvidence!.mimeType),
      ]);

      if (!consistencyResult.ok) {
        guidedFlowError = consistencyResult.error;
      } else {
        const consistencyStatus = consistencyResult.data.sameSpeaker ? "PASSED" : "FLAGGED";
        const livenessMultiStatus = livenessSpeakerResult.ok ? (livenessSpeakerResult.data.multipleVoicesDetected ? "FLAGGED" : "PASSED") : "PENDING";
        const businessMultiStatus = businessSpeakerResult.ok ? (businessSpeakerResult.data.multipleVoicesDetected ? "FLAGGED" : "PASSED") : "PENDING";

        Object.assign(updateData, {
          consistencyStatus, consistencySimilarity: consistencyResult.data.similarity, consistencyMethod: consistencyResult.data.method, consistencyNotes: consistencyResult.data.note,
          livenessMultiSpeakerStatus: livenessMultiStatus, livenessSpeakerCount: livenessSpeakerResult.ok ? livenessSpeakerResult.data.speakerCount : null,
          businessMultiSpeakerStatus: businessMultiStatus, businessSpeakerCount: businessSpeakerResult.ok ? businessSpeakerResult.data.speakerCount : null,
        });

        if (consistencyStatus === "FLAGGED") newFlags.push(voiceConsistencyRiskFlag(consistencyResult.data.similarity, consistencyResult.data.method));
        if (livenessMultiStatus === "FLAGGED" && livenessSpeakerResult.ok) newFlags.push(multiSpeakerRiskFlag("selfie-step", livenessSpeakerResult.data.speakerCount));
        if (businessMultiStatus === "FLAGGED" && businessSpeakerResult.ok) newFlags.push(multiSpeakerRiskFlag("business-verification", businessSpeakerResult.data.speakerCount));

        responseBody.consistency = consistencyResult.data;
        responseBody.livenessMultiSpeaker = livenessSpeakerResult.ok ? livenessSpeakerResult.data : { error: livenessSpeakerResult.error };
        responseBody.businessMultiSpeaker = businessSpeakerResult.ok ? businessSpeakerResult.data : { error: businessSpeakerResult.error };
      }
    }
  }

  // --- Live-call check (voice-consistency + multi-speaker only — this is
  // the block the call-end auto-trigger relies on) ---
  let liveCallError: string | null = null;
  if (canCheckLiveCall) {
    if (!liveCallBuf) {
      liveCallError = "The live-call recording file is missing on disk.";
    } else {
      const speakerResult = await checkMultiSpeaker(liveCallBuf, liveCallEvidence!.fileName, liveCallEvidence!.mimeType);
      const liveCallMultiStatus = speakerResult.ok ? (speakerResult.data.multipleVoicesDetected ? "FLAGGED" : "PASSED") : "PENDING";
      Object.assign(updateData, {
        liveCallMultiSpeakerStatus: liveCallMultiStatus,
        liveCallSpeakerCount: speakerResult.ok ? speakerResult.data.speakerCount : null,
      });
      if (liveCallMultiStatus === "FLAGGED" && speakerResult.ok) {
        newFlags.push(liveCallMultiSpeakerRiskFlag(speakerResult.data.speakerCount));
      }
      responseBody.liveCallMultiSpeaker = speakerResult.ok ? speakerResult.data : { error: speakerResult.error };

      // Voice consistency needs a reference voice — only meaningful if the
      // selfie-step recording also exists.
      if (livenessEvidence && livenessBuf) {
        const consistencyResult = await checkVoiceConsistency(liveCallBuf, liveCallEvidence!.fileName, liveCallEvidence!.mimeType, livenessBuf, livenessEvidence.fileName, livenessEvidence.mimeType);
        if (consistencyResult.ok) {
          const liveCallConsistencyStatus = consistencyResult.data.sameSpeaker ? "PASSED" : "FLAGGED";
          Object.assign(updateData, {
            liveCallConsistencyStatus, liveCallConsistencySimilarity: consistencyResult.data.similarity,
            liveCallConsistencyMethod: consistencyResult.data.method, liveCallConsistencyNotes: consistencyResult.data.note,
          });
          if (liveCallConsistencyStatus === "FLAGGED") newFlags.push(liveCallVoiceConsistencyRiskFlag(consistencyResult.data.similarity, consistencyResult.data.method));
          responseBody.liveCallConsistency = consistencyResult.data;
        } else {
          liveCallError = liveCallError ? `${liveCallError} ${consistencyResult.error}` : consistencyResult.error;
        }
      }
    }
  }

  // --- Deepfake check (guided-flow clips only — LIVE_CALL_RECORDING is
  // deliberately audio-only, nothing to run this against) ---
  let deepfakeError: string | null = null;
  if (runDeepfake && livenessEvidence && businessEvidence) {
    const deepfakeChecks: { label: string; buf: Buffer; evidence: typeof livenessEvidence; field: "livenessDeepfake" | "businessDeepfake" }[] = [];
    if (livenessBuf) deepfakeChecks.push({ label: "selfie-step", buf: livenessBuf, evidence: livenessEvidence, field: "livenessDeepfake" });
    if (businessBuf) deepfakeChecks.push({ label: "business-verification", buf: businessBuf, evidence: businessEvidence, field: "businessDeepfake" });

    for (const { label, buf, evidence, field } of deepfakeChecks) {
      const result = await checkDeepfake(buf, evidence!.fileName, evidence!.mimeType);
      if (!result.ok) {
        deepfakeError = deepfakeError ? `${deepfakeError} ${result.error}` : result.error;
        continue;
      }
      if (result.data.insufficientFrames) continue; // nothing usable extracted — leave PENDING rather than claim a verdict
      const status = result.data.flagged ? "FLAGGED" : "PASSED";
      updateData[`${field}Status`] = status;
      updateData[`${field}Ratio`] = result.data.fakeFrameRatio;
      updateData.deepfakeModel = result.data.model;
      if (status === "FLAGGED") newFlags.push(deepfakeRiskFlag(label, result.data.fakeFrameRatio, result.data.framesAnalyzed, result.data.model));
      responseBody[`${field}`] = result.data;
    }
  }

  // --- Lip-sync check (guided-flow clips only, same reasoning as deepfake
  // above) ---
  let lipSyncError: string | null = null;
  if (runLipSync && livenessEvidence && businessEvidence) {
    const lipSyncChecks: { label: string; buf: Buffer; evidence: typeof livenessEvidence; field: "livenessLipSync" | "businessLipSync" }[] = [];
    if (livenessBuf) lipSyncChecks.push({ label: "selfie-step", buf: livenessBuf, evidence: livenessEvidence, field: "livenessLipSync" });
    if (businessBuf) lipSyncChecks.push({ label: "business-verification", buf: businessBuf, evidence: businessEvidence, field: "businessLipSync" });

    for (const { label, buf, evidence, field } of lipSyncChecks) {
      const result = await checkLipSync(buf, evidence!.fileName, evidence!.mimeType);
      if (!result.ok) {
        lipSyncError = lipSyncError ? `${lipSyncError} ${result.error}` : result.error;
        continue;
      }
      if (result.data.insufficientFrames) continue; // no usable face/frames — leave PENDING rather than claim a verdict
      const status = result.data.flagged ? "FLAGGED" : "PASSED";
      updateData[`${field}Status`] = status;
      updateData[`${field}Score`] = result.data.score;
      updateData.lipSyncModel = result.data.model;
      if (status === "FLAGGED") newFlags.push(lipSyncRiskFlag(label, result.data.score));
      responseBody[`${field}`] = result.data;
    }
  }

  // --- Asset detection (Phase 1 work-premises checklist — business-
  // verification clip only, no liveness-clip counterpart. Advisory
  // checklist, not a risk check: no PASSED/FLAGGED verdict, nothing folded
  // into riskFlags — see asset_detection.py's doc comment for why. ) ---
  let assetDetectionError: string | null = null;
  let customAssetDetectionError: string | null = null;
  if (canCheckAssetDetection) {
    if (!businessBuf) {
      assetDetectionError = "The business-verification recording file is missing on disk.";
      customAssetDetectionError = assetDetectionError;
    } else {
      const segmentSettings = await getAssetDetectionSegmentSettings(application.segment);

      // --- Fixed-vocabulary COCO checklist (asset_detection.py) ---
      const result = await checkAssetDetection(businessBuf, businessEvidence!.fileName, businessEvidence!.mimeType);
      if (!result.ok) {
        assetDetectionError = result.error;
      } else if (result.data.insufficientFrames) {
        // nothing usable extracted — leave PENDING rather than claim a checklist
      } else {
        // The model itself always detects across all 80 COCO categories —
        // this only controls what's kept, per the admin's own selection FOR
        // THIS APPLICATION'S SEGMENT (src/lib/assetDetectionCategories.ts,
        // src/lib/assetDetectionSegmentSettings.ts). null = no filter
        // configured for this segment yet, keep everything, same as every
        // category being selected.
        const allowedCategories = resolveAssetDetectionCategories(segmentSettings.categoriesJson);
        const checklist = allowedCategories
          ? result.data.checklist.filter((item) => allowedCategories.includes(item.label))
          : result.data.checklist;
        updateData.assetDetectionStatus = "PASSED";
        updateData.assetDetectionChecklistJson = JSON.stringify(checklist);
        updateData.assetDetectionModel = result.data.model;
        updateData.assetDetectionNotes = result.data.note;
        responseBody.assetDetection = { ...result.data, checklist };
      }

      // --- Open-vocabulary/zero-shot custom checklist (custom_asset_detection.py)
      // — the actual answer to "we're still only using COCO categories, not
      // the segment-specific custom objects": queries THIS segment's manual
      // reference items directly, at inference time, no fine-tuning. ---
      const manualItems = resolveAssetDetectionCategories(segmentSettings.manualItemsJson) ?? [];
      if (manualItems.length > 0) {
        const customResult = await checkCustomAssetDetection(businessBuf, businessEvidence!.fileName, businessEvidence!.mimeType, manualItems);
        if (!customResult.ok) {
          customAssetDetectionError = customResult.error;
        } else if (customResult.data.insufficientFrames) {
          // nothing usable extracted — leave PENDING rather than claim a checklist
        } else {
          updateData.customAssetDetectionStatus = "PASSED";
          updateData.customAssetDetectionChecklistJson = JSON.stringify(customResult.data.checklist);
          updateData.customAssetDetectionModel = customResult.data.model;
          updateData.customAssetDetectionNotes = customResult.data.note;
          responseBody.customAssetDetection = customResult.data;
        }
      }

      // --- Weighted score + manual-tick pre-fill ---
      // Combines whichever checklists exist (freshly updated above, or
      // already stored from a prior run this call didn't touch) with the
      // underwriter's manual ticks. An admin-configured rubric total, not
      // an outcome-calibrated valuation — see computeAssetChecklistScore's
      // own doc comment.
      if (updateData.assetDetectionChecklistJson || updateData.customAssetDetectionChecklistJson) {
        const existingCheck = await db.voiceBiometricCheck.findUnique({
          where: { applicationId },
          select: { assetChecklistManualTicksJson: true, assetDetectionChecklistJson: true, customAssetDetectionChecklistJson: true },
        });

        const labelsFrom = (json: unknown): string[] => {
          if (typeof json !== "string") return [];
          try {
            const parsed = JSON.parse(json);
            return Array.isArray(parsed) ? parsed.map((item: { label: string }) => item.label) : [];
          } catch {
            return [];
          }
        };
        const cocoLabels = labelsFrom(updateData.assetDetectionChecklistJson ?? existingCheck?.assetDetectionChecklistJson);
        const customChecklistJson = (updateData.customAssetDetectionChecklistJson as string | undefined) ?? existingCheck?.customAssetDetectionChecklistJson ?? undefined;
        const customLabels = labelsFrom(customChecklistJson);

        // Pre-fill manual ticks from high-confidence zero-shot hits — ONLY
        // the very first time (the field has never been touched, i.e.
        // still NULL in the DB). From that point on it's fully
        // underwriter-owned; a fresh AI run never overwrites what they
        // already confirmed or unchecked.
        let manualTicks: string[];
        if (existingCheck?.assetChecklistManualTicksJson == null) {
          let preFill: string[] = [];
          if (customChecklistJson) {
            try {
              const parsed = JSON.parse(customChecklistJson) as { label: string; confidence: number }[];
              preFill = parsed.filter((item) => item.confidence >= 0.3).map((item) => item.label);
            } catch {
              // leave preFill empty — malformed JSON shouldn't block scoring
            }
          }
          manualTicks = preFill;
          if (preFill.length > 0) updateData.assetChecklistManualTicksJson = JSON.stringify(preFill);
        } else {
          manualTicks = resolveAssetDetectionCategories(existingCheck.assetChecklistManualTicksJson) ?? [];
        }

        const weights = resolveAssetDetectionWeights(segmentSettings.weightsJson);
        const score = computeAssetChecklistScore([...cocoLabels, ...customLabels], manualTicks, weights);
        updateData.assetChecklistScore = score;
        responseBody.assetChecklistScore = score;
      }
    }
  }

  // --- Storefront & signage text recognition (signage_ocr.py) — a real
  // capability check with a checklist result, not a risk check: no
  // PASSED/FLAGGED verdict, nothing folded into riskFlags, same reasoning
  // as the asset-detection block above. Genuinely independent of it: this
  // reads TEXT off signboards, the asset checklist detects OBJECT
  // PRESENCE — deliberately kept as its own gate/toggle rather than
  // folded into canCheckAssetDetection, so either can be turned off
  // without touching the other. ---
  let signageOcrError: string | null = null;
  if (canCheckSignageOcr) {
    if (!businessBuf) {
      signageOcrError = "The business-verification recording file is missing on disk.";
    } else {
      const signageResult = await checkSignageOcr(businessBuf, businessEvidence!.fileName, businessEvidence!.mimeType);
      if (!signageResult.ok) {
        signageOcrError = signageResult.error;
      } else if (signageResult.data.insufficientFrames) {
        // nothing usable extracted — leave PENDING rather than claim a checklist
      } else {
        updateData.signageOcrStatus = "PASSED";
        updateData.signageOcrChecklistJson = JSON.stringify(signageResult.data.checklist);
        updateData.signageOcrModel = signageResult.data.model;
        updateData.signageOcrNotes = signageResult.data.note;
        responseBody.signageOcr = signageResult.data;
      }
    }
  }

  if (Object.keys(updateData).length <= 1) {
    // Only checkedAt got set — every attempted check failed outright.
    return { ok: false, error: [guidedFlowError, liveCallError, assetDetectionError, customAssetDetectionError, signageOcrError].filter(Boolean).join(" ") || "Voice check failed.", status: 502 };
  }

  const check = await db.voiceBiometricCheck.upsert({
    where: { applicationId },
    create: { applicationId, ...updateData },
    update: updateData,
  });

  // Fold FLAGGED results into the Lead's summary.riskFlags — same
  // replace-by-code pattern as BANK_STATEMENT_AUTHENTICITY_RISK_FLAG_CODE
  // and IDENTITY_RISK_FLAG_CODE, so a later clean re-check replaces rather
  // than duplicates, and clears the flag again if the re-check comes back
  // clean. Codes actually checked this run get cleared-then-possibly-
  // re-added; codes not attempted this run (e.g. no live-call recording
  // yet, or a call-end auto-trigger that deliberately skipped deepfake/
  // lip-sync) are left untouched rather than wiped.
  //
  // touchesRiskFlags guards this whole block: asset detection never
  // contributes a risk flag (it's a checklist, not a risk check — see
  // asset_detection.py), so a call that only ran asset detection (the
  // upload auto-trigger scoped to just that — see api/upload/route.ts)
  // would otherwise still read-modify-write this JSON blob for nothing.
  // That's not just waste: two of these auto-triggers can genuinely race
  // (an asset-only call and a guided-flow/deepfake/lip-sync call, fired
  // from the same or adjacent uploads) — both read the summary at their
  // own start, and whichever writes last wins. A no-op write from the
  // asset-only call landing after the other call's real update would
  // silently erase it. Skipping the write entirely when there's nothing
  // this call would actually change removes that race for the one call
  // shape that's actually vulnerable to it.
  const touchesRiskFlags =
    (canCheckGuidedFlow && !guidedFlowError) ||
    (canCheckLiveCall && !liveCallError) ||
    (runDeepfake && !deepfakeError) ||
    (runLipSync && !lipSyncError) ||
    newFlags.length > 0;
  if (application.lead?.summary && touchesRiskFlags) {
    const summary: InitialSummary = JSON.parse(application.lead.summary.summaryJson);
    let flags = summary.riskFlags;
    if (canCheckGuidedFlow && !guidedFlowError) {
      flags = flags.filter((f) => f.code !== VOICE_CONSISTENCY_RISK_FLAG_CODE && f.code !== MULTI_SPEAKER_RISK_FLAG_CODE);
    }
    if (canCheckLiveCall && !liveCallError) {
      flags = flags.filter((f) => f.code !== LIVE_CALL_VOICE_CONSISTENCY_RISK_FLAG_CODE && f.code !== LIVE_CALL_MULTI_SPEAKER_RISK_FLAG_CODE);
    }
    if (runDeepfake && !deepfakeError) {
      flags = flags.filter((f) => f.code !== DEEPFAKE_RISK_FLAG_CODE);
    }
    if (runLipSync && !lipSyncError) {
      flags = flags.filter((f) => f.code !== LIP_SYNC_RISK_FLAG_CODE);
    }
    flags = [...flags, ...newFlags];
    summary.riskFlags = flags;
    const writes: Prisma.PrismaPromise<any>[] = [
      db.initialSummaryDocument.update({ where: { id: application.lead.summary.id }, data: { summaryJson: JSON.stringify(summary) } }),
      db.lead.update({ where: { id: application.lead.id }, data: { riskFlagCount: flags.length, riskSeverity: riskSeverityOf(flags) } }),
    ];
    await db.$transaction(writes);
  }

  return {
    ok: true, check, responseBody, guidedFlowError, liveCallError, deepfakeError, lipSyncError, assetDetectionError, customAssetDetectionError, signageOcrError,
    deepfakeCheckEnabled: featureSettings.deepfakeCheckEnabled, lipSyncCheckEnabled: featureSettings.lipSyncCheckEnabled,
    assetDetectionCheckEnabled: featureSettings.assetDetectionCheckEnabled, signageOcrCheckEnabled: featureSettings.signageOcrCheckEnabled,
  };
}
