import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * DLP/LOS integration Phase 3 (extended Phase 6 with videoPdSession) —
 * read-only status endpoint for DLP's
 * `workflow-external-worker` to poll. Mirrors the shape of
 * application-onboarding's own `GET /applications/{id}` that DLP's own
 * bridges read (worker.py's `_get_application`) — except this one is
 * called directly at VideoPD's own base URL, not through DLP's Internal
 * Gateway, since VideoPD isn't one of DLP's own registered services in
 * the gateway's routing table. Same "reflect, never decide" discipline as
 * every DLP-side bridge source: this returns Lead.status as-is, computes
 * nothing, and never writes anything.
 *
 * `[id]` is the LoanApplication id — the same id used as `businessKey`
 * when src/lib/dlpWorkflow.ts started this case's Flowable process
 * instance, and the same id DLP's worker resolves a polled job's
 * businessKey back to.
 *
 * No auth — same prototype-grade posture as the rest of this app's API
 * (see README's "Known gaps"). Read-only and non-sensitive enough
 * (workflow status only, no PII) that this is a reasonable seam to leave
 * for later, not a blocker for Phase 3 itself.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const application = await db.loanApplication.findUnique({
    where: { id },
    include: { lead: { include: { videoPdSession: true } } },
  });
  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = application.lead?.videoPdSession ?? null;

  return NextResponse.json({
    applicationId: application.id,
    segment: application.segment,
    applicationStatus: application.status,
    leadId: application.lead?.id ?? null,
    leadStatus: application.lead?.status ?? null,
    underwriterRecommendation: application.lead?.underwriterRecommendation ?? null,
    approverDecision: application.lead?.approverDecision ?? null,
    // Phase 6 — enough for skillfin-videopd-followup-bridge to decide
    // whether an auto-reminder is due, without VideoPD needing to trust
    // the bridge's own sense of elapsed time (all the real timestamps
    // come from here; the bridge only does the "is it due yet" math).
    videoPdSession: session
      ? {
          status: session.status,
          currentStep: session.currentStep,
          linkSentAt: session.linkSentAt,
          startedAt: session.startedAt,
          lastReminderSentAt: session.lastReminderSentAt,
          reminderCount: session.reminderCount,
        }
      : null,
  });
}
