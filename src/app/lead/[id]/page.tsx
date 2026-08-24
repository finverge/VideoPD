"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, Copy, FileText, Loader2, MessageSquareWarning, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BrandHeader } from "@/components/BrandHeader";
import { t } from "@/lib/i18n";
import { formatINR } from "@/lib/utils";
import type { InitialSummary, LangCode } from "@/types";

export default function LeadPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const lang = (search.get("lang") as LangCode) || "en";
  const [summary, setSummary] = useState<InitialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/lead/${params.id}`);
      const data = await res.json();
      if (data.lead?.summary) setSummary(JSON.parse(data.lead.summary.summaryJson));
      setLoading(false);
    })();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-sprout-500" />
      </div>
    );
  }

  const refNumber = params.id.slice(-8).toUpperCase();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-8">
      <BrandHeader className="mb-8" />
      <div className="flex flex-1 flex-col items-center justify-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-sprout-400 to-sprout-600 text-white shadow-glow"
      >
        <CheckCircle2 className="h-10 w-10" strokeWidth={2} />
        <motion.span
          className="absolute inset-0 rounded-full border-4 border-sprout-300"
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 1.4, repeat: 2 }}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white">{t(lang, "submittedTitle")}</h1>
        <p className="mt-2 text-ink-500 dark:text-ink-400">{t(lang, "submittedBody")}</p>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        onClick={() => {
          navigator.clipboard.writeText(refNumber);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-6 flex items-center gap-2 rounded-2xl border-2 border-dashed border-sprout-300 bg-sprout-50 px-5 py-3 dark:border-sprout-800 dark:bg-sprout-950/30"
      >
        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400">{t(lang, "submittedSub")}</span>
        <span className="font-mono text-lg font-bold text-sprout-700 dark:text-sprout-400">{refNumber}</span>
        <Copy className="h-3.5 w-3.5 text-ink-400" />
        {copied && <span className="text-xs font-semibold text-sprout-600">Copied!</span>}
      </motion.button>

      {summary && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-8 w-full">
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-4 w-4 text-sprout-600" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                Initial Summary Document
              </h2>
            </div>
            <div className="space-y-2.5">
              <Row label="Loan product" value={summary.loanAsk.productType} />
              <Row label="Amount requested" value={formatINR(summary.loanAsk.amount)} />
              <Row label="Tenure" value={summary.loanAsk.tenureMonths ? `${summary.loanAsk.tenureMonths} months` : "—"} />
              <Row label="Completeness score" value={`${summary.completenessScore}%`} />
            </div>

            <div className="mt-5 border-t border-ink-100 pt-4 dark:border-ink-800">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Documents</p>
              <div className="flex flex-wrap gap-2">
                {summary.documentChecklist.map((d, i) => (
                  <Badge key={i} tone={d.status === "PASSED" ? "success" : d.status === "FLAGGED" ? "warning" : "neutral"}>
                    {d.type.replace("_", " ")}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-ink-100 pt-4 dark:border-ink-800">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Risk flags (advisory)</p>
              {summary.riskFlags.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-sprout-600">
                  <CheckCircle2 className="h-4 w-4" /> {t(lang, "riskFlagsNone")}
                </p>
              ) : (
                <div className="space-y-2">
                  {summary.riskFlags.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 dark:bg-amber-950/20">
                      <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{f.label}</p>
                        <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70">{f.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-ink-400">
            <Sparkles className="h-3 w-3" /> This dossier is now waiting in the Underwriter Workspace queue.
          </p>
        </motion.div>
      )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-500 dark:text-ink-400">{label}</span>
      <span className="font-semibold text-ink-900 dark:text-white">{value || "—"}</span>
    </div>
  );
}
