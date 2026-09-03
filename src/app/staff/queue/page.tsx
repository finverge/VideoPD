"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Download, HelpCircle, Inbox, Info, Landmark, LogOut, Search, SlidersHorizontal, Sliders } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";
import { formatINR } from "@/lib/utils";
import type { SegmentCode } from "@/types";

interface CaseListItem {
  id: string;
  status: string;
  riskFlagCount: number;
  riskSeverity: string;
  assignedUnderwriter: string | null;
  approverName: string | null;
  createdAt: string;
  application: {
    fullName: string | null;
    segment: SegmentCode;
    requestedAmount: number | null;
    borrower: { mobile: string };
  };
}

// VIDEOPD_SCHEDULED and VIDEOPD_COMPLETE were missing here — same gap the
// claim endpoint's own comment documents (see api/staff/case/[id]/claim/
// route.ts's CLAIMABLE_STATUSES): a case waiting on/back from VideoPD had no
// way to be filtered to directly, and — worse — silently fell out of the
// "Pending action" count below, so the dashboard could read 0 while cases
// genuinely needed claiming (found live ahead of a demo).
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "AWAITING_CHECKER_REVIEW", label: "Awaiting checker review" },
  { value: "SENT_BACK", label: "Sent back" },
  { value: "VIDEOPD_SCHEDULED", label: "VideoPD link sent" },
  { value: "VIDEOPD_COMPLETE", label: "VideoPD complete — ready to claim" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const SEGMENT_OPTIONS = [
  { value: "", label: "All segments" },
  { value: "FARMER", label: "Farmer" },
  { value: "VOCATIONAL_STUDENT", label: "Vocational student" },
  { value: "BUSINESS_OWNER", label: "Business owner" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  NEW: "info",
  UNDER_REVIEW: "warning",
  AWAITING_CHECKER_REVIEW: "warning",
  SENT_BACK: "danger",
  VIDEOPD_SCHEDULED: "info",
  VIDEOPD_COMPLETE: "warning", // ready to claim — same "needs someone's attention" weight as UNDER_REVIEW/AWAITING_CHECKER_REVIEW
  APPROVED: "success",
  REJECTED: "danger",
};

const RISK_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  none: "success",
  low: "neutral",
  medium: "warning",
  high: "danger",
};

export default function StaffQueuePage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [segment, setSegment] = useState("");
  const [search, setSearch] = useState("");
  // Reported live: an Approver picking "All statuses" from the dropdown
  // saw no change at all — its value is the same empty string the page
  // starts on, so there was no way to tell "never touched the filter" apart
  // from "deliberately chose to see everything." The role-based default
  // below used the untouched-empty-string case for both, meaning an
  // Approver could never actually see NEW/VIDEOPD_COMPLETE cases through
  // this dropdown no matter what they picked — despite this file's own
  // comment claiming "everyone can still see everything via the status
  // dropdown." This makes that claim true: only an actual onChange (any
  // value, including re-selecting "All statuses") counts as "touched."
  const [statusTouched, setStatusTouched] = useState(false);

  useEffect(() => {
    const s = getStoredStaff();
    if (!s) {
      router.replace("/staff");
      return;
    }
    setStaff(s);
  }, [router]);

  useEffect(() => {
    if (!staff) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (segment) params.set("segment", segment);
    if (search) params.set("search", search);
    fetch(`/api/staff/cases?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setCases(data.leads ?? []))
      .finally(() => setLoading(false));
  }, [staff, status, segment, search]);

  // Underwriters primarily work NEW/SENT_BACK/their own UNDER_REVIEW cases;
  // approvers work AWAITING_CHECKER_REVIEW. Not a hard filter — everyone can
  // still see everything via the status dropdown — just a helpful default,
  // gone the moment the dropdown's been touched at all (statusTouched),
  // not just when it holds a non-empty value — see that state's own
  // comment for why the distinction matters.
  const defaultFiltered = useMemo(() => {
    if (statusTouched) return cases;
    if (!staff) return cases;
    if (staff.role === "APPROVER") {
      return cases.filter((c) => ["AWAITING_CHECKER_REVIEW", "APPROVED", "REJECTED"].includes(c.status));
    }
    return cases;
  }, [cases, statusTouched, staff]);
  const hiddenByDefault = cases.length - defaultFiltered.length;

  const counts = useMemo(() => {
    const total = cases.length;
    // VIDEOPD_COMPLETE is genuinely pending action (ready to claim) — VIDEOPD_SCHEDULED
    // is a softer "waiting on the borrower" state but still counts, since an underwriter
    // can claim and start reviewing before VideoPD finishes (see claim route's own note).
    const pending = cases.filter((c) => ["NEW", "UNDER_REVIEW", "AWAITING_CHECKER_REVIEW", "SENT_BACK", "VIDEOPD_SCHEDULED", "VIDEOPD_COMPLETE"].includes(c.status)).length;
    const highRisk = cases.filter((c) => c.riskSeverity === "high").length;
    return { total, pending, highRisk };
  }, [cases]);

  if (!staff) return null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-6 sm:px-6 sm:py-8">
      {/* flex-col on mobile — four right-side items (name, role, question
          bank, sign out) don't fit in one nowrap row at 375px; they
          overflowed past the viewport edge. See case detail page's header
          for the same fix. */}
      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Landmark className="h-5 w-5 shrink-0 text-white" />
          <div>
            <p className="text-sm font-bold text-white">Underwriter Workspace</p>
            <p className="text-[11px] font-medium text-ink-300">Lakshya Skill Finance</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-200">
          <span className="font-semibold text-white">{staff.name}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-bold uppercase tracking-wide">{staff.role}</span>
          {/* Header chrome is always dark navy regardless of site theme, so
              the toggle gets the header's own translucent-pill look rather
              than its default light/dark card styling. */}
          <ThemeToggle className="h-8 w-8 rounded-full border-white/20 bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white dark:border-white/20 dark:bg-transparent dark:text-white dark:hover:bg-white/10 dark:hover:text-white" />
          <button
            onClick={() => router.push("/staff/questions")}
            className="flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-white/10"
          >
            <HelpCircle className="h-3 w-3" /> Question bank
          </button>
          <button
            onClick={() => router.push("/staff/risk-parameters")}
            className="flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-white/10"
          >
            <Sliders className="h-3 w-3" /> Risk parameters
          </button>
          {/* Bulk handoff for whatever system actually owns eMandate/loan
              account opening/disbursement — the BRD treats all of that as
              existing infrastructure outside this program's scope (see
              docs/videopd-future-work.md), so a CSV extract of approved
              cases is the practical bridge rather than a real integration. */}
          <a
            href="/api/staff/cases/export"
            className="flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-white/10"
          >
            <Download className="h-3 w-3" /> Export approved (CSV)
          </a>
          <button
            onClick={() => {
              clearStoredStaff();
              router.push("/staff");
            }}
            className="flex items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-white/10"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatCard label="Total cases" value={counts.total} />
        <StatCard label="Pending action" value={counts.pending} />
        <StatCard label="High risk" value={counts.highRisk} tone="danger" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-ink-400" />
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or mobile…"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setStatusTouched(true); }} className="h-9 w-auto text-sm">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select value={segment} onChange={(e) => setSegment(e.target.value)} className="h-9 w-auto text-sm">
          {SEGMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      {/* Reported live: the stat cards above always count every case, but
          this table quietly doesn't show all of them for an Approver by
          default — "Total cases: 7, Pending action: 3" with only 4 rows
          visible read as broken/inconsistent, with nothing on screen
          explaining why. This makes the gap visible and gives a one-click
          way out, rather than requiring the Approver to already know to
          fiddle with the status dropdown. */}
      {hiddenByDefault > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-2.5 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
          <Info className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          <span>
            Showing {defaultFiltered.length} of {cases.length} cases — {hiddenByDefault} more {hiddenByDefault === 1 ? "is" : "are"} still with an underwriter or unclaimed, hidden from your default Approver view.
          </span>
          <button
            type="button"
            onClick={() => setStatusTouched(true)}
            className="font-semibold text-sprout-600 underline underline-offset-2 hover:text-sprout-700 dark:text-sprout-400"
          >
            Show all cases
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-xs font-bold uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <th className="px-4 py-3">Applicant</th>
              <th className="px-4 py-3">Segment</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assigned</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-400">Loading…</td>
              </tr>
            ) : defaultFiltered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                  <Inbox className="mx-auto mb-2 h-6 w-6" />
                  No cases match these filters.
                </td>
              </tr>
            ) : (
              defaultFiltered.map((c, i) => (
                <motion.tr
                  key={c.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  onClick={() => router.push(`/staff/case/${c.id}`)}
                  className="cursor-pointer border-b border-ink-50 transition-colors last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/30"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink-900 dark:text-white">{c.application.fullName || "—"}</p>
                    <p className="text-xs text-ink-400">{c.application.borrower.mobile}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{c.application.segment.replace("_", " ")}</td>
                  <td className="px-4 py-3 font-semibold text-ink-900 dark:text-white">{formatINR(c.application.requestedAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={RISK_TONE[c.riskSeverity] ?? "neutral"}>{c.riskSeverity}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500 dark:text-ink-400">
                    {/* Terminal states show who made the final call; anything still in
                        motion shows the current underwriter — an approverName from an
                        earlier send-back round would otherwise read as "still with them". */}
                    {c.status === "APPROVED" || c.status === "REJECTED"
                      ? c.approverName ?? "Unassigned"
                      : c.assignedUnderwriter ?? "Unassigned"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone === "danger" ? "text-red-500" : "text-ink-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}
