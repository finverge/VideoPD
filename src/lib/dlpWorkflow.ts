import type { SegmentCode } from "@/types";

/**
 * DLP/LOS workflow-start client — starts this segment's real
 * `Process_SKILLFIN_{segment}` BPMN case-lifecycle process (authored +
 * versioned in DLP's workflow-config, deployed to DLP's Flowable process
 * engine — see the Admin Portal, Workflow Designer) when a Lakshya Skill
 * Finance application is submitted.
 *
 * Mirrors application-onboarding's own `workflow_client.py::start_case()`
 * exactly: calls Flowable's process engine directly (POST
 * /service/runtime/process-instances) rather than routing through
 * workflow-config or DLP's Internal Gateway — same "workflow-config is
 * design-time, the engine itself is the right thing to call at runtime"
 * reasoning dlpBre.ts already uses for the DMN side, and the same
 * `/service/*` path quirk (every other Flowable engine is under
 * `/<engine>-api/*`; the BPMN process engine alone stays at `/service/*`
 * for backward compatibility with pre-7.x Flowable — see workflow_client.py
 * and flowable_deploy_client.py's own notes on this).
 *
 * `processDefinitionKey` must exactly match the `<bpmn:process id="">`
 * baked into the deployed BPMN XML, NOT workflow-config's own authoring
 * `process_key` field — those are two independent identifiers, same
 * distinction workflow_client.py's module doc documents for DLP's own
 * products. `businessKey` is this application's own id — the same id
 * every DLP-side bridge resolves back via
 * `GET /service/runtime/process-instances/{id}` to know which case a
 * polled job belongs to.
 *
 * Same graceful-degradation contract as everywhere else this integration
 * touches: returns null if Flowable is unreachable or that segment's
 * process isn't deployed yet — VideoPD's own Lead.status remains the
 * single source of truth for the borrower/underwriter UI either way, this
 * is purely a Flowable-side visibility/audit-trail mirror.
 */

const FLOWABLE_REST_URL = process.env.FLOWABLE_REST_URL ?? "http://127.0.0.1:8090/flowable-rest";
const FLOWABLE_REST_USERNAME = process.env.FLOWABLE_REST_USERNAME ?? "rest-admin";
const FLOWABLE_REST_PASSWORD = process.env.FLOWABLE_REST_PASSWORD ?? "test";

const _PROCESS_KEY_BY_SEGMENT: Record<SegmentCode, string> = {
  FARMER: "Process_SKILLFIN_FARMER",
  VOCATIONAL_STUDENT: "Process_SKILLFIN_VOCSTUDENT",
  BUSINESS_OWNER: "Process_SKILLFIN_BUSINESS",
};

/** Starts the segment-specific case-lifecycle BPMN process for a newly
 * submitted application. Returns the Flowable process instance id, or
 * null if it couldn't be started (Flowable unreachable, or that segment's
 * process isn't deployed yet — expected in local dev before Phase 3's
 * BPMN processes are deployed). */
export async function startSkillFinanceCase(applicationId: string, segment: SegmentCode): Promise<string | null> {
  const processDefinitionKey = _PROCESS_KEY_BY_SEGMENT[segment];
  try {
    const auth = Buffer.from(`${FLOWABLE_REST_USERNAME}:${FLOWABLE_REST_PASSWORD}`).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let response: Response;
    try {
      response = await fetch(`${FLOWABLE_REST_URL}/service/runtime/process-instances`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          processDefinitionKey,
          businessKey: applicationId,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn(
        `[dlpWorkflow] Could not start Flowable case for process '${processDefinitionKey}' / application ${applicationId} (HTTP ${response.status}) — tracked locally only. Expected if that segment's BPMN process isn't deployed yet.`,
      );
      return null;
    }
    const body = (await response.json()) as { id?: string };
    return body.id ?? null;
  } catch (error) {
    console.warn(
      `[dlpWorkflow] Could not reach DLP's Flowable process engine to start '${processDefinitionKey}' for application ${applicationId} — tracked locally only. Expected in local dev before DLP/LOS is running.`,
      error,
    );
    return null;
  }
}
