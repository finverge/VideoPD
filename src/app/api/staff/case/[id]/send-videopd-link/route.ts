import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { notifySkillFinanceVideoPdLink } from "@/lib/dlpNotify";

// Underwriter-triggered VideoPD link (BRD BR-21/BR-22). SMS/Email delivery
// (DLP/LOS integration Phase 3) goes through DLP's real notification-service
// (src/lib/dlpNotify.ts) — best-effort, never blocks this endpoint; the link
// is also always returned directly in the response (same mocked-delivery
// fallback posture as the OTP gateway, src/app/api/auth/otp/route.ts), so an
// underwriter can still share it manually if the notification doesn't land.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    include: { videoPdSession: true, application: { include: { borrower: true } } },
  });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const borrowerName = lead.application.fullName ?? lead.application.borrower.name ?? "";
  const mobile = lead.application.borrower.mobile ?? null;
  const email = lead.application.email ?? null;
  const origin = req.nextUrl.origin;

  // Resend: an existing not-yet-complete session reuses its link rather than
  // orphaning the old token (BR-22 "resend... the lead status must reflect
  // the current VideoPD state" — a fresh token each time would be confusing).
  if (lead.videoPdSession) {
    if (lead.videoPdSession.status === "COMPLETE") {
      return NextResponse.json({ error: "VideoPD is already complete for this case." }, { status: 409 });
    }
    const updated = await db.videoPdSession.update({
      where: { id: lead.videoPdSession.id },
      data: { linkSentAt: new Date() },
    });
    await notifySkillFinanceVideoPdLink({ borrowerName, mobile, email, videoPdLink: `${origin}/videopd/${updated.token}` });
    return NextResponse.json({ session: updated, link: `/videopd/${updated.token}` });
  }

  const session = await db.videoPdSession.create({
    data: { leadId: id, token: nanoid(24) },
  });
  await db.lead.update({ where: { id }, data: { status: "VIDEOPD_SCHEDULED" } });

  await notifySkillFinanceVideoPdLink({ borrowerName, mobile, email, videoPdLink: `${origin}/videopd/${session.token}` });

  return NextResponse.json({ session, link: `/videopd/${session.token}` });
}
