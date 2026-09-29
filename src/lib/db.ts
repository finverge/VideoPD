import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton so hot-reload doesn't exhaust DB connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// WAL mode — go-live hardening, measured live, not assumed. This app's
// dev.db shipped on SQLite's default rollback-journal mode ("delete"),
// under which a writer takes an exclusive lock right at commit that
// blocks concurrent READERS too, not just other writers. Real effect
// under a mixed-load test (5 concurrent decision-writes + 15 concurrent
// reads, the same shape as this app's own DLP-bridge status polling
// running alongside an underwriter submitting a decision): reads
// clustered around ~200ms instead of their normal ~1-20ms, a genuine
// lock-wait pattern, not noise. Switching to WAL fixed that cleanly — the
// identical test then showed reads at a uniform ~85ms regardless of
// concurrent writers. WAL does NOT and cannot remove writer-vs-writer
// serialization (SQLite allows exactly one writer at a time under any
// journal mode) — the same test's write latencies stayed in the same
// low-hundreds-of-ms range before and after, comfortably fine at this
// platform's own real expected volume (~1000 applications/month, see the
// earlier infra-sizing work) — WAL specifically targets the read-blocked-
// by-write pattern this app's own polling-heavy traffic actually hits.
//
// Idempotent and safe to run on every startup: WAL, once set, persists in
// the database file's own header (not a per-connection setting) — this
// mostly just confirms it's still on, and is what actually applies it the
// first time a fresh dev.db is created in a new environment (a clean
// `prisma db push` defaults back to the rollback journal, same as this
// file originally did before being set manually once this session).
// Fire-and-forget at module load: nothing downstream should wait on this
// completing before the app is otherwise usable, and a failure here
// (e.g. a read-only filesystem) isn't fatal — the app still works, just
// without this specific tuning, same graceful-degradation posture as
// every other optional check in this codebase.
db.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((e) => {
  console.error("[db] Could not enable WAL mode — continuing on whatever journal mode is already active:", e);
});
