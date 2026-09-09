/**
 * DLP/LOS notification client — DLP/LOS integration Phase 3 (notifications
 * scoped in alongside the workflow, per the "sms and email notifications
 * with videopd link also to be scoped in as part of workflow design"
 * follow-up). Calls DLP's real `notification-service` — a genuine,
 * working, template-driven send pipeline (event_key + channel ->
 * NotificationTemplate lookup -> render -> External Gateway's mocked
 * SMS/email delivery, real request/response chain, just a dev-mode stub
 * at the very last hop, same posture as this app's own OTP gateway) —
 * rather than building a second, bespoke notification path in VideoPD.
 *
 * Routed through DLP's Internal Gateway (`/gateway/notification-service/*`),
 * NOT called directly like dlpBre.ts/dlpWorkflow.ts call Flowable —
 * notification-service is an ordinary internal microservice, not a
 * design-time-vs-runtime engine split, so the gateway (the documented
 * ingress for calling into DLP's own services from outside, same path
 * admin-portal's api.ts uses for workflow-config) is the right thing to
 * call here, not Flowable's REST API.
 *
 * "Scoped in as part of workflow design": this fires at exactly the real
 * status transition VideoPD's own send-videopd-link route already drives
 * (Lead.status -> VIDEOPD_SCHEDULED) — the same checkpoint
 * Task_VideoPdScheduled (src/lib/dlpWorkflow.ts's BPMN processes)
 * represents in Flowable. Consistent with the "reflect, never decide"
 * discipline the whole DLP bridge layer already uses: Flowable's bridge
 * only ever observes that this checkpoint was reached, it never triggers
 * the send itself — the send is a real side effect of VideoPD's own
 * code, at the same moment the workflow-visible checkpoint is reached,
 * not a second, independent trigger that could drift out of step with it.
 *
 * Best-effort throughout, same graceful-degradation contract as every
 * other DLP integration point here: a template not existing, DLP being
 * unreachable, or the external delivery stub itself reporting nothing
 * back — none of these ever block or fail the caller (sending the
 * VideoPD link is what actually matters; the notification is a
 * convenience on top of it, not a precondition for it).
 */

const INTERNAL_GATEWAY_URL = process.env.DLP_INTERNAL_GATEWAY_URL ?? "http://127.0.0.1:8100";
const BASE = `${INTERNAL_GATEWAY_URL}/gateway/notification-service`;

type Channel = "SMS" | "Email";

async function sendNotification(channel: Channel, recipient: string, mergeData: Record<string, string>): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response: Response;
    try {
      response = await fetch(`${BASE}/notifications/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_key: "SKILLFIN_VIDEOPD_LINK",
          channel,
          recipient,
          merge_data: mergeData,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      console.warn(`[dlpNotify] notification-service returned HTTP ${response.status} for ${channel} to ${recipient} — link still sent, notification best-effort only.`);
      return;
    }
    const body = (await response.json()) as { status?: string };
    if (body.status && body.status !== "Sent") {
      // "No Template" or "Failed" — logged, not thrown. Either way the
      // borrower still has the link via the underwriter's own screen.
      console.warn(`[dlpNotify] ${channel} notification to ${recipient} did not send (status: ${body.status}).`);
    }
  } catch (error) {
    console.warn(`[dlpNotify] Could not reach DLP's notification-service for ${channel} to ${recipient} — expected in local dev before DLP/LOS is running.`, error);
  }
}

/** Sends the VideoPD verification link to the borrower over SMS (always,
 * if a mobile number exists) and Email (if the borrower has one on file).
 * Fire-and-forget from the caller's perspective — never throws, never
 * blocks the actual link creation this rides alongside. */
export async function notifySkillFinanceVideoPdLink(params: {
  borrowerName: string;
  mobile: string | null;
  email: string | null;
  videoPdLink: string;
}): Promise<void> {
  const mergeData = { borrowerName: params.borrowerName || "there", videoPdLink: params.videoPdLink };
  const sends: Promise<void>[] = [];
  if (params.mobile) sends.push(sendNotification("SMS", params.mobile, mergeData));
  if (params.email) sends.push(sendNotification("Email", params.email, mergeData));
  await Promise.allSettled(sends);
}
