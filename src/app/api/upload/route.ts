import { NextRequest, NextResponse } from "next/server";
import { mkdir, open, unlink } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { mockQualityCheck } from "@/lib/mockChecks";
import { checkIdNumberMatch } from "@/lib/idProofCheck";
import { runVoiceCheck } from "@/lib/runVoiceCheck";

// Matches the 25mb ceiling next.config.mjs already sets for Server Actions —
// that setting doesn't apply to Route Handlers like this one though (no
// built-in Next.js body-size limit here), so this route had no upper bound
// at all until this check: any size, any file, silently accepted onto disk.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Backgrounded, same reasoning and pattern as processStatement in
// api/videopd/[token]/bank-statement/route.ts (see that file's own doc
// comment for the honest "what background means here, and where it stops
// being correct" caveat — same applies verbatim). Reported live: ID proof
// visibly took several real seconds longer than every other upload slot to
// finish, because this OCR pass used to run inline before the response —
// and nothing downstream actually decides anything off it inline (no step
// is gated on the result the way, say, evidenceComplete gates Next on the
// upload step), so there was never a reason for the borrower to wait on it.
// This file already backgrounds runVoiceCheck below for the identical
// reason; this brings the OCR check in line with that, rather than being
// the one inconsistent synchronous path left in this route.
async function runIdProofOcrCheck(evidenceId: string, filePath: string, idType: string | null, idNumber: string | null) {
  let authenticityStatus: "PASSED" | "FLAGGED" | "PENDING" = "PENDING";
  let authenticityNotes: string | null = null;
  try {
    const Tesseract = await import("tesseract.js");
    const { data } = await Tesseract.recognize(filePath, "eng");
    const result = checkIdNumberMatch(idType, idNumber, data.text);
    authenticityStatus = result.status === "NOT_APPLICABLE" ? "PENDING" : result.status;
    authenticityNotes = result.notes;
  } catch (e) {
    console.error("[api/upload] ID proof OCR failed:", e);
    authenticityNotes = "ID-number OCR check couldn't run — verify the number visually against the photo.";
  }
  // The row (or the file behind it) may have moved on since this started —
  // a retake/re-upload during the OCR window replaces the row via the same
  // applicationId_type upsert below, and a stale background result landing
  // after that would silently overwrite the newer file's real result with
  // one about a file that's no longer even on disk. Only write back if this
  // is still the row (and still the same file) it was launched for.
  const current = await db.uploadedEvidence.findUnique({ where: { id: evidenceId } });
  if (!current || path.relative(process.cwd(), filePath) !== current.filePath) return;
  await db.uploadedEvidence.update({ where: { id: evidenceId }, data: { authenticityStatus, authenticityNotes } });
}

