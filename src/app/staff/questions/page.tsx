"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Archive,
  CheckCircle2,
  ChevronDown,
  Landmark,
  Loader2,
  LogOut,
  Pencil,
  Plus,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";
import { useTenantConfig } from "@/lib/TenantConfigProvider";
import { cn } from "@/lib/utils";
import type { SegmentCode } from "@/types";

interface QuestionRow {
  id: string;
  segment: SegmentCode;
  key: string;
  orderIndex: number;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  promptEn: string;
  promptHi: string | null;
  promptTe: string | null;
  promptTa: string | null;
  promptKn: string | null;
  promptMl: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

const SEGMENTS: { value: SegmentCode; label: string }[] = [
  { value: "FARMER", label: "Farmer" },
  { value: "VOCATIONAL_STUDENT", label: "Vocational student" },
  { value: "BUSINESS_OWNER", label: "Business owner" },
];

const LANG_FIELDS: { field: keyof QuestionRow; label: string }[] = [
  { field: "promptHi", label: "Hindi" },
  { field: "promptTe", label: "Telugu" },
  { field: "promptTa", label: "Tamil" },
  { field: "promptKn", label: "Kannada" },
  { field: "promptMl", label: "Malayalam" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  DRAFT: "warning", APPROVED: "success", ARCHIVED: "neutral",
};

export default function QuestionsAdminPage() {
  const router = useRouter();
  const brand = useTenantConfig();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [segmentFilter, setSegmentFilter] = useState<SegmentCode>("FARMER");
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/staff/questions?segment=${segmentFilter}`);
    const data = await res.json();
    setQuestions(data.questions ?? []);
    setLoading(false);
  }, [segmentFilter]);

  useEffect(() => {
    const s = getStoredStaff();
    if (!s) { router.replace("/staff"); return; }
    setStaff(s);
  }, [router]);

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

  if (!staff) return null;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-6 sm:px-6 sm:py-8">
      {/* flex-col on mobile — see case detail page's header for the same fix. */}
      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/staff/queue")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Landmark className="h-5 w-5 shrink-0 text-white" />
          <div>
            <p className="text-sm font-bold text-white">VideoPD Question Bank</p>
            <p className="text-[11px] font-medium text-ink-300">{brand.displayName}</p>
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

      <p className="mb-5 text-sm text-ink-500 dark:text-ink-400">
        Skill & Intent Q&A shown to borrowers during VideoPD (BR-24, BR-43). Any staff member can draft a question — an
        <strong> Approver</strong> must review and approve it before it goes live. Editing an approved question sends it back to draft.
      </p>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSegmentFilter(s.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                segmentFilter === s.value ? "bg-white text-ink-900 shadow-soft dark:bg-ink-900 dark:text-white" : "text-ink-500 hover:text-ink-700 dark:text-ink-400"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowAddForm((v) => !v)} icon={<Plus className="h-3.5 w-3.5" />}>
          Draft new question
        </Button>
      </div>

      <AnimatePresence>
        {showAddForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-5 overflow-hidden">
            <AddQuestionForm
              staff={staff}
              defaultSegment={segmentFilter}
              onCreated={() => { setShowAddForm(false); load(); }}
              onError={setError}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-4 flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </motion.p>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>
      ) : questions.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-400">No questions yet for this segment.</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionCard key={q.id} question={q} staff={staff} onChanged={load} onError={setError} />
          ))}
        </div>
      )}
    </main>
  );
}

function AddQuestionForm({
  staff, defaultSegment, onCreated, onError,
}: {
  staff: StaffMember; defaultSegment: SegmentCode; onCreated: () => void; onError: (e: string | null) => void;
}) {
  const [segment, setSegment] = useState<SegmentCode>(defaultSegment);
  const [key, setKey] = useState("");
  const [promptEn, setPromptEn] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    onError(null);
    if (!key.trim() || !promptEn.trim()) { onError("Both a key and an English prompt are required."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/staff/questions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffName: staff.name, segment, key: key.trim(), promptEn: promptEn.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setKey(""); setPromptEn("");
      onCreated();
    } catch (e: any) {
      onError(e.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-400">New question (draft)</p>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Segment" value={segment} onChange={(e) => setSegment(e.target.value as SegmentCode)}>
          {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <Input label="Key" hint="Stable identifier, e.g. cropCycle" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. irrigationPlan" />
      </div>
      <Textarea label="Prompt (English)" hint="Auto-translated into the other 5 languages on save — review and edit before approving." value={promptEn} onChange={(e) => setPromptEn(e.target.value)} placeholder="What would you ask the borrower?" />
      <Button className="mt-3" loading={saving} onClick={submit} icon={<Plus className="h-4 w-4" />}>Create draft</Button>
    </Card>
  );
}

function QuestionCard({
  question, staff, onChanged, onError,
}: {
  question: QuestionRow; staff: StaffMember; onChanged: () => void; onError: (e: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(question);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(question), [question]);

  async function save() {
    onError(null);
    setBusy(true);
    try {
      // Only the English prompt is ever sent — the other 5 languages are
      // never directly editable here (see this endpoint's own doc comment
      // for why); the server re-translates and overwrites them from
      // whatever promptEn ends up being.
      const res = await fetch(`/api/staff/questions/${question.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptEn: draft.promptEn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setEditing(false);
      onChanged();
    } catch (e: any) {
      onError(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    onError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/staff/questions/${question.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffName: staff.name, staffRole: staff.role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      onChanged();
    } catch (e: any) {
      onError(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    onError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/staff/questions/${question.id}/archive`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      onChanged();
    } catch (e: any) {
      onError(e.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={STATUS_TONE[question.status]}>{question.status}</Badge>
            <span className="text-[11px] text-ink-400">key: {question.key}</span>
          </div>
          <p className="font-semibold text-ink-900 dark:text-white">{question.promptEn}</p>
          {question.approvedBy && (
            <p className="mt-1 text-[11px] text-ink-400">Approved by {question.approvedBy}</p>
          )}
          {question.createdBy && !question.approvedBy && (
            <p className="mt-1 text-[11px] text-ink-400">Drafted by {question.createdBy}</p>
          )}
        </div>
        <button onClick={() => setExpanded((v) => !v)} className="shrink-0 rounded-full p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 space-y-3 border-t border-ink-100 pt-4 dark:border-ink-800">
              {editing ? (
                <>
                  {/* Only English is ever hand-edited here — reported live:
                      exposing all 6 language fields as free-text let staff
                      who mostly can't read Hindi/Telugu/Tamil/Kannada/
                      Malayalam edit those directly, with nothing to stop a
                      translation quietly drifting from the English prompt
                      it's supposed to match. The other 5 are re-derived
                      from whatever's saved here (api/staff/questions/[id]/
                      route.ts), same as a brand-new question already
                      works — shown read-only below so staff can still
                      review what will go live, just not hand-edit it. */}
                  <Textarea label="Prompt (English)" hint="Saving re-translates the other 5 languages from this text." value={draft.promptEn} onChange={(e) => setDraft({ ...draft, promptEn: e.target.value })} />
                  <div className="space-y-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                    <p className="text-[11px] font-semibold text-ink-400">Auto-translated on save — not directly editable</p>
                    {LANG_FIELDS.map(({ field, label }) => (
                      <div key={field}>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
                        <p className={cn("text-sm", question[field] ? "text-ink-700 dark:text-ink-200" : "italic text-amber-600 dark:text-amber-400")}>
                          {(question[field] as string) || "Not translated yet."}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" loading={busy} onClick={save}>Save changes</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setDraft(question); setEditing(false); }}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  {LANG_FIELDS.map(({ field, label }) => (
                    <div key={field}>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
                      <p className={cn("text-sm", question[field] ? "text-ink-700 dark:text-ink-200" : "italic text-amber-600 dark:text-amber-400")}>
                        {(question[field] as string) || "Not translated — edit to add manually."}
                      </p>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                    {question.status !== "APPROVED" && question.status !== "ARCHIVED" && (
                      <Button
                        size="sm"
                        loading={busy}
                        disabled={staff.role !== "APPROVER"}
                        onClick={approve}
                        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                      >
                        {staff.role === "APPROVER" ? "Approve" : "Approver only"}
                      </Button>
                    )}
                    {question.status !== "ARCHIVED" && (
                      <Button size="sm" variant="ghost" loading={busy} onClick={archive} icon={<Archive className="h-3.5 w-3.5" />}>Archive</Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
