"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "ref" | "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-sprout-500 to-sprout-600 text-white shadow-glow hover:from-sprout-400 hover:to-sprout-500 active:from-sprout-600 active:to-sprout-700 disabled:opacity-50",
  secondary:
    "bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100",
  outline:
    "border-2 border-ink-200 text-ink-800 hover:border-sprout-400 hover:text-sprout-700 dark:border-ink-700 dark:text-ink-100 dark:hover:border-sprout-500",
  ghost: "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800/60",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-4 text-sm gap-1.5",
  md: "h-12 px-6 text-base gap-2",
  lg: "h-14 px-8 text-lg gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, icon, children, disabled, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: disabled || loading ? 1 : 1.015 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center rounded-2xl font-semibold tracking-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-light disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {children}
      </motion.button>
    );
  }
);
Button.displayName = "Button";
