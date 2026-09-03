"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Boxes, CheckCircle2, Clock3, Loader2, LogOut, Plus, Send, ShieldCheck, X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { getStoredStaff, clearStoredStaff, type StaffMember } from "@/lib/staffAuth";
import {
  ASSET_DETECTION_CATEGORIES, ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT,
} from "@/lib/assetDetectionCategories";
import type { SegmentCode } from "@/types";

const SEGMENTS: { value: SegmentCode; label: string }[] = [
  { value: "FARMER", label: "Farmer" },
  { value: "VOCATIONAL_STUDENT", label: "Vocational student" },
  { value: "BUSINESS_OWNER", label: "Business owner" },
];

interface SegmentSettingsData {
  segment: SegmentCode;
  categoriesJson: string | null;
  weightsJson: string | null;
  manualItemsJson: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface ScorecardRevision {
  id: string;
  segment: SegmentCode;
  categoriesJson: string;
  weightsJson: string;
  manualItemsJson: string;
  proposedBy: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface CategoryRequestData {
  id: string;
  segment: SegmentCode;
  label: string;
  requestedBy: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

function parseArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function parseWeights(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Asset Scorecard — everything about the work-premises asset checklist's
// CONTENT (which categories, what they're worth, what the underwriter
// manually confirms) lives here, separate from Risk Parameters, and goes
// through maker-checker: any staff member can propose a full revision,
// but a DIFFERENT Approver must approve it before it becomes the live
// configuration runVoiceCheck.ts actually uses — enforced server-side in
// decideScorecardRevision (src/lib/assetScorecardRevisions.ts), not just
// a role check, so a single Approver account can't both propose and
// approve their own change. The on/off switch for the check itself stays
// on /staff/risk-parameters (app-wide, not a content decision).
export default function AssetScorecardPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [segment, setSegment] = useState<SegmentCode>("FARMER");

  const [live, setLive] = useState<SegmentSettingsData | null>(null);
  const [revisions, setRevisions] = useState<ScorecardRevision[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/staff/asset-scorecard?segment=${segment}`);
    const json = await res.json();
    setLive(json.settings);
    setRevisions(json.revisions ?? []);
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

  // Draft state — a fresh working copy the staff member edits, always
  // re-synced from the LIVE config whenever it or the segment changes, so
  // "propose a revision" starts from what's actually running, not from
  // whatever was left over from a previous segment tab.
  const [categoryDraft, setCategoryDraft] = useState<Set<string>>(new Set());
  const [manualItemDraft, setManualItemDraft] = useState<Set<string>>(new Set());
  const [weightsDraft, setWeightsDraft] = useState<Record<string, number>>({});
  const [proposeNote, setProposeNote] = useState("");
  useEffect(() => {
    if (!live) return;
    const categories = parseArray(live.categoriesJson);
    setCategoryDraft(new Set(categories.length ? categories : ASSET_DETECTION_CATEGORIES));
    const manualItems = parseArray(live.manualItemsJson);
    setManualItemDraft(new Set(manualItems.length ? manualItems : (ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT[segment] ?? [])));
    setWeightsDraft(parseWeights(live.weightsJson));
    setProposeNote("");
  }, [live, segment]);

  function toggleCategory(c: string) {
    setCategoryDraft((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });
  }
  function toggleManualItem(item: string) {
    setManualItemDraft((prev) => { const n = new Set(prev); n.has(item) ? n.delete(item) : n.add(item); return n; });
  }
  const [newManualItem, setNewManualItem] = useState("");
  function addManualItem() {
    const label = newManualItem.trim().toLowerCase();
    if (!label) return;
    setManualItemDraft((prev) => new Set(prev).add(label));
    setWeightsDraft((prev) => (label in prev ? prev : { ...prev, [label]: 1 }));
    setNewManualItem("");
  }
  function setWeight(label: string, value: number) {
    setWeightsDraft((prev) => ({ ...prev, [label]: value }));
  }

  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);
  async function proposeRevision() {
    if (!staff) return;
    setProposeError(null);
    setProposing(true);
    setProposed(false);
    try {
      const res = await fetch("/api/staff/asset-scorecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment, staffName: staff.name,
          categories: Array.from(categoryDraft),
          manualItems: Array.from(manualItemDraft),
          weights: weightsDraft,
          note: proposeNote,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setProposed(true);
      setTimeout(() => setProposed(false), 2500);
      await load();
    } catch (e: any) {
      setProposeError(e.message ?? "Something went wrong.");
    } finally {
      setProposing(false);
    }
  }

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  async function decideRevision(id: string, decision: "APPROVED" | "REJECTED") {
    if (!staff) return;
    setDecideError(null);
    setDecidingId(id);
    try {
      const res = await fetch(`/api/staff/asset-scorecard/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffName: staff.name, staffRole: staff.role, decision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await load();
    } catch (e: any) {
      setDecideError(e.message ?? "Something went wrong.");
    } finally {
      setDecidingId(null);
    }
  }

  // Individual custom-category quick-add — a lighter-weight sibling to a
  // full revision, for "I just want to suggest ONE new object name," same
  // maker-checker separation (server blocks self-approval too — see
  // api/staff/asset-detection-category-requests/[id]/route.ts).
  const [categoryRequests, setCategoryRequests] = useState<CategoryRequestData[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [newRequestLabel, setNewRequestLabel] = useState("");
  const [newRequestNote, setNewRequestNote] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);

  const loadCategoryRequests = useCallback(async () => {
    setRequestsLoading(true);
    const res = await fetch(`/api/staff/asset-detection-category-requests?segment=${segment}`);
    const json = await res.json();
    setCategoryRequests(json.requests ?? []);
    setRequestsLoading(false);
  }, [segment]);

  useEffect(() => {
    if (staff) loadCategoryRequests();
  }, [staff, loadCategoryRequests]);

  async function submitCategoryRequest() {
    if (!staff || !newRequestLabel.trim()) return;
    setRequestError(null);
    setRequestSubmitting(true);
    try {
      const res = await fetch("/api/staff/asset-detection-category-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment, staffName: staff.name, label: newRequestLabel, note: newRequestNote }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setNewRequestLabel("");
      setNewRequestNote("");
      await loadCategoryRequests();
    } catch (e: any) {
      setRequestError(e.message ?? "Something went wrong.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  async function decideCategoryRequest(id: string, decision: "APPROVED" | "REJECTED") {
    if (!staff) return;
    setRequestError(null);
    setDecidingRequestId(id);
    try {
      const res = await fetch(`/api/staff/asset-detection-category-requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffName: staff.name, staffRole: staff.role, decision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await loadCategoryRequests();
      if (decision === "APPROVED") await load();
    } catch (e: any) {
      setRequestError(e.message ?? "Something went wrong.");
    } finally {
      setDecidingRequestId(null);
    }
  }

  if (!staff) return null;

  const liveCategories = live ? parseArray(live.categoriesJson) : [];
  const liveManualItems = live ? parseArray(live.manualItemsJson) : [];
  const pendingRevisions = revisions.filter((r) => r.status === "PENDING");
  const decidedRevisions = revisions.filter((r) => r.status !== "PENDING");

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/staff/risk-parameters")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Boxes className="h-5 w-5 shrink-0 text-white" />
          <div>
            <p className="text-sm font-bold text-white">Asset Scorecard</p>
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
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Any staff member can propose a scorecard change below; it only goes live once a <strong>different</strong> Approver
          reviews and approves it — maker-checker, enforced server-side, not just a role check. The on/off switch for the
          asset checklist itself is on Risk Parameters; this page only controls its content and scoring.
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

      {loading || !live ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>
      ) : (
        <>
          {/* Live, read-only summary */}
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-sprout-600 dark:text-sprout-400" />
              <p className="text-sm font-bold text-ink-900 dark:text-white">Currently live</p>
            </div>
            <p className="mb-3 text-xs text-ink-400">
              {liveCategories.length} AI categories, {liveManualItems.length} manual reference items.
              {live.updatedBy ? ` Last approved by ${live.updatedBy} on ${new Date(live.updatedAt).toLocaleString()}.` : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[...liveCategories, ...liveManualItems].map((label) => (
                <span key={label} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium capitalize text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                  {label}
                </span>
              ))}
              {liveCategories.length === 0 && liveManualItems.length === 0 && (
                <p className="text-xs text-ink-400">Nothing live yet for this segment.</p>
              )}
            </div>
          </Card>

          {/* Pending revisions needing a decision */}
          {pendingRevisions.length > 0 && (
            <Card className="mt-5">
              <div className="mb-2 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-bold text-ink-900 dark:text-white">Pending your review</p>
              </div>
              <div className="space-y-3">
                {pendingRevisions.map((r) => {
                  const cats = parseArray(r.categoriesJson);
                  const items = parseArray(r.manualItemsJson);
                  const weights = parseWeights(r.weightsJson);
                  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
                  const isOwnProposal = r.proposedBy === staff.name;
                  return (
                    <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/10">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                          {cats.length} categories · {items.length} manual items · weights sum {totalWeight}
                        </p>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">Pending</span>
                      </div>
                      {r.note && <p className="mb-1 text-xs text-ink-500 dark:text-ink-400">{r.note}</p>}
                      <p className="mb-2 text-[11px] text-ink-400">Proposed by {r.proposedBy} on {new Date(r.createdAt).toLocaleString()}</p>
                      {staff.role === "APPROVER" ? (
                        isOwnProposal ? (
                          <p className="text-xs italic text-ink-400">You proposed this — a different Approver needs to review it.</p>
                        ) : (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => decideRevision(r.id, "APPROVED")}
                              disabled={decidingId === r.id}
                              className="flex items-center gap-1 rounded-full border border-sprout-200 px-2.5 py-1 text-[11px] font-semibold text-sprout-700 transition-colors hover:bg-sprout-50 disabled:opacity-50 dark:border-sprout-900 dark:text-sprout-400 dark:hover:bg-sprout-950/20"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Approve &amp; go live
                            </button>
                            <button
                              onClick={() => decideRevision(r.id, "REJECTED")}
                              disabled={decidingId === r.id}
                              className="flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 text-[11px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
                            >
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        )
                      ) : (
                        <p className="text-xs italic text-ink-400">Approver only.</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {decideError && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {decideError}
                </p>
              )}
            </Card>
          )}

          {/* Propose a revision */}
          <Card className="mt-5">
            <p className="mb-1 text-sm font-bold text-ink-900 dark:text-white">Propose a change</p>
            <p className="mb-4 text-xs text-ink-400">
              Edit the checklist below, then submit for a different Approver to review. Nothing here takes effect
              until it's approved.
            </p>

            <p className="mb-1.5 text-xs font-semibold text-ink-600 dark:text-ink-300">AI categories ({categoryDraft.size} of {ASSET_DETECTION_CATEGORIES.length})</p>
            <div className="mb-1.5 flex gap-1.5">
              <button onClick={() => setCategoryDraft(new Set(ASSET_DETECTION_CATEGORIES))} className="rounded-full border border-ink-200 px-2.5 py-1 text-[11px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800">Select all</button>
              <button onClick={() => setCategoryDraft(new Set())} className="rounded-full border border-ink-200 px-2.5 py-1 text-[11px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800">Clear all</button>
            </div>
            <div className="mb-4 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-ink-100 p-3 dark:border-ink-800">
              {ASSET_DETECTION_CATEGORIES.map((category) => {
                const selected = categoryDraft.has(category);
                return (
                  <button
                    key={category}
                    onClick={() => toggleCategory(category)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                      selected
                        ? "border-sprout-500 bg-sprout-50 text-sprout-700 dark:border-sprout-500 dark:bg-sprout-950/30 dark:text-sprout-400"
                        : "border-ink-200 text-ink-400 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                    )}
                  >
                    {category}
                  </button>
                );
              })}
            </div>

            <p className="mb-1.5 text-xs font-semibold text-ink-600 dark:text-ink-300">Manual reference items (not AI-detectable)</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {Array.from(new Set([...(ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT[segment] ?? []), ...manualItemDraft])).map((item) => {
                const selected = manualItemDraft.has(item);
                return (
                  <button
                    key={item}
                    onClick={() => toggleManualItem(item)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                      selected
                        ? "border-sprout-500 bg-sprout-50 text-sprout-700 dark:border-sprout-500 dark:bg-sprout-950/30 dark:text-sprout-400"
                        : "border-ink-200 text-ink-400 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                    )}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <div className="mb-4 flex items-center gap-2">
              <Input placeholder="Add a custom item, e.g. flour mill" value={newManualItem} onChange={(e) => setNewManualItem(e.target.value)} className="flex-1" />
              <Button onClick={addManualItem} disabled={!newManualItem.trim()} icon={<Plus className="h-4 w-4" />} variant="secondary">Add</Button>
            </div>

            <p className="mb-1.5 text-xs font-semibold text-ink-600 dark:text-ink-300">Score weights</p>
            <p className="mb-2 text-xs text-ink-400">
              Point value each selected item contributes when present (AI-detected or manually ticked) — an
              admin-set rubric, not a validated asset valuation.
            </p>
            <div className="mb-4 grid max-h-64 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-xl border border-ink-100 p-3 sm:grid-cols-3 dark:border-ink-800">
              {Array.from(new Set([...categoryDraft, ...manualItemDraft])).sort().map((label) => (
                <div key={label} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="truncate text-xs capitalize text-ink-600 dark:text-ink-300" title={label}>{label}</span>
                  <input
                    type="number"
                    step={1}
                    value={weightsDraft[label] ?? 1}
                    onChange={(e) => setWeight(label, Number(e.target.value))}
                    className="w-14 shrink-0 rounded-lg border border-ink-200 bg-white px-1.5 py-0.5 text-right text-xs text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                  />
                </div>
              ))}
              {categoryDraft.size === 0 && manualItemDraft.size === 0 && (
                <p className="col-span-full text-xs text-ink-400">No items selected — nothing to weight.</p>
              )}
            </div>

            <Textarea label="Note for the reviewer (optional)" placeholder="Why this change?" value={proposeNote} onChange={(e) => setProposeNote(e.target.value)} />

            <div className="mt-3 flex items-center gap-3">
              <Button onClick={proposeRevision} loading={proposing} icon={proposed ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}>
                {proposed ? "Submitted" : "Submit for approval"}
              </Button>
              {proposeError && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {proposeError}
                </p>
              )}
            </div>
          </Card>

          {/* Custom-category quick-add (single item, its own lightweight
              request/approve — see the model's schema doc comment for why
              approving one doesn't make it detectable). */}
          <Card className="mt-5">
            <p className="mb-1 text-sm font-bold text-ink-900 dark:text-white">Requested categories</p>
            <p className="mb-3 text-xs text-ink-400">
              Not on the list above? Suggest a single object name here without a full scorecard revision — an
              Approver (not you) still signs off. <strong>Important:</strong> the detector only ever recognizes the
              fixed 80 categories above (a general-purpose model, not trained on this lender's premises types) —
              approving a request records it for the checklist and for whoever scopes a future, purpose-built
              model, but it does <strong>not</strong> make that object actually detectable today.
            </p>

            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start">
              <Input label="Object name" placeholder="e.g. sewing machine" value={newRequestLabel} onChange={(e) => setNewRequestLabel(e.target.value)} className="sm:w-48" />
              <Input label="Note (optional)" placeholder="Why this would help" value={newRequestNote} onChange={(e) => setNewRequestNote(e.target.value)} className="flex-1" />
              <Button onClick={submitCategoryRequest} disabled={!newRequestLabel.trim()} loading={requestSubmitting} icon={<Plus className="h-4 w-4" />} variant="secondary" className="sm:mt-5">
                Request
              </Button>
            </div>
            {requestError && (
              <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-red-500">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {requestError}
              </p>
            )}

            {requestsLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-sprout-500" /></div>
            ) : categoryRequests.length === 0 ? (
              <p className="text-xs text-ink-400">No requests yet for this segment.</p>
            ) : (
              <div className="space-y-2">
                {categoryRequests.map((r) => {
                  const isOwnRequest = r.requestedBy === staff.name;
                  return (
                    <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold capitalize text-ink-800 dark:text-ink-100">{r.label}</p>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              r.status === "PENDING" && "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
                              r.status === "APPROVED" && "bg-sprout-100 text-sprout-700 dark:bg-sprout-950/30 dark:text-sprout-400",
                              r.status === "REJECTED" && "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400"
                            )}
                          >
                            {r.status}
                          </span>
                        </div>
                        {r.note && <p className="mt-0.5 text-xs text-ink-400">{r.note}</p>}
                        <p className="mt-0.5 text-[11px] text-ink-300 dark:text-ink-600">
                          Requested by {r.requestedBy}
                          {r.decidedBy && r.status !== "PENDING" ? ` · ${r.status === "APPROVED" ? "approved" : "rejected"} by ${r.decidedBy}` : ""}
                        </p>
                      </div>
                      {r.status === "PENDING" && (
                        staff.role === "APPROVER" ? (
                          isOwnRequest ? (
                            <p className="shrink-0 text-xs italic text-ink-400">Needs another Approver</p>
                          ) : (
                            <div className="flex shrink-0 gap-1.5">
                              <button
                                onClick={() => decideCategoryRequest(r.id, "APPROVED")}
                                disabled={decidingRequestId === r.id}
                                className="flex items-center gap-1 rounded-full border border-sprout-200 px-2.5 py-1 text-[11px] font-semibold text-sprout-700 transition-colors hover:bg-sprout-50 disabled:opacity-50 dark:border-sprout-900 dark:text-sprout-400 dark:hover:bg-sprout-950/20"
                              >
                                <CheckCircle2 className="h-3 w-3" /> Approve
                              </button>
                              <button
                                onClick={() => decideCategoryRequest(r.id, "REJECTED")}
                                disabled={decidingRequestId === r.id}
                                className="flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 text-[11px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
                              >
                                <X className="h-3 w-3" /> Reject
                              </button>
                            </div>
                          )
                        ) : null
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Revision history */}
          {decidedRevisions.length > 0 && (
            <Card className="mt-5">
              <p className="mb-3 text-sm font-bold text-ink-900 dark:text-white">Revision history</p>
              <div className="space-y-2">
                {decidedRevisions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3 text-xs dark:border-ink-800">
                    <div>
                      <p className="text-ink-600 dark:text-ink-300">
                        {parseArray(r.categoriesJson).length} categories · {parseArray(r.manualItemsJson).length} manual items
                      </p>
                      <p className="text-ink-300 dark:text-ink-600">
                        Proposed by {r.proposedBy} · {r.status.toLowerCase()} by {r.decidedBy} on {r.decidedAt ? new Date(r.decidedAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        r.status === "APPROVED" && "bg-sprout-100 text-sprout-700 dark:bg-sprout-950/30 dark:text-sprout-400",
                        r.status === "REJECTED" && "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400"
                      )}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
