import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { LeadStatus } from "@prisma/client";
import type { SegmentCode } from "@/types";
import { startSkillFinanceCase } from "@/lib/dlpWorkflow";

// VIDEOPD_SCHEDULED and VIDEOPD_COMPLETE were missing here — sending a
// VideoPD link (which moves a case to VIDEOPD_SCHEDULED) permanently took
// it out of the claimable set, and completing VideoPD never put it back in
// (found live: a case sat with an empty Action panel forever once a link
// was sent, since nothing could ever claim it again, whether or not the
// borrower ever finished). An underwriter can claim at any pre-decision
// point, including while VideoPD is still in progress — there's no reason
// to force them to wait.
const CLAIMABLE_STATUSES: LeadStatus[] = ["NEW", "SENT_BACK", "VIDEOPD_SCHEDULED", "VIDEOPD_COMPLETE"];

// Underwriter claims a case before working it — same "who's on this" signal
// as a real queue, and it's what unlocks the recommendation form client-side.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staffName } = (await req.json()) as { staffName?: string };
  if (!staffName) return NextResponse.json({ error: "staffName is required." }, { status: 400 });

  // Atomic: the status check happens *inside* the same write the old
  // separate findUnique-then-update left a gap for — confirmed reproducible,
  // two concurrent claims on one NEW case both got a 200 with their own name
  // as assignedUnderwriter, even though only the later write actually
  // persisted (the earlier caller's "success" response was already a lie by
  // the time it arrived). updateMany's affected-row count tells us whether
  // this request actually won the race, not just what the status looked
  // like a moment before the write.
  const result = await db.lead.updateMany({
    where: { id, status: { in: CLAIMABLE_STATUSES } },
    data: { status: "UNDER_REVIEW", assignedUnderwriter: staffName },
  });

  if (result.count === 0) {
    const lead = await db.lead.findUnique({ where: { id } });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: `Case is not claimable in status ${lead.status}.` }, { status: 409 });
  }

  // DLP/LOS integration Phase 3 — self-healing backfill: an application
  // submitted while DLP's Flowable was unreachable never got a process
  // instance started (submit/route.ts's own graceful degradation — a
  // null workflowProcessInstanceId never blocked that submission), and
  // nothing was retrying it afterwards. Claim is the one choke-point
  // every case passes through before any underwriter/approver work
  // happens on it, so this is where "every application genuinely tracks
  // in DLP's workflow, not just ones submitted while Flowable happened to
  // be up" gets enforced, without needing a separate background job.
  // Still purely best-effort/non-blocking: startSkillFinanceCase already
  // degrades to null on failure rather than throwing, and Lead.status
  // (already committed above) remains this app's real source of truth
  // either way — a claim never fails or waits on this.
  const updated = await db.lead.findUniqueOrThrow({ where: { id }, include: { application: true } });
  if (!updated.application.workflowProcessInstanceId) {
    const workflowProcessInstanceId = await startSkillFinanceCase(
      updated.applicationId,
      updated.application.segment as SegmentCode,
    );
    if (workflowProcessInstanceId) {
      await db.loanApplication.update({
        where: { id: updated.applicationId },
        data: { workflowProcessInstanceId },
      });
    }
  }

  return NextResponse.json({ lead: updated });
}
