import { NextRequest, NextResponse } from "next/server";
import path from "path";
import os from "os";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { extractFromImage, joinAddress } from "@/lib/aadhaarQr";
import { extractFromImageOcr } from "@/lib/aadhaarOcr";

const execFileAsync = promisify(execFile);

/** Rasterizes a PDF's first page to a PNG buffer via the same
 * scripts/rasterize-pdf.py subprocess bankStatement.ts already uses for
 * scanned-PDF OCR — reused as-is, not reimplemented, since it's already a
 * real, working PyMuPDF renderer in this codebase. Only the first page:
 * the e-Aadhaar PDF UIDAI's own website issues is always one page, and
 * this feature has no reason to look past it even if a borrower uploads
 * something longer. 200 DPI (the script's own fixed setting) renders the
 * embedded QR at real resolution — meaningfully better than a photographed
 * card in practice, since there's no camera angle/lighting/focus involved
 * at all; the QR path above should succeed on most genuine e-Aadhaar PDFs
 * even when a photo of the same card wouldn't.
 *
 * Returns null on any failure (a password-protected PDF included — UIDAI's
 * own e-Aadhaar download is often password-protected with the first 4
 * letters of the holder's name + birth year, which this makes no attempt
 * to guess) rather than throwing, so the caller can fall through to a
 * clear, honest message instead of a raw error. */
async function rasterizeFirstPdfPage(pdfBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "aadhaar-pdf-"));
  try {
    const pdfPath = path.join(tmpDir, "input.pdf");
    await writeFile(pdfPath, pdfBuffer);
    const scriptPath = path.join(process.cwd(), "scripts", "rasterize-pdf.py");
    const { stdout } = await execFileAsync("python", [scriptPath, pdfPath, tmpDir, "1"], { maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout) as { pageCount: number; renderedPages: number; files: string[] };
    if (result.files.length === 0) return null;
    return await readFile(result.files[0]);
  } catch {
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Auto-fill entry point, called right after OTP verification lands the
// borrower on /apply/[id]'s step 0 — before they've typed anything. Takes
// a photo of the borrower's Aadhaar card, tries to decode its QR code, and
// returns the demographic fields it found for the client to pre-fill
// (never auto-submitted — see aadhaarQr.ts's own doc comment for why this
// is a data-entry convenience, not identity verification).
//
// QR-first, OCR-fallback: real-world card photos vary a lot (different
// rooms, lighting, phone cameras) and a wide reference-style photo often
// makes the QR too low-resolution to decode — confirmed directly against
// real borrower-submitted cards, not a hypothetical. Rather than drop
// straight to "fill in everything by hand" the moment the QR fails, this
// now tries reading the printed text on the same photo (aadhaarOcr.ts)
// before giving up — lower confidence than the QR path, surfaced to the
// client via `source: "ocr"` so the UI can ask for a more careful review.
//
// Deliberately stateless and not applicationId-scoped: this runs before
// the caller necessarily has anything else on file, doesn't write
// anything, and the image itself is never persisted here — if the
// borrower's photo turns out to be good enough to also serve as their
// ID_PROOF evidence, that's a separate, existing upload call
// (api/upload/route.ts) the client makes on its own, not something this
// route does implicitly.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file uploaded." }, { status: 400 });
  }
  const isPdf = file.type === "application/pdf";
  if (!file.type.startsWith("image/") && !isPdf) {
    return NextResponse.json({ success: false, error: "Please upload a photo (JPEG/PNG) or PDF of your Aadhaar." }, { status: 400 });
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  if (isPdf) {
    const rendered = await rasterizeFirstPdfPage(buffer);
    if (!rendered) {
      // Most common real cause: UIDAI's own e-Aadhaar download is
      // password-protected by default, and this makes no attempt to guess
      // that password (first-4-letters-of-name + birth year) — a genuine
      // limitation worth naming, not a silent generic failure.
      return NextResponse.json({
        success: false,
        error: "Couldn't read that PDF — it may be password-protected (common for UIDAI's e-Aadhaar download). Try a photo of the printed card instead.",
      });
    }
    buffer = rendered;
  }

  const qrResult = await extractFromImage(buffer);

  if (qrResult.success) {
    return NextResponse.json({
      success: true,
      source: qrResult.source,
      fields: {
        fullName: qrResult.fields.name,
        dob: qrResult.fields.dob,
        gender: qrResult.fields.gender,
        currentAddress: joinAddress(qrResult.fields),
        idNumber: null, // never from the QR path — see aadhaarQr.ts's own doc comment on why
      },
    });
  }

  const ocrResult = await extractFromImageOcr(buffer);
  if (!ocrResult.success) {
    // Not an error response — neither QR nor OCR finding anything is a
    // normal, expected outcome (worn card, poor photo, wrong document
    // entirely). 200 with success:false lets the client show "couldn't
    // read that — no problem, fill in your details below" without
    // treating it as a failure. Surfaces the OCR attempt's own error
    // (more specific than the QR one) since OCR ran last.
    return NextResponse.json({ success: false, error: ocrResult.error });
  }

  return NextResponse.json({
    success: true,
    source: "ocr",
    fieldsFound: ocrResult.fieldsFound,
    fields: {
      fullName: ocrResult.fields.name,
      dob: ocrResult.fields.dob,
      gender: ocrResult.fields.gender,
      currentAddress: ocrResult.fields.address,
      idNumber: ocrResult.fields.idNumber,
    },
  });
}
