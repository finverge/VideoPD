"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Circle, RefreshCw, RotateCcw, Square, Video, X, Check, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { loadFaceModels, faceapi } from "@/lib/faceModels";
import { averageEAR, estimateYawOffset, BlinkTracker, AttentionTracker, LOOKED_AWAY_YAW_THRESHOLD } from "@/lib/liveness";
import { describeGetUserMediaError } from "@/lib/mediaErrors";

const AWAY_STREAK_TO_NUDGE = 3; // ~1.2s of consecutive looked-away ticks before showing the nudge — avoids flicker on a single noisy frame

const MAX_VIDEO_SECONDS = 90; // FSD Section 6.1 — Business/Asset Video, 30–90 seconds
const MIN_VIDEO_SECONDS = 3; // sanity floor for the prototype, not a hard FSD number
const ANALYSIS_INTERVAL_MS = 400; // ~2.5fps — enough to catch a blink, light enough to run on-device

type Mode = "photo" | "video";

/** Real, on-device signals gathered while `analyzeLiveness` recorded — see
 * src/lib/liveness.ts and src/lib/faceMatch.ts for exactly what these do and
 * don't prove. `descriptor` is the 128-d face-recognition vector from the
 * most confidently-detected frame, for the caller to compare against an ID
 * proof photo — null if no face was ever confidently detected. */
export interface LivenessCaptureResult {
  blinkCount: number;
  framesAnalyzed: number;
  noFacePct: number;
  lookedAwayPct: number;
  offCameraGlances: number;
  recordingSeconds: number;
  descriptor: number[] | null;
}

// Reported live, still happening after the mp4-vs-webm fix above: the
// review player showed no duration (just "0:00", no seek bar at all) and
// Play did nothing. Separate, well-documented Chromium bug, not the one
// that fix addressed: a MediaRecorder blob built from one single
// end-of-recording Blob (this component's start()/stop() never passes a
// timeslice, so there's exactly one ondataavailable at the very end,
// matching startRecording() below) often has no Cues/seek index written
// into it, and Chrome's own <video> element reports `duration: Infinity`
// for that — which is what makes the native control hide its seek bar and
// show a bare "0:00" with nowhere for Play to visibly go. Couldn't
// reproduce it directly in this environment's own Chrome build (it played
// back fine here even at 8+ seconds), which points at this being
// version/hardware-dependent — exactly the kind of intermittent bug this
// workaround exists for. The fix is the standard one for this exact
// Chromium issue: force a seek near the end (which makes Chrome actually
// walk the file and discover the real duration) then seek back to the
// start — safe to run unconditionally, since it's a no-op whenever
// duration was already fine.
function fixInfiniteDuration(video: HTMLVideoElement) {
  if (isFinite(video.duration)) return;
  const onTimeUpdate = () => {
    video.currentTime = 0;
    video.removeEventListener("timeupdate", onTimeUpdate);
  };
  video.addEventListener("timeupdate", onTimeUpdate);
  video.currentTime = Number.MAX_SAFE_INTEGER;
}

/** How many distinct cameras this device actually has, via
 * MediaDevices.enumerateDevices() — the real, capability-based way to
 * decide whether a "flip camera" control makes sense, rather than
 * guessing from a user-agent string (unreliable — iPadOS identifies as
 * desktop Safari by default since iOS 13) or screen width (a narrow
 * desktop browser window isn't a phone). A phone/tablet almost always
 * reports 2+ videoinput devices (front + back); a laptop/desktop webcam
 * almost always reports exactly 1 — which is what naturally limits the
 * flip control to "mobile/tablet gets front-or-back, desktop/laptop only
 * ever gets its one front-facing camera" without any device-type
 * branching at all.
 *
 * Device labels (and sometimes the full device list) are only reliably
 * populated *after* a getUserMedia permission grant on that origin, so
 * callers should enumerate after acquiring the initial stream, not
 * before. */
