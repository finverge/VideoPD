"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Camera, CheckCircle2, FileUp, Loader2, Mic, MicOff, ShieldCheck, Upload } from "lucide-react";
import { CameraCapture, type LivenessCaptureResult } from "@/components/CameraCapture";
import { LiveCallRoom } from "@/components/LiveCallRoom";
import { descriptorFromIdProofUrl, compareFaceDescriptors, isSamePerson } from "@/lib/faceMatch";
import { LakshyaLogo } from "@/components/BrandHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { t } from "@/lib/i18n";
import { type DbQuestion, questionPrompt } from "@/lib/videoPdQuestions";
import { useSpeech } from "@/lib/speech";
import { cn } from "@/lib/utils";
import type { LangCode, SegmentCode } from "@/types";

type Step = "loading" | "invalid" | "already-complete" | "welcome" | "liveness" | "qna" | "business" | "statement" | "complete";

// Persisted-resume steps only — "loading"/"invalid"/"already-complete" are
// client-only states, never written to VideoPdSession.currentStep. Order
// matters: the index *is* the persisted value.
const RESUMABLE_STEPS: Step[] = ["welcome", "liveness", "qna", "business", "statement", "complete"];

interface SessionData {
  id: string;
  status: string;
  currentStep: number;
  lead: {
    applicationId: string;
    application: { id: string; segment: SegmentCode; borrower: { language: LangCode; mobile: string } };
  };
}

