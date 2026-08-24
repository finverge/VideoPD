"use client";

import { motion } from "framer-motion";
import { Check, Volume2 } from "lucide-react";
import { LANGUAGES } from "@/lib/i18n";
import type { LangCode } from "@/types";
import { cn } from "@/lib/utils";

export function LanguageSelector({
  value,
  onChange,
  onSpeak,
}: {
  value: LangCode;
  onChange: (lang: LangCode) => void;
  onSpeak?: (lang: LangCode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {LANGUAGES.map((l, i) => {
        const active = l.code === value;
        return (
          <motion.button
            key={l.code}
            type="button"
            onClick={() => onChange(l.code)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.96 }}
            className={cn(
              "group relative flex flex-col items-start gap-1 rounded-2xl border-2 p-4 text-left transition-all",
              active
                ? "border-sprout-500 bg-sprout-50 shadow-glow dark:bg-sprout-950/40"
                : "border-ink-100 bg-white hover:border-sprout-200 hover:bg-sprout-50/40 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-sprout-800"
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-xl font-bold text-ink-900 dark:text-white">{l.nativeName}</span>
              {active && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-sprout-500 text-white"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </motion.span>
              )}
            </div>
            <span className="text-xs font-medium text-ink-400 dark:text-ink-500">{l.englishName}</span>
            {onSpeak && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSpeak(l.code);
                }}
                className="absolute bottom-3 right-3 rounded-full p-1.5 text-ink-300 opacity-0 transition-opacity hover:bg-ink-100 hover:text-sprout-600 group-hover:opacity-100 dark:hover:bg-ink-800"
                aria-label={`Listen: ${l.englishName}`}
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
