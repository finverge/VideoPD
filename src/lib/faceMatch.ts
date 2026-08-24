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
 * throwing — callers treat "no face" as a signal to skip/flag, not an error.
 *
 * inputSize defaults to TinyFaceDetector's own default (416, tuned for a
 * face filling a good fraction of the frame — a selfie or a live camera
 * capture). A document scan is the opposite shape: a small ID photo inside
 * a much larger page, so the face occupies a small fraction of the image.
 * Confirmed live: at 416, detection on a rendered Aadhaar PDF page found no
 * face at all; a caller working from a full-page render should pass a
 * larger size (608, TinyFaceDetector's max) instead. */
export async function extractFaceDescriptor(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  inputSize?: number
): Promise<Float32Array | null> {
  const options = inputSize ? new faceapi.TinyFaceDetectorOptions({ inputSize }) : new faceapi.TinyFaceDetectorOptions();
  const result = await faceapi
    .detectSingleFace(input, options)
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

async function descriptorFromImageBlob(blob: Blob): Promise<Float32Array | null> {
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
    return await descriptorFromImageBlob(await res.blob());
  } catch {
    return null;
  }
}

/** Scans a large canvas in overlapping tiles and returns the first
 * confident face descriptor found. TinyFaceDetector downscales its WHOLE
 * input to fit `inputSize` (608 max) before running — so a small ID photo
 * within a large rendered page shrinks to well under reliably-detectable
 * size regardless of how high the page itself was rendered (the face and
 * the page grow together, so their ratio never improves). Confirmed live
 * against a real Aadhaar PDF: a genuinely clear, visible photo went
 * completely undetected on a single full-page pass even at max inputSize —
 * only cropping to a smaller region worked. Each tile is small enough that
 * a face within it stays a large fraction of that tile, independent of the
 * source document's layout (not an Aadhaar-specific heuristic — this is a
 * standard sliding-window technique, applicable to any document shape). */
async function detectFaceInLargeCanvas(canvas: HTMLCanvasElement): Promise<Float32Array | null> {
  const GRID = 3; // 3x3 tiles
  const OVERLAP = 0.15; // so a face straddling a tile boundary isn't missed by both neighbors
  const tileW = canvas.width / GRID;
  const tileH = canvas.height / GRID;
  const stepW = tileW * (1 - OVERLAP);
  const stepH = tileH * (1 - OVERLAP);

  for (let ty = 0; ty < canvas.height - 1; ty += stepH) {
    for (let tx = 0; tx < canvas.width - 1; tx += stepW) {
      const w = Math.min(tileW, canvas.width - tx);
      const h = Math.min(tileH, canvas.height - ty);
      const crop = document.createElement("canvas");
      crop.width = Math.round(w);
      crop.height = Math.round(h);
      const ctx = crop.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(canvas, tx, ty, w, h, 0, 0, crop.width, crop.height);
      const descriptor = await extractFaceDescriptor(crop);
      if (descriptor) return descriptor;
    }
  }
  return null;
}

/** Renders a PDF's first page to an offscreen canvas and extracts a face
 * descriptor from it — the "ID proof was uploaded as a PDF" case, a real,
 * common shape (DigiLocker/scanned Aadhaar downloads), which previously
 * meant face-match was unconditionally skipped (reported live — "no ID
 * proof to match" even though one was clearly uploaded and visible to the
 * underwriter; it just wasn't an image). pdfjs-dist is dynamically imported
 * here rather than at module top-level, since it's only needed on this one
 * path — the far more common image-ID-proof case never pays its bundle
 * cost (same practice as useCallRoom.ts's dynamic import of faceModels).
 * Honest limitation: this still depends on the scan actually containing a
 * clear, detectable face at whatever resolution the PDF embeds it at — a
 * genuinely low-quality/blurry scan can still legitimately yield no
 * confident detection, same as a blurry photo would; tiling fixes the
 * "face is real but too small in the full page" case, not a bad scan. */
async function descriptorFromPdfBlob(blob: Blob): Promise<Float32Array | null> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  // 3x scale — captures as much of the PDF's own embedded photo resolution
  // as possible; tiling above is what actually makes that usable.
  const viewport = page.getViewport({ scale: 3 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
  return detectFaceInLargeCanvas(canvas);
}

/** ID proof can be an image or a PDF — dispatches on the response's actual
 * content-type rather than assuming, so both real shapes work. Returns null
 * on any failure (not found, unrecognized type, no face detected in either
 * case) — every failure mode looks the same to the caller, same contract
 * descriptorFromImageUrl always had. */
export async function descriptorFromIdProofUrl(url: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const blob = await res.blob();
    if (contentType.startsWith("image/")) return await descriptorFromImageBlob(blob);
    if (contentType === "application/pdf") return await descriptorFromPdfBlob(blob);
    return null;
  } catch {
    return null;
  }
}
