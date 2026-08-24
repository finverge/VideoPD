"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProgressSteps({
  labels,
  activeIndex,
}: {
  labels: string[];
  activeIndex: number;
}) {
  const pct = labels.length > 1 ? (activeIndex / (labels.length - 1)) * 100 : 0;

  return (
    <div className="w-full">
      {/* Mobile: compact fraction + bar */}
      <div className="mb-2 flex items-center justify-between sm:hidden">
        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400">
          Step {activeIndex + 1} of {labels.length}
        </span>
        <span className="text-xs font-bold text-sprout-600 dark:text-sprout-400">{labels[activeIndex]}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800 sm:hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-sprout-400 to-sprout-600"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 30 }}
        />
      </div>

      {/* Desktop: full step rail */}
      <div className="hidden items-center sm:flex">
        {labels.map((label, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <div key={label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <motion.div
                  animate={{
                    scale: active ? 1.1 : 1,
                    backgroundColor: done || active ? "rgb(28 178 125)" : "rgb(231 235 246)",
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                    done || active ? "text-white" : "text-ink-400 dark:text-ink-500"
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </motion.div>
                <span
                  className={cn(
                    "max-w-[5.5rem] text-center text-[11px] font-medium leading-tight",
                    active ? "text-ink-900 dark:text-white" : "text-ink-400 dark:text-ink-500"
                  )}
                >
                  {label}
                </span>
              </div>
              {i < labels.length - 1 && (
                <div className="mx-1 h-0.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <motion.div
                    className="h-full bg-sprout-500"
                    initial={false}
                    animate={{ width: done ? "100%" : "0%" }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
