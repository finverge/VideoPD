import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { mockQualityCheck } from "@/lib/mockChecks";

// Matches the 25mb ceiling next.config.mjs already sets for Server Actions —
// that setting doesn't apply to Route Handlers like this one though (no
// built-in Next.js body-size limit here), so this route had no upper bound
// at all until this check: any size, any file, silently accepted onto disk.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
  await writeFile(filePath, bytes);

  const quality = mockQualityCheck(bytes.length, file.type || "application/octet-stream", type);

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
      // Reset to PENDING/null; whatever analysis step normally follows this
      // upload (e.g. liveness-result) recomputes it fresh against the new
      // file, same as it would for a brand-new row.
      authenticityStatus: "PENDING",
      authenticityNotes: null,
      livenessBlinkCount: null,
      livenessNoFacePct: null,
      livenessLookedAwayPct: null,
      livenessOffCameraGlances: null,
      livenessRecordingSeconds: null,
      faceMatchDistance: null,
      faceMatchResult: null,
    },
  });

  if (existing && existing.filePath !== evidence.filePath) {
    try {
      await unlink(path.join(process.cwd(), existing.filePath));
    } catch {
      // Old file already missing/removed — not fatal, the DB row is the
      // source of truth and it's already been replaced above.
    }
  }

  return NextResponse.json({ evidence });
}
