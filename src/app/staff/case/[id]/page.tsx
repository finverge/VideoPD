"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  Landmark,
  Loader2,
  LogOut,
  MapPin,
  MessageSquareWarning,
  ScanFace,
  ShieldCheck,
  UserCheck,
  Video,
  XCircle,
  Undo2,
  AlertTriangle,
  Mic,
  Users,
  Boxes,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { LiveCallRoom } from "@/components/LiveCallRoom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";
import { formatINR, cn } from "@/lib/utils";
import { SEGMENT_FIELDS } from "@/lib/formSchema";
import { draftUnderwriterRecommendation } from "@/lib/underwriterAgent";
import { Sparkles } from "lucide-react";
import { t } from "@/lib/i18n";
import type { InitialSummary, SegmentCode } from "@/types";

interface EvidenceRow {
  id: string;
  type: string;
  fileName: string;
  mimeType: string;
  geoLat: number | null;
  geoLng: number | null;
  qualityStatus: string;
  qualityNotes: string | null;
  authenticityStatus: string;
  authenticityNotes: string | null;
  livenessBlinkCount: number | null;
  livenessNoFacePct: number | null;
  livenessLookedAwayPct: number | null;
  livenessOffCameraGlances: number | null;
  faceMatchDistance: number | null;
  faceMatchResult: boolean | null;
}

interface ChatTurnRow {
  id: string;
  role: string;
  channel: string;
  language: string;
  text: string;
  createdAt: string;
}

interface VideoPdAnswerRow {
  questionKey: string;
  questionText: string;
  answerText: string;
  score: number;
  answerTextEn?: string | null;
  translationAvailable?: boolean;
}

interface BankStatementRow {
  id: string;
  fileName: string;
  mimeType: string;
  status: string;
  eligibilityFlag: string | null;
  eligibilityReasonsJson: string | null;
  metricsJson: string | null;
  authenticityStatus: string;
  authenticityReasonsJson: string | null;
}

interface CallTranscriptSegmentRow {
  id: string;
  speakerName: string;
  text: string;
  createdAt: string;
}

interface VideoPdSessionData {
  id: string;
  token: string;
  status: string;
  linkSentAt: string;
  completedAt: string | null;
  skillIntentScore: number | null;
  dossierJson: string | null;
  answers: VideoPdAnswerRow[];
  bankStatements: BankStatementRow[];
  callTranscript: CallTranscriptSegmentRow[];
}

interface CaseDetailData {
  id: string;
  status: string;
  riskFlagCount: number;
  riskSeverity: string;
  assignedUnderwriter: string | null;
  underwriterName: string | null;
  underwriterRecommendation: string | null;
  underwriterNotes: string | null;
  underwriterDecidedAt: string | null;
  approverName: string | null;
  approverDecision: string | null;
  approverNotes: string | null;
  approverDecidedAt: string | null;
  // Full audit trail across every maker-checker round (see LeadDecision's doc
  // comment in schema.prisma) — the fields above only ever hold the current
  // round, overwritten on a re-claim after send-back.
  decisions: { id: string; actorRole: string; actorName: string; action: string; notes: string | null; decidedAt: string }[];
  createdAt: string;
  summary: { summaryJson: string } | null;
  videoPdSession: VideoPdSessionData | null;
  application: {
    id: string;
    segment: SegmentCode;
    fullName: string | null;
    gender: string | null;
    email: string | null;
    maritalStatus: string | null;
    dependents: number | null;
    currentAddress: string | null;
    permanentAddress: string | null;
    idType: string | null;
    idNumber: string | null;
    productType: string | null;
    requestedAmount: number | null;
    tenureMonths: number | null;
    loanPurpose: string | null;
    incomeSource: string | null;
    monthlyIncome: number | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    bankName: string | null;
    segmentFieldsJson: string | null;
    borrower: { mobile: string; language: string };
    evidence: EvidenceRow[];
    transcripts: ChatTurnRow[];
    voiceBiometricCheck: VoiceBiometricCheckRow | null;
  };
}

interface VoiceBiometricCheckRow {
  consistencyStatus: string;
  consistencySimilarity: number | null;
  consistencyMethod: string | null;
  consistencyNotes: string | null;
  livenessMultiSpeakerStatus: string;
  livenessSpeakerCount: number | null;
  businessMultiSpeakerStatus: string;
  businessSpeakerCount: number | null;
  liveCallConsistencyStatus: string;
  liveCallConsistencySimilarity: number | null;
  liveCallConsistencyMethod: string | null;
  liveCallConsistencyNotes: string | null;
  liveCallMultiSpeakerStatus: string;
  liveCallSpeakerCount: number | null;
  livenessDeepfakeStatus: string;
  livenessDeepfakeRatio: number | null;
  businessDeepfakeStatus: string;
  businessDeepfakeRatio: number | null;
  deepfakeModel: string | null;
  livenessLipSyncStatus: string;
  livenessLipSyncScore: number | null;
  businessLipSyncStatus: string;
  businessLipSyncScore: number | null;
  lipSyncModel: string | null;
  assetDetectionStatus: string;
  assetDetectionChecklistJson: string | null;
  assetDetectionModel: string | null;
  assetDetectionNotes: string | null;
  customAssetDetectionStatus: string;
  customAssetDetectionChecklistJson: string | null;
  customAssetDetectionModel: string | null;
  customAssetDetectionNotes: string | null;
  assetChecklistManualTicksJson: string | null;
  assetChecklistScore: number | null;
  checkedAt: string | null;
}

interface AssetDetectionChecklistItem {
  label: string;
  count: number;
  confidence: number;
  thumbnail: string | null;
}

