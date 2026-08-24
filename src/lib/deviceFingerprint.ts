"use client";

/**
 * Real, client-side device fingerprint — combines canvas-rendering quirks
 * (differ by GPU/driver/font-rendering stack) with a WebGL renderer/vendor
 * string and navigator/screen signals into one stable hash. This is the
 * same class of technique open-source fingerprinting libraries use (canvas
 * + WebGL fingerprinting is well-documented browser-security research, not
 * a proprietary trick) — real entropy, not fabricated.
 *
 * Honest scope: this is the prototype ceiling, not FingerprintJS Pro/
 * enterprise-grade. No reference-device database, no ML-based drift
 * tracking across browser updates, no protection against a fraud operator
 * deliberately spoofing these signals. Expect real collisions (two
 * genuinely different devices of the identical model/OS/browser combo) and
 * occasional false negatives (the same device after a browser update).
 * Advisory only — feeds the SHARED_DEVICE risk flag (see api/submit), never
 * blocks a submission. See docs/videopd-future-work.md item 5.
 */

export interface DeviceSignals {
  userAgent: string;
  platform: string;
  language: string;
  timezone: string;
  screenResolution: string;
  colorDepth: number;
  hardwareConcurrency: number | null;
  webglRenderer: string;
}

function canvasSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 30;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 100, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Finverge device check", 2, 2);
    return canvas.toDataURL();
  } catch {
    return "";
  }
}

function webglSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${vendor}~${renderer}`;
  } catch {
    return "";
  }
}

export function collectDeviceSignals(): DeviceSignals {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform ?? "",
    language: navigator.language ?? "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    screenResolution: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth ?? 0,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    webglRenderer: webglSignature(),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeDeviceFingerprint(): Promise<{ fingerprint: string; signals: DeviceSignals }> {
  const signals = collectDeviceSignals();
  const raw = JSON.stringify(signals) + "|" + canvasSignature();
  const fingerprint = await sha256Hex(raw);
  return { fingerprint, signals };
}
