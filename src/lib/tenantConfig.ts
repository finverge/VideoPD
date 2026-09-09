import { db } from "@/lib/db";

/**
 * Server-side tenant config reader — DLP/LOS integration Phase 5. See
 * prisma/schema.prisma's TenantConfig model doc comment for the full
 * rationale (mirrors Fraud360's real branding_service Branding model —
 * D:\SourceCode\Fraud360\services\branding_service\app\models.py) and
 * the honest scoping note on what "branding" does and doesn't cover here.
 *
 * Same seed-then-return pattern as riskParameters.ts's getRiskParameters
 * — the singleton row is created with defaults on first read, not at
 * migration time, so a fresh dev.db still "just works".
 */
export async function getTenantConfig() {
  const existing = await db.tenantConfig.findUnique({ where: { id: "global" } });
  if (existing) return existing;
  return db.tenantConfig.create({ data: { id: "global" } });
}

export interface TenantBrand {
  displayName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  neutralColor: string;
  defaultTheme: string;
}

/** Narrows a full TenantConfig row down to just what client components
 * need (src/lib/TenantConfigProvider.tsx) — never staff-audit fields
 * (updatedBy/updatedAt), which have no business reaching the browser. */
export function toTenantBrand(config: { displayName: string; shortName: string; logoUrl: string | null; primaryColor: string; accentColor: string; neutralColor: string; defaultTheme: string }): TenantBrand {
  return {
    displayName: config.displayName,
    shortName: config.shortName,
    logoUrl: config.logoUrl,
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    neutralColor: config.neutralColor,
    defaultTheme: config.defaultTheme,
  };
}
