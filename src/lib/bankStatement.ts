import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Bank statement extraction + basic eligibility (VideoPD Step 4, this
 * conversation's explicit ask): local extraction via PDF text-layer parsing
 * or ICR/OCR — never a paid statement-analyzer service like Perfios.
 *
 * Two-stage pipeline:
 *   1. Extraction (extractText) — PDF text layer if present, else OCR for
 *      images. A scanned/image-only PDF has no text layer and this prototype
 *      does not rasterize PDF pages for OCR fallback (that needs a native
 *      PDF-to-image renderer) — it's flagged NEEDS_REVIEW instead of guessing.
 *      See docs/videopd-future-work.md.
 *   2. Structuring + eligibility (parseTransactions / computeMetrics /
 *      computeEligibility) — rule-based, transparent, ADVISORY ONLY. Per BRD
 *      Section 7.2 ("Automated non-underwriter-reviewed credit decisioning"
 *      is explicitly out of scope), this never auto-approves or auto-rejects
 *      — it only ever produces a flag + reasons for the underwriter to read.
 */

export interface StatementTransaction {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

export interface StatementMetrics {
  transactionCount: number;
  avgBalance: number;
  minBalance: number;
  totalCredits: number;
  totalDebits: number;
  bounceCount: number;
  emiOutflow: number;
  estimatedMonthlyIncome: number;
  monthsSpanned: number;
}

export type EligibilityFlag = "ELIGIBLE" | "NEEDS_REVIEW" | "NOT_ELIGIBLE";

const BOUNCE_PATTERN = /\b(bounce|return|insufficient|dishonour|dishonor|ecs return|cheque return)\b/i;
const EMI_PATTERN = /\b(emi|loan repay|installment|instalment)\b/i;
const AMOUNT_PATTERN = /\d[\d,]*\.\d{2}/g;
const DATE_PATTERN = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;

export async function extractText(
  absoluteFilePath: string,
  mimeType: string
): Promise<{ text: string; status: "EXTRACTED" | "NEEDS_REVIEW" | "FAILED" }> {
  try {
    if (mimeType === "application/pdf") {
      // Runs as a separate `node` child process — see scripts/extract-pdf.js
      // for why: pdf-parse's vendored pdf.js corrupts across repeated calls
      // inside Next's long-lived dev-server process, in ways that persisted
      // through every in-process fix attempted (module.parent workarounds,
      // requiring its inner module directly, serverExternalPackages). A
      // fresh one-shot process is the one environment this was verified to
      // work reliably in.
      const scriptPath = path.join(process.cwd(), "scripts", "extract-pdf.js");
      const { stdout } = await execFileAsync("node", [scriptPath, absoluteFilePath], { maxBuffer: 20 * 1024 * 1024 });
      const result = JSON.parse(stdout) as { text: string };
      const text = result.text.trim();
      if (text.length < 40) {
        // No usable text layer — likely a scanned/image-only PDF. This
        // prototype doesn't rasterize PDF pages for an OCR fallback (see
        // module docstring) — flag rather than silently return near-nothing.
        return { text, status: "NEEDS_REVIEW" };
      }
      return { text, status: "EXTRACTED" };
    }

    if (mimeType.startsWith("image/")) {
      const Tesseract = await import("tesseract.js");
      const { data } = await Tesseract.recognize(absoluteFilePath, "eng");
      const text = data.text.trim();
      if (text.length < 40) return { text, status: "NEEDS_REVIEW" };
      return { text, status: "EXTRACTED" };
    }

    return { text: "", status: "FAILED" };
  } catch (e) {
    console.error("[bankStatement.extractText] extraction failed:", e);
    return { text: "", status: "FAILED" };
  }
}

/** Parses OCR/PDF-text-layer output into transaction rows. Column layout
 * doesn't survive OCR reliably (whitespace collapses, debit/credit columns
 * can't be told apart by position alone), so this deliberately infers
 * debit-vs-credit from the balance *delta* between consecutive dated lines
 * rather than trying to guess which number is which column — the balance
 * figure is the one thing that stays unambiguous line to line.
 *
 * Grouped into one record per date-line before extraction (a record runs
 * until the next date-line or end of text), not one record per raw line —
 * confirmed against a real bank statement PDF export where a transaction's
 * date, description, and numbers each land on their own line (no
 * whitespace between adjacent amount columns once flattened to text), so
 * requiring a date and an amount on the *same* line matched zero rows on
 * a real, correctly-extracted statement. Grouping first, then running the
 * same amount extraction against the joined record text, recovers those
 * without changing how amounts themselves are read.
 */
export function parseTransactions(rawText: string): StatementTransaction[] {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const records: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (DATE_PATTERN.test(line)) {
      if (current.length > 0) records.push(current.join(" "));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
    // Lines before the first date-line (account summary, column headers,
    // branch address, etc.) belong to no record — dropped, not guessed at.
  }
  if (current.length > 0) records.push(current.join(" "));

  const rows: StatementTransaction[] = [];
  let previousBalance: number | null = null;

  for (const record of records) {
    const dateMatch = record.match(DATE_PATTERN);
    if (!dateMatch) continue;

    const amounts = record.match(AMOUNT_PATTERN);
    if (!amounts || amounts.length === 0) continue;

    const parseAmt = (s: string) => parseFloat(s.replace(/,/g, ""));
    const balance = parseAmt(amounts[amounts.length - 1]);
    const txnAmount = amounts.length >= 2 ? parseAmt(amounts[amounts.length - 2]) : null;

    const description = record
      .replace(DATE_PATTERN, "")
      .replace(new RegExp(amounts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), "")
      .trim();

    let debit: number | null = null;
    let credit: number | null = null;
    if (txnAmount !== null && previousBalance !== null) {
      if (balance >= previousBalance) credit = txnAmount;
      else debit = txnAmount;
    }
    // First row (opening balance) or a row we can't sign — record the
    // balance for delta tracking but don't count it as a transaction amount.

    rows.push({ date: dateMatch[1], description, debit, credit, balance });
    previousBalance = balance;
  }

  return rows;
}

export function computeMetrics(rows: StatementTransaction[]): StatementMetrics {
  const withAmount = rows.filter((r) => r.debit !== null || r.credit !== null);
  const balances = rows.map((r) => r.balance);
  const totalCredits = withAmount.reduce((s, r) => s + (r.credit ?? 0), 0);
  const totalDebits = withAmount.reduce((s, r) => s + (r.debit ?? 0), 0);
  const bounceCount = rows.filter((r) => BOUNCE_PATTERN.test(r.description)).length;
  const emiOutflow = withAmount.filter((r) => EMI_PATTERN.test(r.description) && r.debit).reduce((s, r) => s + (r.debit ?? 0), 0);

  // Recurring-amount credits (same amount appearing 2+ times) as an income
  // proxy — closer to a real salary/regular-income signal than a flat
  // average of every credit, which would be skewed by one-off deposits.
  const creditAmounts = withAmount.filter((r) => r.credit).map((r) => r.credit as number);
  const counts = new Map<number, number>();
  for (const amt of creditAmounts) counts.set(amt, (counts.get(amt) ?? 0) + 1);
  const recurring = [...counts.entries()].filter(([, n]) => n >= 2);

  const dates = rows.map((r) => parseStatementDate(r.date)).filter((d): d is Date => d !== null);
  const monthsSpanned = dates.length >= 2
    ? Math.max(1, Math.round((Math.max(...dates.map((d) => d.getTime())) - Math.min(...dates.map((d) => d.getTime()))) / (1000 * 60 * 60 * 24 * 30)))
    : 1;

  const recurringTotal = recurring.reduce((s, [amt, n]) => s + amt * n, 0);
  const estimatedMonthlyIncome = recurringTotal > 0
    ? Math.round(recurringTotal / monthsSpanned)
    : Math.round(totalCredits / monthsSpanned);

  return {
    transactionCount: withAmount.length,
    avgBalance: balances.length ? Math.round(balances.reduce((a, b) => a + b, 0) / balances.length) : 0,
    minBalance: balances.length ? Math.min(...balances) : 0,
    totalCredits: Math.round(totalCredits),
    totalDebits: Math.round(totalDebits),
    bounceCount,
    emiOutflow: Math.round(emiOutflow),
    estimatedMonthlyIncome,
    monthsSpanned,
  };
}

function parseStatementDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(mo) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

export function computeEligibility(metrics: StatementMetrics): { flag: EligibilityFlag; reasons: string[] } {
  const reasons: string[] = [];

  if (metrics.transactionCount < 5) {
    reasons.push(`Only ${metrics.transactionCount} transaction(s) could be parsed from this statement — too few for a reliable assessment. Recommend requesting a clearer statement or manual review.`);
    return { flag: "NEEDS_REVIEW", reasons };
  }

  if (metrics.bounceCount >= 3) {
    reasons.push(`${metrics.bounceCount} bounced/returned transactions found in the statement period.`);
    return { flag: "NOT_ELIGIBLE", reasons };
  }
  if (metrics.minBalance < 0) {
    reasons.push("Account balance went negative at least once during the statement period.");
    return { flag: "NOT_ELIGIBLE", reasons };
  }

  let needsReview = false;
  if (metrics.bounceCount > 0) {
    reasons.push(`${metrics.bounceCount} bounced/returned transaction(s) found — review before approval.`);
    needsReview = true;
  }
  if (metrics.estimatedMonthlyIncome > 0) {
    const emiPerMonth = metrics.emiOutflow / metrics.monthsSpanned;
    const burden = emiPerMonth / metrics.estimatedMonthlyIncome;
    if (burden > 0.5) {
      reasons.push(`Existing EMI/loan outflow is ~${Math.round(burden * 100)}% of estimated monthly income (recommended ceiling: 50%).`);
      needsReview = true;
    }
  }

  if (needsReview) return { flag: "NEEDS_REVIEW", reasons };

  reasons.push("No bounced transactions; balance and income patterns from the statement appear healthy.");
  return { flag: "ELIGIBLE", reasons };
}

export function absoluteUploadPath(relativeFilePath: string): string {
  return path.join(process.cwd(), relativeFilePath);
}
