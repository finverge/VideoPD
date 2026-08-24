"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  MessageCircle,
  X,
  CheckCircle2,
  ShieldCheck,
  Copy,
} from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { computeDeviceFingerprint } from "@/lib/deviceFingerprint";
import { StepFields } from "@/components/StepFields";
import { UploadDropzone } from "@/components/UploadDropzone";
import { BrandHeader } from "@/components/BrandHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressSteps } from "@/components/ui/ProgressSteps";
import { Input } from "@/components/ui/Input";
import {
  CORE_STEPS,
  SEGMENT_FIELDS,
  fieldsForStep,
  getWizardSteps,
} from "@/lib/formSchema";
import { t } from "@/lib/i18n";
import { cn, formatINR } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { EvidenceItem, LangCode, SegmentCode } from "@/types";

const EVIDENCE_CONFIG: { type: EvidenceItem["type"]; titleKey: string; helpKey: string; accept: string; capture?: "user" | "environment" }[] = [
  { type: "ID_PROOF", titleKey: "uploadIdProof", helpKey: "uploadIdProofHelp", accept: "image/*,.pdf" },
  { type: "ADDRESS_PROOF", titleKey: "uploadAddressProof", helpKey: "uploadAddressProofHelp", accept: "image/*,.pdf" },
  { type: "BUSINESS_PHOTO", titleKey: "uploadBusinessPhoto", helpKey: "uploadBusinessPhotoHelp", accept: "image/*", capture: "environment" },
  { type: "BUSINESS_VIDEO", titleKey: "uploadBusinessVideo", helpKey: "uploadBusinessVideoHelp", accept: "video/*", capture: "environment" },
  { type: "SELFIE", titleKey: "uploadSelfie", helpKey: "uploadSelfieHelp", accept: "image/*", capture: "user" },
];

