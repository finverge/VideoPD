import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv";

// Bulk CSV extract of approved cases — the practical bridge for handing
// off to a 3rd-party LOS/disbursement system, since the BRD itself treats
// everything past "credit manager approves" (eMandate, loan account
// opening, eContract) as outside this program's scope, handled by
// whatever system actually owns that (see docs/videopd-future-work.md and
// the BRD's own Section 6 Step 17 — disbursement is a single existing,
// undescribed LOS mechanism this program hands off to, not something it
// builds). One row per approved Lead, using each Lead's own final-round
// decision fields (underwriterName/approverName/etc.) rather than the full
// LeadDecision audit trail — a downstream system needs the final approved
// state, not the multi-round history.
export async function GET() {
  const leads = await db.lead.findMany({
    where: { status: "APPROVED" },
    include: {
      application: { include: { borrower: true } },
      videoPdSession: { include: { bankStatements: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
    orderBy: { approverDecidedAt: "desc" },
  });

  const headers = [
    "Reference", "Lead ID", "Borrower Name", "Mobile", "Segment",
    "Product Type", "Requested Amount", "Tenure Months", "Loan Purpose",
    "ID Type", "ID Number", "Current Address", "Monthly Income",
    "Risk Severity", "Risk Flag Count",
    "Skill Intent Score", "VideoPD Completed At", "Bank Statement Eligibility",
    "Underwriter Name", "Underwriter Decision", "Underwriter Decided At",
    "Approver Name", "Approver Decision Date", "Approver Notes",
  ];

  const rows = leads.map((lead) => {
    const app = lead.application;
    const statement = lead.videoPdSession?.bankStatements[0] ?? null;
    return [
      lead.id.slice(-8).toUpperCase(),
      lead.id,
      app.fullName ?? "",
      app.borrower.mobile,
      app.segment,
      app.productType ?? "",
      app.requestedAmount ?? "",
      app.tenureMonths ?? "",
      app.loanPurpose ?? "",
      app.idType ?? "",
      app.idNumber ?? "",
      app.currentAddress ?? "",
      app.monthlyIncome ?? "",
      lead.riskSeverity,
      lead.riskFlagCount,
      lead.videoPdSession?.skillIntentScore ?? "",
      lead.videoPdSession?.completedAt?.toISOString() ?? "",
      statement?.eligibilityFlag ?? "",
      lead.underwriterName ?? "",
      lead.underwriterRecommendation ?? "",
      lead.underwriterDecidedAt?.toISOString() ?? "",
      lead.approverName ?? "",
      lead.approverDecidedAt?.toISOString() ?? "",
      lead.approverNotes ?? "",
    ];
  });

  const csv = toCsv(headers, rows);
  const filename = `approved-cases-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
