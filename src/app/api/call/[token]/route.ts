import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Minimal, deliberately narrow validation endpoint for a 3rd-party call
// guest link — a training institute contact (VOCATIONAL_STUDENT) or a
// business/workshop contact (BUSINESS_OWNER) joining the live call to show
// their premises alongside the borrower, not a generic "witness". Reuses
// the VideoPD session's own token as the room id (same trust boundary:
// anyone who could already reach the borrower's VideoPD page with this
// token can already see far more sensitive data than what's returned here),
// but excludes everything api/videopd/[token] exposes that this guest has
// no reason to see — loan amount, income, bank details, ID numbers, the
// borrower's mobile. segment + the one relevant business/institute name is
// the whole point of who's being invited, not a privacy leak; unlike that
// route, this also has no side effect on the session's status — a guest
// joining a live call shouldn't silently flip NOT_STARTED -> IN_PROGRESS on
// the borrower's own async verification steps.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({
    where: { token },
    select: { status: true, lead: { select: { application: { select: { segment: true, segmentFieldsJson: true } } } } },
  });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });

  const segment = session.lead.application.segment;
  const segmentFields: Record<string, unknown> = session.lead.application.segmentFieldsJson
    ? JSON.parse(session.lead.application.segmentFieldsJson)
    : {};
  const contextName =
    segment === "VOCATIONAL_STUDENT"
      ? (segmentFields.instituteName as string | undefined) ?? null
      : segment === "BUSINESS_OWNER"
        ? (segmentFields.businessName as string | undefined) ?? null
        : null;

  return NextResponse.json({ ok: true, status: session.status, segment, contextName });
}