export default function VideoPdSessionPage() {
  const params = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<SessionData | null>(null);
  const [questions, setQuestions] = useState<DbQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [showLiveCall, setShowLiveCall] = useState(false);

  // Advances the visible step *and* persists it, so a mid-session reload
  // resumes here instead of restarting at "welcome" (see docs/
  // videopd-future-work.md item 13 — the data was always safe, only the UI
  // position wasn't remembered). Fire-and-forget: a failed PATCH just means
  // a future reload resumes one step earlier, never data loss, since every
  // step's own data (answer/capture/statement) is already persisted
  // separately by that step's own save call before onDone ever fires.
  function advanceStep(next: Step) {
    setStep(next);
    const index = RESUMABLE_STEPS.indexOf(next);
    if (index >= 0) {
      fetch(`/api/videopd/${params.token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStep: index }),
      }).catch(() => {});
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/videopd/${params.token}`);
      if (!res.ok) { setStep("invalid"); return; }
      const data = await res.json();
      setSession(data.session);
      setQuestions(data.questions ?? []);
      if (data.session.status === "COMPLETE") setStep("already-complete");
      else setStep(RESUMABLE_STEPS[data.session.currentStep] ?? "welcome");
    })();
  }, [params.token]);

  if (step === "loading") {
    return <Centered><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></Centered>;
  }
  if (step === "invalid" || !session) {
    return <Centered><StatusCard icon={<ShieldCheck className="h-8 w-8 text-red-400" />} text={t("en", "vpdInvalidLink")} /></Centered>;
  }

  const lang = session.lead.application.borrower.language ?? "en";
  const applicationId = session.lead.application.id;

  if (step === "already-complete") {
    return <Centered><StatusCard icon={<CheckCircle2 className="h-8 w-8 text-sprout-500" />} text={t(lang, "vpdAlreadyComplete")} /></Centered>;
  }

  return (
    // max-w-lg fits the rest of this page's narrow, single-column wizard
    // content (forms, camera dialogs) — but LiveCallRoom's own video grid
    // (grid-cols-2 sm:grid-cols-3, same component the underwriter's much
    // wider max-w-5xl case page uses) was capped to that same ~512px width
    // whenever the borrower opened the live call, rendering the video tiles
    // visibly small with plenty of real, unused screen width beyond it —
    // reported live, confirmed by the underwriter's side of the identical
    // component looking correct at a wider max-w-5xl. Widens only while the
    // live call is actually open; every other step keeps the narrower width.
    <main className={`mx-auto flex min-h-screen flex-col px-5 py-8 transition-[max-width] ${showLiveCall ? "max-w-3xl" : "max-w-lg"}`}>
      {/* Borrower's other portal pages (landing, apply wizard) both offer a
          manual theme toggle — this page was the one gap. Logo stays
          centered like before; toggle sits in the corner via an invisible
          spacer matching its width, so the logo doesn't visually drift off
          the true page center. */}
      <div className="mb-8 flex items-center justify-between">
        <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        <LakshyaLogo size="sm" />
        <ThemeToggle />
      </div>

      <AnimatePresence mode="wait">
        {step === "welcome" && (
          <StepShell key="welcome">
            <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-sprout-500" />
            <h1 className="mb-2 text-center text-2xl font-extrabold tracking-tight text-ink-900 dark:text-white">{t(lang, "vpdWelcomeTitle")}</h1>
            <p className="mb-6 text-center text-sm text-ink-500 dark:text-ink-400">{t(lang, "vpdWelcomeBody")}</p>
            <Button className="w-full" onClick={() => advanceStep("liveness")}>{t(lang, "vpdStart")}</Button>

            {/* Real, self-hosted live video call with the loan officer —
                separate from the recorded steps below; doesn't touch
                currentStep at all, just an optional live conversation. */}
            <div className="mt-4 border-t border-ink-100 pt-4 dark:border-ink-800">
              {showLiveCall ? (
                <LiveCallRoom roomId={params.token} displayName="Borrower" analyzeLiveness transcribe lang={lang} />
              ) : (
                <button
                  onClick={() => setShowLiveCall(true)}
                  className="w-full text-center text-xs font-semibold text-sprout-600 hover:underline dark:text-sprout-400"
                >
                  Or join a live video call with your loan officer
                </button>
              )}
            </div>
          </StepShell>
        )}

        {step === "liveness" && (
          <StepShell key="liveness">
            <CaptureStep
              lang={lang}
              titleKey="vpdStepLiveness"
              bodyKey="vpdStepLivenessBody"
              mode="video"
              facingMode="user"
              applicationId={applicationId}
              token={params.token}
              evidenceType="VIDEOPD_LIVENESS"
              analyzeLiveness
              onDone={() => advanceStep(questions.length > 0 ? "qna" : "business")}
            />
          </StepShell>
        )}

        {step === "qna" && (
          <StepShell key={`qna-${qIndex}`}>
            <QnaStep
              lang={lang}
              token={params.token}
              question={questions[qIndex]}
              index={qIndex}
              total={questions.length}
              onNext={() => {
                if (qIndex + 1 < questions.length) setQIndex((i) => i + 1);
                else advanceStep("business");
              }}
            />
          </StepShell>
        )}

        {step === "business" && (
          <StepShell key="business">
            <CaptureStep
              lang={lang}
              titleKey="vpdStepBusiness"
              bodyKey="vpdStepBusinessBody"
              mode="video"
              facingMode="environment"
              applicationId={applicationId}
              token={params.token}
              evidenceType="VIDEOPD_BUSINESS_VERIFICATION"
              onDone={() => advanceStep("statement")}
            />
          </StepShell>
        )}

        {step === "statement" && (
          <StepShell key="statement">
            <StatementStep lang={lang} token={params.token} onDone={() => advanceStep("complete")} />
          </StepShell>
        )}

        {step === "complete" && (
          <StepShell key="complete">
            <CompleteStep lang={lang} token={params.token} />
          </StepShell>
        )}
      </AnimatePresence>
    </main>
  );
}

function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
      <Card>{children}</Card>
    </motion.div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-5">{children}</div>;
}

function StatusCard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      {icon}
      <p className="text-sm font-medium text-ink-600 dark:text-ink-300">{text}</p>
    </div>
  );
}

