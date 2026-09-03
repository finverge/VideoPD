import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFeatureSettings } from "@/lib/featureSettings";
import { t } from "@/lib/i18n";
import type { LangCode, SegmentCode } from "@/types";

// Plain segment nouns ("Farmer", not "I'm a Farmer") — segmentFarmer/
// segmentStudent/segmentBusiness in i18n.ts are first-person
// self-descriptions for the segment-picker screen and read wrong
// mid-sentence in a message like "already in progress in {segment}".
const SEGMENT_LABEL_KEY: Record<SegmentCode, string> = {
  FARMER: "segmentNameFarmer",
  VOCATIONAL_STUDENT: "segmentNameStudent",
  BUSINESS_OWNER: "segmentNameBusiness",
};

/**
 * Landing-page duplicate-application check — run right after OTP verifies
 * and before an application is created or resumed (see src/app/page.tsx's
 * verifyOtp). Read-only; never creates or changes anything, so the landing
 * page can call it first and decide what to do before the actual
 * create-or-resume (POST /api/application, or a direct navigate for the
 * resume case) happens.
 *
 * Closes two real gaps, both found live in the previous behavior:
 *   1. POST /api/application used to silently REUSE a borrower's existing
 *      draft and switch it to whatever new segment was picked, with zero
 *      warning — a borrower who genuinely wanted a second application
 *      (e.g. a Farmer loan after already starting a Business Owner one)
 *      would have their in-progress application silently overwritten
 *      instead of a new one being created.
 *   2. Picking the SAME segment again silently resumed the old draft with
 *      no confirmation — a reasonable default, but nothing told the
 *      borrower that's what just happened.
 *
 * Same "single most recent draft" simplification the existing GET
 * /api/application (resume lookup) and POST (create-or-resume) already
 * use — this app doesn't try to reason about multiple simultaneous drafts
 * across segments for one borrower.
 */
export async function GET(req: NextRequest) {
  const borrowerId = req.nextUrl.searchParams.get("borrowerId");
  const segment = req.nextUrl.searchParams.get("segment") as SegmentCode | null;
  const lang = (req.nextUrl.searchParams.get("lang") as LangCode | null) ?? "en";
  if (!borrowerId || !segment) {
    return NextResponse.json({ error: "borrowerId and segment are required." }, { status: 400 });
  }

  const latestDraft = await db.loanApplication.findFirst({
    where: { borrowerId, status: "DRAFT" },
    orderBy: { lastActiveAt: "desc" },
  });

  if (!latestDraft) {
    return NextResponse.json({ conflict: null });
  }

  if (latestDraft.segment !== segment) {
    // A draft exists, but in a different segment — always worth asking
    // about regardless of how old it is (a different concern from
    // staleness: this is "did you mean to start a second application",
    // not "is your old one still relevant").
    return NextResponse.json({
      conflict: {
        type: "different-segment",
        applicationId: latestDraft.id,
        existingSegment: latestDraft.segment,
        existingSegmentLabel: t(lang, SEGMENT_LABEL_KEY[latestDraft.segment as SegmentCode]),
      },
    });
  }

  // Same segment — only offer to resume if the draft is still "fresh"
  // enough per the admin-configurable expiry window (default 30 days,
  // src/staff/risk-parameters). Past it, say nothing here and let a fresh
  // application start normally; POST /api/application would still find
  // and silently resume this exact draft if nothing newer exists in this
  // segment by the time it's called — which is fine (better than a
  // pointless second blank draft), it just isn't worth interrupting the
  // borrower with a prompt over.
  const { applicationExpiryDays } = await getFeatureSettings();
  const ageMs = Date.now() - latestDraft.lastActiveAt.getTime();
  const withinExpiry = ageMs <= applicationExpiryDays * 24 * 60 * 60 * 1000;
  if (!withinExpiry) {
    return NextResponse.json({ conflict: null });
  }

  return NextResponse.json({
    conflict: {
      type: "resume-same-segment",
      applicationId: latestDraft.id,
      fullName: latestDraft.fullName,
    },
  });
}
