"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Boxes, CheckCircle2, ChevronRight, Clock, Info, Landmark, Loader2, LogOut, Save, ScanFace } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";
import type { SegmentCode } from "@/types";

interface RiskParametersData {
  maxLoanToIncomeMultiple: number;
  assumedAnnualInterestRatePct: number;
  maxEmiToIncomeRatioPct: number;
  updatedBy: string | null;
  updatedAt: string;
}

const SEGMENTS: { value: SegmentCode; label: string }[] = [
  { value: "FARMER", label: "Farmer" },
  { value: "VOCATIONAL_STUDENT", label: "Vocational student" },
  { value: "BUSINESS_OWNER", label: "Business owner" },
];

// Honest, not invented: these two segments have genuinely different income
// shapes than the EMI-to-income check assumes (a stable monthly figure) —
// worth flagging to whoever's calibrating these, not a claim about what the
// right number is.
const SEGMENT_NOTES: Partial<Record<SegmentCode, string>> = {
  FARMER: "Farm income is typically seasonal/harvest-cycle, not a stable monthly figure — the EMI-to-income check below assumes monthly income and may not fit well here without Lakshya's own seasonal-income convention.",
  VOCATIONAL_STUDENT: "A vocational student applicant often has no current income at all (the loan is against future earning potential or a guarantor) — if monthly income is blank or zero, the EMI-affordability check is skipped entirely for that application rather than flagging on a meaningless ratio.",
};

// BR-43's "configurable against a lending partner's own credit parameters"
// — real, staff-editable numbers (src/lib/riskParameters.ts), seeded with
// generic industry-standard microfinance/NBFC defaults, not Lakshya's own
// calibrated risk appetite (BRD Section 12, an explicit external
// dependency). Segment-specific, not one global set, since farm/student/
// business income genuinely work differently (see SEGMENT_NOTES above) —
// each segment is independently editable, all three start from the same
// generic numbers because there's no rigorous basis yet to invent different
// starting values. This page is exactly the intended seam: Lakshya provides
// their real numbers during UAT or in production, an Approver enters them
// here per segment, and every subsequent application in that segment is
// scored against them — no engineering change, no redeploy.
interface FeatureSettingsData {
  deepfakeCheckEnabled: boolean;
  lipSyncCheckEnabled: boolean;
  assetDetectionCheckEnabled: boolean;
  // How many days a draft application still blocks/offers a resume prompt
  // on the landing page's duplicate-application check
  // (api/application/duplicate-check) before a fresh one can start
  // normally — global platform behavior, not a per-segment underwriting
  // number, same reasoning as the two toggles above.
  applicationExpiryDays: number;
  updatedBy: string | null;
  updatedAt: string;
}