function CaptureStep({
  lang, titleKey, bodyKey, mode, facingMode, applicationId, token, evidenceType, analyzeLiveness, onDone,
}: {
  lang: LangCode; titleKey: string; bodyKey: string; mode: "photo" | "video"; facingMode: "user" | "environment";
  applicationId: string; token: string; evidenceType: string; analyzeLiveness?: boolean; onDone: () => void;
}) {
  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const livenessResultRef = useRef<LivenessCaptureResult | null>(null);

  async function handleCapture(file: File) {
    setShowCamera(false);
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("applicationId", applicationId);
    form.append("type", evidenceType);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    setUploading(false);
    setDone(true);

    // Fire-and-forget, same as step-resume's PATCH above: the borrower has
    // already moved on by the time this resolves, and a failure here just
    // means the evidence's authenticityStatus stays PENDING instead of
    // getting a real verdict — never something that blocks or reopens
    // this step for the borrower.
    const livenessResult = livenessResultRef.current;
    livenessResultRef.current = null;
    if (analyzeLiveness && livenessResult && res.ok) {
      res.json().then((data) => {
        if (data?.evidence?.id) return submitLivenessResult(token, data.evidence.id, livenessResult);
      }).catch(() => {});
    }
  }

  return (
    <>
      <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-sprout-500" />
      <h2 className="mb-2 text-center text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">{t(lang, titleKey)}</h2>
      <p className="mb-6 text-center text-sm text-ink-500 dark:text-ink-400">{t(lang, bodyKey)}</p>

      {done ? (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-sprout-50 px-4 py-3 text-sm font-semibold text-sprout-700 dark:bg-sprout-950/30 dark:text-sprout-400">
          <CheckCircle2 className="h-4 w-4" /> Captured
        </div>
      ) : uploading ? (
        <div className="mb-4 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
        </div>
      ) : (
        <button
          onClick={() => setShowCamera(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sprout-300 bg-sprout-50/50 px-4 py-6 text-sm font-semibold text-sprout-700 hover:bg-sprout-50 dark:border-sprout-800 dark:bg-sprout-950/10 dark:text-sprout-400"
        >
          <Camera className="h-5 w-5" /> {t(lang, "vpdRecordVideo")}
        </button>
      )}

      <Button className="w-full" disabled={!done} onClick={onDone}>{t(lang, "vpdContinue")}</Button>

      {showCamera && (
        <CameraCapture
          mode={mode}
          facingMode={facingMode}
          analyzeLiveness={analyzeLiveness}
          onLivenessResult={(result) => { livenessResultRef.current = result; }}
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </>
  );
}

// Runs the on-device face-match (Step 1's liveness capture vs. the
// application's own ID proof photo) and reports both that and the
// blink/attention signals to the server for the advisory authenticityStatus
// verdict (see api/videopd/[token]/liveness-result). Fire-and-forget from
// CaptureStep's handleCapture — never awaited on the borrower's critical path.
async function submitLivenessResult(token: string, evidenceId: string, result: LivenessCaptureResult) {
  let faceMatch: { attempted: boolean; distance: number | null; matched: boolean | null; skippedReason?: string };

  if (!result.descriptor) {
    faceMatch = { attempted: false, distance: null, matched: null, skippedReason: "No confident face detected during the liveness recording — face-match skipped." };
  } else {
    const idDescriptor = await descriptorFromIdProofUrl(`/api/videopd/${token}/id-proof`);
    if (!idDescriptor) {
      // Two genuinely different reasons collapse to the same skip, both
      // honest: no ID proof is on file at all, or one is but no confident
      // face was found in it (image or PDF, after rendering) — worded to
      // not read as "there's no ID proof" when there visibly is one, which
      // is exactly what caused real confusion (reported live) when the ID
      // proof was a PDF this same check couldn't yet render, before
      // descriptorFromIdProofUrl added PDF support.
      faceMatch = { attempted: false, distance: null, matched: null, skippedReason: "Could not find a clear, matchable face in the uploaded ID proof — face-match skipped." };
    } else {
      const distance = compareFaceDescriptors(idDescriptor, result.descriptor);
      faceMatch = { attempted: true, distance, matched: isSamePerson(distance) };
    }
  }

  await fetch(`/api/videopd/${token}/liveness-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      evidenceId,
      blinkCount: result.blinkCount,
      framesAnalyzed: result.framesAnalyzed,
      noFacePct: result.noFacePct,
      lookedAwayPct: result.lookedAwayPct,
      offCameraGlances: result.offCameraGlances,
      recordingSeconds: result.recordingSeconds,
      faceMatch,
    }),
  }).catch(() => {});
}

function QnaStep({
  lang, token, question, index, total, onNext,
}: {
  lang: LangCode; token: string; question: DbQuestion; index: number; total: number; onNext: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const { listening, supported, interimTranscript, error: micError, startListening, stopListening } = useSpeech({
    lang,
    onResult: (text, isFinal) => { if (isFinal) setAnswer((prev) => (prev ? `${prev} ${text}` : text)); },
  });

  async function submit() {
    if (!answer.trim()) return;
    setSaving(true);
    await fetch(`/api/videopd/${token}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionKey: question.key, questionText: questionPrompt(question, lang), answerText: answer.trim() }),
    });
    setSaving(false);
    setAnswer("");
    onNext();
  }

  return (
    <>
      <p className="mb-1 text-center text-xs font-bold uppercase tracking-wide text-ink-400">{t(lang, "vpdStepQnA")} · {index + 1}/{total}</p>
      <h2 className="mb-6 text-center text-lg font-bold text-ink-900 dark:text-white">{questionPrompt(question, lang)}</h2>

      {/* Was silently swallowed before — useSpeech tracks a real error state
          (mic denied, no mic found, etc.) but this component never read it,
          so a borrower whose permission prompt they dismissed saw the mic
          button do nothing with zero explanation. ChatPanel already renders
          this correctly; mirrored here. */}
      {supported && micError && (
        <p className="mb-2 flex items-center justify-center gap-1.5 text-center text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {micError}
        </p>
      )}
      <div className="relative mb-4">
        <Textarea
          value={answer + (interimTranscript ? ` ${interimTranscript}` : "")}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={t(lang, "vpdAnswerPlaceholder")}
          rows={4}
        />
        {supported && (
          <button
            type="button"
            onClick={() => (listening ? stopListening() : startListening())}
            className={cn(
              "absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              listening ? "bg-red-500 text-white" : "bg-ink-100 text-ink-500 hover:bg-sprout-100 hover:text-sprout-700 dark:bg-ink-800 dark:text-ink-300"
            )}
            aria-label="Toggle microphone"
          >
            {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <Button className="w-full" loading={saving} disabled={!answer.trim()} onClick={submit}>{t(lang, "vpdContinue")}</Button>
    </>
  );
}

function StatementStep({ lang, token, onDone }: { lang: LangCode; token: string; onDone: () => void }) {
  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  async function uploadFile(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    await fetch(`/api/videopd/${token}/bank-statement`, { method: "POST", body: form });
    setUploading(false);
    setDone(true);
  }

  return (
    <>
      <FileUp className="mx-auto mb-4 h-10 w-10 text-sprout-500" />
      <h2 className="mb-2 text-center text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">{t(lang, "vpdStepBankStatement")}</h2>
      <p className="mb-6 text-center text-sm text-ink-500 dark:text-ink-400">{t(lang, "vpdStepBankStatementBody")}</p>

      {done ? (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-sprout-50 px-4 py-3 text-sm font-semibold text-sprout-700 dark:bg-sprout-950/30 dark:text-sprout-400">
          <CheckCircle2 className="h-4 w-4" /> {t(lang, "vpdStatementProcessed")}
        </div>
      ) : uploading ? (
        <div className="mb-4 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> {t(lang, "vpdStatementUploaded")}
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowCamera(true)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-sprout-300 bg-sprout-50/50 px-4 py-5 text-xs font-semibold text-sprout-700 hover:bg-sprout-50 dark:border-sprout-800 dark:bg-sprout-950/10 dark:text-sprout-400"
          >
            <Camera className="h-5 w-5" /> {t(lang, "vpdUploadStatement")}
          </button>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50/50 px-4 py-5 text-xs font-semibold text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800/30 dark:text-ink-300">
            <Upload className="h-5 w-5" /> {t(lang, "vpdChooseFile")}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
            />
          </label>
        </div>
      )}

      {/* Stacked, not side-by-side — "I don't have one right now" is too long
          to sit in a half-width flex-1 column at mobile widths without
          wrapping to 3 lines and reading as broken next to the pill button. */}
      <div className="flex flex-col gap-2">
        <Button disabled={!done} onClick={onDone}>{t(lang, "vpdContinue")}</Button>
        {!done && (
          <Button variant="ghost" onClick={onDone}>{t(lang, "vpdSkipStatement")}</Button>
        )}
      </div>

      {showCamera && (
        <CameraCapture
          mode="photo"
          facingMode="environment"
          onCapture={(f) => { setShowCamera(false); uploadFile(f); }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </>
  );
}

function CompleteStep({ lang, token }: { lang: LangCode; token: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/videopd/${token}/complete`, { method: "POST" }).finally(() => setDone(true));
  }, [token]);

  if (!done) {
    return <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>;
  }

  return (
    <div className="text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sprout-400 to-sprout-600 text-white">
        <CheckCircle2 className="h-8 w-8" />
      </motion.div>
      <h2 className="mb-2 text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">{t(lang, "vpdCompleteTitle")}</h2>
      <p className="text-sm text-ink-500 dark:text-ink-400">{t(lang, "vpdCompleteBody")}</p>
    </div>
  );
}
