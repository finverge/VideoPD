"use client";

import { motion } from "framer-motion";
import { Sprout, GraduationCap, Store, ArrowRight } from "lucide-react";
import type { SegmentCode } from "@/types";
import { cn } from "@/lib/utils";

const ICONS: Record<SegmentCode, React.ElementType> = {
  FARMER: Sprout,
  VOCATIONAL_STUDENT: GraduationCap,
  BUSINESS_OWNER: Store,
};

export function SegmentCard({
  code,
  title,
  subtitle,
  active,
  onClick,
  index,
}: {
  code: SegmentCode;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
  index: number;
}) {
  const Icon = ICONS[code];
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 200, damping: 22 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "group relative flex flex-col items-start gap-4 overflow-hidden rounded-3xl border-2 p-6 text-left transition-colors",
        active
          ? "border-sprout-500 bg-gradient-to-br from-sprout-50 to-white shadow-glow dark:from-sprout-950/50 dark:to-ink-900"
          : "border-ink-100 bg-white hover:border-sprout-300 dark:border-ink-800 dark:bg-ink-900"
      )}
    >
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl transition-colors",
          active ? "bg-sprout-500 text-white" : "bg-ink-50 text-ink-500 group-hover:bg-sprout-100 group-hover:text-sprout-600 dark:bg-ink-800 dark:text-ink-300"
        )}
      >
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <div>
        <h3 className="text-lg font-bold text-ink-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>
      </div>
      <div
        className={cn(
          "mt-auto flex items-center gap-1 text-sm font-semibold transition-all",
          active ? "text-sprout-600 dark:text-sprout-400" : "text-ink-300 group-hover:text-sprout-500 dark:text-ink-600"
        )}
      >
        <span className="opacity-0 transition-opacity group-hover:opacity-100">Select</span>
        <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </div>
    </motion.button>
  );
}
