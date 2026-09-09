import { NextResponse } from "next/server";
import { getSkillFinanceStaffRoster } from "@/lib/dlpStaff";

// DLP/LOS integration Phase 4 — thin server-side proxy so the client-side
// sign-in page (src/app/staff/page.tsx) can fetch DLP's real staff roster
// same-origin. dlpStaff.ts itself must run server-side (server env vars,
// no CORS handshake needed against DLP's Internal Gateway) — this route
// is that server boundary.
export async function GET() {
  const result = await getSkillFinanceStaffRoster();
  return NextResponse.json(result);
}
