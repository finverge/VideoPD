"use client";

import { faceapi } from "@/lib/faceModels";

/**
 * Selfie-vs-ID-proof face matching, client-side, using face-api.js's
 * pre-trained face-recognition net (128-d descriptor, Euclidean distance).
 * Verified against real photos before this was wired into the UI (see the
 * liveness/faceModels module comments) — different people scored ~0.87,
 * the same photo scored 0.00. <0.6 is the conventional same-person cutoff
 * for this model, used as-is here.
 *
 * Honest scope: this is a real, general-purpose face-recognition model, not
 * one trained or tuned for Indian ID documents specifically, and this
 * prototype has no liveness-SDK-grade anti-spoofing beyond the blink check
 * in liveness.ts. Advisory only — see docs/videopd-future-work.md item 3.
 */

export const FACE_MATCH_DISTANCE_THRESHOLD = 0.6;

/** Runs detection + landmarks + descriptor extraction on a single image-like
 * element. Returns null if no face was confidently found, rather than
 * throwing — callers treat "no face" as a signal to skip/flag, not an error. */
export async function extractFaceDescriptor(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<Float32Array | null> {
  const result = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result?.descriptor ?? null;
}

export function compareFaceDescriptors(a: Float32Array | number[], b: Float32Array | number[]): number {
  return faceapi.euclideanDistance(a, b);
}

export function isSamePerson(distance: number): boolean {
  return distance < FACE_MATCH_DISTANCE_THRESHOLD;
}

/** Fetches a same-origin image URL and extracts a face descriptor from it.
 * Returns null on any failure — not found, not an image, no face detected —
 * so callers can treat every failure mode the same way: skip the match. */
export async function descriptorFromImageUrl(url: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image failed to load"));
      });
      img.src = objectUrl;
      await loaded;
      return await extractFaceDescriptor(img);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}
