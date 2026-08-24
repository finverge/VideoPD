import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { PoweredByBadge } from "@/components/BrandHeader";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lakshya Skill Finance — Digital Loan Origination",
  description:
    "Apply for a loan in your own language — Lakshya Skill Finance, powered by Finverge VideoPD 2.0.",
};

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-grid-fade" />
        {children}
        <PoweredByBadge />
      </body>
    </html>
  );
}
