import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface FieldWrapProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & FieldWrapProps
>(({ className, label, hint, error, required, id, ...props }, ref) => {
  return (
    <label className="block" htmlFor={id}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-ink-700 dark:text-ink-200">
          {label}
          {required && <span className="ml-0.5 text-amber-500">*</span>}
        </span>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(
          "h-12 w-full rounded-xl border-2 border-ink-100 bg-white px-4 text-base text-ink-900 outline-none transition-all placeholder:text-ink-300",
          "focus:border-sprout-400 focus:ring-4 focus:ring-sprout-100",
          "dark:border-ink-700 dark:bg-ink-900 dark:text-white dark:placeholder:text-ink-500 dark:focus:ring-sprout-900/40",
          error && "border-red-300 focus:border-red-400 focus:ring-red-100",
          className
        )}
        {...props}
      />
      {hint && !error && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-red-500">{error}</span>}
    </label>
  );
});
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & FieldWrapProps
>(({ className, label, hint, error, required, id, ...props }, ref) => {
  return (
    <label className="block" htmlFor={id}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-ink-700 dark:text-ink-200">
          {label}
          {required && <span className="ml-0.5 text-amber-500">*</span>}
        </span>
      )}
      <textarea
        ref={ref}
        id={id}
        rows={3}
        className={cn(
          "w-full rounded-xl border-2 border-ink-100 bg-white px-4 py-3 text-base text-ink-900 outline-none transition-all placeholder:text-ink-300",
          "focus:border-sprout-400 focus:ring-4 focus:ring-sprout-100",
          "dark:border-ink-700 dark:bg-ink-900 dark:text-white dark:placeholder:text-ink-500 dark:focus:ring-sprout-900/40",
          error && "border-red-300 focus:border-red-400 focus:ring-red-100",
          className
        )}
        {...props}
      />
      {hint && !error && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-red-500">{error}</span>}
    </label>
  );
});
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & FieldWrapProps & { children: React.ReactNode }
>(({ className, label, hint, error, required, id, children, ...props }, ref) => {
  return (
    <label className="block" htmlFor={id}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-ink-700 dark:text-ink-200">
          {label}
          {required && <span className="ml-0.5 text-amber-500">*</span>}
        </span>
      )}
      <select
        ref={ref}
        id={id}
        className={cn(
          "h-12 w-full rounded-xl border-2 border-ink-100 bg-white px-4 text-base text-ink-900 outline-none transition-all",
          "focus:border-sprout-400 focus:ring-4 focus:ring-sprout-100",
          "dark:border-ink-700 dark:bg-ink-900 dark:text-white dark:focus:ring-sprout-900/40",
          error && "border-red-300",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {hint && !error && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-red-500">{error}</span>}
    </label>
  );
});
Select.displayName = "Select";
