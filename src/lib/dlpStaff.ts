import { FALLBACK_STAFF_ROSTER, type StaffMember, type StaffRole } from "@/lib/staffAuth";

/**
 * DLP/LOS staff roster client — DLP/LOS integration Phase 4. VideoPD's
 * underwriter/approver picker (src/app/staff/page.tsx) now reads from
 * DLP's real Staff Admin instead of a hardcoded array: real,
 * DB-backed, provisioned via `underwriting-decisioning`'s `/staff`
 * endpoints (manual entry, HRMS sync, or CSV bulk upload — see
 * `services/underwriting-decisioning/app/routers/staff.py`), the exact
 * same roster frontend/staff-portal's own `StaffAdmin.tsx` (Manager-only
 * screen) manages. Adding an underwriter there makes them pickable here
 * on the very next page load — no VideoPD deploy.
 *
 * Routed through DLP's Internal Gateway (`/gateway/underwriting-decisioning`),
 * same as dlpNotify.ts — an ordinary internal microservice read, not the
 * design-time-vs-runtime engine split dlpBre.ts/dlpWorkflow.ts have with
 * Flowable.
 *
 * Role mapping: DLP's StaffRole is broader (Underwriter / Credit Approver
 * / Manager / Gold Appraiser — the whole Bank/Branch Staff Portal's
 * shared identity roster) than VideoPD's two-role maker-checker model.
 * Only "Underwriter" and "Credit Approver" map onto VideoPD's
 * UNDERWRITER/APPROVER; Manager and Gold Appraiser aren't roles VideoPD's
 * case flow has anything for, so they're filtered out rather than shown
 * as an unusable option.
 *
 * Real Keycloak-backed sign-in (LOS-20) is NOT part of this — confirmed
 * out of scope for this phase (see the integration plan's Phase 4
 * decision): no real IDP exists anywhere on the DLP platform yet
 * (internal-gateway forwards the Authorization header unvalidated, per
 * its own code comment). This client only reuses the roster *table*;
 * "sign-in" stays a no-password pick, same as DLP's own staff-portal
 * SignIn.tsx today.
 *
 * Graceful degradation, same contract as every other DLP integration
 * point here: returns the last-known-good FALLBACK_STAFF_ROSTER (visibly
 * labeled as such, never presented as real DLP staff) if DLP is
 * unreachable, rather than leaving the sign-in page with no one to pick.
 */

const INTERNAL_GATEWAY_URL = process.env.DLP_INTERNAL_GATEWAY_URL ?? "http://127.0.0.1:8100";
const BASE = `${INTERNAL_GATEWAY_URL}/gateway/underwriting-decisioning`;

interface DlpStaffMember {
  id: string;
  name: string;
  role: string; // "Underwriter" | "Credit Approver" | "Manager" | "Gold Appraiser"
  is_active: boolean;
}

const _ROLE_MAP: Record<string, StaffRole> = {
  Underwriter: "UNDERWRITER",
  "Credit Approver": "APPROVER",
};

export interface StaffRosterResult {
  staff: StaffMember[];
  source: "dlp" | "fallback";
}

/** Fetches the live underwriter/approver roster from DLP's Staff Admin.
 * Falls back to FALLBACK_STAFF_ROSTER (and reports which source was used)
 * if DLP is unreachable — never throws, the sign-in page always has
 * someone to pick. */
export async function getSkillFinanceStaffRoster(): Promise<StaffRosterResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response: Response;
    try {
      response = await fetch(`${BASE}/staff`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      console.warn(`[dlpStaff] underwriting-decisioning returned HTTP ${response.status} — falling back to the offline roster.`);
      return { staff: FALLBACK_STAFF_ROSTER, source: "fallback" };
    }
    const dlpStaff = (await response.json()) as DlpStaffMember[];
    const mapped = dlpStaff
      .filter((s) => s.is_active && s.role in _ROLE_MAP)
      .map((s) => ({ id: s.id, name: s.name, role: _ROLE_MAP[s.role] }));
    if (mapped.length === 0) {
      console.warn("[dlpStaff] DLP's roster has no active Underwriter/Credit Approver entries — falling back to the offline roster.");
      return { staff: FALLBACK_STAFF_ROSTER, source: "fallback" };
    }
    return { staff: mapped, source: "dlp" };
  } catch (error) {
    console.warn("[dlpStaff] Could not reach DLP's Staff Admin — expected in local dev before DLP/LOS is running. Falling back to the offline roster.", error);
    return { staff: FALLBACK_STAFF_ROSTER, source: "fallback" };
  }
}
