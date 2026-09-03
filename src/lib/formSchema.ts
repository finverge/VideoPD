import type { SegmentCode } from "@/types";

export type FieldType = "text" | "number" | "choice" | "textarea";

export interface FieldDef {
  key: string;
  labelKey: string; // i18n key
  type: FieldType;
  // aliases: extra strings the voice/text field-matcher (dialogManager's
  // extractFieldValue) should also accept for this choice, beyond its own
  // value/label. For a small, known set of speech-to-text mishearings or
  // autocorrect substitutions — not a general fuzzy-match mechanism.
  choices?: { value: string; labelKey: string; aliases?: string[] }[];
  // choicesBySegment: narrows `choices` to just the options relevant to a
  // specific segment (e.g. loan product) — BRD Section 3's own segment
  // descriptions already imply a natural per-segment subset ("Vocational-
  // training students — education/skilling loans"; "Small factory/workshop
  // owners — working-capital or asset-purchase loans"; "Farmers — seasonal/
  // agri-input and equipment finance"), but the picker previously showed the
  // same undifferentiated full list to every segment regardless (reported
  // live — "why is it asking for loan product again" right after already
  // picking Business/Student, seeing Education/Agri Input options that
  // don't fit). Falls back to `choices` for a segment not listed here, or
  // when segment isn't known yet (resolveChoices below).
  choicesBySegment?: Partial<Record<SegmentCode, { value: string; labelKey: string; aliases?: string[] }[]>>;
  required?: boolean;
  step: number; // wizard step index this field belongs to
  hint?: string; // small persistent guidance text shown below the field
  placeholder?: string;
  // Format check for a "text" field, checked once it's non-empty (a blank
  // optional field is a `required` concern, not a format one — see
  // fieldValidationError below). Reported live, priority fix: bank IFSC and
  // the institute-contact phone number both accepted literally anything —
  // no length or shape check at all, so a garbled or truncated value
  // (a common voice-dictation/fat-finger failure mode, same class of bug
  // as the Aadhaar trailing-period issue) went straight through to a case
  // an underwriter would only catch by eye, if they caught it at all. A
  // follow-up full audit of every other field turned up more of the same
  // shape (email, DOB, bank account number, ID number) — see each field's
  // own pattern/validate below for what was actually missing.
  pattern?: RegExp;
  patternHint?: string; // shown under the field, and blocks Next until fixed — same "can't do something the button wouldn't already allow" principle as evidenceComplete on the upload step
  // Native HTML bounds for a "number" field — also enforced by
  // fieldValidationError below, not just left to the browser's own spinner
  // (someone can still type a negative value directly). Only set where a
  // value below the bound is nonsensical (dependents, years, amounts) —
  // never an invented business ceiling (e.g. a max loan amount) this
  // codebase has no real basis for.
  min?: number;
  max?: number;
  // Escape hatch for a check a regex/min/max can't express — currently
  // just DOB (must be a real calendar date, not just DD/MM/YYYY-shaped)
  // and idNumber (the right shape depends on the sibling idType field, so
  // it needs to see every other value on the step, not just its own).
  validate?: (value: string, allValues: Record<string, unknown>) => string | null;
}

/** The validation message for `field`/`value` (or null if it's fine),
 * checking pattern, min/max, and a custom `validate` in that order, against
 * `allValues` for the rare cross-field case (idNumber vs. idType). Shared by
 * every renderer that shows a field (StepFields, the segment-fields grid)
 * and by the wizard's own Next-button/Enter-key gate, so "what counts as
 * invalid" and "what actually blocks moving on" can never quietly drift
 * apart. A blank value is always fine here — that's a `required` concern,
 * a separate, not-yet-enforced check (see CaseDetailPage's own note on this
 * same gap in the underwriter workspace's Next button). */
export function fieldValidationError(
  field: { pattern?: RegExp; patternHint?: string; min?: number; max?: number; validate?: (v: string, all: Record<string, unknown>) => string | null },
  value: unknown,
  allValues: Record<string, unknown> = {}
): string | null {
  const str = value == null ? "" : String(value).trim();
  if (!str) return null;
  if (field.pattern && !field.pattern.test(str)) return field.patternHint ?? "Invalid format.";
  if (field.min !== undefined || field.max !== undefined) {
    const num = Number(str);
    if (!Number.isNaN(num)) {
      if (field.min !== undefined && num < field.min) return `Must be ${field.min} or more.`;
      if (field.max !== undefined && num > field.max) return `Must be ${field.max} or less.`;
    }
  }
  if (field.validate) return field.validate(str, allValues);
  return null;
}

