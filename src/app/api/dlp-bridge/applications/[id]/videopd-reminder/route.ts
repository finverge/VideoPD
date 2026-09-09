import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifySkillFinanceVideoPdLink } from "@/lib/dlpNotify";

/**
 * DLP/LOS integration Phase 6 — auto-resend trigger, called by
 * workflow-external-worker's `skillfin-videopd-followup-bridge` when
 * DLP's Flowable boundary timer (attached to the "waiting for the
 * borrower to finish VideoPD" span of the case-lifecycle BPMN process)
 * fires and finds this session still NOT_STARTED well past linkSentAt.
 *
 * Deliberately reuses notifySkillFinanceVideoPdLink (dlpNotify.ts) rather
 * than duplicating link/notification content logic on DLP's Python side
 * — DLP's bridge is a thin trigger ("it's been long enough, go remind
 * them"), VideoPD stays the one place that knows what a reminder message
 * actually says and how to build the link. Same reason
 * src/lib/dlpWorkflow.ts / dlpBre.ts live here and not as duplicated
 * logic in workflow-external-worker.
 *
 * [id] is the LoanApplication id — same convention as the sibling
 * read-only status endpoint. No auth — same prototype-grade posture as
 * the rest of the dlp-bridge surface (see that route's own doc comment).
 *
 * Idempotent/rate-limited: does nothing (200, no-op) if the session has
 * since moved past NOT_STARTED (borrower already started — a reminder
 * would be pointless/confusing) or if a reminder already went out inside
 * the last REMINDER_COOLDOWN_HOURS (guards against a duplicate timer
 * fire, or the boundary timer's own poll cadence being shorter than the
 * threshold it's checking — see worker.py's own bridge for why that's a
 * real possibility, not just defensive paranoia).
 */
const REMINDER_COOLDOWN_HOURS = 24;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const application = await db.loanApplication.findUnique({
    where: { id },
    include: {
      borrower: true,
      lead: { include: { videoPdSession: true } },
    },
  });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = application.lead?.videoPdSession;
  if (!session) {
    return NextResponse.json({ sent: false, reason: "No VideoPD session for this application." });
  }
  if (session.status !== "NOT_STARTED") {
    return NextResponse.json({ sent: false, reason: `Session is already ${session.status} — nothing to remind.` });
  }

  const lastTouch = session.lastReminderSentAt ?? session.linkSentAt;
  const hoursSinceLastTouch = (Date.now() - lastTouch.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastTouch < REMINDER_COOLDOWN_HOURS) {
    return NextResponse.json({
      sent: false,
      reason: `Last reminder/link was ${hoursSinceLastTouch.toFixed(1)}h ago — within the ${REMINDER_COOLDOWN_HOURS}h cooldown.`,
    });
  }

  // Same source as send-videopd-link/route.ts's own origin — the incoming
  // request's own Host, which reflects DLP's videopd_base_url config
  // (config.py) regardless of who's actually calling.
  const origin = req.nextUrl.origin;
  const borrowerName = application.fullName ?? application.borrower.name ?? "";

  await notifySkillFinanceVideoPdLink({
    borrowerName,
    mobile: application.borrower.mobile ?? null,
    email: application.email ?? null,
    videoPdLink: `${origin}/videopd/${session.token}`,
  });

  const updated = await db.videoPdSession.update({
    where: { id: session.id },
    data: { lastReminderSentAt: new Date(), reminderCount: { increment: 1 } },
  });

  return NextResponse.json({ sent: true, reminderCount: updated.reminderCount });
}
