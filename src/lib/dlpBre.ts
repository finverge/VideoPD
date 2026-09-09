import type { SegmentCode } from "@/types";
import { DEFAULT_RISK_PARAMETERS } from "@/lib/riskParameters";

/**
 * DLP/LOS BRE client — calls the `SkillFinanceRiskGate` DMN decision
 * (authored + versioned in DLP's workflow-config, deployed to DLP's
 * Flowable DMN engine) to resolve this segment's risk-policy thresholds at
 * request time, replacing the local `RiskParameters` Prisma lookup that
 * `riskParameters.ts::getRiskParameters` used to be the only source of.
 *
 * Calls Flowable's DMN engine directly (POST /dmn-api/dmn-rule/execute-
 * decision) rather than routing through workflow-config or DLP's Internal
 * Gateway — mirrors application-onboarding's own `dmn_client.py` exactly:
 * workflow-config is the authoring/deploy-time service (design-time), the
 * DMN engine itself is the right thing to call at runtime, and the
 * Internal Gateway fronts browser-originated traffic, not server-to-server
 * calls like this one (a Next.js API route calling a sibling backend).
 *
 * `SkillFinanceRiskGate`'s table is a pure per-segment threshold lookup —
 * input `segment`, outputs `maxLoanToIncomeMultiple`,
 * `assumedAnnualInterestRatePct`, `maxEmiToIncomeRatioPct` (same 3 fields
 * `RiskParameters` used to store locally). The actual flag/severity
 * comparison logic stays exactly where it already lived, in
 * mockChecks.ts — this only changes where the threshold *numbers* come
 * from. Deliberately not folded into a bigger "evaluate the whole
 * application" decision: DMN tables are for threshold/band policy, not
 * the EMI formula or flag-composition logic, same division of labor
 * `evaluate_gold_loan_ltv_gate` and `evaluate_eligibility_gate` already
 * use on the DLP side.
 *
 * Same graceful-degradation contract as every DLP client this mirrors: if
 * Flowable is unreachable or the decision isn't deployed, this returns
 * null rather than throwing — callers must fall back to a last-known-good
 * value (DEFAULT_RISK_PARAMETERS below), never silently skip the risk
 * checks that depend on it.
 */

const FLOWABLE_REST_URL = process.env.FLOWABLE_REST_URL ?? "http://127.0.0.1:8090/flowable-rest";
const FLOWABLE_REST_USERNAME = process.env.FLOWABLE_REST_USERNAME ?? "rest-admin";
const FLOWABLE_REST_PASSWORD = process.env.FLOWABLE_REST_PASSWORD ?? "test";

export interface SkillFinanceRiskThresholds {
  maxLoanToIncomeMultiple: number;
  assumedAnnualInterestRatePct: number;
  maxEmiToIncomeRatioPct: number;
}

interface DmnResultVariable {
  name: string;
  value: unknown;
  type?: string;
}

/** Resolves this segment's risk-policy thresholds from DLP's live BRE.
 * Returns null on any failure (Flowable down, decision not deployed,
 * malformed response) — callers decide the fallback, this never guesses. */
export async function getSkillFinanceRiskThresholds(
  segment: SegmentCode,
): Promise<SkillFinanceRiskThresholds | null> {
  try {
    const auth = Buffer.from(`${FLOWABLE_REST_USERNAME}:${FLOWABLE_REST_PASSWORD}`).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(`${FLOWABLE_REST_URL}/dmn-api/dmn-rule/execute-decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          decisionKey: "SkillFinanceRiskGate",
          inputVariables: [{ name: "segment", value: segment }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn(
        `[dlpBre] SkillFinanceRiskGate returned HTTP ${response.status} for segment ${segment} — falling back to last-known-good thresholds.`,
      );
      return null;
    }

    const body = (await response.json()) as { resultVariables?: DmnResultVariable[][] };
    const resultGroups = body.resultVariables ?? [];
    // hitPolicy UNIQUE with segment as the sole input column always
    // produces exactly one matched-rule group; flatten defensively rather
    // than assuming index [0] exists.
    const flat: Record<string, unknown> = {};
    for (const group of resultGroups) {
      for (const v of group) flat[v.name] = v.value;
    }

    const { maxLoanToIncomeMultiple, assumedAnnualInterestRatePct, maxEmiToIncomeRatioPct } = flat;
    if (
      typeof maxLoanToIncomeMultiple !== "number" ||
      typeof assumedAnnualInterestRatePct !== "number" ||
      typeof maxEmiToIncomeRatioPct !== "number"
    ) {
      console.warn(
        `[dlpBre] SkillFinanceRiskGate returned no usable result for segment ${segment} — falling back to last-known-good thresholds.`,
      );
      return null;
    }
    return { maxLoanToIncomeMultiple, assumedAnnualInterestRatePct, maxEmiToIncomeRatioPct };
  } catch (error) {
    console.warn(
      `[dlpBre] Could not reach DLP's Flowable DMN engine for SkillFinanceRiskGate (segment ${segment}) — expected in local dev before DLP/LOS is running. Falling back to last-known-good thresholds.`,
      error,
    );
    return null;
  }
}

/** Last-known-good thresholds, used only when the live DMN call fails.
 * Deliberately the SAME numbers as DEFAULT_RISK_PARAMETERS (the values the
 * DMN table itself was seeded with) — this is a fallback for
 * unavailability, not a second, independently-maintained policy. */
export const FALLBACK_RISK_THRESHOLDS: SkillFinanceRiskThresholds = DEFAULT_RISK_PARAMETERS;
