import { NextRequest, NextResponse } from "next/server";
import { decideScorecardRevision } from "@/lib/assetScorecardRevisions";

// Approver decides one pending scorecard revision (approve/reject) — see
// AssetScorecardRevision's schema doc comment and
// decideScorecardRevision's own doc comment for the maker-checker rule
// enforced here: the decider can't be the same person who proposed it,
// checked in the lib function itself (not just the Approver-role gate
// below), so a single Approver account can't both propose and approve
// their own change.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await params;
  const body = (await req.json()) as {
    staffName?: string;
    staffRole?: string;
    decision?: "APPROVED" | "REJECTED";
  };
  const { staffName, staffRole, decision } = body;

  if (staffRole !== "APPROVER") {
    return NextResponse.json({ error: "Only an Approver can decide a scorecard revision." }, { status: 403 });
  }
  if (!staffName) {
    return NextResponse.json({ error: "staffName is required." }, { status: 400 });
  }
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return NextResponse.json({ error: "decision must be APPROVED or REJECTED." }, { status: 400 });
  }

  const result = await decideScorecardRevision(revisionId, staffName, decision);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ revision: result.revision });
}
