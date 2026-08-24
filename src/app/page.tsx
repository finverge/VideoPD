"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Phone, ShieldCheck } from "lucide-react";
import { LanguageSelector } from "@/components/LanguageSelector";
import { SegmentCard } from "@/components/SegmentCard";
import { BrandHeader } from "@/components/BrandHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { t } from "@/lib/i18n";
import type { LangCode, SegmentCode } from "@/types";

type OnboardStep = "language" | "segment" | "mobile" | "otp";

export default function LandingPage() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardStep>("language");
  const [lang, setLang] = useState<LangCode>("en");
  const [segment, setSegment] = useState<SegmentCode | null>(null);
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [borrowerId, setBorrowerId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  async function sendOtp() {
    setError(null);
    if (!/^\d{10}$/.test(mobile)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", mobile, language: lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBorrowerId(data.borrowerId);
      setDevCode(data.devCode ?? null);
      setStep("otp");
      setTimeout(() => otpRef.current?.focus(), 300);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", mobile, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const appRes = await fetch("/api/application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId: data.borrowerId, segment }),
      });
      const appData = await appRes.json();
      if (!appRes.ok) throw new Error(appData.error);

      localStorage.setItem("finverge_borrower_id", data.borrowerId);
      localStorage.setItem("finverge_lang", lang);
      router.push(`/apply/${appData.application.id}?lang=${lang}`);
    } catch (e: any) {
      setError(e.message ?? "Incorrect code.");
    } finally {
      setLoading(false);
    }
  }

  const segments: { code: SegmentCode; titleKey: string; subKey: string }[] = [
    { code: "FARMER", titleKey: "segmentFarmer", subKey: "segmentFarmerSub" },
    { code: "VOCATIONAL_STUDENT", titleKey: "segmentStudent", subKey: "segmentStudentSub" },
    { code: "BUSINESS_OWNER", titleKey: "segmentBusiness", subKey: "segmentBusinessSub" },
  ];

  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-10 sm:py-16">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-start justify-between gap-3">
          <BrandHeader />
          <ThemeToggle />
        </div>
        <div className="mt-3 hidden items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1.5 text-xs font-semibold text-ink-500 dark:bg-ink-800 dark:text-ink-300 sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-sprout-500" />
          {t(lang, "financialInclusion")}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            {step === "language" && (
              <motion.section
                key="language"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Eyebrow>{t(lang, "tagline")}</Eyebrow>
                <h1 className="mb-1.5 text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-4xl">
                  {t(lang, "chooseLanguage")}
                </h1>
                <p className="mb-6 text-ink-500 dark:text-ink-400">{t(lang, "chooseLanguageSub")}</p>
                <LanguageSelector value={lang} onChange={setLang} />
                <Button className="mt-8 w-full" size="lg" onClick={() => setStep("segment")} icon={<ArrowRight className="h-4 w-4" />}>
                  {t(lang, "continue")}
                </Button>
              </motion.section>
            )}

            {step === "segment" && (
              <motion.section
                key="segment"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Eyebrow>{t(lang, "tagline")}</Eyebrow>
                <h1 className="mb-1.5 text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-4xl">
                  {t(lang, "whoAreYou")}
                </h1>
                <p className="mb-6 text-ink-500 dark:text-ink-400">{t(lang, "whoAreYouSub")}</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {segments.map((s, i) => (
                    <SegmentCard
                      key={s.code}
                      code={s.code}
                      title={t(lang, s.titleKey)}
                      subtitle={t(lang, s.subKey)}
                      active={segment === s.code}
                      onClick={() => setSegment(s.code)}
                      index={i}
                    />
                  ))}
                </div>
                <div className="mt-8 flex gap-3">
                  <Button variant="ghost" onClick={() => setStep("language")}>
                    {t(lang, "back")}
                  </Button>
                  <Button
                    className="flex-1"
                    size="lg"
                    disabled={!segment}
                    onClick={() => setStep("mobile")}
                    icon={<ArrowRight className="h-4 w-4" />}
                  >
                    {t(lang, "continue")}
                  </Button>
                </div>
              </motion.section>
            )}

            {step === "mobile" && (
              <motion.section
                key="mobile"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Card>
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-600 dark:bg-sprout-900/40 dark:text-sprout-400">
                    <Phone className="h-6 w-6" />
                  </div>
                  <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-ink-900 dark:text-white">
                    {t(lang, "mobileLabel")}
                  </h1>
                  <p className="mb-5 text-sm text-ink-500 dark:text-ink-400">{t(lang, "devOtpHint")}</p>
                  <Input
                    id="mobile"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder={t(lang, "mobilePlaceholder")}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                    error={error ?? undefined}
                  />
                  <div className="mt-6 flex gap-3">
                    <Button variant="ghost" onClick={() => setStep("segment")}>
                      {t(lang, "back")}
                    </Button>
                    <Button className="flex-1" size="lg" loading={loading} onClick={sendOtp}>
                      {t(lang, "sendOtp")}
                    </Button>
                  </div>
                </Card>
              </motion.section>
            )}

            {step === "otp" && (
              <motion.section
                key="otp"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Card>
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-600 dark:bg-sprout-900/40 dark:text-sprout-400">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-ink-900 dark:text-white">
                    {t(lang, "otpLabel")}
                  </h1>
                  <p className="mb-5 text-sm text-ink-500 dark:text-ink-400">
                    {t(lang, "otpSentTo")} <span className="font-semibold text-ink-700 dark:text-ink-200">{mobile}</span>
                  </p>
                  {devCode && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                      {t(lang, "devOtpHint")}: <span className="font-mono text-sm font-bold">{devCode}</span>
                    </div>
                  )}
                  <Input
                    ref={otpRef}
                    id="otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="••••••"
                    className="text-center text-2xl font-bold tracking-[0.5em]"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    error={error ?? undefined}
                  />
                  <div className="mt-6 flex gap-3">
                    <Button variant="ghost" onClick={() => setStep("mobile")}>
                      {t(lang, "back")}
                    </Button>
                    <Button className="flex-1" size="lg" loading={loading} disabled={otp.length !== 6} onClick={verifyOtp}>
                      {t(lang, "verifyOtp")}
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={sendOtp}
                    className="mt-4 w-full text-center text-xs font-semibold text-ink-400 hover:text-sprout-600"
                  >
                    {t(lang, "resendOtp")}
                  </button>
                </Card>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>

      <a href="/staff" className="mt-10 self-center text-[11px] font-medium text-ink-300 hover:text-ink-500 dark:text-ink-600 dark:hover:text-ink-400">
        Staff sign-in
      </a>
    </main>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-sprout-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sprout-700 dark:bg-sprout-950/40 dark:text-sprout-400">
      {children}
    </div>
  );
}
