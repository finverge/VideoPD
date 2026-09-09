import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Lists Leads (= underwriting "cases") with the same server-side search/filter
// pattern noted in the DLP staff-portal's CaseQueue — filters applied before
// pagination so summary counts and search always reflect the full matching
// set, not just loaded rows. No pagination here yet (prototype data volumes
// are small); straightforward to add a cursor later without changing the shape.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const segment = searchParams.get("segment");
  const search = searchParams.get("search")?.trim();

  const where: Prisma.LeadWhereInput = {};
  if (status) where.status = status as any;
  if (segment) where.application = { segment: segment as any };
  if (search) {
    where.application = {
      ...(where.application as object),
      OR: [
        { fullName: { contains: search } },
        { borrower: { mobile: { contains: search } } },
      ],
    };
  }

  const leads = await db.lead.findMany({
    where,
    include: {
      application: { include: { borrower: true } },
      // DLP/LOS integration Phase 6 — enough for the queue page's own
      // getVideoPdProgressBadge (src/lib/videoPdStall.ts) to show whether
      // a case's borrower has actually opened/progressed their VideoPD
      // session, not just that a link was sent.
      videoPdSession: { select: { status: true, currentStep: true, linkSentAt: true, startedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ leads });
}
