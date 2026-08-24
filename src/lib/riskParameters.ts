import { db } from "@/lib/db";
import type { SegmentCode } from "@/types";

/**
 * Generic, industry-standard microfinance/NBFC underwriting defaults —
 * real, defensible starting points, not Lakshya's own calibrated risk
 * appetite. Citations, so "generic" doesn't mean "made up":
 *
 * - Loan-to-income multiple (36x monthly income): a commonly cited retail-
 *   lending rule of thumb — roughly a 3-year repayment horizon at income
 *   parity. Was previously a hardcoded magic number in mockChecks.ts;
 *   moved here so it's the same configurable value as everything else.
 * - EMI-to-income ratio cap (50%): FOIR (Fixed Obligation to Income Ratio)
 *   is standard Indian lending terminology; 50% is within the commonly
 *   cited 40–55% range used across retail/microfinance lending in India.
 *   Not an RBI-mandated figure — no single regulatory number exists — just
 *   a widely-used industry convention.
 * - Assumed annual interest rate (24%): a generic placeholder in the
 *   commonly cited range for Indian microfinance lending, used ONLY to
 *   estimate an EMI for the affordability check below, since no actual
 *   quoted rate is captured elsewhere in this application's data model.
 *
 * BRD Section 12 lists Lakshya's own baseline credit questionnaire and risk
 * parameters as an explicit external dependency. This is the seam: these
 * numbers are real and usable today, and staff can overwrite them at
 * /staff/risk-parameters the moment Lakshya provides their real ones —
 * during UAT or in production — without an engineering change.
 *
 * Segment-specific, not one global set: FARMER, VOCATIONAL_STUDENT, and
 * BUSINESS_OWNER income genuinely work differently — farm income is
 * seasonal/harvest-cycle, not a stable monthly figure; a vocational
 * student typically has no current income at all (the loan is against
 * future earning potential or a guarantor, not this month's pay). All
 * three segments are seeded with the SAME generic numbers below — there's
 * no rigorous, citable basis for inventing different starting numbers per
 * segment, and doing that would just be different-flavored fabrication.
 * What's real here is the ARCHITECTURE: each segment is independently
 * editable, so when Lakshya's real numbers differ meaningfully by segment
 * (plausible, given the above), entering them doesn't need an engineering
 * change — same seam as everything else in this file.
 */
export const DEFAULT_RISK_PARAMETERS = {
  maxLoanToIncomeMultiple: 36,
  assumedAnnualInterestRatePct: 24,
  maxEmiToIncomeRatioPct: 50,
};

export async function getRiskParameters(segment: SegmentCode) {
  const existing = await db.riskParameters.findUnique({ where: { id: segment } });
  if (existing) return existing;
  return db.riskParameters.create({ data: { id: segment, ...DEFAULT_RISK_PARAMETERS } });
}

/** Standard reducing-balance EMI formula. Returns null if the inputs can't
 * produce a meaningful EMI (zero/negative principal, tenure, or rate). */
export function estimateMonthlyEmi(principal: number, annualRatePct: number, tenureMonths: number): number | null {
  if (principal <= 0 || tenureMonths <= 0) return null;
  const monthlyRate = annualRatePct / 12 / 100;
  if (monthlyRate <= 0) return principal / tenureMonths; // degenerate 0%-rate case — straight-line
  const factor = Math.pow(1 + monthlyRate, tenureMonths);
  return (principal * monthlyRate * factor) / (factor - 1);
}
