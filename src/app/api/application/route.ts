import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// FR-BWP-05/06 — start or resume a draft application for a verified borrower.
export async function POST(req: NextRequest) {
  const { borrowerId, segment } = await req.json();
  if (!borrowerId || !segment) {
    return NextResponse.json({ error: "borrowerId and segment are required." }, { status: 400 });
  }

  const borrower = await db.borrower.findUnique({ where: { id: borrowerId } });
  if (!borrower || !borrower.mobileVerified) {
    return NextResponse.json({ error: "Borrower not verified." }, { status: 403 });
  }

  await db.borrower.update({ where: { id: borrowerId }, data: { segment } });

  // Scoped to THIS segment specifically — used to also grab a borrower's
  // latest draft in ANY segment and silently switch it to whatever segment
  // was just picked, clobbering an in-progress application in a different
  // segment with zero warning (reported live, fixed by adding the
  // duplicate-check the landing page now calls first — see
  // api/application/duplicate-check/route.ts). Scoping the lookup by
  // segment here means this route no longer needs to choose between
  // "reuse" and "overwrite" itself: a same-segment draft resumes exactly
  // like before, a different-segment draft is simply invisible to this
  // query and a genuinely new, separate application gets created instead —
  // the landing page has already asked the borrower about that by the
  // time this is called.
  let application = await db.loanApplication.findFirst({
    where: { borrowerId, status: "DRAFT", segment },
    orderBy: { updatedAt: "desc" },
  });

  if (!application) {
    application = await db.loanApplication.create({
      data: { borrowerId, segment, status: "DRAFT" },
    });
  }

  return NextResponse.json({ application });
}

// Resume: look up the latest draft for a borrower.
export async function GET(req: NextRequest) {
  const borrowerId = req.nextUrl.searchParams.get("borrowerId");
  if (!borrowerId) return NextResponse.json({ error: "borrowerId is required." }, { status: 400 });

  const application = await db.loanApplication.findFirst({
    where: { borrowerId, status: "DRAFT" },
    orderBy: { updatedAt: "desc" },
    include: { evidence: true },
  });

  return NextResponse.json({ application });
}
