"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "finverge_theme";

/**
 * Light/dark toggle. Defaults to the borrower's OS/browser preference on
 * first visit, then remembers whatever they explicitly pick. The actual
 * `.dark` class flip (and the flash-of-wrong-theme guard on first paint)
 * lives in the inline script in layout.tsx — this component only has to
 * stay in sync with whatever that script already applied.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    setIsDark(next);
  }

  // Avoid rendering the wrong icon for a flash before we've read the real state.
  if (isDark === null) {
    return <div className={cn("h-9 w-9", className)} aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink-100 bg-white text-ink-500 shadow-soft transition-colors hover:text-sprout-600 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:text-sprout-400",
        className
      )}
    >
      <motion.span
        key={isDark ? "moon" : "sun"}
        initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="flex items-center justify-center"
      >
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </motion.span>
    </button>
  );
}
