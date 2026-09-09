"use client";

import { createContext, useContext } from "react";
import type { TenantBrand } from "@/lib/tenantConfig";

/**
 * Client-side access to the tenant's brand (name/logo/colors) — DLP/LOS
 * integration Phase 5. Populated once, server-side, in src/app/layout.tsx
 * (a server component calls getTenantConfig() and passes the result down
 * as this provider's `value` prop) — client components then read it via
 * useTenantConfig() with no fetch, no loading flicker, and no risk of
 * ever showing the wrong brand name for a beat before a client-side
 * request resolves.
 */

const DEFAULT_BRAND: TenantBrand = {
  displayName: "Lakshya Skill Finance",
  shortName: "Lakshya",
  logoUrl: null,
  primaryColor: "#1cb27d",
  accentColor: "#0f1730",
  neutralColor: "#4a629d",
  defaultTheme: "light",
};

const TenantConfigContext = createContext<TenantBrand>(DEFAULT_BRAND);

export function TenantConfigProvider({ value, children }: { value: TenantBrand; children: React.ReactNode }) {
  return <TenantConfigContext.Provider value={value}>{children}</TenantConfigContext.Provider>;
}

/** Reads the current tenant's brand. Always returns a real value — the
 * hardcoded DEFAULT_BRAND above if somehow used outside the provider
 * (shouldn't happen — RootLayout wraps the whole app), never null/undefined,
 * so every consumer can destructure it directly without a guard. */
export function useTenantConfig(): TenantBrand {
  return useContext(TenantConfigContext);
}