async function countVideoInputDevices(): Promise<number> {
  if (!navigator.mediaDevices?.enumerateDevices) return 1;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput").length;
  } catch {
    return 1; // can't tell — assume one camera, same as never offering the button
  }
}

const ACQUIRE_TIMEOUT_MS = 10000; // hard ceiling — see acquireCameraStream's own doc comment
const BUSY_RETRY_DELAYS_MS = [400, 900]; // two retries: covers real-world camera-driver release lag after a call's leave() stops its tracks

/** Wraps getUserMedia with two defenses neither browsers nor the raw API
 * give you for free:
 *
 * 1. Retry on NotReadableError/TrackStartError ("device already in use").
 *    Reported live: right after leaving a live call (whose own leave()
 *    genuinely does call track.stop() on every track), the very next
 *    getUserMedia() for this guided-flow recording can still transiently
 *    fail — some camera drivers don't release the physical device the
 *    instant the JS-level track reports stopped. A borrower who clicks
 *    Continue right after a call is exactly this race, not just the
 *    two-tabs-one-machine testing case. Only retries this specific error —
 *    every other cause (permission denied, no camera at all) is retried
 *    for nothing and should surface immediately instead.
 * 2. An overall timeout. Reported live: in the exact two-tabs-one-camera
 *    scenario, some Chrome builds don't reject with NotReadableError at
 *    all — the getUserMedia() promise just never settles, leaving the
 *    loading spinner on screen with no way out except closing the dialog.
 *    Racing a timeout turns that into the same clear, actionable error
 *    every other failure already gets. */
