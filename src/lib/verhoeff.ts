/**
 * Verhoeff checksum (ISO/IEC 7064) — the checksum scheme UIDAI uses for the
 * 12th (last) digit of every real Aadhaar number. Used here purely as a
 * plausibility filter on OCR output: aadhaarOcr.ts's number-shaped regex
 * (`\d{4}\s?\d{4}\s?\d{4}`) can just as easily match an unrelated 12-digit
 * run the OCR engine misread out of noisy card text — running the result
 * through this check rejects most of those before they ever reach the form,
 * without needing any external UIDAI API call. A digit string passing this
 * check is a plausible Aadhaar number, not a verified-real one — it says
 * nothing about whether that specific number is issued, active, or belongs
 * to the person in the photo.
 *
 * Standard, publicly documented tables — not UIDAI-specific secrets, the
 * same algorithm used for e.g. some ISO 7812 check digits elsewhere.
 */

const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True if `digits` (a plain string of ASCII digits, e.g. a 12-digit
 * Aadhaar number with its own trailing check digit included) satisfies the
 * Verhoeff checksum. Returns false for anything that isn't all digits. */
export function verhoeffIsValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    const digit = Number(reversed[i]);
    c = D_TABLE[c][P_TABLE[i % 8][digit]];
  }
  return c === 0;
}
