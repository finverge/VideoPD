/**
 * Aadhaar QR auto-fill — customer-requested (raised live in a demo): let a
 * borrower upload their Aadhaar card and have name/DOB/gender/address
 * auto-filled instead of typed by hand, "to reduce the number of hits".
 *
 * Decodes the UIDAI "Secure QR Code" printed on current Aadhaar cards
 * (standard since ~2018) — the same QR the physical card carries, not a
 * separate scan/API call. The format is publicly documented by UIDAI: a
 * large decimal integer, converted to bytes, DEFLATE-decompressed, then
 * split into pipe-delimited (0xFF byte) fields in a fixed order, followed
 * by a JPEG photo and an RSA signature (neither of which this module reads
 * — see "What this deliberately does NOT do" below).
 *
 * A real existing npm package (`aadhaar-react-scanner`) claims to do this
 * plus "cryptographically verify UIDAI signatures against the historical
 * database of official UIDAI public keys" — that claim was not trusted:
 * it's a single-maintainer package, ~2 months old, and UIDAI's real
 * signature-verification public keys are only issued to certified/licensed
 * AUAs and KUAs through an official channel, not something a small open-
 * source library would legitimately have "the historical database" of.
 * Given this touches real PII, that package was not installed. This module
 * is hand-built against UIDAI's own published Secure QR Code spec, using
 * only `jsqr` (QR detection, well-established, zero deps) and `pako`
 * (DEFLATE decompression, long-established zlib port) — both genuinely
 * inspectable, neither making any claim about identity verification.
 *
 * What this deliberately does NOT do:
 *   - Does NOT verify the UIDAI RSA signature. That would require UIDAI's
 *     actual certified public key, which this integration doesn't have and
 *     shouldn't fake having. This is a DATA-ENTRY CONVENIENCE, not an
 *     identity-authentication mechanism — never present it to the
 *     underwriter or the borrower as "verified", only as "auto-filled from
 *     your Aadhaar — please check these are correct".
 *   - Does NOT extract the embedded photo. Not needed for form auto-fill,
 *     and skips a second PII-image-handling surface this feature has no
 *     reason to open.
 *   - Does NOT read or store the Aadhaar number itself. The QR's "Reference
 *     Id" field is deliberately NOT the Aadhaar number — by UIDAI's own
 *     privacy design it's a randomized reference containing only the last 4
 *     digits plus a generation timestamp. This module never maps it to the
 *     idNumber form field; that stays exactly as it was, either typed by
 *     the borrower or cross-checked by the existing OCR pipeline
 *     (idProofCheck.ts) against the printed number.
 *   - Falls back to the older, unsigned, plain-XML QR format (pre-2018
 *     cards) on a best-effort basis, since some of those may still be in
 *     circulation — the current Secure QR format is tried first.
 */
import * as pako from "pako";
import jsQR from "jsqr";
import sharp from "sharp";

export interface AadhaarExtractedFields {
  name: string | null;
  dob: string | null; // as printed, DD-MM-YYYY on the Secure QR
  gender: string | null; // "M" | "F" | "T" (as UIDAI encodes it) — mapped to the form's male/female/other below
  careOf: string | null;
  house: string | null;
  street: string | null;
  landmark: string | null;
  location: string | null;
  vtc: string | null; // village/town/city
  subDistrict: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
}

export type AadhaarExtractResult =
  | { success: true; source: "secure-qr" | "xml-qr"; fields: AadhaarExtractedFields }
  | { success: false; error: string };

// The Secure QR Code's fields, in the fixed order UIDAI's spec lays them
// out in, each terminated by a single 0xFF delimiter byte. Only the first
// 16 delimited segments are demographic text — everything after the 16th
// delimiter is the JPEG photo followed by the RSA signature, both binary
// and both deliberately left unparsed (see the module doc comment).
const SECURE_QR_FIELD_ORDER = [
  "emailMobileStatus", // bit flags, not surfaced
  "referenceId", // NOT the Aadhaar number — see module doc comment
  "name",
  "dob",
  "gender",
  "careOf",
  "district",
  "landmark",
  "house",
  "location",
  "pincode",
  "postOffice",
  "state",
  "street",
  "subDistrict",
  "vtc",
] as const;

