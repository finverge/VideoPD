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
    try {
      const geo = await getGeo();
      const form = new FormData();
      form.append("file", file);
      form.append("applicationId", applicationId);
      form.append("type", type);
      if (geo) {
        form.append("geoLat", String(geo.lat));
        form.append("geoLng", String(geo.lng));
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
      </AnimatePresence>

      <AnimatePresence>
        {cameraOpen && (
          <CameraCapture
            mode={captureMode}
            facingMode={capture}
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

function getGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 }
    );
  });
}