// RBI IFSC format: 4 alphabetic bank-code characters, a literal "0"
// (reserved for future use), then 6 alphanumeric branch-code characters —
// always exactly 11 characters. Case-insensitive match (borrowers commonly
// type these lowercase); stored exactly as typed, not force-uppercased.
export const IFSC_PATTERN = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
export const IFSC_HINT = "Enter a valid 11-character IFSC code (4 letters, then 0, then 6 letters/digits) — e.g. SBIN0001234.";

// Same 10-digit shape as the landing page's own borrower-mobile check
// (src/app/page.tsx's sendOtp) — kept as one pattern here so both never
// silently diverge.
export const MOBILE_PATTERN = /^\d{10}$/;
export const MOBILE_HINT = "Enter a valid 10-digit mobile number.";

// Deliberately simple (has an @, has a dot after it) rather than a
// pedantically "complete" RFC 5322 pattern — this only needs to catch
// obviously-not-an-email input (a name, a phone number typed here by
// mistake), not police edge cases like quoted local parts nobody's address
// actually uses.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_HINT = "Enter a valid email address, e.g. name@example.com.";

// Real Indian bank account numbers have no single fixed length (SBI, HDFC,
// ICICI etc. each use their own — commonly 9 to 18 digits), so this is a
// sanity range, not a claimed standard the way IFSC's 11 characters is —
// wide enough to accept any real account number, narrow enough to catch
// obvious garbage (letters, a 3-digit typo, a pasted IFSC into the wrong box).
export const BANK_ACCOUNT_PATTERN = /^\d{9,18}$/;
export const BANK_ACCOUNT_HINT = "Enter a valid bank account number (digits only, 9–18 digits).";

// DD/MM/YYYY, and a REAL calendar date, not just three number groups in
// that shape — a regex alone would happily accept "31/02/2020" or a date in
// the future. Deliberately does NOT enforce a minimum age: whether/what age
// floor applies is a lending-eligibility policy call, not a data-format
// one, and this codebase doesn't have Lakshya's real answer to that yet
// (same "generic default, not their calibrated policy" honesty as
// src/lib/riskParameters.ts) — a genuinely malformed or future-dated DOB is
// the only thing being caught here.
function validateDob(value: string): string | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "Enter the date as DD/MM/YYYY, e.g. 25/03/1990.";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(year, month - 1, day);
  const isRealDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  if (!isRealDate) return "That's not a real calendar date — check the day and month.";
  if (date.getTime() > Date.now()) return "Date of birth can't be in the future.";
  return null;
}

// Format depends on which ID was chosen (idType, a sibling field on the
// same Identity step) — Aadhaar/PAN/Voter ID all have a genuinely fixed
// national format; reuses the exact same three patterns
// src/lib/idProofCheck.ts already OCR-matches against, so "does this look
// right" and "does it match the photo" never quietly disagree on what
// counts as valid. Driving licence is deliberately NOT checked — format
// varies too much by issuing state to validate reliably (same reasoning
// idProofCheck.ts's own checkIdNumberMatch already documents for skipping
// it there).
const ID_NUMBER_RULES: Partial<Record<string, { pattern: RegExp; hint: string }>> = {
  aadhaar: { pattern: /^\d{12}$/, hint: "Aadhaar is 12 digits — e.g. 123456789012 (spaces are fine, but should total 12 digits)." },
  pan: { pattern: /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, hint: "PAN is 10 characters: 5 letters, 4 digits, then 1 letter — e.g. ABCDE1234F." },
  voter_id: { pattern: /^[A-Za-z]{3}[0-9]{7}$/, hint: "Voter ID (EPIC) is 3 letters followed by 7 digits — e.g. ABC1234567." },
};
function validateIdNumber(value: string, allValues: Record<string, unknown>): string | null {
  const rule = ID_NUMBER_RULES[allValues.idType as string];
  if (!rule) return null; // driving_licence, or idType not chosen yet — nothing to check against
  return rule.pattern.test(value.replace(/\s+/g, "")) ? null : rule.hint;
}

// Steps shared by every segment (FSD 4.3.1)
export const CORE_STEPS = [
  "stepPersonal",
  "stepAddress",
  "stepIdentity",
  "stepLoan",
  "stepIncome",
  "stepBank",
] as const;

