/**
 * Aadhaar OCR fallback — runs when aadhaarQr.ts can't find/decode a QR at
 * all (real, common outcome: the QR on a wide reference photo of the whole
 * card is often too small/low-density to decode — confirmed directly
 * against real borrower-submitted card photos, not a hypothetical). Rather
 * than leave the borrower to type everything by hand whenever the QR fails,
 * this reads the printed text on the same photo instead — genuinely lower
 * confidence than the QR path (OCR misreads on a photographed card are
 * common — glare, angle, low resolution, a regional-language line
 * interleaved with the English one), but still real signal worth
 * pre-filling and asking the borrower to check, same "auto-fill, always
 * editable, never authoritative" posture as the QR path.
 *
 * Reuses Tesseract.js (`tesseract.js`, English), the same OCR engine
 * already used for bank-statement text extraction (bankStatement.ts) and
 * the ID-number cross-check (idProofCheck.ts) — no new OCR dependency for
 * this feature specifically.
 *
 * One deliberate difference from aadhaarQr.ts: this path DOES surface the
 * Aadhaar number. The QR module's own doc comment explains why it never
 * does — the QR's "Reference Id" field isn't the real number by UIDAI's own
 * design. Here there's no such ambiguity: the OCR is reading the actual
 * printed number straight off the card, the same number a borrower would
 * type into the idNumber field themselves, filtered through a Verhoeff
 * checksum (verhoeff.ts) so a random 12-digit OCR misread elsewhere in the
 * text doesn't get treated as it.
 *
 * What this deliberately does NOT do, same posture as the QR module:
 *   - Does not verify anything — a plausible Verhoeff-valid number is not a
 *     confirmed-real one, and none of this proves the card belongs to the
 *     person uploading it. Data-entry convenience only.
 *   - Does not attempt regional-language text at all (English-only OCR) —
 *     most cards print an English line alongside the regional-language one
 *     for exactly this kind of automated reading, so this targets that.
 *   - Address extraction is the least reliable field here by a wide margin
 *     (multi-line, no consistent label on every card layout) — returns
 *     null rather than a low-confidence guess when the heuristic can't
 *     anchor on anything.
 */
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { verhoeffIsValid } from "./verhoeff";

export interface AadhaarOcrFields {
  name: string | null;
  dob: string | null; // normalized to this app's DD/MM/YYYY
  gender: string | null; // "male" | "female" | "other"
  address: string | null;
  idNumber: string | null; // Verhoeff-valid 12-digit Aadhaar number, spaces stripped
}

export type AadhaarOcrResult =
  | { success: true; source: "ocr"; fields: AadhaarOcrFields; fieldsFound: number }
  | { success: false; error: string };

const GENDER_RE = /\b(Male|Female|Transgender)\b/i;
const DOB_RE = /\bD\s*[.:]?\s*O\s*[.:]?\s*B\s*[.:]?\s*[:\-]?\s*(\d{2})\s*[\/\-]\s*(\d{2})\s*[\/\-]\s*(\d{4})/i;
const AADHAAR_NUMBER_RE = /\b(\d{4})\s?(\d{4})\s?(\d{4})\b/g;
const PHONE_RE = /\b[6-9]\d{9}\b/; // Indian mobile numbers — used only to recognize where an address block ends, never extracted as a field itself

// Lines that are page furniture, not the borrower's name — excluded when
// picking the name candidate below. Deliberately substring-matched and
// lowercased: OCR case/spacing on these headers is inconsistent enough
// that an exact match would miss most real occurrences.
const NAME_EXCLUSIONS = [
  "government of india", "unique identification authority", "aadhaar", "आधार",
  "enrollment no", "enrolment no", "your aadhaar no", "download date", "to,", "c/o", "s/o", "w/o", "d/o",
];

function normalizeGender(raw: string): string | null {
  const g = raw.trim().toLowerCase();
  if (g === "male") return "male";
  if (g === "female") return "female";
  if (g === "transgender") return "other";
  return null;
}

function isMostlyLatin(line: string): boolean {
  const letters = line.replace(/[^\p{L}]/gu, "");
  if (letters.length === 0) return false;
  const latin = letters.replace(/[^A-Za-z]/g, "");
  return latin.length / letters.length > 0.6;
}

// Strips stray leading/trailing OCR noise (a misread bullet, a fragment of
// an adjacent Telugu/Hindi glyph rendered as e.g. "<" or "|") before
// validating the core text — real OCR output on a bilingual card routinely
// prepends/appends one or two garbage characters to an otherwise-clean
// English line (confirmed directly: "Kantaiah Chebathina" came back as
// "<anisiah Chebathina" on one real test card), so requiring the WHOLE raw
// line to be clean rejected genuinely good reads.
function coreText(line: string): string {
  return line.trim().replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z.]+$/, "");
}

