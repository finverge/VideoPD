export type LangCode = "en" | "hi" | "te" | "ta" | "kn" | "ml";

export type SegmentCode = "FARMER" | "VOCATIONAL_STUDENT" | "BUSINESS_OWNER";

export interface CoreFormFields {
  fullName?: string;
  gender?: string;
  email?: string;
  maritalStatus?: string;
  dependents?: number;
  currentAddress?: string;
  permanentAddress?: string;
  addressDurationYears?: number;
  ownershipStatus?: string;
  idType?: string;
  idNumber?: string;
  productType?: string;
  requestedAmount?: number;
  tenureMonths?: number;
  loanPurpose?: string;
  incomeSource?: string;
  monthlyIncome?: number;
  existingObligations?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
}

export interface FarmerFields {
  landHoldingSize?: string;
  landOwnership?: "owned" | "leased";
  crops?: string;
  season?: "kharif" | "rabi" | "annual";
  irrigationType?: string;
  equipmentOwned?: string;
  nearestMandi?: string;
  kisanId?: string;
}

export interface StudentFields {
  courseName?: string;
  instituteName?: string;
  instituteCode?: string;
  courseDurationMonths?: number;
  courseFee?: number;
  expectedCompletionDate?: string;
  instituteContact?: string;
  priorEducationLevel?: string;
}

export interface BusinessFields {
  businessName?: string;
  businessType?: string;
  yearsInOperation?: number;
  gstOrUdyam?: string;
  employeeCount?: number;
  monthlyTurnover?: number;
  equipmentOwned?: string;
}

export type SegmentFields = FarmerFields | StudentFields | BusinessFields;

export interface EvidenceItem {
  id: string;
  type: "ID_PROOF" | "ADDRESS_PROOF" | "BUSINESS_PHOTO" | "BUSINESS_VIDEO" | "SELFIE";
  fileName: string;
  qualityStatus: "PENDING" | "PASSED" | "FLAGGED";
  qualityNotes?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  channel: "voice" | "text";
  createdAt: string;
}

export interface RiskFlag {
  code: string;
  label: string;
  severity: "low" | "medium" | "high";
  detail: string;
}

export interface InitialSummary {
  borrowerProfile: {
    name?: string;
    segment: SegmentCode;
    language: LangCode;
    mobile: string;
  };
  loanAsk: {
    productType?: string;
    amount?: number;
    tenureMonths?: number;
    purpose?: string;
  };
  documentChecklist: { type: string; status: string }[];
  riskFlags: RiskFlag[];
  completenessScore: number;
  generatedAt: string;
}