// Shared once, referenced from both the base `choices` fallback and every
// choicesBySegment subset below — each segment's productType choice is a
// separate object literal (JS doesn't let a "asset_purchase" choice in
// FARMER's list share anything with the one in BUSINESS_OWNER's list), so
// without this the same alias list would need retyping four times over.
// Confirmed live (end-to-end chat test, both FARMER and VOCATIONAL_STUDENT):
// natural phrasing ("I need it to buy fertilizer and seeds", "for my course
// fees") matched nothing at all — the choice's own value/label never
// literally appears in how a borrower actually states their purpose, same
// root cause as the ownershipStatus gap above.
const PRODUCT_TYPE_ALIASES: Record<string, string[]> = {
  working_capital: ["working capital", "cash flow", "day to day expenses", "business expenses", "run my business", "run the business"],
  asset_purchase: ["buy equipment", "new equipment", "buy machinery", "purchase equipment", "buy a machine", "equipment purchase"],
  education: ["course fees", "course fee", "tuition", "tuition fees", "study", "my course", "training fees", "college fees"],
  agri_input: ["seeds", "fertilizer", "seeds and fertilizer", "farm inputs", "crop inputs", "buy seeds", "farming inputs"],
};

export const CORE_FIELDS: FieldDef[] = [
  { key: "fullName", labelKey: "fullName", type: "text", required: true, step: 0 },
  {
    key: "gender",
    labelKey: "gender",
    type: "choice",
    step: 0,
    choices: [
      // "mail"/"email" aliases: real, reproducible Web Speech API
      // mishearings of "male" (reported live — the browser transcribes it
      // as "Mail." every time), and a plausible mobile-keyboard autocorrect
      // substitution for typed input too. "email" tested and confirmed as
      // its own separate gap: "e mail"/"e-mail" already matched (they
      // tokenize into a standalone "mail" token), but a single-word "Email."
      // transcription doesn't contain "mail" as its own token at all — one
      // word, not two — so it fell through to "Sorry, I didn't quite catch
      // that" even with the "mail" alias already in place. "male", "mail",
      // and "email" share no substring the existing \b-word-boundary match
      // could catch (different letters, not a typo/adjacent-key slip), so
      // this needs explicit aliases, not a looser regex.
      // "man"/"men": confirmed live in a multi-language end-to-end test —
      // colloquial gender answers in Kannada/Malayalam ("ನಾನು ಗಂಡಸು", "ഞാൻ
      // ഒരു ആണാണ്" — "I am a man") go through resolveFieldValue's
      // translate-to-English fallback (see its own doc comment) and come
      // back as "man", not "male" — a genuinely different English word
      // from "male", not a mishearing of it, so no amount of matching
      // against "male"/"mail"/"email" would ever catch it. Telugu and
      // Tamil's equivalent phrasing translated straight to "male" and
      // needed no fix.
      //
      // The equivalent Hindi phrase ("मैं एक आदमी हूँ") stayed broken even
      // after this — traced it to the free translation API itself (MyMemory,
      // src/lib/translate.ts), not this matching logic: it translated that
      // exact phrase to "Video fuck", and a separate ownershipStatus test
      // phrase ("यह मेरा अपना घर है", "this is my own house") to "This is my
      // ball" — both unusable, one outright offensive. That's a third-party
      // translation-quality problem this codebase can't fix by changing its
      // own matching code; adding the actual Hindi word directly as an
      // alias (आदमी, "man") sidesteps needing that translation call to
      // succeed at all for this specific common phrasing. Doesn't fix the
      // underlying translation reliability for whatever wasn't anticipated
      // here — see docs/videopd-future-work.md for that as a standing risk.
      { value: "male", labelKey: "Male", aliases: ["mail", "mails", "email", "emails", "man", "men", "आदमी", "मर्द"] },
      { value: "female", labelKey: "Female" },
      { value: "other", labelKey: "Other" },
    ],
  },
  { key: "dob", labelKey: "dob", type: "text", step: 0, placeholder: "DD/MM/YYYY", hint: "Format: DD/MM/YYYY (e.g., 25/03/1990)", validate: validateDob },
  { key: "email", labelKey: "email", type: "text", step: 0, pattern: EMAIL_PATTERN, patternHint: EMAIL_HINT },
  {
    key: "maritalStatus",
    labelKey: "maritalStatus",
    type: "choice",
    step: 0,
    choices: [
      { value: "single", labelKey: "Single" },
      { value: "married", labelKey: "Married" },
    ],
  },
  { key: "dependents", labelKey: "dependents", type: "number", step: 0, min: 0 },

  { key: "currentAddress", labelKey: "currentAddress", type: "textarea", required: true, step: 1 },
  { key: "permanentAddress", labelKey: "permanentAddress", type: "textarea", step: 1 },
  { key: "addressDurationYears", labelKey: "addressDuration", type: "number", step: 1, min: 0 },
  {
    key: "ownershipStatus",
    labelKey: "ownershipStatus",
    type: "choice",
    step: 1,
    choices: [
      // Confirmed live (end-to-end chat test): "it's my own house" — a
      // completely natural way to answer this — didn't match "owned" at
      // all, since the word "owned" itself never appears in it (only "own"
      // does, a different word the \b-word matcher can't treat as the same
      // token). Same reasoning as the gender aliases above: add the actual
      // words people say, don't rely on the choice's own value/label
      // appearing verbatim in the answer.
      //
      // "अपना"/"अपना घर": the Hindi equivalent phrase ("यह मेरा अपना घर है")
      // hit the exact same free-translation-API failure documented on the
      // gender choice above ("This is my ball", not anything recognizable)
      // — added directly for the same reason: don't depend on that call
      // succeeding for common, predictable phrasing.
      { value: "owned", labelKey: "owned", aliases: ["own", "my own", "own house", "own home", "self owned", "अपना", "अपना घर"] },
      { value: "rented", labelKey: "rented", aliases: ["rent", "renting", "on rent", "rented house"] },
    ],
  },

  {
    key: "idType",
    labelKey: "idType",
    type: "choice",
    required: true,
    step: 2,
    choices: [
      { value: "aadhaar", labelKey: "Aadhaar" },
      { value: "pan", labelKey: "PAN" },
      { value: "voter_id", labelKey: "Voter ID" },
      { value: "driving_licence", labelKey: "Driving Licence" },
    ],
  },
  { key: "idNumber", labelKey: "idNumber", type: "text", required: true, step: 2, validate: validateIdNumber },

  {
    key: "productType",
    labelKey: "productType",
    type: "choice",
    required: true,
    step: 3,
    // Fallback (segment not yet known) — the full list.
    choices: [
      { value: "working_capital", labelKey: "Working Capital", aliases: PRODUCT_TYPE_ALIASES.working_capital },
      { value: "asset_purchase", labelKey: "Asset Purchase", aliases: PRODUCT_TYPE_ALIASES.asset_purchase },
      { value: "education", labelKey: "Education", aliases: PRODUCT_TYPE_ALIASES.education },
      { value: "agri_input", labelKey: "Agri Input", aliases: PRODUCT_TYPE_ALIASES.agri_input },
    ],
    // Per-segment subset, straight from the BRD's own segment descriptions
    // (Section 3): "Farmers — seasonal/agri-input and equipment finance",
    // "Vocational-training students — education/skilling loans", "Small
    // factory/workshop owners — working-capital or asset-purchase loans".
    choicesBySegment: {
      FARMER: [
        { value: "agri_input", labelKey: "Agri Input", aliases: PRODUCT_TYPE_ALIASES.agri_input },
        { value: "asset_purchase", labelKey: "Asset Purchase", aliases: PRODUCT_TYPE_ALIASES.asset_purchase },
      ],
      VOCATIONAL_STUDENT: [
        { value: "education", labelKey: "Education", aliases: PRODUCT_TYPE_ALIASES.education },
      ],
      BUSINESS_OWNER: [
        { value: "working_capital", labelKey: "Working Capital", aliases: PRODUCT_TYPE_ALIASES.working_capital },
        { value: "asset_purchase", labelKey: "Asset Purchase", aliases: PRODUCT_TYPE_ALIASES.asset_purchase },
      ],
    },
  },
  { key: "requestedAmount", labelKey: "requestedAmount", type: "number", required: true, step: 3, min: 1 },
  { key: "tenureMonths", labelKey: "tenureMonths", type: "number", required: true, step: 3, min: 1 },
  { key: "loanPurpose", labelKey: "loanPurpose", type: "textarea", step: 3 },

  { key: "incomeSource", labelKey: "incomeSource", type: "text", step: 4 },
  { key: "monthlyIncome", labelKey: "monthlyIncome", type: "number", required: true, step: 4, min: 0 },
  { key: "existingObligations", labelKey: "existingObligations", type: "textarea", step: 4 },

  { key: "bankAccountNumber", labelKey: "bankAccountNumber", type: "text", step: 5, pattern: BANK_ACCOUNT_PATTERN, patternHint: BANK_ACCOUNT_HINT },
  { key: "bankIfsc", labelKey: "bankIfsc", type: "text", step: 5, pattern: IFSC_PATTERN, patternHint: IFSC_HINT },
  { key: "bankName", labelKey: "bankName", type: "text", step: 5 },
];