export default function ApplyPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const applicationId = params.id;
  const lang = (search.get("lang") as LangCode) || (typeof window !== "undefined" ? (localStorage.getItem("finverge_lang") as LangCode) : null) || "en";

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [segment, setSegment] = useState<SegmentCode>("FARMER");
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [segmentFields, setSegmentFields] = useState<Record<string, unknown>>({});
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [consent, setConsent] = useState({ dataUsage: false, bureauPull: false, media: false });
  const [sameAsCurrentAddress, setSameAsCurrentAddress] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatSheetRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const steps = useMemo(() => getWizardSteps(), []);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/application/${applicationId}`);
      const data = await res.json();
      if (data.application) {
        // A borrower revisiting their own saved /apply/[id] link after
        // already submitting would otherwise land back on a fully "live"
        // wizard: fields editable, Back/Next clickable — but every edit
        // 409s silently (persist() below doesn't surface fetch errors),
        // so nothing they change here actually saves. Send them to their
        // lead's status page instead, same place a fresh submit lands them.
        if (data.application.status !== "DRAFT") {
          router.replace(data.application.lead ? `/lead/${data.application.lead.id}?lang=${lang}` : "/");
          return;
        }
        setSegment(data.application.segment);
        setStep(data.application.currentStep ?? 0);
        setFields(data.application);
        setSegmentFields(data.application.segmentFieldsJson ? JSON.parse(data.application.segmentFieldsJson) : {});
        setEvidence(data.application.evidence ?? []);
      } else {
        // A bad/mistyped/tampered applicationId (the GET 404s, so
        // data.application is absent) used to fall straight through to the
        // component's default blank state — rendering what looked like a
        // normal fresh wizard. Every field would silently fail to persist
        // (persist() doesn't check res.ok either), so a borrower could fill
        // all 9 steps before finally hitting an error on Submit. Surface it
        // immediately instead.
        setNotFound(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const persist = useCallback(
    async (patch: { fields?: Record<string, unknown>; currentStep?: number; segmentFields?: Record<string, unknown> }) => {
      setSaving(true);
      try {
        await fetch(`/api/application/${applicationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } finally {
        setSaving(false);
      }
    },
    [applicationId]
  );

  function updateField(key: string, value: unknown) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }
  function updateSegmentField(key: string, value: unknown) {
    setSegmentFields((prev) => ({ ...prev, [key]: value }));
  }

  // Keep permanent address live-synced while "same as current address" is checked.
  useEffect(() => {
    if (sameAsCurrentAddress) {
      setFields((prev) => (prev.permanentAddress === prev.currentAddress ? prev : { ...prev, permanentAddress: prev.currentAddress ?? "" }));
    }
  }, [sameAsCurrentAddress, fields.currentAddress]);

  async function goNext() {
    const nextStep = Math.min(step + 1, steps.length - 1);
    await persist({ fields, currentStep: nextStep, segmentFields });
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function goBack() {
    const prevStep = Math.max(step - 1, 0);
    setStep(prevStep);
    await persist({ currentStep: prevStep });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const currentCoreFields = step < CORE_STEPS.length ? fieldsForStep(step, segment) : [];
  const activeFieldKey = useMemo(() => {
    const empty = currentCoreFields.find((f) => !fields[f.key]);
    return empty?.key ?? null;
  }, [currentCoreFields, fields]);
  const activeFieldLabel = activeFieldKey
    ? t(lang, currentCoreFields.find((f) => f.key === activeFieldKey)?.labelKey ?? "")
    : null;

  // Same "walk the empty fields in order" pattern as core fields, but for the
  // segment step — lets the chatbot fill Farmer/Student/Business fields too.
  const currentSegmentFields = steps[step] === "stepSegment" ? SEGMENT_FIELDS[segment] : [];
  const activeSegmentFieldKey = useMemo(() => {
    const empty = currentSegmentFields.find((f) => !segmentFields[f.key]);
    return empty?.key ?? null;
  }, [currentSegmentFields, segmentFields]);
  const activeSegmentFieldLabel = activeSegmentFieldKey
    ? t(lang, currentSegmentFields.find((f) => f.key === activeSegmentFieldKey)?.labelKey ?? "")
    : null;

  // Whichever step is active, hand the chat panel the right field to fill and
  // the right place to write the answer — core fields vs segment fields live
  // in separate state, and outside both (upload/review) chat has nothing to fill.
  const chatFieldKey = step < CORE_STEPS.length ? activeFieldKey : steps[step] === "stepSegment" ? activeSegmentFieldKey : null;
  const chatFieldLabel = step < CORE_STEPS.length ? activeFieldLabel : steps[step] === "stepSegment" ? activeSegmentFieldLabel : null;
  const chatOnFieldUpdate = steps[step] === "stepSegment" ? updateSegmentField : updateField;

  const requiredEvidence: EvidenceItem["type"][] = ["ID_PROOF", "ADDRESS_PROOF", "SELFIE"];
  const evidenceComplete = requiredEvidence.every((reqType) => evidence.some((e) => e.type === reqType));
  const allConsentGiven = consent.dataUsage && consent.bureauPull && consent.media;

  // Found in accessibility review: this bottom sheet had no role="dialog"/
  // aria-modal and no focus management — a keyboard user tabbing through it
  // fell straight into the page underneath, and its close button had no
  // aria-label at all (icon-only, so a screen reader announced nothing).
  useFocusTrap(chatSheetRef, chatOpen, () => setChatOpen(false));

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await persist({ fields, segmentFields });
      // Best-effort — a fingerprint failure (unsupported API, blocked
      // canvas, etc.) shouldn't stop a legitimate submission. See
      // src/lib/deviceFingerprint.ts for what this does and doesn't cover.
      const device = await computeDeviceFingerprint().catch(() => null);
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, consent, deviceFingerprint: device?.fingerprint, deviceSignals: device?.signals }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/lead/${data.lead.id}?lang=${lang}`);
    } catch (e: any) {
      setSubmitError(e.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-sprout-500" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
        <ShieldCheck className="mb-4 h-8 w-8 text-red-400" />
        <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400">
          We couldn&apos;t find this application. The link may be incorrect — please start a new application or check the link you were sent.
        </p>
      </div>
    );
  }

  const stepLabels = steps.map((s) => t(lang, s));

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <BrandHeader className="mr-4 flex-1" />
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs font-medium text-ink-400">Saving…</span>}
          <span className="hidden text-xs font-semibold text-ink-400 sm:block">{t(lang, "savedDraft")}</span>
          <ThemeToggle />
        </div>
      </div>

      <div className="mb-8">
        <ProgressSteps labels={stepLabels} activeIndex={step} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main step content */}
        <div>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22 }}
            >
              <Card className="min-h-[420px]">
                <h2 className="mb-6 text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">
                  {stepLabels[step]}
                </h2>

                {step < CORE_STEPS.length && (
                  <StepFields
                    fields={currentCoreFields}
                    values={fields}
                    onChange={updateField}
                    lang={lang}
                    activeFieldKey={activeFieldKey}
                    disabledKeys={sameAsCurrentAddress ? ["permanentAddress"] : []}
                    renderAfterField={(key) =>
                      key === "currentAddress" ? (
                        <div className="sm:col-span-2 -mt-2">
                          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-500 dark:text-ink-400">
                            <input
                              type="checkbox"
                              checked={sameAsCurrentAddress}
                              onChange={(e) => {
                                setSameAsCurrentAddress(e.target.checked);
                                if (e.target.checked) updateField("permanentAddress", fields.currentAddress ?? "");
                              }}
                              className="h-4 w-4 rounded border-2 border-ink-300 text-sprout-600 focus:ring-sprout-400"
                            />
                            <Copy className="h-3.5 w-3.5" />
                            Permanent address is the same as current address
                          </label>
                        </div>
                      ) : null
                    }
                  />
                )}

                {steps[step] === "stepSegment" && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {SEGMENT_FIELDS[segment].map((f) => (
                      <Input
                        key={f.key}
                        id={f.key}
                        type={f.type === "number" ? "number" : "text"}
                        label={t(lang, f.labelKey)}
                        value={(segmentFields[f.key] as string | number) ?? ""}
                        onChange={(e) =>
                          updateSegmentField(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)
                        }
                      />
                    ))}
                  </div>
                )}

                {steps[step] === "stepUpload" && (
                  <div className="space-y-3">
                    {EVIDENCE_CONFIG.filter((c) => segment === "FARMER" || segment === "BUSINESS_OWNER" || (c.type !== "BUSINESS_PHOTO" && c.type !== "BUSINESS_VIDEO")).map((cfg) => (
                      <UploadDropzone
                        key={cfg.type}
                        title={t(lang, cfg.titleKey)}
                        helpText={t(lang, cfg.helpKey)}
                        accept={cfg.accept}
                        capture={cfg.capture}
                        applicationId={applicationId}
                        type={cfg.type}
                        existing={evidence.find((e) => e.type === cfg.type)}
                        onUploaded={(ev) =>
                          setEvidence((prev) => [...prev.filter((e) => e.type !== ev.type), ev])
                        }
                      />
                    ))}
                  </div>
                )}

                {steps[step] === "stepReview" && (
                  <ReviewStep
                    lang={lang}
                    fields={fields}
                    segment={segment}
                    segmentFields={segmentFields}
                    evidence={evidence}
                    consent={consent}
                    setConsent={setConsent}
                  />
                )}

                {submitError && (
                  <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
                    {submitError}
                  </p>
                )}

                {/* Viewport-relative (not fixed-px) margin at every breakpoint —
                    the fixed "Powered by" badge is pinned to the viewport's
                    bottom-right corner, and the 9 steps vary a lot in field
                    count (mobile's single-column stacking makes this worse,
                    not better), so a fixed-px push just relocates which
                    step's button lands in the badge's zone (confirmed twice:
                    once on desktop, once on mobile's "Address" step). A
                    vh-based push scales with actual content/viewport height
                    instead, guaranteeing every step's Back/Next row sits
                    below the badge's corner at rest, at the cost of a short
                    scroll on shorter steps. */}
                <div className="mt-[52vh] flex items-center justify-between border-t border-ink-100 pt-5 dark:border-ink-800 sm:mt-[48vh]">
                  <Button variant="ghost" onClick={goBack} disabled={step === 0} icon={<ArrowLeft className="h-4 w-4" />}>
                    {t(lang, "back")}
                  </Button>
                  {steps[step] === "stepReview" ? (
                    <Button
                      size="lg"
                      loading={submitting}
                      disabled={!evidenceComplete || !allConsentGiven}
                      onClick={handleSubmit}
                      icon={<CheckCircle2 className="h-4 w-4" />}
                    >
                      {t(lang, "submit")}
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={goNext}
                      disabled={steps[step] === "stepUpload" && !evidenceComplete}
                      icon={<ArrowRight className="h-4 w-4" />}
                    >
                      {t(lang, "next")}
                    </Button>
                  )}
                </div>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Desktop chat panel — sticky */}
        <div className="hidden lg:block">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <ChatPanel
              applicationId={applicationId}
              lang={lang}
              segment={segment}
              activeFieldKey={chatFieldKey}
              activeFieldLabel={chatFieldLabel}
              onFieldUpdate={chatOnFieldUpdate}
            />
          </div>
        </div>
      </div>

      {/* Mobile floating chat trigger + sheet */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-5 left-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sprout-500 to-sprout-600 text-white shadow-glow lg:hidden"
        aria-label="Open assistant"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setChatOpen(false)}
          >
            <motion.div
              ref={chatSheetRef}
              role="dialog"
              aria-modal="true"
              aria-label="Lakshya Assistant"
              tabIndex={-1}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-0 right-0 h-[85vh] rounded-t-3xl bg-white p-2 pt-4 dark:bg-ink-950"
            >
              <button
                onClick={() => setChatOpen(false)}
                aria-label="Close assistant"
                className="absolute right-4 top-4 z-10 rounded-full bg-ink-100 p-1.5 text-ink-500 dark:bg-ink-800"
              >
                <X className="h-4 w-4" />
              </button>
              <ChatPanel
                applicationId={applicationId}
                lang={lang}
                segment={segment}
                activeFieldKey={chatFieldKey}
                activeFieldLabel={chatFieldLabel}
                onFieldUpdate={chatOnFieldUpdate}
                className="h-full !rounded-2xl"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function ReviewStep({
  lang,
  fields,
  segment,
  segmentFields,
  evidence,
  consent,
  setConsent,
}: {
  lang: LangCode;
  fields: Record<string, unknown>;
  segment: SegmentCode;
  segmentFields: Record<string, unknown>;
  evidence: EvidenceItem[];
  consent: { dataUsage: boolean; bureauPull: boolean; media: boolean };
  setConsent: React.Dispatch<React.SetStateAction<{ dataUsage: boolean; bureauPull: boolean; media: boolean }>>;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-500 dark:text-ink-400">{t(lang, "reviewSub")}</p>

      <SummaryRow label={t(lang, "fullName")} value={fields.fullName as string} />
      <SummaryRow label={t(lang, "requestedAmount")} value={formatINR(fields.requestedAmount as number | null | undefined)} />
      <SummaryRow label={t(lang, "loanPurpose")} value={fields.loanPurpose as string} />
      <SummaryRow label={t(lang, "monthlyIncome")} value={formatINR(fields.monthlyIncome as number | null | undefined)} />

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">{t(lang, "stepSegment")}</p>
        <div className="space-y-0">
          {SEGMENT_FIELDS[segment].map((f) => {
            const raw = segmentFields[f.key];
            const value = f.type === "number" && typeof raw === "number" ? raw.toLocaleString("en-IN") : (raw as string | undefined);
            return <SummaryRow key={f.key} label={t(lang, f.labelKey)} value={value} />;
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Documents</p>
        <div className="flex flex-wrap gap-2">
          {evidence.map((e) => (
            <span
              key={e.id}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                e.qualityStatus === "PASSED"
                  ? "bg-sprout-100 text-sprout-700 dark:bg-sprout-900/40 dark:text-sprout-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              )}
            >
              {e.type.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/40">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900 dark:text-white">
          <ShieldCheck className="h-4 w-4 text-sprout-600" /> {t(lang, "consentTitle")}
        </p>
        <ConsentCheckbox
          checked={consent.dataUsage}
          onChange={(v) => setConsent((c) => ({ ...c, dataUsage: v }))}
          label={t(lang, "consentDataUsage")}
        />
        <ConsentCheckbox
          checked={consent.bureauPull}
          onChange={(v) => setConsent((c) => ({ ...c, bureauPull: v }))}
          label={t(lang, "consentBureauPull")}
        />
        <ConsentCheckbox
          checked={consent.media}
          onChange={(v) => setConsent((c) => ({ ...c, media: v }))}
          label={t(lang, "consentMediaCapture")}
        />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-50 py-2 dark:border-ink-800/60">
      <span className="text-sm text-ink-500 dark:text-ink-400">{label}</span>
      <span className="text-sm font-semibold text-ink-900 dark:text-white">{value || "—"}</span>
    </div>
  );
}

function ConsentCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-2 border-ink-300 text-sprout-600 focus:ring-sprout-400"
      />
      <span className="text-xs text-ink-600 dark:text-ink-300">{label}</span>
    </label>
  );
}
