import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      summary: true,
      decisions: { orderBy: { decidedAt: "asc" } },
      videoPdSession: {
        include: {
          answers: { orderBy: { createdAt: "asc" } },
          bankStatements: { orderBy: { createdAt: "desc" } },
        },
      },
      application: {
        include: {
          borrower: true,
          evidence: { orderBy: { createdAt: "asc" } },
          transcripts: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lead });
}
