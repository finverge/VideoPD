"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, AlertTriangle, FolderOpen, Loader2, UploadCloud, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EvidenceItem } from "@/types";
import { CameraCapture } from "@/components/CameraCapture";

export function UploadDropzone({
  title,
  helpText,
  accept,
  capture,
  applicationId,
  type,
  existing,
  onUploaded,
}: {
  title: string;
  helpText: string;
  accept: string;
  capture?: "user" | "environment";
  applicationId: string;
  type: EvidenceItem["type"];
  existing?: EvidenceItem;
  onUploaded: (evidence: EvidenceItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);

  const captureMode: "photo" | "video" = accept.startsWith("video/") ? "video" : "photo";

  useEffect(() => {
    setHasCamera(
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"
    );
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setLocalError(null);
    setGeoNote(null);
    try {
      const geo = await getGeo();
      const form = new FormData();
      form.append("file", file);
      form.append("applicationId", applicationId);
      form.append("type", type);
      if ("lat" in geo) {
        form.append("geoLat", String(geo.lat));
        form.append("geoLng", String(geo.lng));
      } else {
        // Every prior reason (permission denied, unsupported, timed out, an
        // insecure http:// origin blocking the API outright) used to
        // collapse into the exact same silent "no location" with nothing
        // shown anywhere — reported live as "why didn't it capture it?"
        // with no way to tell which of those actually happened. Not
        // treated as an upload error (setLocalError) since the upload
        // itself still succeeds — this is purely informational, so it
        // doesn't block or fail anything.
        setGeoNote(geo.reason);
      }
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onUploaded(data.evidence);
    } catch (e: any) {
      setLocalError(e.message ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const showCameraOption = Boolean(capture) && hasCamera;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture as any}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = ""; // allow re-selecting the same file later
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className={cn(
          "flex w-full items-center gap-4 rounded-2xl border-2 border-dashed p-4 transition-colors",
          existing?.qualityStatus === "PASSED"
            ? "border-sprout-300 bg-sprout-50/50 dark:border-sprout-800 dark:bg-sprout-950/20"
            : existing?.qualityStatus === "FLAGGED"
            ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
            : dragOver
            ? "border-sprout-400 bg-sprout-50 dark:bg-sprout-950/30"
            : "border-ink-200 bg-white hover:border-sprout-300 dark:border-ink-700 dark:bg-ink-900"
        )}
      >
        <button
          type="button"
          onClick={() => (showCameraOption ? setCameraOpen(true) : inputRef.current?.click())}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform active:scale-95",
            existing ? "bg-sprout-100 text-sprout-600 dark:bg-sprout-900/40" : "bg-ink-50 text-ink-400 dark:bg-ink-800"
          )}
          aria-label={showCameraOption ? "Open camera" : "Choose file"}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : existing?.qualityStatus === "PASSED" ? (
            <CheckCircle2 className="h-5 w-5 text-sprout-600" />
          ) : existing?.qualityStatus === "FLAGGED" ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : capture ? (
            captureMode === "video" ? (
              <Video className="h-5 w-5" />
            ) : (
              <Camera className="h-5 w-5" />
            )
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
        </button>

        <button type="button" onClick={() => inputRef.current?.click()} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{title}</p>
          <p className="truncate text-xs text-ink-400">{existing ? existing.fileName : helpText}</p>
          {existing?.qualityStatus === "FLAGGED" && existing.qualityNotes && (
            <p className="mt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">{existing.qualityNotes}</p>
          )}
        </button>

        {showCameraOption && (
          <div className="flex shrink-0 items-center gap-1.5">
            <IconAction label="Use camera" onClick={() => setCameraOpen(true)} active>
              {captureMode === "video" ? <Video className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
            </IconAction>
            <IconAction label="Choose file" onClick={() => inputRef.current?.click()}>
              <FolderOpen className="h-4 w-4" />
            </IconAction>
          </div>
        )}
      </div>

      <AnimatePresence>
        {localError && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 text-xs font-medium text-red-500"
          >
            {localError}
          </motion.p>
        )}
        {/* Informational, not an error — the upload above still succeeded.
            Only tells you WHY no location tag was attached, since every
            reason used to be silently indistinguishable from every other. */}
        {!localError && geoNote && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 text-xs font-medium text-ink-400"
          >
            No location tag attached: {geoNote}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cameraOpen && (
          <CameraCapture
            mode={captureMode}
            facingMode={capture}
            // A selfie (capture="user") must stay on the front camera —
            // flipping it would defeat the point of the shot. Every other
            // slot (ID/address proof, business photo/video) is free to
            // flip on a device that has a second camera.
            allowFlip={capture !== "user"}
            onClose={() => setCameraOpen(false)}
            onCapture={(file) => {
              setCameraOpen(false);
              upload(file);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-sprout-100 text-sprout-700 hover:bg-sprout-200 dark:bg-sprout-900/40 dark:text-sprout-300"
          : "text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
      )}
    >
      {children}
    </button>
  );
}

type GeoResult = { lat: number; lng: number } | { reason: string };

// Every failure path here used to collapse to the same silent `resolve(null)`
// — permission denied, no browser support, a GPS timeout, and one common
// real-world gotcha (navigator.geolocation is simply undefined on any
// non-secure, non-localhost origin — plain http:// on a LAN IP, no prompt,
// no error, nothing) were all indistinguishable from each other and
// invisible to whoever was testing. Reported live as "why didn't it capture
// it?" with no way to tell which one actually happened.
function getGeo(): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined") return resolve({ reason: "not running in a browser." });
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return resolve({ reason: "this page isn't loaded over https:// or localhost — browsers only allow location access on a secure connection." });
    }
    if (!navigator.geolocation) return resolve({ reason: "this browser doesn't support location access." });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return resolve({ reason: "location access was denied." });
        if (err.code === err.TIMEOUT) return resolve({ reason: "location request timed out (GPS may be unavailable indoors)." });
        resolve({ reason: "location is unavailable on this device right now." });
      },
      {
        // 4s was too tight for a real cold fix (reported live: worked on
        // one upload, timed out on the next). 10s gives a genuine cold
        // acquisition a realistic chance without hanging the upload
        // indefinitely if there's truly no signal.
        timeout: 10000,
        // Reuse a position the browser already has from up to 5 minutes
        // ago instead of forcing a brand-new fix every single upload — the
        // default (maximumAge: 0) never reuses anything, so even the very
        // next upload seconds later has to reacquire from scratch. Across a
        // multi-document upload flow like this one, that's most of why
        // "worked on the first upload, timed out on the second" happens:
        // the first call's successful fix gets thrown away instead of
        // reused for the next document a few seconds later.
        maximumAge: 5 * 60 * 1000,
      }
    );
  });
}
