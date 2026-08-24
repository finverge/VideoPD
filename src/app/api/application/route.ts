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

  let application = await db.loanApplication.findFirst({
    where: { borrowerId, status: "DRAFT" },
    orderBy: { updatedAt: "desc" },
  });

  if (!application) {
    application = await db.loanApplication.create({
      data: { borrowerId, segment, status: "DRAFT" },
    });
  } else if (application.segment !== segment) {
    application = await db.loanApplication.update({
      where: { id: application.id },
      data: { segment },
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