async function acquireCameraStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  let lastError: any = null;
  for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt++) {
    let timedOut = false;
    const request = navigator.mediaDevices.getUserMedia(constraints);
    // If the timeout wins the race below but this original request still
    // resolves later (the hang eventually clears on its own), stop
    // whatever it hands back immediately — otherwise that stream leaks:
    // the camera stays physically held with nothing left holding a
    // reference to release it, which is worse than the hang this exists
    // to work around.
    request.then((stream) => { if (timedOut) stream.getTracks().forEach((t) => t.stop()); }).catch(() => {});

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => { timedOut = true; reject({ name: "TimeoutError" }); }, ACQUIRE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([request, timeout]);
    } catch (e: any) {
      lastError = e;
      const retryable = e?.name === "NotReadableError" || e?.name === "TrackStartError";
      if (!retryable || attempt === BUSY_RETRY_DELAYS_MS.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError; // unreachable — loop always returns or throws above
}

function pickVideoMimeType(): string {
  // WebM first, not mp4 — reported live: "End" (stop recording) and Retake
  // both worked, but the review player's Play button silently did nothing.
  // Reproduced directly: MediaRecorder's mp4 muxer (Chrome's own, a newer
  // and far less battle-tested addition than its webm path) produced a
  // blob whose <video> element happily reported a valid loadedmetadata
  // event and a finite duration — which is why Retake's preview swap and
  // the player's UI looked fine — but calling .play() on it never actually
  // advanced playback at all. WebM recorded through the exact same
  // MediaRecorder→Blob→blob-URL pipeline played back correctly. Browsers
  // that only support mp4 recording (older Safari) still get it — each
  // candidate is still gated by isTypeSupported, so this only changes
  // which one wins on a browser (Chrome/Edge/Firefox) that supports both.
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "video/webm";
}

export function CameraCapture({
  mode,
  facingMode = "environment",
  allowFlip = true,
  analyzeLiveness = false,
  onCapture,
  onLivenessResult,
  onClose,
}: {
  mode: Mode;
  /** Starting camera — the borrower can still flip it live (see allowFlip)
   * unless this instance opts out. */
  facingMode?: "user" | "environment";
  /** Set false to lock this capture to `facingMode` with no flip control at
   * all, regardless of how many cameras the device has — for captures
   * that are only meaningful facing one direction, e.g. a selfie or the
   * liveness check (flipping to the back camera mid-liveness would defeat
   * the point: there'd be no face left to analyze). Everywhere else
   * (ID/address proof, business photo/video, bank statement) defaults to
   * true — the borrower may genuinely want either camera for those. */
  allowFlip?: boolean;
  /** When true (video mode only), runs real face detection/landmarks on the
   * live feed during recording and reports blink/attention/descriptor
   * signals via onLivenessResult once the borrower confirms the capture. */
  analyzeLiveness?: boolean;
  onCapture: (file: File) => void;
  onLivenessResult?: (result: LivenessCaptureResult) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0); // mirrors `seconds` state but readable without the stale-closure risk of stopRecording() being called from a setInterval callback created back at startRecording()'s render
  const dialogRef = useRef<HTMLDivElement>(null);
  const analysisIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkTrackerRef = useRef<BlinkTracker | null>(null);
  const attentionTrackerRef = useRef<AttentionTracker | null>(null);
  const bestDescriptorRef = useRef<{ descriptor: Float32Array; score: number } | null>(null);
  const pendingLivenessResultRef = useRef<LivenessCaptureResult | null>(null);
  const analyzingRef = useRef(false); // guards against overlapping detect() calls if one tick runs long
  const awayStreakRef = useRef(0);
  const blinkPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(!analyzeLiveness);
  // The live camera direction — starts at the caller's `facingMode` but,
  // unlike that prop, changes when the borrower taps the flip button
  // (flipCamera below), which is what actually re-runs the acquisition
  // effect further down (it depends on this, not on the static prop).
  const [currentFacingMode, setCurrentFacingMode] = useState<"user" | "environment">(facingMode);
  // Whether this device actually has a second camera to flip to — set
  // once, right after the first successful getUserMedia grant (see
  // countVideoInputDevices' own doc comment for why not before). Stays
  // false on every desktop/laptop with a single webcam, which is what
  // keeps the flip button off those devices without any user-agent or
  // screen-size guessing.
  const [canFlip, setCanFlip] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  // Live, real-time borrower-facing feedback during an analyzeLiveness
  // recording — separate from pendingLivenessResultRef, which holds the
  // finalized numbers used once the borrower confirms the capture. These
  // just drive the on-screen indicators so the borrower sees the check
  // actually happening, not a silent background process.
  const [liveFaceDetected, setLiveFaceDetected] = useState<boolean | null>(null); // null = no reading yet
  const [liveBlinkCount, setLiveBlinkCount] = useState(0);
  const [liveLookingAway, setLiveLookingAway] = useState(false);
  const [showBlinkPulse, setShowBlinkPulse] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (analyzeLiveness) {
      loadFaceModels()
        .then(() => { if (!cancelled) setModelsReady(true); })
        .catch(() => { if (!cancelled) setModelsReady(true); }); // model load failure shouldn't block recording — analysis ticks just no-op below
    }
    (async () => {
      try {
        const stream = await acquireCameraStream({
          video: { facingMode: currentFacingMode },
          audio: mode === "video",
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        setFlipping(false);
        // First grant only — device count doesn't change mid-session, and
        // labels are already populated by now regardless of which camera
        // this particular stream ended up on.
        if (allowFlip) {
          const count = await countVideoInputDevices();
          if (!cancelled) setCanFlip(count >= 2);
        }
      } catch (e: any) {
        // Was just e?.name === "NotAllowedError" vs. one generic fallback —
        // real cause reported live: opening the live VideoPD call (which
        // holds the camera via its own getUserMedia in useCallRoom.ts) and
        // then switching back to this guided-flow recording without leaving
        // that call first. Most devices have exactly one camera, so the
        // second getUserMedia call genuinely can't get it — a real hardware
        // constraint, but the old message gave no hint that was the cause.
        setError(describeGetUserMediaError(e?.name));
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
      if (blinkPulseTimeoutRef.current) clearTimeout(blinkPulseTimeoutRef.current);
    };
    // currentFacingMode, not the static facingMode prop — a flip changes
    // the former, which re-runs this exact acquisition (old stream torn
    // down via the cleanup above, new one requested on the other camera).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentFacingMode]);

  /** Switches to the other camera — only reachable when canFlip is true
   * (2+ real cameras) and allowFlip permits it for this capture. Disabled
   * while recording: MediaRecorder is bound to the stream it started
   * with, so swapping cameras mid-clip isn't something a single
   * recording can do cleanly — same reason every ordinary camera app
   * only lets you pick a lens before you hit record. */
  function flipCamera() {
    if (recording || flipping || capturedUrl) return;
    setFlipping(true);
    setReady(false);
    setCurrentFacingMode((m) => (m === "user" ? "environment" : "user"));
  }

  // The live preview <video> below is only mounted while capturedUrl is
  // null — confirming a capture swaps it out for a <video src={capturedUrl}>
  // review player, and clicking Retake swaps back. That swap unmounts and
  // re-mounts a *new* <video> DOM node each time, so the srcObject
  // assignment the effect above did on first mount doesn't carry over:
  // after a retake, the fresh video element has no stream attached at all,
  // which looked like "retake is broken" (blank/frozen preview) and — for
  // an analyzeLiveness capture — silently broke liveness analysis too,
  // since analyzeFrame reads directly from this same element and a
  // stream-less video never reaches readyState >= 2. Re-attach the stream
  // every time we land back in live-preview mode, not just on first mount.
  useEffect(() => {
    if (!capturedUrl && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [capturedUrl]);

  // One tick of live analysis: detect a face on the current video frame, feed
  // its eye-aspect-ratio into the blink tracker and its head-yaw estimate
  // into the attention tracker, and keep the descriptor from whichever frame
  // had the highest detection confidence so far.
  const analyzeFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || analyzingRef.current) return;
    analyzingRef.current = true;
    try {
      const result = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (result) {
        setLiveFaceDetected(true);

        const yaw = estimateYawOffset(result.landmarks);
        attentionTrackerRef.current?.update(yaw);
        awayStreakRef.current = Math.abs(yaw) > LOOKED_AWAY_YAW_THRESHOLD ? awayStreakRef.current + 1 : 0;
        setLiveLookingAway(awayStreakRef.current >= AWAY_STREAK_TO_NUDGE);

        const blinked = blinkTrackerRef.current?.update(averageEAR(result.landmarks));
        if (blinked) {
          setLiveBlinkCount(blinkTrackerRef.current!.totalBlinks);
          setShowBlinkPulse(true);
          if (blinkPulseTimeoutRef.current) clearTimeout(blinkPulseTimeoutRef.current);
          blinkPulseTimeoutRef.current = setTimeout(() => setShowBlinkPulse(false), 1400);
        }

        const score = result.detection.score;
        if (!bestDescriptorRef.current || score > bestDescriptorRef.current.score) {
          bestDescriptorRef.current = { descriptor: result.descriptor, score };
        }
      } else {
        attentionTrackerRef.current?.update(null);
        setLiveFaceDetected(false);
        awayStreakRef.current = 0;
        setLiveLookingAway(false);
      }
    } catch {
      // A single failed detection tick shouldn't interrupt recording — just
      // counts as "no face this frame" and the analysis continues.
      attentionTrackerRef.current?.update(null);
    } finally {
      analyzingRef.current = false;
    }
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
        setCapturedFile(file);
        setCapturedUrl(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.9
    );
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = pickVideoMimeType();
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `capture-${Date.now()}.${ext}`, { type: mimeType });
      // Temporary diagnostic — replay still reported broken after two
      // targeted fixes (mp4-vs-webm priority, Infinity-duration workaround)
      // that couldn't be reproduced/confirmed in this dev environment (no
      // real camera access here to test against). Logs exactly what got
      // recorded so the next real repro has actual numbers instead of
      // another guess — safe to remove once the real cause is confirmed.
      // eslint-disable-next-line no-console
      console.log("[CameraCapture] recorded", { mimeType, chunkCount: chunksRef.current.length, blobSize: blob.size, seconds: secondsRef.current });
      setCapturedFile(file);
      setCapturedUrl(URL.createObjectURL(blob));
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setSeconds(0);

    if (analyzeLiveness) {
      blinkTrackerRef.current = new BlinkTracker();
      attentionTrackerRef.current = new AttentionTracker();
      bestDescriptorRef.current = null;
      awayStreakRef.current = 0;
      setLiveFaceDetected(null);
      setLiveBlinkCount(0);
      setLiveLookingAway(false);
      setShowBlinkPulse(false);
      if (modelsReady) {
        analysisIntervalRef.current = setInterval(analyzeFrame, ANALYSIS_INTERVAL_MS);
      }
    }

    secondsRef.current = 0;
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = Math.min(s + 1, MAX_VIDEO_SECONDS);
        secondsRef.current = next;
        if (next >= MAX_VIDEO_SECONDS) stopRecording();
        return next;
      });
    }, 1000);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
    if (blinkPulseTimeoutRef.current) {
      clearTimeout(blinkPulseTimeoutRef.current);
      blinkPulseTimeoutRef.current = null;
    }
    if (analyzeLiveness) {
      const summary = attentionTrackerRef.current?.summary() ?? { framesTotal: 0, noFacePct: 0, lookedAwayPct: 0, glanceCount: 0 };
      pendingLivenessResultRef.current = {
        blinkCount: blinkTrackerRef.current?.totalBlinks ?? 0,
        framesAnalyzed: summary.framesTotal,
        noFacePct: summary.noFacePct,
        lookedAwayPct: summary.lookedAwayPct,
        offCameraGlances: summary.glanceCount,
        recordingSeconds: secondsRef.current,
        descriptor: bestDescriptorRef.current ? Array.from(bestDescriptorRef.current.descriptor) : null,
      };
    }
  }

  function retake() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setCapturedFile(null);
    setSeconds(0);
    pendingLivenessResultRef.current = null;
  }

  function confirm() {
    if (capturedFile) onCapture(capturedFile);
    if (pendingLivenessResultRef.current) onLivenessResult?.(pendingLivenessResultRef.current);
    stopStream();
  }

  function close() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    stopStream();
    onClose();
  }

  // Found in accessibility review: this overlay had no role="dialog"/
  // aria-modal and no focus management — a keyboard user tabbing through it
  // fell straight into the page underneath, and a screen reader never
  // announced "you're in a dialog" at all.
  useFocusTrap(dialogRef, true, close);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "photo" ? "Take a photo" : "Record a video"}
        tabIndex={-1}
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-ink-950 shadow-lift"
      >
        <button
          onClick={close}
          className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          aria-label="Close camera"
        >
          <X className="h-4 w-4" />
        </button>

        {canFlip && allowFlip && !error && !capturedUrl && !recording && (
          <button
            onClick={flipCamera}
            disabled={flipping}
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-2 text-xs font-semibold text-white hover:bg-black/70 disabled:opacity-60"
            aria-label={currentFacingMode === "user" ? "Switch to back camera" : "Switch to front camera"}
          >
            <RefreshCw className={cn("h-4 w-4", flipping && "animate-spin")} />
            {currentFacingMode === "user" ? "Back" : "Front"}
          </button>
        )}

        <div className="relative aspect-[4/3] w-full bg-black">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
              <p className="text-sm font-medium text-white">{error}</p>
            </div>
          ) : capturedUrl ? (
            mode === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={capturedUrl} alt="Captured preview" className="h-full w-full object-cover" />
            ) : (
              <video
                src={capturedUrl}
                controls
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  // eslint-disable-next-line no-console
                  console.log("[CameraCapture] review player loadedmetadata", {
                    duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight,
                    // If this is ever non-null, it's the smoking gun: this
                    // element still has the LIVE camera stream attached via
                    // srcObject, which browsers play in preference to `src`
                    // regardless of what src points at — exactly matching
                    // "clicking Play shows the live camera" reported live.
                    unexpectedSrcObject: v.srcObject ? String(v.srcObject) : null,
                  });
                  if (v.srcObject) v.srcObject = null; // belt-and-braces: never let a stray srcObject win over the recorded blob
                  fixInfiniteDuration(v);
                }}
                onError={(e) => {
                  const err = e.currentTarget.error;
                  // eslint-disable-next-line no-console
                  console.error("[CameraCapture] review player error", { code: err?.code, message: err?.message });
                }}
                className="h-full w-full object-cover"
              />
            )
          ) : (
            <>
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                </div>
              )}
              {ready && analyzeLiveness && !modelsReady && !recording && (
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-[11px] font-medium text-white/80">
                  <Loader2 className="h-3 w-3 animate-spin" /> Preparing liveness check…
                </div>
              )}
              {recording && (
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-red-500/90 px-2.5 py-1 text-xs font-bold text-white">
                  <Circle className="h-2 w-2 animate-pulse fill-white" />
                  {String(Math.floor(seconds / 60)).padStart(1, "0")}:{String(seconds % 60).padStart(2, "0")}
                </div>
              )}
              {recording && analyzeLiveness && (
                <div
                  className={cn(
                    "absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white",
                    liveFaceDetected ? "bg-black/50" : "bg-amber-500/90"
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", liveFaceDetected ? "bg-sprout-400" : "animate-pulse bg-white")} />
                  {liveFaceDetected ? `${liveBlinkCount} blink${liveBlinkCount === 1 ? "" : "s"}` : "Center your face"}
                </div>
              )}
              {recording && analyzeLiveness && liveLookingAway && (
                <div className="absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-[11px] font-bold text-white">
                  Please look at the camera
                </div>
              )}
              <AnimatePresence>
                {recording && analyzeLiveness && showBlinkPulse && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-sprout-500/95 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    <Check className="h-3.5 w-3.5" /> Blink detected
                  </motion.div>
                )}
              </AnimatePresence>
              {mode === "video" && !recording && !(analyzeLiveness && !modelsReady) && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] font-medium text-white/80">
                  30–90 seconds
                </div>
              )}
            </>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <div className="flex items-center justify-center gap-4 bg-ink-950 px-6 py-5">
          {error ? null : capturedUrl ? (
            <>
              <button
                onClick={retake}
                className="flex items-center gap-1.5 rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
              >
                <RotateCcw className="h-4 w-4" /> Retake
              </button>
              <button
                onClick={confirm}
                className="flex items-center gap-1.5 rounded-2xl bg-sprout-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sprout-400"
              >
                <Check className="h-4 w-4" /> Use this {mode === "photo" ? "photo" : "video"}
              </button>
            </>
          ) : mode === "photo" ? (
            <button
              onClick={takePhoto}
              disabled={!ready}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/30 bg-white text-ink-900 transition-transform active:scale-90 disabled:opacity-40"
              aria-label="Take photo"
            >
              <Camera className="h-6 w-6" />
            </button>
          ) : !recording ? (
            <button
              onClick={startRecording}
              disabled={!ready || (analyzeLiveness && !modelsReady)}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/30 bg-red-500 text-white transition-transform active:scale-90 disabled:opacity-40"
              aria-label="Start recording"
            >
              <Video className="h-6 w-6" />
            </button>
          ) : (
            <button
              onClick={stopRecording}
              disabled={seconds < MIN_VIDEO_SECONDS}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-red-400 bg-white text-red-500 transition-transform active:scale-90 disabled:opacity-40"
              aria-label="Stop recording"
            >
              <Square className="h-5 w-5 fill-current" />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
