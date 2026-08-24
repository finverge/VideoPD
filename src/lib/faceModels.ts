"use client";

import * as faceapi from "face-api.js";

/**
 * Real, on-device face detection/landmark/recognition models (face-api.js,
 * running entirely client-side via TensorFlow.js — nothing sent to a
 * server, no vendor API key). This is the genuine, honest ceiling for this
 * prototype's liveness/face-match work: real ML, real ~99%+ face-detection
 * accuracy on the underlying benchmarks, but not an enterprise liveness SDK
 * (FaceTec/Onfido) — no anti-spoofing beyond a real blink challenge, no
 * production-grade accuracy guarantees. See docs/videopd-future-work.md
 * item 3 for what this deliberately doesn't attempt (deepfake detection,
 * voice biometrics, coaching detection via lip-sync/background audio) —
 * none of that can be approximated honestly without a real trained model or
 * vendor, so none of it is attempted here either.
 *
 * Models are self-hosted under /public/models (not loaded from a CDN) so
 * they work reliably on the low-bandwidth connections this app already
 * targets — one ~6.7MB load, cached by the browser after that.
 */

const MODEL_URL = "/models";

let loadPromise: Promise<void> | null = null;

export function loadFaceModels(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => undefined);
  }
  return loadPromise;
}

export function faceModelsReady(): boolean {
  return (
    faceapi.nets.tinyFaceDetector.isLoaded &&
    faceapi.nets.faceLandmark68Net.isLoaded &&
    faceapi.nets.faceRecognitionNet.isLoaded
  );
}

export { faceapi };