export default function RiskParametersPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [segment, setSegment] = useState<SegmentCode>("FARMER");
  const [data, setData] = useState<RiskParametersData | null>(null);
  const [defaults, setDefaults] = useState<Omit<RiskParametersData, "updatedBy" | "updatedAt"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Feature-settings — separate model/endpoint (not segment-scoped, see
  // src/lib/featureSettings.ts), loaded once. Requested live: the
  // deepfake check specifically needed to be admin-toggleable given how
  // research-grade it is (see voice-service/README.md). The asset-
  // detection on/off switch lives here too (assetDetectionCheckEnabled),
  // but its categories/weights/manual-item configuration moved to its own
  // maker-checker page — see the pointer card below.
  const [featureSettings, setFeatureSettings] = useState<FeatureSettingsData | null>(null);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [featureSaved, setFeatureSaved] = useState(false);
  const [featureError, setFeatureError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSaved(false);
    const res = await fetch(`/api/staff/risk-parameters?segment=${segment}`);
    const json = await res.json();
    setData(json.riskParameters);
    setDefaults(json.defaults);
    setLoading(false);
  }, [segment]);

  useEffect(() => {
    const s = getStoredStaff();
    if (!s) { router.replace("/staff"); return; }
    setStaff(s);
  }, [router]);

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

  useEffect(() => {
    if (!staff) return;
    fetch("/api/staff/feature-settings").then((r) => r.json()).then((json) => setFeatureSettings(json.settings));
  }, [staff]);

  // Local editable copy of the expiry-days field — typing shouldn't PUT on
  // every keystroke the way the toggle buttons save immediately on click;
  // this saves only when the Save button next to it is clicked, same
  // "type then explicitly save" pattern as the risk-parameters form above.
  // Synced from featureSettings once it loads (and again if a toggle save
  // returns a fresh row) rather than read directly from it, so this field
  // doesn't blank out while featureSettings itself is null on first load.
  const [expiryDraft, setExpiryDraft] = useState<number | "">("");
  useEffect(() => {
    if (featureSettings) setExpiryDraft(featureSettings.applicationExpiryDays);
  }, [featureSettings]);

  // Shared by the toggle buttons and the expiry-days field below — the PUT
  // endpoint saves the whole FeatureSettings row at once, so every caller
  // sends its own changed field(s) plus whatever's already in state for
  // the rest, rather than separate save paths drifting apart.
  async function saveFeatureSettings(patch: Partial<Pick<FeatureSettingsData, "deepfakeCheckEnabled" | "lipSyncCheckEnabled" | "assetDetectionCheckEnabled" | "applicationExpiryDays">>) {
    if (!featureSettings || !staff) return;
    setFeatureError(null);
    setFeatureSaving(true);
    setFeatureSaved(false);
    try {
      const res = await fetch("/api/staff/feature-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffName: staff.name, staffRole: staff.role,
          deepfakeCheckEnabled: featureSettings.deepfakeCheckEnabled,
          lipSyncCheckEnabled: featureSettings.lipSyncCheckEnabled,
          assetDetectionCheckEnabled: featureSettings.assetDetectionCheckEnabled,
          applicationExpiryDays: featureSettings.applicationExpiryDays,
          ...patch,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setFeatureSettings(json.settings);
      setFeatureSaved(true);
      setTimeout(() => setFeatureSaved(false), 2000);
    } catch (e: any) {
      setFeatureError(e.message ?? "Something went wrong.");
    } finally {
      setFeatureSaving(false);
    }
  }
  function handleFeatureToggle(field: "deepfakeCheckEnabled" | "lipSyncCheckEnabled" | "assetDetectionCheckEnabled", enabled: boolean) {
    saveFeatureSettings({ [field]: enabled });
  }

  async function handleSave() {
    if (!data || !staff) return;
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/staff/risk-parameters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment,
          staffName: staff.name,
          staffRole: staff.role,
          maxLoanToIncomeMultiple: data.maxLoanToIncomeMultiple,
          assumedAnnualInterestRatePct: data.assumedAnnualInterestRatePct,
          maxEmiToIncomeRatioPct: data.maxEmiToIncomeRatioPct,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json.riskParameters);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (!staff) return null;
  const isDefault = defaults && data && (
    data.maxLoanToIncomeMultiple === defaults.maxLoanToIncomeMultiple &&
    data.assumedAnnualInterestRatePct === defaults.assumedAnnualInterestRatePct &&
    data.maxEmiToIncomeRatioPct === defaults.maxEmiToIncomeRatioPct
  );

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/staff/queue")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Landmark className="h-5 w-5 shrink-0 text-white" />
          <div>
            <p className="text-sm font-bold text-white">Risk Parameters</p>
            <p className="text-[11px] font-medium text-ink-300">Lakshya Skill Finance</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-200">
          <span className="font-semibold text-white">{staff.name}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-bold uppercase tracking-wide">{staff.role}</span>
          <ThemeToggle className="h-8 w-8 rounded-full border-white/20 bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white dark:border-white/20 dark:bg-transparent dark:text-white dark:hover:bg-white/10 dark:hover:text-white" />
          <button onClick={() => { clearStoredStaff(); router.push("/staff"); }} className="flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-white/10">
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </header>

      <div className="mb-5 flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-500 dark:bg-ink-800/40 dark:text-ink-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          These feed the automated risk flags every application gets on submission (loan-to-income and EMI-affordability
          checks), <strong>set independently per segment</strong> since farm/student/business income work differently.
          What's here now are <strong>generic, industry-standard microfinance underwriting defaults</strong> — not
          Lakshya's own calibrated risk appetite. Update them per segment once Lakshya provides their real baseline
          credit questionnaire and risk parameters (BRD Section 12) — no engineering change needed, just this form.
        </p>
      </div>

      <div className="mb-5 flex gap-1.5 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
        {SEGMENTS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSegment(s.value)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              segment === s.value ? "bg-white text-ink-900 shadow-soft dark:bg-ink-900 dark:text-white" : "text-ink-500 hover:text-ink-700 dark:text-ink-400"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {SEGMENT_NOTES[segment] && (
        <div className="mb-5 flex items-start gap-2 rounded-xl bg-sprout-50 p-3 text-xs text-sprout-700 dark:bg-sprout-950/20 dark:text-sprout-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{SEGMENT_NOTES[segment]}</p>
        </div>
      )}

      {isDefault && (
        <div className="mb-5 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Still using generic defaults for this segment — never calibrated by Lakshya.
        </div>
      )}

      {loading || !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>
      ) : (
        <Card>
          <div className="space-y-5">
            <Input
              label="Max loan-to-income multiple"
              hint="Flags a requested amount above this multiple of stated monthly income (e.g. 36 = ~3 years of income)."
              type="number"
              min={1}
              step={0.5}
              value={data.maxLoanToIncomeMultiple}
              onChange={(e) => setData({ ...data, maxLoanToIncomeMultiple: Number(e.target.value) })}
            />
            <Input
              label="Assumed annual interest rate (%)"
              hint="Used only to estimate a monthly EMI for the affordability check below — not a real quoted rate (none is captured elsewhere in the application data)."
              type="number"
              min={0.1}
              step={0.5}
              value={data.assumedAnnualInterestRatePct}
              onChange={(e) => setData({ ...data, assumedAnnualInterestRatePct: Number(e.target.value) })}
            />
            <Input
              label="Max EMI-to-income ratio (%)"
              hint="FOIR-style affordability cap. Flags if the estimated EMI exceeds this share of stated monthly income."
              type="number"
              min={1}
              max={100}
              step={1}
              value={data.maxEmiToIncomeRatioPct}
              onChange={(e) => setData({ ...data, maxEmiToIncomeRatioPct: Number(e.target.value) })}
            />

            {error && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Feature settings — global, not segment-scoped, so a separate card
          rather than mixed into the per-segment form above. */}
      <Card className="mt-5">
        <div className="mb-1 flex items-center gap-2">
          <ScanFace className="h-4 w-4 text-ink-500 dark:text-ink-400" />
          <p className="text-sm font-bold text-ink-900 dark:text-white">Advanced fraud detection</p>
        </div>
        <p className="mb-4 text-xs text-ink-400">
          Face-manipulation and lip-sync analysis on the guided-flow recordings, surfaced to the underwriter as
          advisory flags alongside the other risk signals — never an auto-decision. Each check can be switched
          off independently, any time, right from this page.
        </p>

        {!featureSettings ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-sprout-500" /></div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                <div>
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Deepfake check</p>
                  <p className="text-xs text-ink-400">Scans the recorded video frame by frame for signs of face-swapping or synthetic manipulation. Runs automatically when an underwriter clicks &ldquo;Run voice check&rdquo; on a case.</p>
                </div>
                <button
                  onClick={() => handleFeatureToggle("deepfakeCheckEnabled", !featureSettings.deepfakeCheckEnabled)}
                  disabled={staff.role !== "APPROVER" || featureSaving}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
                    featureSettings.deepfakeCheckEnabled ? "bg-sprout-500" : "bg-ink-200 dark:bg-ink-700"
                  )}
                  aria-label="Toggle deepfake check"
                >
                  <span
                    className={cn(
                      "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      featureSettings.deepfakeCheckEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                <div>
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Lip-sync check</p>
                  <p className="text-xs text-ink-400">Checks whether lip movement matches the audio — a second, independent signal against manipulated video. Takes a little longer to run than the deepfake check.</p>
                </div>
                <button
                  onClick={() => handleFeatureToggle("lipSyncCheckEnabled", !featureSettings.lipSyncCheckEnabled)}
                  disabled={staff.role !== "APPROVER" || featureSaving}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
                    featureSettings.lipSyncCheckEnabled ? "bg-sprout-500" : "bg-ink-200 dark:bg-ink-700"
                  )}
                  aria-label="Toggle lip-sync check"
                >
                  <span
                    className={cn(
                      "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      featureSettings.lipSyncCheckEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            </div>
            {staff.role !== "APPROVER" && (
              <p className="mt-2 text-xs text-ink-400">Approver only.</p>
            )}
            {featureError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-500">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {featureError}
              </p>
            )}
            {featureSaved && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-sprout-600 dark:text-sprout-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Saved.
              </p>
            )}
            {featureSettings.updatedBy && (
              <p className="mt-2 text-xs text-ink-400">Last updated by {featureSettings.updatedBy} on {new Date(featureSettings.updatedAt).toLocaleString()}</p>
            )}
          </>
        )}
      </Card>

      {/* Asset checklist — on/off switch only. Its categories, score
          weights, manual reference items, and custom-category requests all
          moved to /staff/asset-scorecard, which runs those through a
          maker-checker approval flow (a different Approver must sign off
          than whoever proposed the change) rather than a direct save —
          requested live, so this page stays focused on straightforward
          single-person-editable settings. */}
      <Card className="mt-5">
        <div className="mb-1 flex items-center gap-2">
          <Boxes className="h-4 w-4 text-ink-500 dark:text-ink-400" />
          <p className="text-sm font-bold text-ink-900 dark:text-white">Work-premises asset checklist</p>
        </div>
        <p className="mb-4 text-xs text-ink-400">
          Scans the business-verification recording with a general-purpose object detector and lists what it saw
          as a starting checklist for the underwriter to verify visually — presence/count only, not a valuation,
          condition assessment, or score by itself.
        </p>

        {!featureSettings ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-sprout-500" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl border border-ink-100 p-3 dark:border-ink-800">
              <div>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Asset detection checklist</p>
                <p className="text-xs text-ink-400">Runs automatically when an underwriter clicks &ldquo;Run voice check&rdquo; on a case, alongside the other checks.</p>
              </div>
              <button
                onClick={() => handleFeatureToggle("assetDetectionCheckEnabled", !featureSettings.assetDetectionCheckEnabled)}
                disabled={staff.role !== "APPROVER" || featureSaving}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
                  featureSettings.assetDetectionCheckEnabled ? "bg-sprout-500" : "bg-ink-200 dark:bg-ink-700"
                )}
                aria-label="Toggle asset detection checklist"
              >
                <span
                  className={cn(
                    "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    featureSettings.assetDetectionCheckEnabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
            {staff.role !== "APPROVER" && (
              <p className="mt-2 text-xs text-ink-400">Approver only.</p>
            )}

            <button
              onClick={() => router.push("/staff/asset-scorecard")}
              className="mt-4 flex w-full items-center justify-between rounded-xl border border-dashed border-ink-200 p-3 text-left transition-colors hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
            >
              <div>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Configure categories, weights &amp; scoring →</p>
                <p className="text-xs text-ink-400">Per-segment checklist categories, point weights, manual reference items, and custom-category requests — all maker-checker reviewed on the Asset Scorecard page.</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
            </button>
          </>
        )}
      </Card>

      {/* Duplicate-application handling — global, separate card from the
          fraud-detection toggles above since it's a different concern
          entirely (how long a stalled draft still counts as "in
          progress"), stored in the same FeatureSettings row purely as an
          implementation convenience. Feeds the landing page's
          duplicate-application check (api/application/duplicate-check) —
          within this many days of a draft's last activity, a borrower
          starting over with the same mobile number gets asked whether to
          resume it (same segment) or is warned before starting a second
          one (different segment); past it, a fresh application just
          starts normally and the stale draft is left alone, not deleted. */}
      <Card className="mt-5">
        <div className="mb-1 flex items-center gap-2">
          <Clock className="h-4 w-4 text-ink-500 dark:text-ink-400" />
          <p className="text-sm font-bold text-ink-900 dark:text-white">Duplicate application handling</p>
        </div>
        <p className="mb-4 text-xs text-ink-400">
          How long an unfinished application still blocks (or offers to resume) a fresh start with the same
          mobile number, before it's treated as abandoned.
        </p>
        {!featureSettings ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-sprout-500" /></div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Application expiry period (in days)"
              hint="Default 30 — a draft older than this no longer blocks or offers to resume."
              type="number"
              min={1}
              step={1}
              value={expiryDraft}
              onChange={(e) => setExpiryDraft(e.target.value === "" ? "" : Number(e.target.value))}
              disabled={staff.role !== "APPROVER"}
              className="w-48"
            />
            <Button
              onClick={() => saveFeatureSettings({ applicationExpiryDays: Number(expiryDraft) })}
              disabled={staff.role !== "APPROVER" || expiryDraft === "" || Number(expiryDraft) < 1}
              loading={featureSaving}
              icon={featureSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            >
              {staff.role !== "APPROVER" ? "Approver only" : featureSaved ? "Saved" : "Save"}
            </Button>
          </div>
        )}
      </Card>

      {!loading && data && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-ink-100 bg-white/80 px-6 py-4 shadow-soft backdrop-blur-sm dark:border-ink-800 dark:bg-ink-900/60">
          {data.updatedBy ? (
            <p className="text-xs text-ink-400">Risk parameters last updated by {data.updatedBy} on {new Date(data.updatedAt).toLocaleString()}</p>
          ) : <span />}
          <Button
            onClick={handleSave}
            disabled={staff.role !== "APPROVER"}
            loading={saving}
            icon={saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            className="ml-auto"
          >
            {staff.role !== "APPROVER" ? "Approver only" : saved ? "Saved" : "Save"}
          </Button>
        </div>
      )}
    </main>
  );
}
