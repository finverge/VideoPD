"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ImageUp, Landmark, Loader2, LogOut, Palette, Save } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";

interface TenantConfigData {
  displayName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  neutralColor: string;
  defaultTheme: string;
  updatedBy: string | null;
  updatedAt: string;
}

// DLP/LOS integration Phase 5 — real tenant-level logo/branding config,
// mirroring the pattern already built for Fraud360's own branding_service
// (display_name/logo_url/primary_color/accent_color/neutral_color/
// default_theme — see D:\SourceCode\Fraud360\services\branding_service).
// Approver-only, same auth posture as every other staff config page in
// this app. Honest scoping note (also in the schema/layout doc comments):
// the 3 colors are real, stored, and delivered as --brand-* CSS custom
// properties, but only drive a couple of surfaces designed to read them
// (BrandHeader's fallback wordmark, this page's own header) — not a full
// re-theme of every Tailwind utility class in the app.
export default function TenantBrandingPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [data, setData] = useState<TenantConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/staff/tenant-config");
    const json = await res.json();
    setData(json.config);
    setLoading(false);
  }, []);

  useEffect(() => {
    const s = getStoredStaff();
    if (!s) { router.replace("/staff"); return; }
    setStaff(s);
  }, [router]);

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    if (file) setLogoPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    if (!data || !staff) return;
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const form = new FormData();
      form.set("staffName", staff.name);
      form.set("staffRole", staff.role);
      form.set("displayName", data.displayName);
      form.set("shortName", data.shortName);
      form.set("primaryColor", data.primaryColor);
      form.set("accentColor", data.accentColor);
      form.set("neutralColor", data.neutralColor);
      form.set("defaultTheme", data.defaultTheme);
      if (logoFile) form.set("logo", logoFile);

      const res = await fetch("/api/staff/tenant-config", { method: "PUT", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json.config);
      setLogoFile(null);
      setLogoPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (!staff) return null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/staff/risk-parameters")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Landmark className="h-5 w-5 shrink-0 text-white" />
          <div>
            <p className="text-sm font-bold text-white">Tenant Branding</p>
            <p className="text-[11px] font-medium text-ink-300">Name, logo &amp; colors</p>
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
        <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          What the borrower and staff-facing screens call this lending partner, and the logo/colors shown alongside
          it. Changes apply immediately, everywhere the brand is shown — no engineering change or redeploy.
        </p>
      </div>

      {loading || !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>
      ) : (
        <>
          <Card>
            <div className="space-y-5">
              <Input
                label="Display name"
                hint="Shown in the page title, borrower-facing header, and staff portal chrome (e.g. “Lakshya Skill Finance”)."
                value={data.displayName}
                onChange={(e) => setData({ ...data, displayName: e.target.value })}
              />
              <Input
                label="Short name"
                hint="Used where space is tight — e.g. the brand initial shown when no logo image is available."
                value={data.shortName}
                onChange={(e) => setData({ ...data, shortName: e.target.value })}
              />

              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink-700 dark:text-ink-200">Logo</span>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900">
                    {logoPreview || data.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreview ?? data.logoUrl ?? ""} alt="" className="h-full w-full object-contain p-1" />
                    ) : (
                      <ImageUp className="h-6 w-6 text-ink-300 dark:text-ink-600" />
                    )}
                  </div>
                  <div>
                    <Button variant="secondary" onClick={() => fileInputRef.current?.click()} icon={<ImageUp className="h-4 w-4" />}>
                      {data.logoUrl || logoFile ? "Replace logo" : "Upload logo"}
                    </Button>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoChange} />
                    <p className="mt-1.5 text-xs text-ink-400">PNG, JPEG, WebP, or SVG — under 5MB. No logo uploaded yet falls back to a text wordmark.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ColorField label="Primary" hint="Buttons, accents" value={data.primaryColor} onChange={(v) => setData({ ...data, primaryColor: v })} />
                <ColorField label="Accent" hint="Headers, gradients" value={data.accentColor} onChange={(v) => setData({ ...data, accentColor: v })} />
                <ColorField label="Neutral" hint="Secondary elements" value={data.neutralColor} onChange={(v) => setData({ ...data, neutralColor: v })} />
              </div>

              <Select
                label="Default theme"
                hint="What a visitor with no stored preference sees first — they can still switch anytime."
                value={data.defaultTheme}
                onChange={(e) => setData({ ...data, defaultTheme: e.target.value })}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>

              {error && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
                </p>
              )}
            </div>
          </Card>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-ink-100 bg-white/80 px-6 py-4 shadow-soft backdrop-blur-sm dark:border-ink-800 dark:bg-ink-900/60">
            {data.updatedBy ? (
              <p className="text-xs text-ink-400">Last updated by {data.updatedBy} on {new Date(data.updatedAt).toLocaleString()}</p>
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
        </>
      )}
    </main>
  );
}

function ColorField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-ink-700 dark:text-ink-200">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border-2 border-ink-100 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full min-w-0 rounded-xl border-2 border-ink-100 bg-white px-3 text-sm text-ink-900 outline-none transition-all focus:border-sprout-400 focus:ring-4 focus:ring-sprout-100 dark:border-ink-700 dark:bg-ink-900 dark:text-white dark:focus:ring-sprout-900/40"
        />
      </div>
      <span className="mt-1 block text-xs text-ink-400">{hint}</span>
    </div>
  );
}