// Segment-specific field schemas (FSD 4.3.2). labelKey looks up the localized
// string in i18n.ts, same as CORE_FIELDS — kept as a separate lighter-weight
// shape (no choices/step) since these render directly on the segment step,
// not through the wizard's per-step CORE_FIELDS machinery.
export const SEGMENT_FIELDS: Record<SegmentCode, { key: string; labelKey: string; type: FieldType; pattern?: RegExp; patternHint?: string; min?: number; max?: number }[]> = {
  FARMER: [
    { key: "landHoldingSize", labelKey: "landHoldingSize", type: "text" },
    { key: "landOwnership", labelKey: "landOwnership", type: "text" },
    { key: "crops", labelKey: "crops", type: "text" },
    { key: "season", labelKey: "cropSeason", type: "text" },
    { key: "irrigationType", labelKey: "irrigationType", type: "text" },
    { key: "equipmentOwned", labelKey: "farmEquipmentOwned", type: "text" },
    { key: "nearestMandi", labelKey: "nearestMandi", type: "text" },
    { key: "kisanId", labelKey: "kisanId", type: "text" },
  ],
  VOCATIONAL_STUDENT: [
    { key: "courseName", labelKey: "courseName", type: "text" },
    { key: "instituteName", labelKey: "instituteName", type: "text" },
    { key: "instituteCode", labelKey: "instituteCode", type: "text" },
    { key: "courseDurationMonths", labelKey: "courseDurationMonths", type: "number", min: 1 },
    { key: "courseFee", labelKey: "courseFee", type: "number", min: 0 },
    { key: "expectedCompletionDate", labelKey: "expectedCompletionDate", type: "text" },
    { key: "instituteContact", labelKey: "instituteContact", type: "text", pattern: MOBILE_PATTERN, patternHint: MOBILE_HINT },
    { key: "priorEducationLevel", labelKey: "priorEducationLevel", type: "text" },
  ],
  BUSINESS_OWNER: [
    { key: "businessName", labelKey: "businessName", type: "text" },
    { key: "businessType", labelKey: "businessType", type: "text" },
    { key: "yearsInOperation", labelKey: "yearsInOperation", type: "number", min: 0 },
    { key: "gstOrUdyam", labelKey: "gstOrUdyam", type: "text" },
    { key: "employeeCount", labelKey: "employeeCount", type: "number", min: 0 },
    { key: "monthlyTurnover", labelKey: "monthlyTurnover", type: "number", min: 0 },
    { key: "equipmentOwned", labelKey: "businessEquipmentOwned", type: "text" },
  ],
};

