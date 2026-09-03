// Thin server-side client for the voice-service microservice (see
// voice-service/README.md for what it does and its honest limitations —
// SpeechBrain ECAPA-TDNN + Resemblyzer speaker embeddings, real but
// uncalibrated-threshold advisory signals, not an auto-reject gate).
//
// This is a separate Python process this Next.js app calls over HTTP, not a
// library import — the same architectural boundary explained in
// voice-service/README.md's "Why a separate Python service" section.
// VOICE_SERVICE_URL lets a real deployment point this at wherever that
// service actually runs; defaults to the local dev port used in this
// prototype.

const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL ?? "http://127.0.0.1:8077";

export interface VoiceConsistencyResult {
  method: string;
  similarity: number;
  threshold: number;
  sameSpeaker: boolean;
  clipASeconds: number;
  clipBSeconds: number;
  note: string;
}

export interface MultiSpeakerResult {
  speakerCount: number;
  multipleVoicesDetected: boolean;
  windowsAnalyzed: number;
  windowsSkippedSilence: number;
  insufficientAudio: boolean;
  note: string;
}

export interface DeepfakeResult {
  framesAnalyzed: number;
  flaggedFrames: number;
  fakeFrameRatio: number;
  flagged: boolean;
  model: string;
  insufficientFrames: boolean;
  note: string;
}

export interface LipSyncResult {
  score: number;
  flagged: boolean;
  model: string;
  framesAnalyzed: number;
  insufficientFrames: boolean;
  noFaceDetected: boolean;
  note: string;
}

export interface AssetDetectionItem {
  label: string;
  count: number;
  confidence: number;
  // Base64 JPEG data URI cropped directly from the detection's own
  // bounding box — real visual evidence for the underwriter, not just a
  // label and a number. Null if the crop failed for some reason (never
  // blocks the rest of the checklist).
  thumbnail: string | null;
}

export interface AssetDetectionResult {
  framesAnalyzed: number;
  checklist: AssetDetectionItem[];
  model: string;
  insufficientFrames: boolean;
  note: string;
}

export interface CustomAssetDetectionResult {
  framesAnalyzed: number;
  checklist: AssetDetectionItem[];
  model: string;
  insufficientFrames: boolean;
  noQueries: boolean;
  note: string;
}

