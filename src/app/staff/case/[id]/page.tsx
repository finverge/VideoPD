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
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { LiveCallRoom } from "@/components/LiveCallRoom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";
import { formatINR } from "@/lib/utils";
import { SEGMENT_FIELDS } from "@/lib/formSchema";
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
  };
}

const RISK_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  none: "success", low: "neutral", medium: "warning", high: "danger",
};
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  NEW: "info", UNDER_REVIEW: "warning", AWAITING_CHECKER_REVIEW: "warning",
  SENT_BACK: "danger", APPROVED: "success", REJECTED: "danger",
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff/case/${params.id}`);
    const json = await res.json();
    if (json.lead) setData(json.lead);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    const s = getStoredStaff();
    if (!s) { router.replace("/staff"); return; }
    setStaff(s);
  }, [router]);

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

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

function ActionPanel({
  data, staff, busy, onClaim, onUnderwriterDecision, onApproverDecision,
}: {
  data: CaseDetailData;
  staff: StaffMember;
  busy: boolean;
  onClaim: () => void;
  onUnderwriterDecision: (recommendation: "APPROVE" | "REJECT", notes: string) => void;
  onApproverDecision: (decision: "APPROVED" | "REJECTED" | "SENT_BACK", notes: string) => void;
}) {
  const [notes, setNotes] = useState("");

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
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the approver should know…" />
        <div className="flex gap-2">
          <Button onClick={() => onUnderwriterDecision("APPROVE", notes)} loading={busy} icon={<CheckCircle2 className="h-4 w-4" />}>Recommend approve</Button>
          <Button variant="outline" onClick={() => onUnderwriterDecision("REJECT", notes)} loading={busy} icon={<XCircle className="h-4 w-4" />}>Recommend reject</Button>
        </div>
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onApproverDecision("APPROVED", notes)} loading={busy} icon={<CheckCircle2 className="h-4 w-4" />}>Approve</Button>
          <Button variant="outline" onClick={() => onApproverDecision("REJECTED", notes)} loading={busy} icon={<XCircle className="h-4 w-4" />}>Reject</Button>
          <Button variant="ghost" onClick={() => onApproverDecision("SENT_BACK", notes)} loading={busy} icon={<Undo2 className="h-4 w-4" />}>Send back</Button>
        </div>
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

  const idProof = evidence.find((e) => e.type === "ID_PROOF" && e.mimeType.startsWith("image/"));
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
            {idProof ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/staff/evidence/${idProof.id}`} alt="ID proof" className="h-full w-full object-cover" />
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