export const SEGMENT_STEP_LABEL = "stepSegment";
export const UPLOAD_STEP_LABEL = "stepUpload";
export const REVIEW_STEP_LABEL = "stepReview";

export function getWizardSteps(): readonly string[] {
  return [...CORE_STEPS, SEGMENT_STEP_LABEL, UPLOAD_STEP_LABEL, REVIEW_STEP_LABEL];
}

function resolveChoices(field: FieldDef, segment?: SegmentCode) {
  return (segment && field.choicesBySegment?.[segment]) ?? field.choices;
}

export function fieldsForStep(stepIndex: number, segment?: SegmentCode): FieldDef[] {
  return CORE_FIELDS.filter((f) => f.step === stepIndex).map((f) =>
    f.choicesBySegment ? { ...f, choices: resolveChoices(f, segment) } : f
  );
}

/** Minimal shape the dialog manager needs — CORE_FIELDS entries satisfy this too. */
export interface ChatFieldDef {
  key: string;
  labelKey: string;
  type: FieldType;
  // aliases: extra strings the voice/text field-matcher (dialogManager's
  // extractFieldValue) should also accept for this choice, beyond its own
  // value/label. For a small, known set of speech-to-text mishearings or
  // autocorrect substitutions — not a general fuzzy-match mechanism.
  choices?: { value: string; labelKey: string; aliases?: string[] }[];
}

/** Resolves a field key to its definition for chat extraction/labeling. Checks
 * CORE_FIELDS first (segment-independent, keys are unique there), then falls
 * back to the given segment's SEGMENT_FIELDS. A segment is required for the
 * fallback because a couple of segment field keys (e.g. "equipmentOwned")
 * are reused across segments with different labels/meaning. */
export function findFieldDef(key: string, segment?: SegmentCode): ChatFieldDef | undefined {
  const core = CORE_FIELDS.find((f) => f.key === key);
  if (core) return core.choicesBySegment ? { ...core, choices: resolveChoices(core, segment) } : core;
  if (segment) return SEGMENT_FIELDS[segment]?.find((f) => f.key === key);
  return undefined;
}
