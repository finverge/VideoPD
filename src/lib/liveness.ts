/**
 * Real liveness/attention signals derived from face-api.js's 68-point
 * landmarks — pure, framework-free functions so the actual math is testable
 * without a browser or camera (see scripts/ for the verification this was
 * checked against real photos before being wired into the UI).
 *
 * Honest scope: this proves "a real face with real eye movement was in
 * front of the camera," which a static printed photo or a photo held up to
 * the camera does NOT produce (no blink event, constant EAR) — that's real
 * anti-spoofing value, not nothing. It is NOT deepfake detection, 3D depth
 * sensing, or an enterprise liveness SDK's full challenge set. See
 * docs/videopd-future-work.md item 3.
 */

export interface Point {
  x: number;
  y: number;
}

/** Minimal shape this module needs from face-api.js's FaceLandmarks68 —
 * kept as a plain interface so these functions don't import face-api.js
 * (and stay testable in plain Node without the browser-only parts of it). */
export interface EyeLandmarks {
  getLeftEye(): Point[];
  getRightEye(): Point[];
  getNose(): Point[];
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function avgPoint(points: Point[]): Point {
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y };
}

/** Eye Aspect Ratio (Soukupová & Čech, "Real-Time Eye Blink Detection using
 * Facial Landmarks", 2016) — a published, standard technique. Needs exactly
 * the 6 eye-contour points face-api.js's getLeftEye()/getRightEye() already
 * return in the right order. Drops sharply when the eye closes. */
export function eyeAspectRatio(eye: Point[]): number {
  if (eye.length !== 6) return 0;
  const vertical1 = dist(eye[1], eye[5]);
  const vertical2 = dist(eye[2], eye[4]);
  const horizontal = dist(eye[0], eye[3]);
  if (horizontal === 0) return 0;
  return (vertical1 + vertical2) / (2 * horizontal);
}

export function averageEAR(landmarks: EyeLandmarks): number {
  return (eyeAspectRatio(landmarks.getLeftEye()) + eyeAspectRatio(landmarks.getRightEye())) / 2;
}

const BLINK_EAR_THRESHOLD = 0.23; // below this, eyes are considered closed this frame

/** Tracks EAR across frames and reports a completed blink — a dip below
 * threshold followed by a return above it. A held-up photo or a frozen
 * frame gives a constant EAR and never fires this; that's the actual
 * anti-spoofing signal, not just "a face was detected." */
export class BlinkTracker {
  private eyesClosed = false;
  private blinkCount = 0;

  /** Feed one frame's EAR reading. Returns true the instant a blink completes. */
  update(ear: number): boolean {
    const closedNow = ear < BLINK_EAR_THRESHOLD;
    if (closedNow) {
      this.eyesClosed = true;
      return false;
    }
    // Eyes open this frame — if they were closed last frame, that's a completed blink.
    const justBlinked = this.eyesClosed;
    if (justBlinked) this.blinkCount++;
    this.eyesClosed = false;
    return justBlinked;
  }

  get totalBlinks(): number {
    return this.blinkCount;
  }
}

/** Rough horizontal head-yaw estimate: how far the nose tip sits from the
 * midpoint between the eyes, normalized by eye separation. A lightweight
 * geometric proxy, not a real 3D head-pose model — good enough to flag
 * "clearly turned away," not precise degrees. Returns 0 (facing camera) to
 * roughly ±1 (turned sharply to one side). */
export function estimateYawOffset(landmarks: EyeLandmarks): number {
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();
  if (!leftEye.length || !rightEye.length || !nose.length) return 0;

  const leftEyeCenter = avgPoint(leftEye);
  const rightEyeCenter = avgPoint(rightEye);
  const eyeMidpoint = { x: (leftEyeCenter.x + rightEyeCenter.x) / 2, y: (leftEyeCenter.y + rightEyeCenter.y) / 2 };
  const eyeSpan = dist(leftEyeCenter, rightEyeCenter) || 1;
  const noseTip = nose[Math.floor(nose.length / 2)];

  return (noseTip.x - eyeMidpoint.x) / eyeSpan;
}

export const LOOKED_AWAY_YAW_THRESHOLD = 0.35;

/** Tracks how often, across the session, no face was visible at all, how
 * often it was visible but turned away, and — the actual coaching-detection
 * signal — how many separate times the borrower glanced away and came back.
 * A repeated pattern of brief glances (checking a second screen for an
 * answer, glancing at someone off-camera) is what's actually suspicious;
 * one sustained turn (adjusting position, or an off-camera capture step)
 * isn't, even though both can produce the same cumulative lookedAwayPct.
 * Counting discrete glances (away → back, same shape as BlinkTracker's
 * close → reopen) separates the two.
 *
 * Honest scope, unchanged from before: this is real per-frame presence and
 * a rough geometric gaze proxy, not background-voice or lip-sync analysis
 * (docs/videopd-future-work.md item 3) — those need real audio/video ML
 * this can't approximate honestly, so neither is attempted. */
// A head-yaw estimate from 2D landmarks is noisier frame-to-frame than EAR
// is for blinks — a single jittery detection can cross the threshold and
// snap back with no real head movement at all. Requiring 2 consecutive
// over-threshold frames before counting the excursion as a genuine "away"
// state (~800ms at the 400ms sampling interval CameraCapture uses) filters
// that noise out without meaningfully missing real glances, which last
// at least a second or two in practice.
const AWAY_ENTRY_STREAK = 2;

export class AttentionTracker {
  private framesTotal = 0;
  private framesNoFace = 0;
  private framesLookedAway = 0;
  private currentlyAway = false;
  private awayStreak = 0;
  private glanceCount = 0;

  /** Call once per frame. Pass null when no face was detected at all. */
  update(yawOffset: number | null): void {
    this.framesTotal++;
    if (yawOffset === null) {
      this.framesNoFace++;
      // No face at all could just as easily be a detection miss or the
      // borrower stepping out of frame briefly — not the same signal as a
      // directional turn, so it doesn't complete (or start) a glance.
      this.awayStreak = 0;
      this.currentlyAway = false;
      return;
    }
    const away = Math.abs(yawOffset) > LOOKED_AWAY_YAW_THRESHOLD;
    if (away) {
      this.framesLookedAway++;
      this.awayStreak++;
      if (this.awayStreak >= AWAY_ENTRY_STREAK) this.currentlyAway = true;
    } else {
      this.awayStreak = 0;
      if (this.currentlyAway) {
        this.glanceCount++; // came back to facing the camera — one completed glance
        this.currentlyAway = false;
      }
    }
  }

  summary(): { framesTotal: number; noFacePct: number; lookedAwayPct: number; glanceCount: number } {
    if (this.framesTotal === 0) return { framesTotal: 0, noFacePct: 0, lookedAwayPct: 0, glanceCount: 0 };
    return {
      framesTotal: this.framesTotal,
      noFacePct: Math.round((this.framesNoFace / this.framesTotal) * 100),
      lookedAwayPct: Math.round((this.framesLookedAway / this.framesTotal) * 100),
      glanceCount: this.glanceCount,
    };
  }
}
