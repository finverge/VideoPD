/**
 * DLP/LOS integration Phase 6 — "how will the underwriter be notified if
 * the borrower's VideoPD session drops or stalls" (the gap this phase
 * closes). Two different mechanisms, deliberately not the same one:
 *
 * - The borrower-facing auto-reminder (resending the link after 24h of
 *   silence) genuinely needs a scheduled trigger to fire a real action —
 *   that's DLP's Flowable boundary timer + skillfin-videopd-followup-
 *   bridge + POST .../videopd-reminder (src/lib/dlpWorkflow.ts's BPMN
 *   processes own that clock, per the confirmed decision).
 * - This — the underwriter-facing "stalled" signal — is pure information
 *   display, not an action. It doesn't need an event to fire; it's just
 *   arithmetic on timestamps the app already has, computed fresh every
 *   time the queue/case page renders. Routing it through Flowable too
 *   would mean a periodically-updated flag that's occasionally stale
 *   instead of a always-live one, for no real benefit — so it isn't.
 *   (Real underwriter notifications — SMS/email/push, not just an in-app
 *   badge — are the next step once DLP's own StaffMember record has
 *   contact info to send to; confirmed as an explicit, deliberate gap for
 *   now, not an oversight.)
 */

// Below this, a case reads as "still fresh" with no visual noise; at or
// past it, the badge escalates to a warning tone. Half of the 24h
// borrower-reminder threshold — the underwriter sees it building before
// the system's own auto-nudge fires, not only after.
const STALL_THRESHOLD_HOURS = 12;

export interface VideoPdProgressBadge {
  label: string;
  stalled: boolean;
  hours: number;
}

interface VideoPdSessionLike {
  status: string;
  currentStep: number;
  linkSentAt: string | Date;
  startedAt: string | Date | null;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Returns a badge describing where the borrower's VideoPD session
 * stands, or null when there's nothing progress-related to show (no
 * session yet, or the case has moved past VIDEOPD_SCHEDULED). */
export function getVideoPdProgressBadge(
  leadStatus: string,
  session: VideoPdSessionLike | null,
): VideoPdProgressBadge | null {
  if (leadStatus !== "VIDEOPD_SCHEDULED" || !session) return null;

  if (session.status === "NOT_STARTED") {
    const hours = (Date.now() - new Date(session.linkSentAt).getTime()) / 3600000;
    return { label: `Link not opened — ${formatHours(hours)}`, stalled: hours >= STALL_THRESHOLD_HOURS, hours };
  }

  if (session.status === "IN_PROGRESS") {
    const since = session.startedAt ?? session.linkSentAt;
    const hours = (Date.now() - new Date(since).getTime()) / 3600000;
    return { label: `In progress (step ${session.currentStep}/5) — ${formatHours(hours)}`, stalled: hours >= STALL_THRESHOLD_HOURS, hours };
  }

  return null;
}