export type VoiceServiceCall<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Not a network call — checked before every real call so a case page or a
// batch job gets an honest "service isn't running" message instead of a
// generic fetch failure. Also used to show/hide the check-trigger UI.
export async function voiceServiceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${VOICE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkVoiceConsistency(
  clipABuffer: Buffer, clipAName: string, clipAMime: string,
  clipBBuffer: Buffer, clipBName: string, clipBMime: string,
): Promise<VoiceServiceCall<VoiceConsistencyResult>> {
  const form = new FormData();
  form.append("clip_a", new Blob([new Uint8Array(clipABuffer)], { type: clipAMime }), clipAName);
  form.append("clip_b", new Blob([new Uint8Array(clipBBuffer)], { type: clipBMime }), clipBName);
  try {
    const res = await fetch(`${VOICE_SERVICE_URL}/voice-consistency`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Voice service returned ${res.status}: ${detail.slice(0, 300)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      data: {
        method: json.method, similarity: json.similarity, threshold: json.threshold,
        sameSpeaker: json.same_speaker, clipASeconds: json.clip_a_seconds, clipBSeconds: json.clip_b_seconds,
        note: json.note,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Could not reach voice service at ${VOICE_SERVICE_URL} — is it running? (${e?.message ?? e})` };
  }
}

export async function checkDeepfake(
  clipBuffer: Buffer, clipName: string, clipMime: string,
): Promise<VoiceServiceCall<DeepfakeResult>> {
  const form = new FormData();
  form.append("clip", new Blob([new Uint8Array(clipBuffer)], { type: clipMime }), clipName);
  try {
    // Longer timeout than the audio checks — frame extraction + a real
    // model inference call per sampled frame (8 by default) is slower than
    // the audio-only checks above.
    const res = await fetch(`${VOICE_SERVICE_URL}/deepfake-check`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Voice service returned ${res.status}: ${detail.slice(0, 300)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      data: {
        framesAnalyzed: json.frames_analyzed, flaggedFrames: json.flagged_frames, fakeFrameRatio: json.fake_frame_ratio,
        flagged: json.flagged, model: json.model, insufficientFrames: json.insufficient_frames, note: json.note,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Could not reach voice service at ${VOICE_SERVICE_URL} — is it running? (${e?.message ?? e})` };
  }
}

export async function checkLipSync(
  clipBuffer: Buffer, clipName: string, clipMime: string,
): Promise<VoiceServiceCall<LipSyncResult>> {
  const form = new FormData();
  form.append("clip", new Blob([new Uint8Array(clipBuffer)], { type: clipMime }), clipName);
  try {
    // Longest timeout of any check here — face detection + landmark
    // extraction across ~25 consecutive frames, then a real model pass.
    const res = await fetch(`${VOICE_SERVICE_URL}/lip-sync-check`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Voice service returned ${res.status}: ${detail.slice(0, 300)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      data: {
        score: json.score, flagged: json.flagged, model: json.model, framesAnalyzed: json.frames_analyzed,
        insufficientFrames: json.insufficient_frames, noFaceDetected: json.no_face_detected, note: json.note,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Could not reach voice service at ${VOICE_SERVICE_URL} — is it running? (${e?.message ?? e})` };
  }
}

export async function checkAssetDetection(
  clipBuffer: Buffer, clipName: string, clipMime: string,
): Promise<VoiceServiceCall<AssetDetectionResult>> {
  const form = new FormData();
  form.append("clip", new Blob([new Uint8Array(clipBuffer)], { type: clipMime }), clipName);
  try {
    // Similar cost profile to /deepfake-check — a real detection forward
    // pass per sampled frame, on fewer frames (6 vs 8).
    const res = await fetch(`${VOICE_SERVICE_URL}/asset-detection-check`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Voice service returned ${res.status}: ${detail.slice(0, 300)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      data: {
        framesAnalyzed: json.frames_analyzed,
        checklist: (json.checklist ?? []).map((item: any) => ({ label: item.label, count: item.count, confidence: item.confidence, thumbnail: item.thumbnail ?? null })),
        model: json.model, insufficientFrames: json.insufficient_frames, note: json.note,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Could not reach voice service at ${VOICE_SERVICE_URL} — is it running? (${e?.message ?? e})` };
  }
}

// Open-vocabulary/zero-shot detection (OWLv2) against a segment's
// configured manual-item names — genuinely different from
// checkAssetDetection above, which can only ever output one of a fixed 80
// categories. `queries` is that segment's manual-item list
// (AssetDetectionSegmentSettings.manualItemsJson) — see
// voice-service/custom_asset_detection.py's own doc comment for exactly
// what this is and its real limitations.
export async function checkCustomAssetDetection(
  clipBuffer: Buffer, clipName: string, clipMime: string, queries: string[],
): Promise<VoiceServiceCall<CustomAssetDetectionResult>> {
  const form = new FormData();
  form.append("clip", new Blob([new Uint8Array(clipBuffer)], { type: clipMime }), clipName);
  form.append("queries", JSON.stringify(queries));
  try {
    // Similar cost profile to /deepfake-check — a real detection forward
    // pass per sampled frame (6), all queries batched into one pass per frame.
    const res = await fetch(`${VOICE_SERVICE_URL}/custom-asset-detection-check`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Voice service returned ${res.status}: ${detail.slice(0, 300)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      data: {
        framesAnalyzed: json.frames_analyzed,
        checklist: (json.checklist ?? []).map((item: any) => ({ label: item.label, count: item.count, confidence: item.confidence, thumbnail: item.thumbnail ?? null })),
        model: json.model, insufficientFrames: json.insufficient_frames, noQueries: json.no_queries, note: json.note,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Could not reach voice service at ${VOICE_SERVICE_URL} — is it running? (${e?.message ?? e})` };
  }
}

export async function checkMultiSpeaker(
  clipBuffer: Buffer, clipName: string, clipMime: string,
): Promise<VoiceServiceCall<MultiSpeakerResult>> {
  const form = new FormData();
  form.append("clip", new Blob([new Uint8Array(clipBuffer)], { type: clipMime }), clipName);
  try {
    const res = await fetch(`${VOICE_SERVICE_URL}/multi-speaker`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Voice service returned ${res.status}: ${detail.slice(0, 300)}` };
    }
    const json = await res.json();
    return {
      ok: true,
      data: {
        speakerCount: json.speaker_count, multipleVoicesDetected: json.multiple_voices_detected,
        windowsAnalyzed: json.windows_analyzed, windowsSkippedSilence: json.windows_skipped_silence,
        insufficientAudio: json.insufficient_audio, note: json.note,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Could not reach voice service at ${VOICE_SERVICE_URL} — is it running? (${e?.message ?? e})` };
  }
}
