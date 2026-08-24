import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";

// Underwriter-triggered VideoPD link (BRD BR-21/BR-22). No real SMS/WhatsApp
// gateway in this prototype (BRD Section 12 lists that as a dependency) — the
// link is returned directly in the response, same mocked-delivery pattern as
// the OTP gateway (src/app/api/auth/otp/route.ts).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const lead = await db.lead.findUnique({ where: { id }, include: { videoPdSession: true } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    return NextResponse.json({ session: updated, link: `/videopd/${updated.token}` });
  }

  const session = await db.videoPdSession.create({
    data: { leadId: id, token: nanoid(24) },
  });
  await db.lead.update({ where: { id }, data: { status: "VIDEOPD_SCHEDULED" } });

  return NextResponse.json({ session, link: `/videopd/${session.token}` });
}
