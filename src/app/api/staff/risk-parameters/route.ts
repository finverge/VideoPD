import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiskParameters, DEFAULT_RISK_PARAMETERS } from "@/lib/riskParameters";
import type { SegmentCode } from "@/types";

const VALID_SEGMENTS: SegmentCode[] = ["FARMER", "VOCATIONAL_STUDENT", "BUSINESS_OWNER"];

// BR-43's configurable-credit-parameters seam — real, staff-editable numbers
// (src/lib/riskParameters.ts), keyed per segment since farm/student/business
// income genuinely work differently, not hardcoded constants. GET returns
// the current values for one segment (generic defaults until someone edits
// them); PUT updates that segment's values, meant for Lakshya to calibrate
// during UAT and in production without an engineering change. Same
// prototype-grade auth as the rest of this app (see README's "Known gaps")
// — role is trusted from the request body, not re-verified server-side
// against a real session.
export async function GET(req: NextRequest) {
  const segment = new URL(req.url).searchParams.get("segment") as SegmentCode | null;
  if (!segment || !VALID_SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  const params = await getRiskParameters(segment);
  return NextResponse.json({ riskParameters: params, defaults: DEFAULT_RISK_PARAMETERS });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    segment?: string;
    staffName?: string;
    staffRole?: string;
    maxLoanToIncomeMultiple?: number;
    assumedAnnualInterestRatePct?: number;
    maxEmiToIncomeRatioPct?: number;
  };
  const { segment, staffName, staffRole, maxLoanToIncomeMultiple, assumedAnnualInterestRatePct, maxEmiToIncomeRatioPct } = body;

  if (!segment || !VALID_SEGMENTS.includes(segment as SegmentCode)) {
    return NextResponse.json({ error: `segment must be one of: ${VALID_SEGMENTS.join(", ")}` }, { status: 400 });
  }
  if (staffRole !== "APPROVER") {
    return NextResponse.json({ error: "Only an Approver can update risk parameters." }, { status: 403 });
  }
  if (
    typeof maxLoanToIncomeMultiple !== "number" ||
    typeof assumedAnnualInterestRatePct !== "number" ||
    typeof maxEmiToIncomeRatioPct !== "number" ||
    maxLoanToIncomeMultiple <= 0 ||
    assumedAnnualInterestRatePct <= 0 ||
    maxEmiToIncomeRatioPct <= 0 ||
    maxEmiToIncomeRatioPct > 100
  ) {
    return NextResponse.json({ error: "All three parameters are required and must be positive numbers (EMI ratio ≤ 100)." }, { status: 400 });
  }

  const updated = await db.riskParameters.upsert({
    where: { id: segment },
    create: { id: segment, maxLoanToIncomeMultiple, assumedAnnualInterestRatePct, maxEmiToIncomeRatioPct, updatedBy: staffName ?? null },
    update: { maxLoanToIncomeMultiple, assumedAnnualInterestRatePct, maxEmiToIncomeRatioPct, updatedBy: staffName ?? null },
  });

  return NextResponse.json({ riskParameters: updated });
}