const RISK_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  none: "success", low: "neutral", medium: "warning", high: "danger",
};
// Same gap fixed in the queue list's own STATUS_TONE (staff/queue/page.tsx) —
// VIDEOPD_SCHEDULED/VIDEOPD_COMPLETE fell through to a plain grey badge here too.
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  NEW: "info", UNDER_REVIEW: "warning", AWAITING_CHECKER_REVIEW: "warning",
  SENT_BACK: "danger", VIDEOPD_SCHEDULED: "info", VIDEOPD_COMPLETE: "warning",
  APPROVED: "success", REJECTED: "danger",
};

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [data, setData] = useState<CaseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Needed here (not just risk-parameters) so the Action panel below knows
  // whether it should wait on deepfake/lip-sync specifically — those are
  // the two sub-checks an Approver can turn off, and this page shouldn't
  // block a decision on a check that's deliberately disabled.
  const [featureSettings, setFeatureSettings] = useState<{ deepfakeCheckEnabled: boolean; lipSyncCheckEnabled: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff/case/${params.id}`);
    const json = await res.json();
    if (json.lead) setData(json.lead);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    fetch("/api/staff/feature-settings").then((r) => r.json()).then((json) => setFeatureSettings(json.settings)).catch(() => {});
  }, []);

  useEffect(() => {
    const s = getStoredStaff();
    if (!s) { router.replace("/staff"); return; }
    setStaff(s);
  }, [router]);

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

  // Bank statement analysis now runs in the background after upload (see
  // api/videopd/[token]/bank-statement/route.ts) — the row this page just
  // loaded can still be PENDING even though the borrower's upload step
  // already finished. Poll while it is, so the real result (or a genuine
  // FAILED) appears on its own rather than requiring a manual refresh.
  // Stops itself the moment the latest statement is no longer PENDING.
  const latestStatementStatus = data?.videoPdSession?.bankStatements?.[0]?.status;
  useEffect(() => {
    if (latestStatementStatus !== "PENDING") return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [latestStatementStatus, load]);

  // Voice-biometrics sub-checks now run automatically in the background
  // (see api/upload/route.ts's calls into runVoiceCheck) rather than
  // waiting for a manual click — but that means a decision made in the
  // few seconds right after a call ends or the guided-flow completes could
  // race ahead of results that are still landing. computeVoiceChecksPending
  // is the single source of truth ActionPanel uses to decide whether to
  // hold the decision buttons; this effect just polls while it's true, on
  // the same pattern as the bank-statement polling above, so the block
  // clears itself the moment results land — never a manual-refresh dead end.
  const voiceChecksPending = data ? computeVoiceChecksPending(data, featureSettings) : false;
  useEffect(() => {
    if (!voiceChecksPending) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [voiceChecksPending, load]);

  async function act(url: string, body: Record<string, unknown>) {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      await load();
    } catch (e: any) {
      setActionError(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function sendVideoPdLink() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/staff/case/${params.id}/send-videopd-link`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      // No real SMS/WhatsApp gateway in this prototype (BRD Section 12 dependency) —
      // same mocked-delivery pattern as the OTP gateway: show the link directly.
      setSentLink(typeof window !== "undefined" ? `${window.location.origin}${json.link}` : json.link);
      await load();
    } catch (e: any) {
      setActionError(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !staff) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>;
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center text-ink-400">Case not found.</div>;
  }

  const app = data.application;
  const summary: InitialSummary | null = data.summary ? JSON.parse(data.summary.summaryJson) : null;
  const segmentFields: Record<string, unknown> = app.segmentFieldsJson ? JSON.parse(app.segmentFieldsJson) : {};
  const segmentFieldDefs = SEGMENT_FIELDS[app.segment] ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-6 sm:px-6 sm:py-8">
      {/* flex-col on mobile — the right-side group (name + role badge + sign
          out) doesn't fit next to the brand block at 375px in one nowrap row;
          it overflowed past the viewport edge, clipping the Sign out button. */}
      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/staff/queue")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Landmark className="h-5 w-5 shrink-0 text-white" />
          <div>
            <p className="text-sm font-bold text-white">Underwriter Workspace</p>
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

      {/* Case header */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">{app.fullName || "—"}</h1>
            <p className="text-sm text-ink-400">{app.borrower.mobile} · {app.segment.replace("_", " ")} · Ref {data.id.slice(-8).toUpperCase()}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={RISK_TONE[data.riskSeverity] ?? "neutral"}>{data.riskSeverity} risk</Badge>
            <Badge tone={STATUS_TONE[data.status] ?? "neutral"}>{data.status.replace(/_/g, " ")}</Badge>
          </div>
        </div>
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4 dark:border-ink-800 sm:grid-cols-4">
            <Stat label="Amount" value={formatINR(app.requestedAmount)} />
            <Stat label="Tenure" value={app.tenureMonths ? `${app.tenureMonths} mo` : "—"} />
            <Stat label="Monthly income" value={formatINR(app.monthlyIncome)} />
            <Stat label="Completeness" value={`${summary.completenessScore}%`} />
          </div>
        )}
      </Card>

      {/* Risk flags */}
      {summary && (
        <Card className="mb-5">
          <SectionTitle icon={<MessageSquareWarning className="h-4 w-4" />}>Risk flags (advisory)</SectionTitle>
          {summary.riskFlags.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-sprout-600"><CheckCircle2 className="h-4 w-4" /> No issues found</p>
          ) : (
            <div className="space-y-2">
              {summary.riskFlags.map((f, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 dark:bg-amber-950/20">
                  <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{f.label} <span className="opacity-60">({f.severity})</span></p>
                    <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70">{f.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Borrower profile */}
      <Card className="mb-5">
        <SectionTitle icon={<FileText className="h-4 w-4" />}>Borrower profile</SectionTitle>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Row label="Gender" value={app.gender} />
          <Row label="Marital status" value={app.maritalStatus} />
          <Row label="Dependents" value={app.dependents?.toString()} />
          <Row label="Email" value={app.email} />
          <Row label="Current address" value={app.currentAddress} />
          <Row label="Permanent address" value={app.permanentAddress} />
          <Row label="ID type" value={app.idType} />
          <Row label="ID number" value={app.idNumber} />
          <Row label="Product type" value={app.productType} />
          <Row label="Loan purpose" value={app.loanPurpose} />
          <Row label="Income source" value={app.incomeSource} />
          <Row label="Bank" value={app.bankName ? `${app.bankName} · ${app.bankAccountNumber ?? "—"} · ${app.bankIfsc ?? "—"}` : null} />
        </div>
      </Card>

      {/* Segment-specific fields */}
      <Card className="mb-5">
        <SectionTitle icon={<FileText className="h-4 w-4" />}>{t("en", "stepSegment")}</SectionTitle>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {segmentFieldDefs.map((f) => (
            <Row key={f.key} label={t("en", f.labelKey)} value={segmentFields[f.key] != null ? String(segmentFields[f.key]) : null} />
          ))}
        </div>
      </Card>

      {/* Evidence */}
      <Card className="mb-5">
        <SectionTitle icon={<ShieldCheck className="h-4 w-4" />}>Documents & evidence</SectionTitle>
        {app.evidence.length === 0 ? (
          <p className="text-sm text-ink-400">No evidence uploaded.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {app.evidence.map((e) => (
              <EvidenceCard key={e.id} evidence={e} />
            ))}
          </div>
        )}
      </Card>

      {/* Identity verification — the real, on-device liveness/face-match
          signal from VideoPD Step 1 (src/lib/liveness.ts, faceMatch.ts),
          surfaced as its own panel rather than buried in a caption under an
          evidence thumbnail, since this is the underwriter's actual answer
          to "is the person on camera the person on the ID proof". */}
      <IdentityVerificationCard evidence={app.evidence} />

      {/* Voice biometrics — staff-triggered, calls a separate Python
          microservice (voice-service/README.md) doing real SpeechBrain/
          Resemblyzer speaker-embedding comparison + a window-cluster
          multi-speaker scan over the two guided-flow recordings. Not run
          automatically: the service may not be running in every
          environment, and its thresholds are uncalibrated against real
          borrower audio (advisory only — see the card's own note). */}
      <VoiceBiometricsCard caseId={data.id} applicationId={app.id} segment={app.segment} evidence={app.evidence} check={app.voiceBiometricCheck} onChecked={load} />

      {/* Bank statement — found live: this had no viewer at all (the raw
          file was uploaded and genuinely parsed, but nothing surfaced it
          except a snapshot buried in the dossier JSON, which only exists
          once the whole VideoPD session completes). This renders straight
          from the BankStatement rows themselves, so it shows up the moment
          a statement is uploaded — before, during, and after the session. */}
      <BankStatementCard statements={data.videoPdSession?.bankStatements ?? []} />

      {/* VideoPD 2.0 verification (BRD BR-21..BR-29, BR-44) */}
      <Card className="mb-5">
        <SectionTitle icon={<Video className="h-4 w-4" />}>VideoPD verification</SectionTitle>
        <VideoPdSection
          caseId={data.id}
          session={data.videoPdSession}
          staffName={staff.name}
          segment={app.segment}
          busy={busy}
          sentLink={sentLink}
          linkCopied={linkCopied}
          onSend={sendVideoPdLink}
          onCopyLink={() => {
            if (sentLink) {
              navigator.clipboard.writeText(sentLink);
              setLinkCopied(true);
              setTimeout(() => setLinkCopied(false), 1500);
            }
          }}
        />
      </Card>

      {/* Chat transcript */}
      <Card className="mb-5">
        <SectionTitle icon={<MessageSquareWarning className="h-4 w-4" />}>Chatbot transcript</SectionTitle>
        {app.transcripts.length === 0 ? (
          <p className="text-sm text-ink-400">No chat activity.</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-ink-50 p-3 dark:bg-ink-800/40">
            {app.transcripts.map((turn) => (
              <div key={turn.id} className={`text-xs ${turn.role === "user" ? "text-ink-800 dark:text-ink-100" : "text-ink-500 dark:text-ink-400"}`}>
                <span className="font-semibold">{turn.role === "user" ? "Borrower" : "Assistant"}</span>
                <span className="ml-1 opacity-60">[{turn.channel}/{turn.language}]</span>: {turn.text}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Decision trail — every maker-checker round, not just the current one.
          A case that's been sent back and re-decided has 4+ entries here
          (recommend, send back, re-recommend, decide) rather than just the
          latest pair; see LeadDecision's doc comment in schema.prisma. */}
      {data.decisions.length > 0 && (
        <Card className="mb-5">
          <SectionTitle icon={<UserCheck className="h-4 w-4" />}>Decision trail</SectionTitle>
          <div className="space-y-3">
            {data.decisions.map((d) => (
              <DecisionRow
                key={d.id}
                who={`${d.actorName} · ${d.actorRole === "UNDERWRITER" ? "Underwriter" : "Approver"}`}
                decision={d.action}
                notes={d.notes}
                at={d.decidedAt}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Action panel */}
      <Card>
        <SectionTitle icon={<ShieldCheck className="h-4 w-4" />}>Action</SectionTitle>
        <AnimatePresence>
          {actionError && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-3 flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {actionError}
            </motion.p>
          )}
        </AnimatePresence>

        <ActionPanel
          data={data}
          staff={staff}
          busy={busy}
          voiceChecksPending={voiceChecksPending}
          onClaim={() => act(`/api/staff/case/${data.id}/claim`, { staffName: staff.name })}
          onUnderwriterDecision={(recommendation, notes) =>
            act(`/api/staff/case/${data.id}/underwriter-decision`, { staffName: staff.name, recommendation, notes })
          }
          onApproverDecision={(decision, notes) =>
            act(`/api/staff/case/${data.id}/approver-decision`, { staffName: staff.name, decision, notes })
          }
        />
      </Card>
    </main>
  );
}

// Whether a decision (recommend / approve / reject) should wait on a
// voice-biometrics sub-check that's still running in the background.
// "Pending" here means "evidence exists that this check runs against, and
// the DB row doesn't yet show a non-PENDING result for it" — it does NOT
// distinguish "still actively running" from "voice-service was
// unreachable and the auto-trigger silently never wrote anything" (that
// second case has no DB trace to tell them apart in this prototype). By
// design this never blocks forever without a way out: ActionPanel always
// offers an explicit "proceed without waiting" override alongside the
// block, so a genuinely-down voice-service (this app's core resilience
// principle — everything else keeps working without it) can't strand a
// case. Deepfake/lip-sync are only required when their admin toggle
// (src/lib/featureSettings.ts) is actually on. Asset detection is
// deliberately NOT included here even when its toggle is on — it's a
// checklist for the underwriter to read, not a risk signal, so there's
// nothing to "wait for" before a decision is safe to make.
function computeVoiceChecksPending(
  data: CaseDetailData,
  featureSettings: { deepfakeCheckEnabled: boolean; lipSyncCheckEnabled: boolean } | null,
): boolean {
  const evidence = data.application.evidence;
  const hasLiveness = evidence.some((e) => e.type === "VIDEOPD_LIVENESS" && e.mimeType.startsWith("video/"));
  const hasBusiness = evidence.some((e) => e.type === "VIDEOPD_BUSINESS_VERIFICATION" && e.mimeType.startsWith("video/"));
  const hasGuidedFlow = hasLiveness && hasBusiness;
  const hasLiveCall = evidence.some((e) => e.type === "LIVE_CALL_RECORDING");
  const vc = data.application.voiceBiometricCheck;

  if (hasGuidedFlow) {
    if (!vc || vc.consistencyStatus === "PENDING") return true;
    if (featureSettings?.deepfakeCheckEnabled && vc.livenessDeepfakeStatus === "PENDING") return true;
    if (featureSettings?.lipSyncCheckEnabled && vc.livenessLipSyncStatus === "PENDING") return true;
  }
  if (hasLiveCall) {
    if (!vc || (vc.liveCallConsistencyStatus === "PENDING" && vc.liveCallMultiSpeakerStatus === "PENDING")) return true;
  }
  return false;
}

// Assembles the real, already-computed signals this case has into the
// shape draftUnderwriterRecommendation needs — no new checks run here, just
// gathering what's already on the page. Reads bank statement/identity data
// from the live rows (session.bankStatements, application.evidence), not
// the frozen dossier snapshot, since those can have moved on since the
// dossier was compiled (e.g. an authenticity re-check after a re-upload).
function buildDraftInput(data: CaseDetailData) {
  const summary: InitialSummary | null = data.summary ? JSON.parse(data.summary.summaryJson) : null;
  const session = data.videoPdSession;
  const dossier: Dossier | null = session?.dossierJson ? JSON.parse(session.dossierJson) : null;
  const statement = session?.bankStatements[0] ?? null;
  const liveness = data.application.evidence.find((e) => e.type === "VIDEOPD_LIVENESS");

  return {
    riskSeverity: data.riskSeverity,
    riskFlags: summary?.riskFlags ?? [],
    skillIntentScore: session?.skillIntentScore ?? null,
    videoPdComplete: session?.status === "COMPLETE",
    dossierFlags: dossier?.flags ?? [],
    bankStatement: statement
      ? { eligibilityFlag: statement.eligibilityFlag, authenticityStatus: statement.authenticityStatus, authenticityReasons: statement.authenticityReasonsJson ? JSON.parse(statement.authenticityReasonsJson) : [] }
      : null,
    identityVerification: liveness
      ? { authenticityStatus: liveness.authenticityStatus, notes: liveness.authenticityNotes, faceMatchResult: liveness.faceMatchResult }
      : null,
  };
}

// Wraps the actual decision buttons — holds them back while
// voice-biometrics sub-checks are still running (see
// computeVoiceChecksPending), with a deliberate, secondary-styled escape
// hatch rather than a silent bypass, so a genuinely unreachable
// voice-service (this app's core resilience principle: everything else
// keeps working without it) can never permanently strand a case.
function VoiceCheckGate({ pending, overridden, onOverride, children }: { pending: boolean; overridden: boolean; onOverride: () => void; children: React.ReactNode }) {
  if (!pending || overridden) return <>{children}</>;
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> Voice-biometrics checks are still running in the background — this page refreshes on its own once they land, no action needed.
      </p>
      <p className="text-[11px] leading-snug text-amber-700/80 dark:text-amber-400/70">
        Taking longer than a minute or two usually means the voice-biometrics service isn't running — try &ldquo;Re-run voice check&rdquo; above once it&apos;s back, or{" "}
        <button type="button" onClick={onOverride} className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300">
          proceed without waiting
        </button>.
      </p>
    </div>
  );
}

function ActionPanel({
  data, staff, busy, voiceChecksPending, onClaim, onUnderwriterDecision, onApproverDecision,
}: {
  data: CaseDetailData;
  staff: StaffMember;
  busy: boolean;
  voiceChecksPending: boolean;
  onClaim: () => void;
  onUnderwriterDecision: (recommendation: "APPROVE" | "REJECT", notes: string) => void;
  onApproverDecision: (decision: "APPROVED" | "REJECTED" | "SENT_BACK", notes: string) => void;
}) {
  const [notes, setNotes] = useState("");
  // Reported live: clicking "Draft recommendation" used to overwrite this
  // same box with the AI text, so typing a comment meant editing (or
  // accidentally clobbering) the draft rather than adding to it — there
  // was no way to tell "what the rule engine said" apart from "what the
  // underwriter actually thinks" once both had been typed into one field.
  // Kept as its own state now: read-only once drafted, never mixed into
  // `notes`, which stays exclusively the underwriter's own words.
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  // Purely a UI hint (which button to highlight) — never disables or
  // pre-selects anything. The underwriter can click either button
  // regardless of what this says.
  const [draftSuggestion, setDraftSuggestion] = useState<"APPROVE" | "REJECT" | null>(null);
  // Deliberately separate from draftSuggestion — this only ever flips via
  // the explicit "proceed without waiting" click in VoiceCheckGate, never
  // automatically, and every decision made while it's true gets an
  // unremovable marker prepended to its notes (see the two onClick
  // handlers below) — a real audit trail of which decisions were made
  // without a completed voice-biometrics read, same reasoning as the
  // "[AI-drafted]" marker below.
  const [voiceCheckOverridden, setVoiceCheckOverridden] = useState(false);
  // What actually gets persisted: the AI draft (if one was ever generated
  // for this round, verbatim, never editable) followed by the
  // underwriter's own notes as a clearly separate section — both survive
  // into the real audit trail (LeadDecision), not just whichever one
  // happened to still be in the box at submit time.
  function combinedNotes() {
    const parts: string[] = [];
    if (aiReasoning) parts.push(`[AI-drafted — reviewed before submission]\n${aiReasoning}`);
    if (notes.trim()) parts.push(notes.trim());
    return parts.join("\n\n");
  }
  function notesWithOverrideMarker() {
    const base = combinedNotes();
    return voiceCheckOverridden && voiceChecksPending
      ? `[Decided without waiting for voice-biometrics checks to finish]\n${base}`
      : base;
  }

  function draftRecommendation() {
    const { recommendation, reasoning } = draftUnderwriterRecommendation(buildDraftInput(data));
    setDraftSuggestion(recommendation);
    setAiReasoning(reasoning);
  }

  if (data.status === "APPROVED" || data.status === "REJECTED") {
    return <p className="text-sm text-ink-500 dark:text-ink-400">This case is closed — see the decision trail above.</p>;
  }

  if (data.status === "NEW" || data.status === "SENT_BACK" || data.status === "VIDEOPD_SCHEDULED" || data.status === "VIDEOPD_COMPLETE") {
    if (staff.role !== "UNDERWRITER") {
      return <p className="text-sm text-ink-500 dark:text-ink-400">Waiting for an underwriter to claim this case.</p>;
    }
    return (
      <div>
        {data.status === "SENT_BACK" && (
          <p className="mb-3 text-sm text-amber-600 dark:text-amber-400">
            This case was sent back by the approver — see their notes in the decision trail above. Claim it to rework the recommendation.
          </p>
        )}
        {data.status === "VIDEOPD_SCHEDULED" && (
          <p className="mb-3 text-sm text-ink-500 dark:text-ink-400">
            A VideoPD link has been sent and the borrower hasn't completed it yet. You can claim and start reviewing the application now, or wait.
          </p>
        )}
        {data.status === "VIDEOPD_COMPLETE" && (
          <p className="mb-3 text-sm text-sprout-600 dark:text-sprout-400">
            VideoPD verification is complete — see the identity check and dossier above before claiming.
          </p>
        )}
        <Button onClick={onClaim} loading={busy} icon={<UserCheck className="h-4 w-4" />}>Claim this case</Button>
      </div>
    );
  }

  if (data.status === "UNDER_REVIEW") {
    if (staff.role !== "UNDERWRITER" || staff.name !== data.assignedUnderwriter) {
      return <p className="text-sm text-ink-500 dark:text-ink-400">Claimed by <strong>{data.assignedUnderwriter}</strong> — awaiting their recommendation.</p>;
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => draftRecommendation()}
            className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-600 transition-colors hover:border-sprout-300 hover:text-sprout-700 dark:border-ink-700 dark:text-ink-300 dark:hover:border-sprout-700 dark:hover:text-sprout-400"
          >
            <Sparkles className="h-3.5 w-3.5" /> Draft recommendation
          </button>
          {draftSuggestion && (
            <span className={`text-[11px] font-semibold ${draftSuggestion === "APPROVE" ? "text-sprout-600 dark:text-sprout-400" : "text-red-500"}`}>
              Suggested: {draftSuggestion}
            </span>
          )}
        </div>
        {/* Rule-based synthesis of the signals already on this page — not a
            language model, and never submitted automatically. Read-only
            once drafted (see aiReasoning's own comment for why this used
            to be an editable box the underwriter's own notes could
            accidentally overwrite) — the underwriter reads it, then adds
            their own view in the separate box below; nothing here writes
            to the database on its own. */}
        <p className="text-[11px] leading-snug text-ink-400">
          "Draft recommendation" synthesizes the checks already shown on this page (risk flags, bank statement, identity verification) into a starting point — it never decides or submits anything.
        </p>
        {aiReasoning && (
          <div className="rounded-xl border border-ink-100 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-800/40">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">
              <Sparkles className="h-3 w-3" /> AI-drafted reasoning
            </p>
            {/* whitespace-pre-line, not a single run-on paragraph — each
                blocker/caution/positive draftUnderwriterRecommendation
                found is its own line now (see that function's own
                comment), and this is what actually renders those line
                breaks instead of collapsing them back into one block. */}
            <p className="whitespace-pre-line text-xs leading-relaxed text-ink-600 dark:text-ink-300">{aiReasoning}</p>
          </div>
        )}
        <Textarea label="Your notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the approver should know…" />
        <VoiceCheckGate pending={voiceChecksPending} overridden={voiceCheckOverridden} onOverride={() => setVoiceCheckOverridden(true)}>
          <div className="flex gap-2">
            <Button onClick={() => onUnderwriterDecision("APPROVE", notesWithOverrideMarker())} loading={busy} icon={<CheckCircle2 className="h-4 w-4" />}>Recommend approve</Button>
            <Button variant="outline" onClick={() => onUnderwriterDecision("REJECT", notesWithOverrideMarker())} loading={busy} icon={<XCircle className="h-4 w-4" />}>Recommend reject</Button>
          </div>
        </VoiceCheckGate>
      </div>
    );
  }

  if (data.status === "AWAITING_CHECKER_REVIEW") {
    if (staff.role !== "APPROVER") {
      return <p className="text-sm text-ink-500 dark:text-ink-400">Awaiting checker review by an approver.</p>;
    }
    if (staff.name === data.assignedUnderwriter) {
      return <p className="text-sm text-amber-600 dark:text-amber-400">You made this recommendation — a different approver must confirm it (two-eyes rule).</p>;
    }
    return (
      <div className="space-y-3">
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for your decision…" />
        <VoiceCheckGate pending={voiceChecksPending} overridden={voiceCheckOverridden} onOverride={() => setVoiceCheckOverridden(true)}>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onApproverDecision("APPROVED", notesWithOverrideMarker())} loading={busy} icon={<CheckCircle2 className="h-4 w-4" />}>Approve</Button>
            <Button variant="outline" onClick={() => onApproverDecision("REJECTED", notesWithOverrideMarker())} loading={busy} icon={<XCircle className="h-4 w-4" />}>Reject</Button>
            <Button variant="ghost" onClick={() => onApproverDecision("SENT_BACK", notes)} loading={busy} icon={<Undo2 className="h-4 w-4" />}>Send back</Button>
          </div>
        </VoiceCheckGate>
      </div>
    );
  }

  // A silent `return null` here is exactly how VIDEOPD_SCHEDULED/
  // VIDEOPD_COMPLETE went unhandled and unnoticed until it blocked a real
  // case — an unrecognized status should say so, not render a blank card.
  return (
    <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Unrecognized case status "{data.status}" — no action defined for this state.
    </p>
  );
}

interface DossierFlag { type: "consistency" | "completeness" | "engagement"; label: string; detail: string }
interface Dossier {
  skillIntentScore: number;
  answers: VideoPdAnswerRow[];
  livenessCaptured: boolean;
  businessVerificationCaptured: boolean;
  bankStatement: { status: string; eligibilityFlag: string | null; reasons: string[]; metrics: Record<string, number> | null } | null;
  flags: DossierFlag[];
  generatedAt: string;
}

const ELIGIBILITY_TONE: Record<string, "success" | "warning" | "danger"> = {
  ELIGIBLE: "success", NEEDS_REVIEW: "warning", NOT_ELIGIBLE: "danger",
};

const GUEST_INVITE_LABEL: Partial<Record<SegmentCode, string>> = {
  VOCATIONAL_STUDENT: "Copy training institute invite link",
  BUSINESS_OWNER: "Copy business contact invite link",
};

function VideoPdSection({
  caseId, session, staffName, segment, busy, sentLink, linkCopied, onSend, onCopyLink,
}: {
  caseId: string;
  session: VideoPdSessionData | null;
  staffName: string;
  segment: SegmentCode;
  busy: boolean;
  sentLink: string | null;
  linkCopied: boolean;
  onSend: () => void;
  onCopyLink: () => void;
}) {
  const [guestLinkCopied, setGuestLinkCopied] = useState(false);
  function copyGuestLink(token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/call/${token}`);
    setGuestLinkCopied(true);
    setTimeout(() => setGuestLinkCopied(false), 1500);
  }

  if (!session) {
    return (
      <div>
        <p className="mb-3 text-sm text-ink-500 dark:text-ink-400">
          Send the borrower a VideoPD verification link — identity check, a short skill/intent Q&A, business verification, and a bank statement upload.
        </p>
        <Button onClick={onSend} loading={busy} icon={<Video className="h-4 w-4" />}>Send VideoPD link</Button>
      </div>
    );
  }

  if (session.status !== "COMPLETE") {
    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={session.status === "IN_PROGRESS" ? "warning" : "info"}>{session.status.replace("_", " ")}</Badge>
          <span className="text-xs text-ink-400">Link sent {new Date(session.linkSentAt).toLocaleString()}</span>
        </div>
        {sentLink && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800/40">
            <span className="flex-1 truncate font-mono text-xs text-ink-600 dark:text-ink-300">{sentLink}</span>
            <button onClick={onCopyLink} className="flex shrink-0 items-center gap-1 rounded-full bg-ink-900 px-2.5 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-ink-900">
              <Copy className="h-3 w-3" /> {linkCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={onSend} loading={busy} icon={<Video className="h-3.5 w-3.5" />}>Resend link</Button>

        {/* Real, self-hosted live video call (server/signaling-server.ts) —
            separate from the async recorded VideoPD steps above. Room is
            keyed by the session's own token, same identifier the borrower's
            page already uses, so whoever opens this second connects to
            whoever opened it first. */}
        <div className="mt-4 border-t border-ink-100 pt-4 dark:border-ink-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-400">Live verification call</p>
            {(segment === "VOCATIONAL_STUDENT" || segment === "BUSINESS_OWNER") && (
              <button
                onClick={() => copyGuestLink(session.token)}
                className="flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              >
                <Copy className="h-3 w-3" /> {guestLinkCopied ? "Copied!" : GUEST_INVITE_LABEL[segment]}
              </button>
            )}
          </div>
          <LiveCallRoom roomId={session.token} displayName={staffName} transcribe />
        </div>

        <CallTranscriptPanel segments={session.callTranscript} />
      </div>
    );
  }

  const dossier: Dossier | null = session.dossierJson ? JSON.parse(session.dossierJson) : null;
  if (!dossier) return <p className="text-sm text-ink-400">Complete, but no dossier data found.</p>;

  return (
    <div className="space-y-4">
      {/* flex-col on mobile — a single row here forced the score+text block into
          a sliver of width between the fixed-size circle and button, wrapping
          the title to one word per line. Stacked below sm:, one row from sm: up. */}
      <div className="flex flex-col gap-3 rounded-xl bg-ink-50 p-3 dark:bg-ink-800/40 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sprout-400 to-sprout-600 text-lg font-extrabold text-white">
            {dossier.skillIntentScore}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900 dark:text-white">Skill & Intent Score</p>
            <p className="text-xs text-ink-400">Completed {new Date(dossier.generatedAt).toLocaleString()} · rule-based (BR-43) — configurable per lending partner</p>
          </div>
        </div>
        <a
          href={`/api/staff/case/${caseId}/dossier-pdf`}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-ink-800 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100 sm:ml-auto"
        >
          <FileDown className="h-3.5 w-3.5" /> Download PDF
        </a>
      </div>

      {dossier.flags.length > 0 && (
        <div className="space-y-2">
          {dossier.flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 dark:bg-amber-950/20">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{f.label} <span className="opacity-60">({f.type})</span></p>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70">{f.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 text-xs">
        <Badge tone={dossier.livenessCaptured ? "success" : "danger"}>{dossier.livenessCaptured ? "Liveness ✓" : "Liveness missing"}</Badge>
        <Badge tone={dossier.businessVerificationCaptured ? "success" : "danger"}>{dossier.businessVerificationCaptured ? "Business verification ✓" : "Business verification missing"}</Badge>
      </div>

      {dossier.bankStatement && (
        <div className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">Bank statement eligibility</p>
            {dossier.bankStatement.eligibilityFlag && (
              <Badge tone={ELIGIBILITY_TONE[dossier.bankStatement.eligibilityFlag] ?? "neutral"}>{dossier.bankStatement.eligibilityFlag.replace("_", " ")}</Badge>
            )}
          </div>
          {dossier.bankStatement.status === "NEEDS_REVIEW" && (
            <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">Extraction confidence was low — verify manually before relying on this.</p>
          )}
          <ul className="mb-2 list-inside list-disc space-y-1 text-xs text-ink-600 dark:text-ink-300">
            {dossier.bankStatement.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {dossier.bankStatement.metrics && (
            <div className="grid grid-cols-2 gap-2 border-t border-ink-100 pt-2 dark:border-ink-800 sm:grid-cols-3">
              <Stat label="Avg balance" value={formatINR(dossier.bankStatement.metrics.avgBalance)} />
              <Stat label="Min balance" value={formatINR(dossier.bankStatement.metrics.minBalance)} />
              <Stat label="Bounces" value={String(dossier.bankStatement.metrics.bounceCount)} />
              <Stat label="Est. monthly income" value={formatINR(dossier.bankStatement.metrics.estimatedMonthlyIncome)} />
              <Stat label="EMI outflow" value={formatINR(dossier.bankStatement.metrics.emiOutflow)} />
              <Stat label="Transactions parsed" value={String(dossier.bankStatement.metrics.transactionCount)} />
            </div>
          )}
        </div>
      )}

      {dossier.answers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">Skill & Intent Q&A</p>
          <div className="space-y-2">
            {dossier.answers.map((a) => (
              <div key={a.questionKey} className="rounded-xl bg-ink-50 p-2.5 text-xs dark:bg-ink-800/40">
                <p className="font-semibold text-ink-700 dark:text-ink-200">{a.questionText}</p>
                <p className="mt-0.5 text-ink-500 dark:text-ink-400">{a.answerText}</p>
                {a.answerTextEn && (
                  <p className="mt-1 border-t border-ink-200/60 pt-1 text-[11px] italic text-ink-400 dark:border-ink-700/60 dark:text-ink-500">
                    EN: {a.answerTextEn}
                  </p>
                )}
                {a.translationAvailable === false && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> English translation unavailable — showing original only.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <CallTranscriptPanel segments={session.callTranscript} />
    </div>
  );
}

/** Persisted transcript from any live call(s) on this session — separate
 * from the in-call live view (LiveCallRoom's own "Live transcript" panel,
 * only visible while actually in the call); this is what survives after
 * everyone's left, so an underwriter reviewing the case later still sees
 * what was said. Renders nothing at all if no call ever happened — an
 * empty "no transcript" card for the ~most common case (no live call used)
 * would just be noise. */
function CallTranscriptPanel({ segments }: { segments: { id: string; speakerName: string; text: string; createdAt: string }[] }) {
  if (segments.length === 0) return null;
  return (
    <div className="mt-4 border-t border-ink-100 pt-4 dark:border-ink-800">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Call transcript</p>
      <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-ink-50 p-3 dark:bg-ink-800/40">
        {segments.map((s) => (
          <p key={s.id} className="text-xs leading-relaxed text-ink-700 dark:text-ink-300">
            <span className="font-semibold text-ink-500 dark:text-ink-400">{s.speakerName}:</span> {s.text}
            <span className="ml-1.5 text-[10px] text-ink-300 dark:text-ink-600">{new Date(s.createdAt).toLocaleTimeString()}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function IdentityVerificationCard({ evidence }: { evidence: EvidenceRow[] }) {
  const liveness = evidence.find((e) => e.type === "VIDEOPD_LIVENESS");
  if (!liveness) return null; // borrower hasn't reached Step 1 yet — nothing to show

  // Any ID proof, image or PDF (a real, common shape — DigiLocker/scanned
  // Aadhaar downloads) — this used to only look for an image, so a PDF ID
  // proof showed "No ID proof photo on file" even though one was clearly
  // uploaded (reported live), reading as if face-match couldn't possibly be
  // running at all. Face-match itself already handles a PDF ID proof fine
  // (see faceMatch.ts's descriptorFromIdProofUrl) — this was purely a
  // display gap, not a face-match gap.
  const idProof = evidence.find((e) => e.type === "ID_PROOF");
  const idProofIsImage = idProof?.mimeType.startsWith("image/") ?? false;
  const notComputed = liveness.authenticityStatus === "PENDING";
  const passed = liveness.authenticityStatus === "PASSED";

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={<ScanFace className="h-4 w-4" />}>Identity verification</SectionTitle>
        <Badge tone={notComputed ? "neutral" : passed ? "success" : "warning"}>
          {notComputed ? "Pending" : passed ? "Verified" : "Needs review"}
        </Badge>
      </div>
      <p className="mb-4 text-xs text-ink-400">
        Real, on-device checks from the borrower's own liveness recording — a blink challenge and a face match
        against their ID proof photo. Advisory only; always confirm visually before deciding.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">ID proof photo</p>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-ink-50 dark:bg-ink-800/40">
            {idProof && idProofIsImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/staff/evidence/${idProof.id}`} alt="ID proof" className="h-full w-full object-cover" />
            ) : idProof ? (
              <a
                href={`/api/staff/evidence/${idProof.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-sprout-600"
              >
                <FileText className="h-6 w-6" />
                ID proof is a PDF — View file
                <span className="font-normal text-ink-400">(face-match still runs against it)</span>
              </a>
            ) : (
              <p className="px-2 text-center text-[11px] text-ink-400">No ID proof photo on file</p>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">Liveness recording</p>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-ink-50 dark:bg-ink-800/40">
            <video src={`/api/staff/evidence/${liveness.id}`} controls className="h-full w-full object-cover" />
          </div>
        </div>
      </div>

      {notComputed ? (
        <p className="text-sm text-ink-400">Liveness/face-match hasn't been computed for this recording yet.</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip
              icon={<Eye className="h-3.5 w-3.5" />}
              label="Blinks detected"
              value={liveness.livenessBlinkCount ?? "—"}
              warn={(liveness.livenessBlinkCount ?? 0) === 0}
            />
            <StatChip
              icon={<UserCheck className="h-3.5 w-3.5" />}
              label="Face visible"
              value={liveness.livenessNoFacePct != null ? `${100 - liveness.livenessNoFacePct}%` : "—"}
              warn={(liveness.livenessNoFacePct ?? 0) > 40}
            />
            <StatChip
              icon={<EyeOff className="h-3.5 w-3.5" />}
              label="Off-camera glances"
              value={liveness.livenessOffCameraGlances ?? "—"}
              // Threshold must match SUSPICIOUS_GLANCE_COUNT in src/lib/mockChecks.ts
              warn={(liveness.livenessOffCameraGlances ?? 0) >= 4}
            />
            <StatChip
              icon={<ScanFace className="h-3.5 w-3.5" />}
              label="Face match"
              value={liveness.faceMatchDistance != null ? `${liveness.faceMatchDistance.toFixed(2)} dist.` : "Skipped"}
              warn={liveness.faceMatchResult === false}
            />
          </div>
          {liveness.authenticityNotes && (
            <p className="rounded-xl bg-ink-50 p-2.5 text-xs leading-snug text-ink-500 dark:bg-ink-800/40 dark:text-ink-400">
              {liveness.authenticityNotes}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** Voice biometrics — staff-triggered call to the separate voice-service
 * microservice (see voice-service/README.md). Real SpeechBrain/Resemblyzer
 * speaker-embedding comparison across the selfie-step and business-
 * verification recordings, plus a window-cluster multi-speaker scan of
 * each — but with thresholds that are each library's published default,
 * not calibrated against real borrower audio, so this is deliberately
 * framed as advisory throughout, same as the bank-statement authenticity
 * banner but with an explicit "uncalibrated" caveat that one doesn't need
 * (PDF-metadata/arithmetic checks there are exact, not threshold-based). */
function VoiceBiometricsCard({
  caseId, applicationId, segment, evidence, check, onChecked,
}: {
  caseId: string; applicationId: string; segment: SegmentCode;
  evidence: EvidenceRow[]; check: VoiceBiometricCheckRow | null; onChecked: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This segment's manual (non-AI-detectable) reference items — fetched
  // once per segment, same endpoint the risk-parameters page uses to edit
  // them, read-only here. Independent of `check` so the checkbox list
  // renders even before any AI check has ever run.
  const [manualItems, setManualItems] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/staff/asset-detection-categories?segment=${segment}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setManualItems(JSON.parse(json.settings.manualItemsJson ?? "[]")); })
      .catch(() => { if (!cancelled) setManualItems([]); });
    return () => { cancelled = true; };
  }, [segment]);

  const manualTicks: string[] = check?.assetChecklistManualTicksJson ? JSON.parse(check.assetChecklistManualTicksJson) : [];
  const [manualTickBusy, setManualTickBusy] = useState<string | null>(null);
  async function toggleManualTick(item: string) {
    const next = manualTicks.includes(item) ? manualTicks.filter((t) => t !== item) : [...manualTicks, item];
    setManualTickBusy(item);
    try {
      const res = await fetch(`/api/staff/case/${caseId}/asset-checklist-manual`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticks: next }),
      });
      if (res.ok) await onChecked();
    } finally {
      setManualTickBusy(null);
    }
  }

  const liveness = evidence.find((e) => e.type === "VIDEOPD_LIVENESS");
  const business = evidence.find((e) => e.type === "VIDEOPD_BUSINESS_VERIFICATION");
  const liveCall = evidence.find((e) => e.type === "LIVE_CALL_RECORDING");
  const bothGuidedFlowPresent = !!liveness && !!business;
  // Asset detection only needs the business-verification clip, so it alone
  // (without a matching liveness clip) still makes there something to run.
  const canCheckAnything = bothGuidedFlowPresent || !!liveCall || !!business;

  async function runCheck() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/voice-check/${applicationId}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Voice check failed.");
      await onChecked();
    } catch (e: any) {
      setError(e.message ?? "Voice check failed.");
    } finally {
      setBusy(false);
    }
  }

  const consistencyFlagged = check?.consistencyStatus === "FLAGGED";
  const guidedFlowMultiFlagged = check?.livenessMultiSpeakerStatus === "FLAGGED" || check?.businessMultiSpeakerStatus === "FLAGGED";
  const liveCallConsistencyFlagged = check?.liveCallConsistencyStatus === "FLAGGED";
  const liveCallMultiFlagged = check?.liveCallMultiSpeakerStatus === "FLAGGED";
  const deepfakeFlagged = check?.livenessDeepfakeStatus === "FLAGGED" || check?.businessDeepfakeStatus === "FLAGGED";
  const lipSyncFlagged = check?.livenessLipSyncStatus === "FLAGGED" || check?.businessLipSyncStatus === "FLAGGED";
  const anyFlagged = consistencyFlagged || guidedFlowMultiFlagged || liveCallConsistencyFlagged || liveCallMultiFlagged || deepfakeFlagged || lipSyncFlagged;
  const checked = !!check?.checkedAt;
  const guidedFlowChecked = checked && check?.consistencyStatus !== "PENDING";
  const liveCallChecked = checked && (check?.liveCallMultiSpeakerStatus !== "PENDING" || check?.liveCallConsistencyStatus !== "PENDING");
  const deepfakeChecked = checked && (check?.livenessDeepfakeStatus !== "PENDING" || check?.businessDeepfakeStatus !== "PENDING");
  const lipSyncChecked = checked && (check?.livenessLipSyncStatus !== "PENDING" || check?.businessLipSyncStatus !== "PENDING");
  const assetDetectionChecked = checked && check?.assetDetectionStatus !== "PENDING";
  const assetChecklist: AssetDetectionChecklistItem[] = check?.assetDetectionChecklistJson ? JSON.parse(check.assetDetectionChecklistJson) : [];
  const customAssetDetectionChecked = checked && check?.customAssetDetectionStatus !== "PENDING";
  const customAssetChecklist: AssetDetectionChecklistItem[] = check?.customAssetDetectionChecklistJson ? JSON.parse(check.customAssetDetectionChecklistJson) : [];

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={<Mic className="h-4 w-4" />}>Voice biometrics</SectionTitle>
        {checked && (
          <Badge tone={anyFlagged ? "warning" : "success"}>{anyFlagged ? "Needs review" : "Clean"}</Badge>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-400">
        Compares voices across the recorded VideoPD steps and the borrower's live call, scans each for more than
        one distinct voice, and — where enabled — scans the guided-flow recordings for face-manipulation and
        lip-sync anomalies, plus a work-premises object checklist from the business-verification clip — both a
        fixed-vocabulary detector (80 everyday categories) and a zero-shot detector that actually looks for this
        segment's own configured items (a sewing machine, a tractor). Advisory signals for the underwriter to
        weigh, not calibrated against this lender's own borrowers yet — treat any flag here as worth a
        listen/look, not a confirmed finding, and the asset checklist as a starting point to verify visually, not
        a confirmed inventory — the zero-shot suggestions especially, since that model's accuracy runs below a
        fixed-vocabulary one. Its checklist score is an admin-configured point rubric (tuned at the Asset
        Scorecard page), not a validated asset valuation — that still needs real loan-outcome data. The
        live-call voice checks below run automatically the moment the borrower leaves the call — no click needed;
        use the button for the guided-flow, deepfake, lip-sync, and asset-detection checks (or to re-run
        everything).
      </p>

      {!canCheckAnything ? (
        <p className="text-sm text-ink-400">Nothing to check yet — need either both guided-flow recordings, or a live-call recording.</p>
      ) : (
        <>
          <Button onClick={runCheck} loading={busy} className="mb-3" variant="secondary">
            {checked ? "Re-run voice check" : "Run voice check"}
          </Button>
          {error && (
            <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">
              {error}
            </p>
          )}

          {bothGuidedFlowPresent && guidedFlowChecked && check && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">Guided-flow recordings</p>
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <StatChip
                  icon={<Mic className="h-3.5 w-3.5" />}
                  label="Voice consistency"
                  value={check.consistencySimilarity != null ? `${check.consistencySimilarity.toFixed(2)} sim.` : "—"}
                  warn={consistencyFlagged}
                />
                <StatChip
                  icon={<Users className="h-3.5 w-3.5" />}
                  label="Selfie-step voices"
                  value={check.livenessSpeakerCount ?? "—"}
                  warn={check.livenessMultiSpeakerStatus === "FLAGGED"}
                />
                <StatChip
                  icon={<Users className="h-3.5 w-3.5" />}
                  label="Business-verification voices"
                  value={check.businessSpeakerCount ?? "—"}
                  warn={check.businessMultiSpeakerStatus === "FLAGGED"}
                />
              </div>
              {check.consistencyNotes && (
                <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/40">
                  <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{check.consistencyNotes}</p>
                  {check.consistencyMethod && (
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-300 dark:text-ink-600">Model: {check.consistencyMethod}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {bothGuidedFlowPresent && deepfakeChecked && check && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">Deepfake scan</p>
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatChip
                  icon={<ScanFace className="h-3.5 w-3.5" />}
                  label="Selfie-step"
                  value={check.livenessDeepfakeRatio != null ? `${Math.round(check.livenessDeepfakeRatio * 100)}% frames flagged` : "—"}
                  warn={check.livenessDeepfakeStatus === "FLAGGED"}
                />
                <StatChip
                  icon={<ScanFace className="h-3.5 w-3.5" />}
                  label="Business-verification"
                  value={check.businessDeepfakeRatio != null ? `${Math.round(check.businessDeepfakeRatio * 100)}% frames flagged` : "—"}
                  warn={check.businessDeepfakeStatus === "FLAGGED"}
                />
              </div>
              <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/40">
                <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">
                  Frame-level image classifier only — not video-native or temporal analysis, not a maintained
                  production deepfake detector. Real false-positive risk on compression artifacts, poor lighting,
                  or low-resolution footage. Treat a flag here as worth a look, not a confirmed finding.
                </p>
                {check.deepfakeModel && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-300 dark:text-ink-600">Model: {check.deepfakeModel}</p>
                )}
              </div>
            </div>
          )}

          {bothGuidedFlowPresent && lipSyncChecked && check && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">Lip-sync scan</p>
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatChip
                  icon={<ScanFace className="h-3.5 w-3.5" />}
                  label="Selfie-step"
                  value={check.livenessLipSyncScore != null ? `score ${check.livenessLipSyncScore.toFixed(2)}` : "—"}
                  warn={check.livenessLipSyncStatus === "FLAGGED"}
                />
                <StatChip
                  icon={<ScanFace className="h-3.5 w-3.5" />}
                  label="Business-verification"
                  value={check.businessLipSyncScore != null ? `score ${check.businessLipSyncScore.toFixed(2)}` : "—"}
                  warn={check.businessLipSyncStatus === "FLAGGED"}
                />
              </div>
              <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/40">
                <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">
                  Real face detection and landmark alignment feeding a lip-region forgery classifier, benchmarked
                  on curated research datasets, not this lender's own borrowers. Treat a flag here as worth a
                  look, not a confirmed finding.
                </p>
                {check.lipSyncModel && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-300 dark:text-ink-600">Model: {check.lipSyncModel}</p>
                )}
              </div>
            </div>
          )}

          {business && (assetDetectionChecked || (manualItems && manualItems.length > 0)) && (
            <div className="mb-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Work-premises asset checklist</p>
                {check?.assetChecklistScore != null && (
                  <span className="rounded-full bg-sprout-50 px-2.5 py-1 text-xs font-bold text-sprout-700 dark:bg-sprout-950/30 dark:text-sprout-400">
                    Checklist score: {check.assetChecklistScore}
                  </span>
                )}
              </div>

              {assetDetectionChecked && check && (
                <>
                  {assetChecklist.length === 0 ? (
                    <p className="mb-2 text-xs text-ink-400">No everyday objects detected with reasonable confidence in the sampled frames.</p>
                  ) : (
                    <div className="mb-2 space-y-1.5">
                      {assetChecklist.map((item) => (
                        <DetectionItemRow key={item.label} item={item} accent="neutral" />
                      ))}
                    </div>
                  )}
                  {check.assetDetectionNotes && (
                    <div className="mb-3 rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/40">
                      <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{check.assetDetectionNotes}</p>
                      {check.assetDetectionModel && (
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-300 dark:text-ink-600">Model: {check.assetDetectionModel}</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {customAssetDetectionChecked && check && (
                <div className="mb-3">
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">
                    AI-suggested (zero-shot, unverified)
                  </p>
                  {customAssetChecklist.length === 0 ? (
                    <p className="mb-2 text-xs text-ink-400">Nothing spotted with reasonable confidence — still worth checking the video directly.</p>
                  ) : (
                    <div className="mb-2 space-y-1.5">
                      {customAssetChecklist.map((item) => (
                        <DetectionItemRow key={item.label} item={item} accent="amber" />
                      ))}
                    </div>
                  )}
                  {check.customAssetDetectionNotes && (
                    <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/40">
                      <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{check.customAssetDetectionNotes}</p>
                      {check.customAssetDetectionModel && (
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-300 dark:text-ink-600">Model: {check.customAssetDetectionModel}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {manualItems && manualItems.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-ink-500 dark:text-ink-400">
                    Confirm from the video (high-confidence AI suggestions above are pre-ticked — add or remove any item):
                  </p>
                  {/* Video sits right next to the checklist so watching and
                      ticking happen in the same place — found live: this
                      clip previously only played from a small thumbnail up
                      in Documents & Evidence, several scrolls away from
                      here, forcing the underwriter to watch, remember, then
                      scroll back to tick from memory. */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[240px_1fr]">
                    {business && (
                      <video
                        src={`/api/staff/evidence/${business.id}`}
                        controls
                        preload="metadata"
                        className="aspect-video w-full rounded-xl border border-ink-100 bg-black dark:border-ink-800"
                      />
                    )}
                    <div className="flex flex-wrap content-start gap-1.5">
                      {manualItems.map((item) => {
                        const ticked = manualTicks.includes(item);
                        return (
                          <button
                            key={item}
                            onClick={() => toggleManualTick(item)}
                            disabled={manualTickBusy === item}
                            aria-pressed={ticked}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50",
                              ticked
                                ? "border-sprout-500 bg-sprout-50 text-sprout-700 dark:border-sprout-500 dark:bg-sprout-950/30 dark:text-sprout-400"
                                : "border-ink-200 text-ink-400 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                            )}
                          >
                            {ticked && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                            {item}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {liveCall && liveCallChecked && check && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">Live call (Tier 1 — borrower-side audio only)</p>
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatChip
                  icon={<Mic className="h-3.5 w-3.5" />}
                  label="Vs. selfie-step voice"
                  value={check.liveCallConsistencySimilarity != null ? `${check.liveCallConsistencySimilarity.toFixed(2)} sim.` : "No selfie-step recording to compare"}
                  warn={liveCallConsistencyFlagged}
                />
                <StatChip
                  icon={<Users className="h-3.5 w-3.5" />}
                  label="Voices on the call"
                  value={check.liveCallSpeakerCount ?? "—"}
                  warn={liveCallMultiFlagged}
                />
              </div>
              {check.liveCallConsistencyNotes && (
                <div className="rounded-xl bg-ink-50 p-2.5 dark:bg-ink-800/40">
                  <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{check.liveCallConsistencyNotes}</p>
                  {check.liveCallConsistencyMethod && (
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-300 dark:text-ink-600">Model: {check.liveCallConsistencyMethod}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const STATEMENT_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  PENDING: "neutral", EXTRACTED: "success", NEEDS_REVIEW: "warning", FAILED: "danger",
};

function BankStatementCard({ statements }: { statements: BankStatementRow[] }) {
  if (statements.length === 0) return null; // borrower hasn't reached this step yet — nothing to show

  return (
    <Card className="mb-5">
      <SectionTitle icon={<FileText className="h-4 w-4" />}>Bank statement</SectionTitle>
      <div className="space-y-3">
        {statements.map((s) => {
          const metrics: Record<string, number> | null = s.metricsJson ? JSON.parse(s.metricsJson) : null;
          const reasons: string[] = s.eligibilityReasonsJson ? JSON.parse(s.eligibilityReasonsJson) : [];
          return (
            <div key={s.id} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <a
                  href={`/api/staff/bank-statement/${s.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-sprout-600 hover:underline dark:text-sprout-400"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" /> {s.fileName}
                </a>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={STATEMENT_STATUS_TONE[s.status] ?? "neutral"} className="!px-1.5 !py-0.5 !text-[10px]">
                    {s.status.replace("_", " ")}
                  </Badge>
                  {s.eligibilityFlag && (
                    <Badge tone={ELIGIBILITY_TONE[s.eligibilityFlag] ?? "neutral"} className="!px-1.5 !py-0.5 !text-[10px]">
                      {s.eligibilityFlag.replace("_", " ")}
                    </Badge>
                  )}
                </div>
              </div>

              {reasons.length > 0 && (
                <ul className="mb-2 list-inside list-disc space-y-0.5 text-[11px] text-ink-500 dark:text-ink-400">
                  {reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}

              <AuthenticityBanner status={s.authenticityStatus} reasonsJson={s.authenticityReasonsJson} />

              {metrics ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Avg balance" value={formatINR(metrics.avgBalance)} />
                  <Stat label="Min balance" value={formatINR(metrics.minBalance)} />
                  <Stat label="Bounces" value={String(metrics.bounceCount)} />
                  <Stat label="Est. monthly income" value={formatINR(metrics.estimatedMonthlyIncome)} />
                  <Stat label="EMI outflow" value={formatINR(metrics.emiOutflow)} />
                  <Stat label="Transactions parsed" value={String(metrics.transactionCount)} />
                </div>
              ) : (
                <p className="text-xs text-ink-400">
                  {s.status === "PENDING" ? "Still processing…" : "No metrics available — extraction may have failed. See the raw file link above."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Document-authenticity result — real, deterministic checks (PDF revision
 * count/generating-software metadata, independent balance-vs-transaction
 * arithmetic reconciliation; see src/lib/bankStatement.ts's checkPdfMetadata
 * and checkTransactionIntegrity). Deliberately loud and explicit on a clean
 * result, not just silence — an underwriter should see a positive
 * confirmation that the document was actually checked and passed, not have
 * to infer "no news is good news" from an absence of warnings. NOT a claim
 * of detecting a doctored logo/visual alteration — that needs real image-
 * forensics ML, out of scope here (see checkPdfMetadata's own doc comment). */
function AuthenticityBanner({ status, reasonsJson }: { status: string; reasonsJson: string | null }) {
  const reasons: string[] = reasonsJson ? JSON.parse(reasonsJson) : [];
  if (status === "PENDING") return null; // extraction hasn't produced a verdict yet — nothing to show

  const flagged = status === "FLAGGED";
  return (
    <div
      className={`mb-2 flex items-start gap-2 rounded-xl border p-2.5 ${
        flagged
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          : "border-sprout-200 bg-sprout-50 dark:border-sprout-900/50 dark:bg-sprout-950/20"
      }`}
    >
      {flagged ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      ) : (
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sprout-600 dark:text-sprout-400" />
      )}
      <div>
        <p className={`text-xs font-semibold ${flagged ? "text-amber-700 dark:text-amber-400" : "text-sprout-700 dark:text-sprout-400"}`}>
          {flagged ? "Document authenticity — review required" : "Document authenticity verified"}
        </p>
        {reasons.map((r, i) => (
          <p key={i} className={`mt-0.5 text-[11px] leading-snug ${flagged ? "text-amber-600/90 dark:text-amber-500/80" : "text-sprout-600/90 dark:text-sprout-500/80"}`}>
            {r}
          </p>
        ))}
      </div>
    </div>
  );
}

function StatChip({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string | number; warn?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-2.5 ${
        warn
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          : "border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/30"
      }`}
    >
      <div className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${warn ? "text-amber-600 dark:text-amber-400" : "text-ink-400"}`}>
        {icon} {label}
      </div>
      <p className={`text-sm font-bold ${warn ? "text-amber-700 dark:text-amber-400" : "text-ink-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

// One detected asset per row — a thumbnail cropped from its own detection
// box (real visual evidence, not just a label and a confidence number the
// underwriter has to take on faith), the label + count, and a confidence
// badge. "amber" accent marks a zero-shot suggestion (see the section
// this renders inside) — same visual language as the rest of that
// section's honesty-forward styling.
function DetectionItemRow({ item, accent }: { item: AssetDetectionChecklistItem; accent: "neutral" | "amber" }) {
  const amber = accent === "amber";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-2",
        amber ? "border-dashed border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/10" : "border-ink-100 dark:border-ink-800"
      )}
    >
      {item.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small base64 data URI crop, not worth next/image's overhead
        <img src={item.thumbnail} alt={item.label} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-ink-100 dark:bg-ink-800">
          <Boxes className="h-5 w-5 text-ink-300 dark:text-ink-600" />
        </div>
      )}
      <p className={cn("min-w-0 flex-1 truncate text-sm font-semibold capitalize", amber ? "text-amber-700 dark:text-amber-400" : "text-ink-700 dark:text-ink-200")}>
        {item.label} × {item.count}
      </p>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
          amber ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" : "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300"
        )}
      >
        {Math.round(item.confidence * 100)}%
      </span>
    </div>
  );
}

function EvidenceCard({ evidence }: { evidence: EvidenceRow }) {
  const url = `/api/staff/evidence/${evidence.id}`;
  return (
    <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
      <div className="flex h-28 items-center justify-center bg-ink-50 dark:bg-ink-800/40">
        {evidence.mimeType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={evidence.type} className="h-full w-full object-cover" />
        ) : evidence.mimeType.startsWith("video/") ? (
          <video src={url} controls className="h-full w-full object-cover" />
        ) : evidence.mimeType.startsWith("audio/") ? (
          <audio src={url} controls className="w-full px-2" />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 text-xs font-semibold text-ink-500 hover:text-sprout-600">
            <FileText className="h-6 w-6" /> View file
          </a>
        )}
      </div>
      <div className="p-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">{evidence.type.replace(/_/g, " ")}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tone={evidence.qualityStatus === "PASSED" ? "success" : evidence.qualityStatus === "FLAGGED" ? "warning" : "neutral"} className="!px-1.5 !py-0.5 !text-[10px]">
            Quality: {evidence.qualityStatus}
          </Badge>
          <Badge tone={evidence.authenticityStatus === "PASSED" ? "success" : evidence.authenticityStatus === "FLAGGED" ? "warning" : "neutral"} className="!px-1.5 !py-0.5 !text-[10px]">
            Auth: {evidence.authenticityStatus}
          </Badge>
        </div>
        {evidence.authenticityNotes && (
          <p className="mt-1 text-[10px] leading-snug text-ink-500 dark:text-ink-400">{evidence.authenticityNotes}</p>
        )}
        {/* Real navigator.geolocation coordinates, captured at upload time
            (UploadDropzone.tsx — apply-wizard document uploads only, not
            VideoPD's own captures). Found live: this was stored on every
            upload but never once displayed anywhere in the workspace —
            same "captured but invisible" gap as the bank statement was. */}
        {evidence.geoLat != null && evidence.geoLng != null && (
          <a
            href={`https://www.google.com/maps?q=${evidence.geoLat},${evidence.geoLng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex items-center gap-1 text-[10px] font-medium text-sprout-600 hover:underline dark:text-sprout-400"
          >
            <MapPin className="h-2.5 w-2.5 shrink-0" /> {evidence.geoLat.toFixed(5)}, {evidence.geoLng.toFixed(5)}
          </a>
        )}
      </div>
    </div>
  );
}

function DecisionRow({ who, decision, notes, at }: { who: string; decision: string; notes: string | null; at: string | null }) {
  const tone = decision === "APPROVE" || decision === "APPROVED" ? "success" : decision === "SENT_BACK" ? "warning" : "danger";
  return (
    <div className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900 dark:text-white">{who}</p>
        <Badge tone={tone}>{decision.replace(/_/g, " ")}</Badge>
      </div>
      {notes && <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">"{notes}"</p>}
      {at && <p className="mt-1 text-[10px] text-ink-300">{new Date(at).toLocaleString()}</p>}
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
      {icon} {children}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="text-sm font-bold text-ink-900 dark:text-white">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    // gap-3 + label shrink-0: justify-between only inserts space when the row
    // has slack — a long value (e.g. a course name) with a short label can
    // otherwise butt straight up against it with zero gap. text-right lets a
    // still-too-long value wrap onto its own line rather than overflow.
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 py-1.5 text-sm dark:border-ink-800/60">
      <span className="shrink-0 text-ink-500 dark:text-ink-400">{label}</span>
      <span className="text-right font-semibold text-ink-900 dark:text-white">{value || "—"}</span>
    </div>
  );
}