// Real OCR garbage from a mangled adjacent regional-language word (e.g. the
// card's own Telugu name line) tends to produce irregular internal
// capitalization — "ToBI Swdd" instead of a real name's consistent
// Title Case ("Kantzizh Chebathina") — confirmed directly on a real test
// card. Requiring every word to look like proper Title Case rejects that
// kind of garbage without needing a dictionary of real names, which this
// app has no way to have for India's actual name diversity anyway.
function isTitleCaseWord(word: string): boolean {
  return /^[A-Z][a-z]+$/.test(word) || /^[A-Z]\.$/.test(word); // a lone initial ("K.") also counts
}

function looksLikeName(line: string): boolean {
  const core = coreText(line);
  if (core.length < 3 || core.length > 60) return false;
  if (!/^[A-Za-z][A-Za-z .]*$/.test(core)) return false;
  if (!isMostlyLatin(core)) return false;
  const lower = core.toLowerCase();
  if (NAME_EXCLUSIONS.some((ex) => lower.includes(ex))) return false;
  const words = core.split(" ").filter(Boolean);
  if (words.length < 2) return false; // a single word is more likely a stray OCR fragment than a full name
  if (!words.every(isTitleCaseWord)) return false;
  return true;
}

interface NameMatch {
  name: string;
  lineIndex: number;
  via: "to" | "dob";
}

/** Best-effort name extraction. Two anchors, tried in order:
 *   1. The "To" line the enrollment-letter/e-Aadhaar layout starts its
 *      address block with — the name is the first genuinely name-shaped
 *      line after it (not necessarily the very next line: the card's own
 *      regional-language name line usually sits between "To" and the
 *      English one, and OCRs into unrelated garbage that also needs
 *      skipping past).
 *   2. Failing that, the DOB/gender line — both real layouts checked also
 *      print the name immediately above it, which is what a plain PVC card
 *      (no "To" block at all) falls back to.
 * Returns the matched line's own index too, so extractAddress can start
 * collecting right after it — not after "To" directly, which would
 * otherwise re-swallow the name line itself as the first "address" line. */
function extractName(lines: string[], toLineIndex: number | null, dobLineIndex: number | null): NameMatch | null {
  if (toLineIndex !== null) {
    for (let i = toLineIndex + 1; i < lines.length && i < toLineIndex + 5; i++) {
      if (looksLikeName(lines[i])) return { name: coreText(lines[i]), lineIndex: i, via: "to" };
    }
  }
  if (dobLineIndex !== null) {
    for (let i = dobLineIndex - 1; i >= 0 && i >= dobLineIndex - 4; i--) {
      if (looksLikeName(lines[i])) return { name: coreText(lines[i]), lineIndex: i, via: "dob" };
    }
  }
  return null;
}

/** Best-effort address extraction, targeting the "To\n<name>\n<address
 * lines>\n<phone>" layout UIDAI's enrollment-letter / e-Aadhaar format uses
 * — collects English-readable lines between the name and whatever ends the
 * block (a phone number, or the "Your Aadhaar No" line), which is exactly
 * how the address appears on that layout. Returns null on the plain PVC
 * card layout, which has no equivalent block this can reliably anchor on —
 * a null address here is a known, honest gap, not a bug to silently paper
 * over with a bad guess. */
