"use client";

/**
 * Staff sign-in for the Underwriter Workspace — DLP/LOS integration Phase 4:
 * the roster itself now comes from DLP's real Staff Admin
 * (underwriting-decisioning's StaffMember table, provisioned via
 * frontend/staff-portal's StaffAdmin.tsx — manual entry, HRMS sync, or CSV
 * bulk upload, see GET /api/staff/roster + src/lib/dlpStaff.ts) instead of
 * a fixed array in this file. Sign-in itself is still a no-password
 * roster-pick, same as DLP's own staff-portal SignIn.tsx today — real
 * Keycloak-backed sign-in is LOS-20, not built anywhere on the DLP
 * platform yet (see dlpStaff.ts's doc comment), deliberately deferred per
 * the integration plan's Phase 4 decision, not silently dropped.
 */

export type StaffRole = "UNDERWRITER" | "APPROVER";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
}

// Last-known-good roster, used only when DLP's Staff Admin is unreachable
// (src/lib/dlpStaff.ts's graceful degradation) — keeps local dev usable
// without DLP running, same "fallback constant, not a second real roster"
// relationship as dlpBre.ts's FALLBACK_RISK_THRESHOLDS. Not shown as DLP
// staff to avoid ever looking like it came from the real roster.
export const FALLBACK_STAFF_ROSTER: StaffMember[] = [
  { id: "fallback-uw-1", name: "Ananya Rao (offline fallback)", role: "UNDERWRITER" },
  { id: "fallback-uw-2", name: "Karthik Menon (offline fallback)", role: "UNDERWRITER" },
  { id: "fallback-ap-1", name: "Vikram Iyer (offline fallback)", role: "APPROVER" },
  { id: "fallback-ap-2", name: "Fatima Sheikh (offline fallback)", role: "APPROVER" },
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