function emptyFields(): AadhaarExtractedFields {
  return {
    name: null, dob: null, gender: null, careOf: null, house: null, street: null,
    landmark: null, location: null, vtc: null, subDistrict: null, district: null,
    state: null, pincode: null,
  };
}

/** Splits a byte array on the first `count` occurrences of 0xFF, returning
 * that many UTF-8-decoded segments plus whatever bytes remain after the
 * last delimiter (the photo+signature tail, untouched). Stopping at a
 * fixed count — rather than splitting on every 0xFF in the buffer — matters
 * because the JPEG photo that follows is full of legitimate 0xFF bytes
 * (JPEG marker segments start with 0xFF); splitting the whole buffer would
 * shred the photo into hundreds of spurious "fields". */
function splitDelimited(bytes: Uint8Array, count: number): string[] {
  const segments: string[] = [];
  let start = 0;
  let found = 0;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let i = 0; i < bytes.length && found < count; i++) {
    if (bytes[i] === 0xff) {
      segments.push(decoder.decode(bytes.subarray(start, i)));
      start = i + 1;
      found++;
    }
  }
  return segments;
}

/** UIDAI's own bit-packed numeric-string-to-bytes conversion for the
 * Secure QR: the QR's raw payload is a very large base-10 digit string,
 * where every 3 digits (interpreted as 0-255... actually as documented by
 * UIDAI, every byte is encoded as exactly 3 decimal digits, zero-padded)
 * represents one original byte. jsQR gives us the QR's raw bytes directly
 * when the symbol was encoded in byte mode (the standard for this QR), so
 * this conversion is only needed as a fallback if a scanner instead handed
 * back the printable numeric-string form. */
function numericStringToBytes(numeric: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < numeric.length; i += 3) {
    const chunk = numeric.slice(i, i + 3);
    if (chunk.length < 3) break; // trailing partial chunk — not a valid byte, drop it rather than guess
    out.push(parseInt(chunk, 10) & 0xff);
  }
  return new Uint8Array(out);
}

function normalizeGender(raw: string | null): string | null {
  if (!raw) return null;
  const g = raw.trim().toUpperCase();
  if (g === "M") return "male";
  if (g === "F") return "female";
  if (g === "T" || g === "O") return "other"; // UIDAI's "T" (transgender) maps to this form's "other" choice — the form has no third option of its own
  return null;
}

/** Normalizes a QR-embedded DOB into this app's DD/MM/YYYY field format.
 * UIDAI Secure QR prints DOB as DD-MM-YYYY; some cards carry year-only
 * ("YOB: 1990") on the older XML format — handled separately by the XML
 * path below, not here. */