function extractAddress(lines: string[], nameLineIndex: number | null): string | null {
  if (nameLineIndex === null) return null;
  const parts: string[] = [];
  for (let i = nameLineIndex + 1; i < lines.length && i < nameLineIndex + 12; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (PHONE_RE.test(line)) break;
    if (/your aadhaar no|आधार/i.test(line)) break;
    if (!isMostlyLatin(line)) continue; // skip interleaved regional-language lines
    // The enrollment-letter layout prints the enrollment number vertically
    // in the left margin, right alongside this address block — a real,
    // confirmed OCR artifact: that sideways text gets read as a stray
    // 1-3 character token prefixed onto the start of each address line
    // ("5 Madhavaram Nagar Colony", "~ Kukatpally"). Stripped when it's
    // clearly not real address content (no vowel, or a bracket/symbol) —
    // deliberately narrow so it doesn't eat a genuine short prefix like a
    // real house/plot number.
    const cleaned = line.replace(/^[^\w\s]{0,2}[A-Za-z]{0,2}\s+(?=[A-Z])/, (m) => (/[aeiouAEIOU]/.test(m) ? m : ""));
    parts.push(cleaned.replace(/^C\/O,?\s*/i, "C/O "));
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function extractIdNumber(text: string): string | null {
  const seen = new Set<string>();
  for (const match of text.matchAll(AADHAAR_NUMBER_RE)) {
    const candidate = `${match[1]}${match[2]}${match[3]}`;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (verhoeffIsValid(candidate)) return candidate;
  }
  return null;
}

// Fallback when the "DOB" label itself doesn't survive OCR intact — real,
// confirmed outcome on a bilingual card: the label sits on the same line as
// its regional-language equivalent, and English-only OCR garbles both
// together often enough that literal D/O/B letters just aren't there to
// match against, even though the date itself (a clean run of digits) came
// through fine. A bare DD/MM/YYYY run near the gender line is a safe
// fallback specifically because both real layouts checked print DOB
// immediately next to gender — the enrollment date elsewhere on the same
// document (which would otherwise be a false-positive risk for a
// label-less date search) sits nowhere near that line.
const BARE_DATE_RE = /\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/;
const CURRENT_YEAR = new Date().getFullYear();

function plausibleBirthYear(year: number): boolean {
  return year >= 1925 && year <= CURRENT_YEAR - 3;
}

function parseFields(rawText: string): AadhaarOcrFields {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  let gender: string | null = null;
  let genderLineIndex: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(GENDER_RE);
    if (m) {
      gender = normalizeGender(m[1]);
      genderLineIndex = i;
      break;
    }
  }

  let dob: string | null = null;
  let dobLineIndex: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DOB_RE);
    if (m) {
      dob = `${m[1]}/${m[2]}/${m[3]}`;
      dobLineIndex = i;
      break;
    }
  }
  if (dob === null && genderLineIndex !== null) {
    for (let i = Math.max(0, genderLineIndex - 3); i <= genderLineIndex; i++) {
      const m = lines[i]?.match(BARE_DATE_RE);
      if (m && plausibleBirthYear(Number(m[3]))) {
        dob = `${m[1]}/${m[2]}/${m[3]}`;
        dobLineIndex = i;
        break;
      }
    }
  }

  // Address collection starts right after wherever the name itself was
  // actually found, not right after "To" — otherwise, whenever the name
  // sits a few lines below "To" (regional-language OCR garbage in
  // between), the name line itself gets re-swallowed as the first
  // "address" line. Only valid when the name came from the "To" anchor —
  // a DOB-adjacent name match sits nowhere near an address block, so using
  // its line index here would scoop up the DOB/gender lines instead.
  const toLineIndex = lines.findIndex((l) => /^to,?$/i.test(l.trim()));
  const nameMatch = extractName(lines, toLineIndex >= 0 ? toLineIndex : null, dobLineIndex);
  const address = extractAddress(lines, nameMatch?.via === "to" ? nameMatch.lineIndex : null);

  const idNumber = extractIdNumber(rawText);

  return { name: nameMatch?.name ?? null, dob, gender, address, idNumber };
}

// Real, measured effect (not a guess): a 423×848 real card photo OCR'd
// almost entirely as garbage at native resolution — upscaling to ~3x plus
// grayscale/contrast-normalize/sharpen turned that into a mostly-readable
// name/address block and a clean "Male" gender read, from the exact same
// source photo. Only upscales when genuinely small; never downscales a
// photo that's already high-resolution.
const MIN_OCR_DIMENSION = 2000;

async function preprocessForOcr(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const longestSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const scale = longestSide > 0 && longestSide < MIN_OCR_DIMENSION ? MIN_OCR_DIMENSION / longestSide : 1;

  let pipeline = sharp(imageBuffer).grayscale().normalize().sharpen({ sigma: 1.5 });
  if (scale > 1 && meta.width && meta.height) {
    pipeline = pipeline.resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { kernel: "cubic" });
  }
  return pipeline.toBuffer();
}

/** Runs Tesseract (English) on the uploaded image and extracts whatever
 * fields the heuristics above can confidently anchor on. Never throws for
 * an ordinary "couldn't read much" outcome — same "missing data is normal,
 * not an error" posture as aadhaarQr.ts; returns success:true with
 * whichever fields came back non-null (possibly all null, if the photo was
 * unreadable) rather than a hard failure, so the caller can still show
 * "found N fields" instead of a blanket error. */
export async function extractFromImageOcr(imageBuffer: Buffer): Promise<AadhaarOcrResult> {
  const tmpPath = path.join(os.tmpdir(), `aadhaar-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    const processed = await preprocessForOcr(imageBuffer).catch(() => imageBuffer); // preprocessing failure shouldn't block OCR — falls back to the original bytes
    await fs.writeFile(tmpPath, processed);
    const Tesseract = await import("tesseract.js");
    const { data } = await Tesseract.recognize(tmpPath, "eng");
    const text = data.text ?? "";
    if (text.trim().length < 10) {
      return { success: false, error: "Couldn't read any text from that photo — it may be too blurry, dark, or angled." };
    }
    const fields = parseFields(text);
    const fieldsFound = Object.values(fields).filter((v) => v !== null).length;
    if (fieldsFound === 0) {
      return { success: false, error: "Read the photo, but couldn't confidently identify any of your details in it." };
    }
    return { success: true, source: "ocr", fields, fieldsFound };
  } catch {
    return { success: false, error: "Something went wrong reading that photo." };
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}
