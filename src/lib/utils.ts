import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Indian-numbering-system-aware amount reader, e.g. 1_50_000 -> "1 lakh 50 thousand".
 * Used by the chatbot's TTS read-back (FSD FR-CHB-07) so amounts are spoken naturally
 * rather than digit-by-digit. Mirrors the "lakh/crore" note in the Threshold Tuning Guide.
 */
export function amountToWords(n: number): string {
  if (n >= 10000000) return `${(n / 10000000).toFixed(n % 10000000 === 0 ? 0 : 2)} crore`;
  if (n >= 100000) return `${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 2)} lakh`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} thousand`;
  return `${n}`;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
