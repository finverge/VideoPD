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

export const CORE_FIELDS: FieldDef[] = [
  { key: "fullName", labelKey: "fullName", type: "text", required: true, step: 0 },
  {
    key: "gender",
    labelKey: "gender",
    type: "choice",
    step: 0,
    choices: [
      // "mail" alias: a real, reproducible Web Speech API mishearing of
      // "male" (reported live — the browser transcribes it as "Mail." every
      // time), and a plausible mobile-keyboard autocorrect substitution for
      // typed input too. "male" and "mail" share no substring the existing
      // \b-word-boundary match could catch (different letters, not a typo
      // adjacent-key slip), so this needed an explicit alias, not a looser
      // regex.
      { value: "male", labelKey: "Male", aliases: ["mail", "mails"] },
      { value: "female", labelKey: "Female" },
      { value: "other", labelKey: "Other" },
    ],
  },
  { key: "dob", labelKey: "dob", type: "text", step: 0, placeholder: "DD/MM/YYYY", hint: "Format: DD/MM/YYYY (e.g., 25/03/1990)" },
  { key: "email", labelKey: "email", type: "text", step: 0 },
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
  { key: "dependents", labelKey: "dependents", type: "number", step: 0 },

  { key: "currentAddress", labelKey: "currentAddress", type: "textarea", required: true, step: 1 },
  { key: "permanentAddress", labelKey: "permanentAddress", type: "textarea", step: 1 },
  { key: "addressDurationYears", labelKey: "addressDuration", type: "number", step: 1 },
  {
    key: "ownershipStatus",
    labelKey: "ownershipStatus",
    type: "choice",
    step: 1,
    choices: [
      { value: "owned", labelKey: "owned" },
      { value: "rented", labelKey: "rented" },
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
  { key: "idNumber", labelKey: "idNumber", type: "text", required: true, step: 2 },

  {
    key: "productType",
    labelKey: "productType",
    type: "choice",
    required: true,
    step: 3,
    // Fallback (segment not yet known) — the full list.
    choices: [
      { value: "working_capital", labelKey: "Working Capital" },
      { value: "asset_purchase", labelKey: "Asset Purchase" },
      { value: "education", labelKey: "Education" },
      { value: "agri_input", labelKey: "Agri Input" },
    ],
    // Per-segment subset, straight from the BRD's own segment descriptions
    // (Section 3): "Farmers — seasonal/agri-input and equipment finance",
    // "Vocational-training students — education/skilling loans", "Small
    // factory/workshop owners — working-capital or asset-purchase loans".
    choicesBySegment: {
      FARMER: [
        { value: "agri_input", labelKey: "Agri Input" },
        { value: "asset_purchase", labelKey: "Asset Purchase" },
      ],
      VOCATIONAL_STUDENT: [
        { value: "education", labelKey: "Education" },
      ],
      BUSINESS_OWNER: [
        { value: "working_capital", labelKey: "Working Capital" },
        { value: "asset_purchase", labelKey: "Asset Purchase" },
      ],
    },
  },
  { key: "requestedAmount", labelKey: "requestedAmount", type: "number", required: true, step: 3 },
  { key: "tenureMonths", labelKey: "tenureMonths", type: "number", required: true, step: 3 },
  { key: "loanPurpose", labelKey: "loanPurpose", type: "textarea", step: 3 },

  { key: "incomeSource", labelKey: "incomeSource", type: "text", step: 4 },
  { key: "monthlyIncome", labelKey: "monthlyIncome", type: "number", required: true, step: 4 },
  { key: "existingObligations", labelKey: "existingObligations", type: "textarea", step: 4 },

  { key: "bankAccountNumber", labelKey: "bankAccountNumber", type: "text", step: 5 },
  { key: "bankIfsc", labelKey: "bankIfsc", type: "text", step: 5 },
  { key: "bankName", labelKey: "bankName", type: "text", step: 5 },
];

// Segment-specific field schemas (FSD 4.3.2). labelKey looks up the localized
// string in i18n.ts, same as CORE_FIELDS — kept as a separate lighter-weight
// shape (no choices/step) since these render directly on the segment step,
// not through the wizard's per-step CORE_FIELDS machinery.
export const SEGMENT_FIELDS: Record<SegmentCode, { key: string; labelKey: string; type: FieldType }[]> = {
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
    { key: "courseDurationMonths", labelKey: "courseDurationMonths", type: "number" },
    { key: "courseFee", labelKey: "courseFee", type: "number" },
    { key: "expectedCompletionDate", labelKey: "expectedCompletionDate", type: "text" },
    { key: "instituteContact", labelKey: "instituteContact", type: "text" },
    { key: "priorEducationLevel", labelKey: "priorEducationLevel", type: "text" },
  ],
  BUSINESS_OWNER: [
    { key: "businessName", labelKey: "businessName", type: "text" },
    { key: "businessType", labelKey: "businessType", type: "text" },
    { key: "yearsInOperation", labelKey: "yearsInOperation", type: "number" },
    { key: "gstOrUdyam", labelKey: "gstOrUdyam", type: "text" },
    { key: "employeeCount", labelKey: "employeeCount", type: "number" },
    { key: "monthlyTurnover", labelKey: "monthlyTurnover", type: "number" },
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
