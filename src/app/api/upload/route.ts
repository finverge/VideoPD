import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
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

  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "uploads", applicationId);
  await mkdir(dir, { recursive: true });
  const safeName = `${type}-${nanoid(8)}-${file.name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, safeName);
  await writeFile(filePath, bytes);

  const quality = mockQualityCheck(bytes.length, file.type || "application/octet-stream");

  const evidence = await db.uploadedEvidence.create({
    data: {
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
  });

  return NextResponse.json({ evidence });
}
