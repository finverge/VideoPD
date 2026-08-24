"use client";

/**
 * Mock staff sign-in for the Underwriter Workspace — same spirit as the
 * mocked OTP gateway (src/app/api/auth/otp/route.ts): no real auth backend,
 * just enough to demo the maker-checker flow end to end. A real build swaps
 * this for the DLP LOS staff-portal's Keycloak-backed sign-in (see
 * frontend/staff-portal/src/components/SignIn.tsx for that shape).
 */

export type StaffRole = "UNDERWRITER" | "APPROVER";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
}

// Small fixed roster — enough to demo one underwriter recommending and a
// different approver confirming (real maker-checker requires two different
// people; the UI enforces that on the approver step, see case detail page).
export const STAFF_ROSTER: StaffMember[] = [
  { id: "uw-ananya", name: "Ananya Rao", role: "UNDERWRITER" },
  { id: "uw-karthik", name: "Karthik Menon", role: "UNDERWRITER" },
  { id: "ap-vikram", name: "Vikram Iyer", role: "APPROVER" },
  { id: "ap-fatima", name: "Fatima Sheikh", role: "APPROVER" },
];

const STORAGE_KEY = "finverge_staff_user";

export function getStoredStaff(): StaffMember | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StaffMember) : null;
  } catch {
    return null;
  }
}

export function setStoredStaff(staff: StaffMember): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
}

export function clearStoredStaff(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
