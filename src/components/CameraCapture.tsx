"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Circle, RotateCcw, Square, Video, X, Check, AlertTriangle, Loader2 } from "lucide-react";
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

function pickVideoMimeType(): string {
  const candidates = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "video/webm";
}

export function CameraCapture({
  mode,
  facingMode = "environment",
  analyzeLiveness = false,
  onCapture,
  onLivenessResult,
  onClose,
}: {
  mode: Mode;
  facingMode?: "user" | "environment";
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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, facingMode]);

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
              <video src={capturedUrl} controls className="h-full w-full object-cover" />
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
