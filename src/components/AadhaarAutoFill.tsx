"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ScanText, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EvidenceItem, LangCode } from "@/types";

export interface AadhaarAutoFillFields {
  fullName: string | null;
  dob: string | null;
  gender: string | null;
  currentAddress: string | null;
  idNumber: string | null; // only ever set via the OCR fallback path — see handleAadhaarAutoFill's own comment
}

// Customer-requested follow-up to the original auto-fill ask: an Aadhaar
// card is legitimately both a valid ID proof AND a valid address proof, so
// a borrower who's already uploaded it here shouldn't be asked to upload
// the exact same document again on the Documents & Photos step further
// into the wizard. Auto-submits the same file to both evidence slots the
// moment a QR/OCR extraction succeeds (regardless of which of the two
// found the data — same underlying photo either way), via the same
// /api/upload endpoint UploadDropzone itself calls, not a separate path.
// "Change if you want" comes for free from existing behavior: UploadDropzone
// already renders a filled slot as editable/re-uploadable (see its own
// `existing` prop), so nothing there needed to change — a borrower who
// gets to that step can still swap in a different document, same as any
// other evidence slot.
const DOUBLE_DUTY_EVIDENCE_TYPES = ["ID_PROOF", "ADDRESS_PROOF"] as const;

async function uploadAsEvidence(file: File, applicationId: string, type: (typeof DOUBLE_DUTY_EVIDENCE_TYPES)[number]): Promise<EvidenceItem | null> {
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("applicationId", applicationId);
    form.append("type", type);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = await res.json();
    return data.evidence ?? null;
  } catch {
    return null; // never blocks or fails the auto-fill itself — see handleFile's own comment
  }
}

/**
 * Auto-fill entry point, shown once at the very top of step 0 — right
 * after mobile OTP verification lands the borrower here, before they've
 * typed a single field. Customer-requested (raised live in a demo): let a
 * borrower upload their Aadhaar instead of typing name/DOB/address by
 * hand, "to reduce the number of hits".
 *
 * Pre-fills only — see aadhaarQr.ts's own doc comment for why this is
 * deliberately a data-entry convenience, not identity verification. Every
 * field it fills stays fully editable afterward, same as if the borrower
 * had typed it themselves; nothing here is locked or hidden from review.
 *
 * Dismissible: a borrower without their Aadhaar handy, or who'd simply
 * rather type, can skip this and never see it again this session.
 */
export function AadhaarAutoFill({
  lang,
  applicationId,
  onFilled,
  onEvidenceUploaded,
}: {
  lang: LangCode;
  applicationId: string;
  onFilled: (fields: AadhaarAutoFillFields) => void;
  /** Fired once per evidence slot (ID_PROOF, then ADDRESS_PROOF) the same
   * uploaded photo got auto-submitted as, right after a successful
   * extraction — see DOUBLE_DUTY_EVIDENCE_TYPES' own comment above. Wire
   * this to whatever already merges UploadDropzone's own onUploaded results
   * into the page's evidence list; the shape is identical. */
  onEvidenceUploaded?: (evidence: EvidenceItem) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [working, setWorking] = useState(false);
  // "success-qr" and "success-ocr" get different copy/styling below —
  // the OCR fallback is genuinely lower-confidence (misreads on a
  // photographed card are common), so it gets a stronger "check this
  // carefully" nudge instead of the QR path's more confident wording.
  const [result, setResult] = useState<"success-qr" | "success-ocr" | "not-found" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (dismissed) return null;

  async function handleFile(file: File) {
    setWorking(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/application/extract-aadhaar", { method: "POST", body: form });
      const data = await res.json();
      if (data.success) {
        onFilled(data.fields);
        setResult(data.source === "ocr" ? "success-ocr" : "success-qr");
        // Fire-and-forget, deliberately not awaited before the success
        // message above shows — the borrower's auto-fill result shouldn't
        // wait on two extra uploads finishing. Both slots attempted
        // independently (Promise.all, not sequential) so one failing
        // doesn't hold up the other.
        Promise.all(
          DOUBLE_DUTY_EVIDENCE_TYPES.map(async (type) => {
            const evidence = await uploadAsEvidence(file, applicationId, type);
            if (evidence) onEvidenceUploaded?.(evidence);
          })
        ).catch(() => {});
      } else {
        setResult("not-found");
      }
    } catch {
      setResult("not-found");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="mb-6 overflow-hidden rounded-2xl border-2 border-sprout-200 bg-sprout-50/60 dark:border-sprout-800 dark:bg-sprout-950/20"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sprout-100 text-sprout-700 dark:bg-sprout-900/40 dark:text-sprout-400">
            <ScanText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900 dark:text-white">{t(lang, "aadhaarAutoFillTitle")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{t(lang, "aadhaarAutoFillBody")}</p>

            {result === "success-qr" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-sprout-700 dark:text-sprout-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t(lang, "aadhaarAutoFillSuccess")}
              </p>
            )}
            {result === "success-ocr" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> {t(lang, "aadhaarAutoFillSuccessOcr")}
              </p>
            )}
            {result === "not-found" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> {t(lang, "aadhaarAutoFillNotFound")}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                loading={working}
                disabled={working}
                onClick={() => inputRef.current?.click()}
              >
                {working ? t(lang, "aadhaarAutoFillWorking") : t(lang, "aadhaarAutoFillAction")}
              </Button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-xs font-semibold text-ink-400 underline decoration-dotted underline-offset-2 hover:text-ink-600 dark:hover:text-ink-200"
              >
                {t(lang, "aadhaarAutoFillSkip")}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t(lang, "aadhaarAutoFillDismiss")}
            className={cn(
              "shrink-0 rounded-full p-1 text-ink-300 hover:bg-ink-100 hover:text-ink-500",
              "dark:text-ink-600 dark:hover:bg-ink-800 dark:hover:text-ink-300"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