// FSD Section 6 — chunked upload is out of scope for the local prototype;
// this handles a single-request upload with the same quality-check contract
// (FR-DOC-05) the chunked version will call once assembled.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const applicationId = form.get("applicationId") as string | null;
  const type = form.get("type") as string | null;
  const geoLat = form.get("geoLat") ? Number(form.get("geoLat")) : null;
  const geoLng = form.get("geoLng") ? Number(form.get("geoLng")) : null;

  if (!file || !applicationId || !type) {
    return NextResponse.json({ error: "file, applicationId, and type are required." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is too large — please upload something under 25MB." }, { status: 413 });
  }

  const application = await db.loanApplication.findUnique({ where: { id: applicationId } });
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  // A re-upload of the same evidence slot (e.g. retaking the ID proof photo,
  // or re-uploading after a FLAGGED result) must REPLACE the existing row,
  // not add a new one — the upload UI only ever tracks a single "existing"
  // item per (application, type) slot (see apply/[id]/page.tsx's
  // EVIDENCE_CONFIG), so extra rows just silently piled up invisibly behind
  // whichever one happened to render (reported live — 3 ID_PROOF rows on one
  // case). Look up any prior row for this slot before writing the new file,
  // so its old file can be deleted too — otherwise every re-upload leaks an
  // orphaned file under uploads/, never referenced by anything again.
  const existing = await db.uploadedEvidence.findUnique({
    where: { applicationId_type: { applicationId, type: type as any } },
  });

  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "uploads", applicationId);
  await mkdir(dir, { recursive: true });
  const safeName = `${type}-${nanoid(8)}-${file.name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, safeName);
  // fsync before the background OCR step (below) reads this back — same
  // real, reproduced Windows race the bank-statement route's own comment
  // documents: a plain writeFile()'s resolved promise doesn't guarantee
  // another process (Tesseract.js's OCR worker) sees the write yet.
  const handle = await open(filePath, "w");
  await handle.writeFile(bytes);
  await handle.sync();
  await handle.close();

  const quality = mockQualityCheck(bytes.length, file.type || "application/octet-stream", type);

  // ID-document text cross-check (src/lib/idProofCheck.ts) — OCRs the ID
  // proof photo and compares the number it finds against the idNumber the
  // borrower typed on the application form. Real gap this closes: face-match
  // only ever compares the PHOTO, never the printed number. Image-only for
  // now (Tesseract.js OCR runs directly on a photo); a PDF ID proof would
  // need the same client-side PDF-to-canvas rendering step face-match
  // already uses, not attempted here — see idProofCheck.ts.
  //
  // Backgrounded (runIdProofOcrCheck above), not awaited — reported live:
  // this used to run inline and was the one upload slot that visibly took
  // several seconds longer than every other one, with nothing downstream
  // actually gated on the result inline to justify the wait. The row
  // starts PENDING here, same as before OCR was even attempted, and the
  // background task updates it once OCR actually finishes — the
  // underwriter's case page reads the evidence row fresh on its own load,
  // so there's no borrower-facing signal that depended on this being
  // synchronous in the first place.
  const idAuthenticityStatus: "PASSED" | "FLAGGED" | "PENDING" = "PENDING";
  const idAuthenticityNotes: string | null = null;

  const evidence = await db.uploadedEvidence.upsert({
    where: { applicationId_type: { applicationId, type: type as any } },
    create: {
      applicationId,
      type: type as any,
      fileName: file.name,
      filePath: path.relative(process.cwd(), filePath),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      geoLat,
      geoLng,
      qualityStatus: quality.status,
      qualityNotes: quality.notes,
      authenticityStatus: idAuthenticityStatus,
      authenticityNotes: idAuthenticityNotes,
    },
    update: {
      fileName: file.name,
      filePath: path.relative(process.cwd(), filePath),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      geoLat,
      geoLng,
      qualityStatus: quality.status,
      qualityNotes: quality.notes,
      // A new file means any prior authenticity/liveness analysis was about
      // a DIFFERENT file — leaving it attached to this row would silently
      // show stale results (e.g. an old blink count) against new footage.
      // Reset to PENDING/null (or the freshly-computed ID-proof result
      // above) — whatever analysis step normally follows this upload (e.g.
      // liveness-result) recomputes it fresh against the new file, same as
      // it would for a brand-new row.
      authenticityStatus: idAuthenticityStatus,
      authenticityNotes: idAuthenticityNotes,
      livenessBlinkCount: null,
      livenessNoFacePct: null,
      livenessLookedAwayPct: null,
      livenessOffCameraGlances: null,
      livenessRecordingSeconds: null,
      faceMatchDistance: null,
      faceMatchResult: null,
    },
  });

  if (type === "ID_PROOF" && (file.type || "").startsWith("image/")) {
    runIdProofOcrCheck(evidence.id, filePath, application.idType, application.idNumber).catch((e) => {
      console.error("[api/upload] runIdProofOcrCheck rejected unexpectedly:", e);
    });
  }

  if (existing && existing.filePath !== evidence.filePath) {
    try {
      await unlink(path.join(process.cwd(), existing.filePath));
    } catch {
      // Old file already missing/removed — not fatal, the DB row is the
      // source of truth and it's already been replaced above.
    }
  }

  // A live-call recording just finished uploading — automatically run the
  // live-call voice-consistency + multi-speaker checks against it, no
  // underwriter click needed (requested live: the underwriter shouldn't have
  // to remember to run this after every call). Deliberately scoped to
  // live-call-only (runGuidedFlow/runDeepfake/runLipSync/runAssetDetection:
  // false) — those other checks only ever look at the two guided-flow
  // clips, which haven't changed just because a call ended, so re-running
  // them here would be pure redundant cost (measured ~45s for a full run
  // against real evidence) for zero new signal. See src/lib/runVoiceCheck.ts's
  // doc comment. Fire-and-forget: this must never block or fail the upload
  // response the borrower's own "leave call" flow is waiting on, and the
  // voice service being down (a separate process, not always running)
  // shouldn't surface as an upload error either.
  if (type === "LIVE_CALL_RECORDING") {
    runVoiceCheck(applicationId, { runGuidedFlow: false, runDeepfake: false, runLipSync: false, runAssetDetection: false }).catch((e) => {
      console.error("[api/upload] auto voice-check on live-call upload failed:", e);
    });
  }

  // The two guided-flow clips (VIDEOPD_LIVENESS, VIDEOPD_BUSINESS_VERIFICATION)
  // together are what guided-flow voice-consistency/multi-speaker AND
  // deepfake/lip-sync actually run against — so the first moment BOTH
  // exist is the right moment to auto-run them, regardless of which of the
  // two just landed (the normal VideoPD flow captures liveness first, but
  // this doesn't assume that order). Requested live: no reason to make the
  // underwriter click a button for this either, same reasoning as the
  // live-call trigger above. A re-upload of either clip (e.g. retaking a
  // flagged recording) re-fires this too, which is correct — a new clip
  // deserves a fresh check, not a stale cached verdict. Fire-and-forget,
  // same non-blocking/error-swallowing reasoning as above; deepfake/
  // lip-sync still respect their admin feature toggles via runVoiceCheck's
  // own defaulting (see src/lib/runVoiceCheck.ts). runAssetDetection:
  // false — asset detection has its own earlier, standalone trigger right
  // below (it only ever needs the business-verification clip, so it
  // doesn't wait on this one); without this it'd redundantly re-run here
  // too on the (normal) upload order where liveness already landed first.
  if (type === "VIDEOPD_LIVENESS" || type === "VIDEOPD_BUSINESS_VERIFICATION") {
    const otherType = type === "VIDEOPD_LIVENESS" ? "VIDEOPD_BUSINESS_VERIFICATION" : "VIDEOPD_LIVENESS";
    const otherEvidence = await db.uploadedEvidence.findUnique({
      where: { applicationId_type: { applicationId, type: otherType as any } },
    });
    if (otherEvidence?.mimeType.startsWith("video/") && (file.type || "").startsWith("video/")) {
      runVoiceCheck(applicationId, { runGuidedFlow: true, runAssetDetection: false }).catch((e) => {
        console.error("[api/upload] auto voice-check on guided-flow completion failed:", e);
      });
    }
  }

  // Asset detection only ever needs the business-verification clip (see
  // runVoiceCheck.ts's own doc comment) — unlike the guided-flow/deepfake/
  // lip-sync trigger above, there's no reason to make it wait on the
  // liveness clip too. Requested live: run it the moment the
  // business-verification video itself finishes uploading, asynchronously,
  // regardless of upload order or whether the liveness clip has landed yet.
  // Scoped to asset-detection-only (everything else false) — the trigger
  // above already owns guided-flow/deepfake/lip-sync once both clips
  // exist. A re-upload of the business-verification clip (e.g. retaking
  // it) re-fires this too — a new clip deserves a fresh checklist, not a
  // stale one. Fire-and-forget, same non-blocking/error-swallowing
  // reasoning as above; still respects FeatureSettings.assetDetectionCheckEnabled
  // via runVoiceCheck's own defaulting. The underwriter's "Run voice
  // check" button on the case page can always retrigger this (and every
  // other check) on demand.
  if (type === "VIDEOPD_BUSINESS_VERIFICATION" && (file.type || "").startsWith("video/")) {
    runVoiceCheck(applicationId, { runGuidedFlow: false, runDeepfake: false, runLipSync: false, runAssetDetection: true }).catch((e) => {
      console.error("[api/upload] auto asset-detection check on business-verification upload failed:", e);
    });
  }

  return NextResponse.json({ evidence });
}
