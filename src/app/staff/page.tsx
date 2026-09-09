"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Landmark, Loader2, ShieldCheck, UserCheck, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getStoredStaff, setStoredStaff, type StaffMember } from "@/lib/staffAuth";
import { cn } from "@/lib/utils";
import { useTenantConfig } from "@/lib/TenantConfigProvider";

/**
 * Mock staff sign-in — pick a name from the roster, no password. Internal
 * tool, kept English-only by design (unlike the borrower-facing portal,
 * which is fully localized — see i18n.ts's language coverage).
 */
export default function StaffSignInPage() {
  const router = useRouter();
  const brand = useTenantConfig();
  const [checking, setChecking] = useState(true);
  // DLP/LOS integration Phase 4 — roster now fetched from DLP's real
  // Staff Admin (GET /api/staff/roster -> src/lib/dlpStaff.ts) instead of
  // a hardcoded array. `source` distinguishes DLP's real roster from the
  // offline fallback so a demo/dev session doesn't mistake one for the
  // other.
  const [roster, setRoster] = useState<StaffMember[] | null>(null);
  const [rosterSource, setRosterSource] = useState<"dlp" | "fallback" | null>(null);

  useEffect(() => {
    const existing = getStoredStaff();
    if (existing) {
      router.replace("/staff/queue");
      return;
    }
    setChecking(false);
  }, [router]);

  useEffect(() => {
    if (checking) return;
    fetch("/api/staff/roster")
      .then((r) => r.json())
      .then((json) => { setRoster(json.staff); setRosterSource(json.source); });
  }, [checking]);

  function signIn(staff: StaffMember) {
    setStoredStaff(staff);
    router.push("/staff/queue");
  }

  if (checking) return null;

  const underwriters = (roster ?? []).filter((s) => s.role === "UNDERWRITER");
  const approvers = (roster ?? []).filter((s) => s.role === "APPROVER");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-5 py-10">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex w-full max-w-md items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-ink-800 to-ink-900 text-white">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-ink-900 dark:text-white">Underwriter Workspace</p>
            <p className="text-xs font-medium text-ink-400">{brand.displayName} · Internal staff only</p>
          </div>
        </div>
        <ThemeToggle />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="w-full">
        <Card>
          <p className="mb-1 text-sm font-bold text-ink-900 dark:text-white">Sign in as</p>
          <p className="mb-3 text-xs text-ink-400">
            Roster from DLP&rsquo;s Staff Admin — pick your name, no password. Real Keycloak-backed sign-in is a
            later phase (not built anywhere on the platform yet); add or remove staff in DLP&rsquo;s Staff Admin and
            they show up here on the next load.
          </p>

          {rosterSource === "fallback" && (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Couldn&rsquo;t reach DLP&rsquo;s Staff Admin — showing an offline fallback roster instead of the real one.
            </div>
          )}

          {roster === null ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-sprout-500" /></div>
          ) : (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
                <UserCheck className="h-3.5 w-3.5" /> Underwriters
              </p>
              <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {underwriters.map((s) => (
                  <StaffCard key={s.id} staff={s} onClick={() => signIn(s)} />
                ))}
              </div>

              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
                <ShieldCheck className="h-3.5 w-3.5" /> Approvers (checker)
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {approvers.map((s) => (
                  <StaffCard key={s.id} staff={s} onClick={() => signIn(s)} />
                ))}
              </div>
            </>
          )}
        </Card>
      </motion.div>
    </main>
  );
}

function StaffCard({ staff, onClick }: { staff: StaffMember; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl border-2 border-ink-100 bg-white px-4 py-3 text-left transition-colors",
        "hover:border-sprout-400 hover:bg-sprout-50/50 dark:border-ink-700 dark:bg-ink-900 dark:hover:border-sprout-600 dark:hover:bg-sprout-950/20"
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-xs font-bold text-white">
        {staff.name.split(" ").map((p) => p[0]).join("")}
      </div>
      <div>
        <p className="text-sm font-bold text-ink-900 dark:text-white">{staff.name}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{staff.role}</p>
      </div>
    </button>
  );
}
