/**
 * ID-document text cross-check — OCRs the uploaded ID_PROOF photo and
 * compares the ID number it finds against the ID number the borrower typed
 * into the application form (`LoanApplication.idNumber`). A real gap this
 * closes: face-match (`src/lib/faceMatch.ts`) only ever compares the
 * PHOTO on the ID proof against the borrower's liveness recording — nothing
 * previously checked whether the number printed on the document actually
 * matches what was declared, so a borrower could upload someone else's
 * (or a fabricated) ID photo with their own typed number and nothing would
 * catch the mismatch.
 *
 * Reliable regex extraction only exists for ID types with a genuinely
 * consistent national format:
 *   - Aadhaar: 12 digits, conventionally grouped in 4s.
 *   - PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F) — a fixed,
 *     government-mandated format.
 *   - Voter ID (EPIC): 3 letters + 7 digits — the Election Commission of
 *     India's standard format, consistent nationally.
 * Driving licence numbers vary too much by issuing state (format, length,
 * separators) to match reliably by pattern — deliberately NOT attempted;
 * returns NOT_APPLICABLE rather than guessing at a format and producing
 * unreliable false mismatches.
 *
 * OCR itself (Tesseract.js, the same engine already used for scanned bank
 * statements — see bankStatement.ts) is imperfect on a photographed card:
 * glare, angle, and low resolution all cause real misreads. A FLAGGED
 * result here is advisory, same as every other check in this app — it
 * means "the numbers didn't match after OCR", not "confirmed fraud".
 */

export interface IdNumberCheckResult {
  status: "PASSED" | "FLAGGED" | "NOT_APPLICABLE";
  notes: string;
}

const AADHAAR_RE = /\b(\d{4}\s?\d{4}\s?\d{4})\b/;
const PAN_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
const VOTER_ID_RE = /\b([A-Z]{3}[0-9]{7})\b/;

function normalize(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

const SUPPORTED: Record<string, { pattern: RegExp; label: string }> = {
  aadhaar: { pattern: AADHAAR_RE, label: "Aadhaar" },
  pan: { pattern: PAN_RE, label: "PAN" },
  voter_id: { pattern: VOTER_ID_RE, label: "Voter ID (EPIC)" },
};

export function checkIdNumberMatch(
  idType: string | null,
  declaredIdNumber: string | null,
  ocrText: string
): IdNumberCheckResult {
  if (!declaredIdNumber) {
    return { status: "NOT_APPLICABLE", notes: "No ID number was declared on the application to compare against." };
  }

  const config = idType ? SUPPORTED[idType] : undefined;
  if (!config) {
    return {
      status: "NOT_APPLICABLE",
      notes: `Automatic ID-number cross-check isn't attempted for ${idType ?? "this ID type"} — the format varies too much (e.g. by issuing state, for a driving licence) to match reliably by pattern. Verify the number visually against the photo.`,
    };
  }

  // Uppercase the OCR text before matching PAN/Voter ID (Tesseract can read
  // clear card-print letters as either case; the ID numbers themselves are
  // always uppercase) — Aadhaar's all-digit pattern doesn't need this.
  const searchText = ocrText.toUpperCase();
  const match = searchText.match(config.pattern);
  if (!match) {
    return {
      status: "NOT_APPLICABLE",
      notes: `Couldn't find a ${config.label}-shaped number anywhere in the extracted text — the photo may be angled, blurry, or partially obscured. Verify the number visually against the photo.`,
    };
  }

  const extracted = normalize(match[1]);
  const declared = normalize(declaredIdNumber);
  if (extracted === declared) {
    return {
      status: "PASSED",
      notes: `${config.label} number on the document (${match[1]}) matches the ${config.label} number declared on the application.`,
    };
  }
  return {
    status: "FLAGGED",
    notes: `${config.label} number extracted from the document (${match[1]}) does not match the ${config.label} number declared on the application (${declaredIdNumber}). OCR can misread individual characters — verify visually before treating this as confirmed.`,
  };
}
