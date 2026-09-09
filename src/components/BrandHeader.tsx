"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useTenantConfig } from "@/lib/TenantConfigProvider";

/**
 * Primary brand = the current tenant (the lending partner borrowers deal
 * with — "Lakshya Skill Finance" is just this app's default seed value,
 * not a hardcoded identity any more; see TenantConfigProvider/
 * tenantConfig.ts, DLP/LOS integration Phase 5). Finverge is attributed
 * as the underlying technology provider via a small, fixed "Powered by"
 * corner badge — never competing with the primary logo, and never
 * tenant-configurable itself (it's Finverge's own attribution, not the
 * tenant's brand).
 *
 * Both fall back to a text wordmark if no logo image is available — either
 * the tenant hasn't uploaded one yet (logoUrl is null; see
 * /staff/tenant-branding) and the bundled default /logos/lakshya-logo.png
 * doesn't exist either, or the tenant's own uploaded logo file has gone
 * missing — so the app never shows a broken-image icon.
 *
 * Existence is checked via a plain `new Image()` probe in an effect, not the
 * rendered <img>'s onError — Next.js auto-preloads these images, and a failed
 * preload doesn't reliably propagate an error event to a same-URL <img> that
 * mounts afterward (observed in dev: naturalWidth stays 0, onError never fires).
 * The probe sidesteps that entirely.
 */

function useImageExists(src: string): "loading" | "ok" | "error" {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setState("ok");
    };
    img.onerror = () => {
      if (!cancelled) setState("error");
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return state;
}

export function BrandHeader({ className }: { className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className={cn(className)}>
      <LakshyaLogo />
    </motion.div>
  );
}

export function LakshyaLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const brand = useTenantConfig();
  const logoSrc = brand.logoUrl ?? "/logos/lakshya-logo.png";
  const status = useImageExists(logoSrc);
  // Responsive height per breakpoint — scales with the page, never fixed-pixel.
  const heightClass =
    size === "lg"
      ? "h-9 sm:h-11 md:h-12"
      : size === "sm"
      ? "h-5 sm:h-6"
      : "h-7 sm:h-8 md:h-9";

  if (status !== "ok") {
    // Text fallback — same visual weight as the intended logo lockup. Shown
    // immediately while the probe is still loading too, so there's no flash
    // of a broken image; it silently swaps to the real logo once confirmed.
    // Splits the tenant's display name on its last space so "Lakshya Skill
    // Finance" keeps rendering as "Lakshya" + accented "Skill Finance" (the
    // original lockup) for any tenant name that follows the same
    // "one-word-then-rest" shape; a name with no space just renders whole,
    // unaccented — better than guessing a split that isn't there.
    const spaceIdx = brand.displayName.indexOf(" ");
    const firstWord = spaceIdx === -1 ? brand.displayName : brand.displayName.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? null : brand.displayName.slice(spaceIdx + 1);
    return (
      <div className="flex items-center gap-2">
        <div
          className={cn("flex items-center justify-center rounded-xl text-white shadow-soft", heightClass, "aspect-square")}
          style={{ background: `linear-gradient(to bottom right, var(--brand-primary), var(--brand-accent))` }}
        >
          <span className="text-xs font-black">{brand.shortName.charAt(0) || "L"}</span>
        </div>
        <span className="text-lg font-extrabold tracking-tight text-ink-900 dark:text-white">
          {firstWord}{rest && <span className="text-sprout-600 dark:text-sprout-400"> {rest}</span>}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoSrc}
      alt={brand.displayName}
      className={cn(heightClass, "w-auto max-w-[60vw] object-contain")}
    />
  );
}

/** Fixed bottom-right "Powered by Finverge" corner badge — small, unobtrusive. */
export function PoweredByBadge() {
  const status = useImageExists("/logos/finverge-logo.png");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4 }}
      className="pointer-events-none fixed bottom-2 right-2 z-20 flex items-center gap-0.5 rounded-full border border-ink-100 bg-white/55 px-1.5 py-0.5 shadow-soft backdrop-blur-md dark:border-ink-800 dark:bg-ink-900/55 sm:bottom-3 sm:right-3"
    >
      <span className="text-[6px] font-medium uppercase tracking-wide text-ink-400 dark:text-ink-500 sm:text-[7px]">
        Powered by
      </span>
      {status === "ok" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logos/finverge-logo.png"
          alt="Finverge"
          className="h-1.5 w-auto object-contain opacity-80 dark:opacity-90 dark:brightness-[1.8] dark:contrast-125 sm:h-2"
        />
      ) : (
        <span className="text-[8px] font-extrabold tracking-tight text-ink-600 dark:text-ink-300 sm:text-[9px]">
          finverge
        </span>
      )}
    </motion.div>
  );
}