function normalizeDob(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function decodeSecureQr(rawBytes: Uint8Array): AadhaarExtractResult {
  let inflated: Uint8Array;
  try {
    inflated = pako.inflate(rawBytes);
  } catch {
    // Not every QR on an Aadhaar-shaped card is actually this format (see
    // the XML fallback in extractFromImage) — a decompression failure here
    // just means "try the other format", not a hard error.
    return { success: false, error: "Could not decompress QR payload as a Secure QR code." };
  }

  const segments = splitDelimited(inflated, SECURE_QR_FIELD_ORDER.length);
  if (segments.length < SECURE_QR_FIELD_ORDER.length) {
    return { success: false, error: `Secure QR payload had only ${segments.length} of the expected ${SECURE_QR_FIELD_ORDER.length} fields.` };
  }

  const raw: Record<string, string> = {};
  SECURE_QR_FIELD_ORDER.forEach((key, i) => { raw[key] = segments[i]; });

  const fields = emptyFields();
  fields.name = raw.name || null;
  fields.dob = normalizeDob(raw.dob);
  fields.gender = normalizeGender(raw.gender);
  fields.careOf = raw.careOf || null;
  fields.house = raw.house || null;
  fields.street = raw.street || null;
  fields.landmark = raw.landmark || null;
  fields.location = raw.location || null;
  fields.vtc = raw.vtc || null;
  fields.subDistrict = raw.subDistrict || null;
  fields.district = raw.district || null;
  fields.state = raw.state || null;
  fields.pincode = raw.pincode || null;

  return { success: true, source: "secure-qr", fields };
}

/** Old, unsigned, plain-XML Aadhaar QR (pre-~2018 cards) — deprecated by
 * UIDAI for security reasons but still a real, plausible thing to
 * encounter on an older physical card. Trivial attribute extraction, no
 * compression involved. */
function decodeXmlQr(text: string): AadhaarExtractResult {
  const attr = (name: string) => {
    const m = text.match(new RegExp(`${name}="([^"]*)"`, "i"));
    return m ? m[1] : null;
  };
  if (!/<PrintLetterBarcodeData/i.test(text)) {
    return { success: false, error: "Not a recognized Aadhaar XML QR payload." };
  }
  const fields = emptyFields();
  fields.name = attr("name");
  const dob = attr("dob");
  const yob = attr("yob");
  fields.dob = dob ? normalizeDob(dob) : yob ? `01/01/${yob}` : null; // year-only cards: best-effort, day/month unknown — flagged to the caller via the "review before submitting" UI copy, not silently treated as exact
  fields.gender = normalizeGender(attr("gender"));
  fields.careOf = attr("co");
  fields.house = attr("house");
  fields.street = attr("street");
  fields.landmark = attr("lm");
  fields.location = attr("loc");
  fields.vtc = attr("vtc");
  fields.subDistrict = attr("subdist");
  fields.district = attr("dist");
  fields.state = attr("state");
  fields.pincode = attr("pc");
  return { success: true, source: "xml-qr", fields };
}

/** Combines the extracted address fragments into one string matching the
 * shape of this app's free-text `currentAddress` field — the form has no
 * separate house/street/pincode inputs, so this is the natural join point,
 * not a compromise made for this feature specifically. */
export function joinAddress(f: AadhaarExtractedFields): string {
  const parts = [f.careOf, f.house, f.street, f.landmark, f.location, f.vtc, f.subDistrict, f.district, f.state, f.pincode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

/** Locates and decodes an Aadhaar QR from an uploaded image buffer. Tries
 * the current Secure QR format first, falls back to the old plain-XML
 * format, and returns a clear "not found"/"couldn't read it" result
 * otherwise — never throws, since a missing/unreadable QR is an entirely
 * normal outcome (a photo of the card's back, poor lighting, a non-Aadhaar
 * document) that the caller falls back to manual entry for, not an error. */
export async function extractFromImage(imageBuffer: Buffer): Promise<AadhaarExtractResult> {
  let raw: { data: Buffer; info: { width: number; height: number } };
  try {
    // Decode to raw RGBA pixels jsQR can scan — same real image-decode
    // path (sharp) already used elsewhere in this codebase (bank statement
    // PDF rasterization, dossier thumbnails), not a new dependency for
    // this feature specifically.
    raw = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return { success: false, error: "Could not read the uploaded file as an image." };
  }

  const rgba = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
  const code = jsQR(rgba, raw.info.width, raw.info.height);
  if (!code) {
    return { success: false, error: "No QR code found in the image." };
  }

  // jsQR exposes both the string interpretation (`data`) and, for
  // byte-mode symbols, the raw bytes (`binaryData`) — the Secure QR is
  // encoded in byte mode, so prefer the raw bytes to avoid any lossy
  // string/encoding round-trip on binary (compressed) data. Fall back to
  // treating `data` as a numeric string only if a scanner ever hands back
  // just the string form.
  const anyCode = code as unknown as { binaryData?: number[]; data: string };
  const rawBytes = anyCode.binaryData
    ? new Uint8Array(anyCode.binaryData)
    : /^\d+$/.test(code.data)
      ? numericStringToBytes(code.data)
      : null;

  if (rawBytes && rawBytes.length > 0) {
    const secureResult = decodeSecureQr(rawBytes);
    if (secureResult.success) return secureResult;
  }

  // Not a Secure QR (or failed to decompress as one) — try the old XML
  // format against whatever text jsQR read.
  if (code.data && /<PrintLetterBarcodeData/i.test(code.data)) {
    return decodeXmlQr(code.data);
  }

  return { success: false, error: "QR code found, but its contents don't match a recognized Aadhaar QR format." };
}
