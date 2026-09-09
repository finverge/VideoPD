import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { PoweredByBadge } from "@/components/BrandHeader";
import { getTenantConfig, toTenantBrand } from "@/lib/tenantConfig";
import { TenantConfigProvider } from "@/lib/TenantConfigProvider";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

// DLP/LOS integration Phase 5 — title/description now read the tenant's
// real display name instead of a literal "Lakshya Skill Finance" string.
// generateMetadata (not the old static `export const metadata`) is what
// lets this be async and read the DB.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantConfig();
  return {
    title: `${tenant.displayName} — Digital Loan Origination`,
    description: `Apply for a loan in your own language — ${tenant.displayName}, powered by Finverge VideoPD 2.0.`,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f1730",
};

// Runs before hydration so the correct theme applies on first paint — no
// flash of light-then-dark (or vice versa). Mirrors ThemeToggle's own logic:
// an explicit past choice wins, otherwise fall back to the OS/browser preference.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("finverge_theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantConfig();
  const brand = toTenantBrand(tenant);

  // DLP/LOS integration Phase 5 — real, stored tenant colors delivered as
  // CSS custom properties on :root, same `--brand-*` shape Fraud360's own
  // branding_service emits (services.py's theme_css()). See
  // TenantConfig's schema doc comment for exactly which surfaces these
  // actually drive today (BrandHeader's fallback wordmark, the staff
  // header gradient) — deliberately not retrofitted across every Tailwind
  // utility class in this app.
  const brandStyle = {
    "--brand-primary": brand.primaryColor,
    "--brand-accent": brand.accentColor,
    "--brand-neutral": brand.neutralColor,
  } as React.CSSProperties;

  return (
    <html lang="en" className={jakarta.variable} style={brandStyle} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-grid-fade" />
        <TenantConfigProvider value={brand}>
          {children}
          <PoweredByBadge />
        </TenantConfigProvider>
      </body>
    </html>
  );
}
