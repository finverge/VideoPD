import { NextRequest, NextResponse } from "next/server";
import { mkdir, open } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { extractText, parseTransactions, computeMetrics, computeEligibility, checkPdfMetadata, checkTransactionIntegrity } from "@/lib/bankStatement";
import { bankStatementAuthenticityRiskFlag, BANK_STATEMENT_AUTHENTICITY_RISK_FLAG_CODE, riskSeverityOf } from "@/lib/mockChecks";
import type { InitialSummary } from "@/types";

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({ where: { token }, include: { lead: { include: { summary: true } } } });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  if (session.status === "COMPLETE") {
    return NextResponse.json({ error: "This verification is already complete." }, { status: 409 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required." }, { status: 400 });
  if (!ACCEPTED_MIME.includes(file.type)) {
    return NextResponse.json({ error: "Please upload a PDF, JPG, PNG, or WEBP file." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "uploads", "bank-statements", session.id);
  await mkdir(dir, { recursive: true });
  const safeName = `statement-${nanoid(8)}-${file.name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const absolutePath = path.join(dir, safeName);

  // fsync before the extraction step reads it back — extractText spawns a
  // separate `node` process (see scripts/extract-pdf.js) to read this file
  // almost immediately, and plain writeFile()'s resolved promise does not
  // guarantee Windows has made the write visible to another process's read
  // yet. Confirmed by reproduction: the exact same bytes, read moments after
  // a from-a-different-process readFile, intermittently came back with a
  // corrupted PDF trailer/XRef table; an explicit fsync eliminates the race.
  const handle = await open(absolutePath, "w");
  await handle.writeFile(bytes);
  await handle.sync();
  await handle.close();
  const relativePath = path.relative(process.cwd(), absolutePath);

  // Extraction (ICR/OCR or PDF text layer — see lib/bankStatement.ts) runs
  // synchronously here. A production build would queue this (OCR can take
  // several seconds) and let the borrower move on to the next step while it
  // completes in the background — acceptable to block for a local prototype.
  const { text, status: extractStatus, pdfInfo, revisionCount } = await extractText(absolutePath, file.type);

  let statement;
  if (extractStatus === "FAILED") {
    statement = await db.bankStatement.create({
      data: {
        sessionId: session.id, fileName: file.name, filePath: relativePath, mimeType: file.type,
        status: "FAILED",
      },
    });
  } else {
    const transactions = parseTransactions(text);
    const metrics = computeMetrics(transactions);
    const finalStatus = extractStatus === "NEEDS_REVIEW" || metrics.transactionCount < 5 ? "NEEDS_REVIEW" : "EXTRACTED";
    const { flag, reasons } = computeEligibility(metrics);

    // Document-authenticity signals (real, deterministic — see
    // bankStatement.ts's own doc comments): PDF revision-count/metadata,
    // plus independent balance-vs-transaction arithmetic reconciliation.
    // Combined into one status+reasons list, PASSED reasons included, same
    // "always say why, never a bare verdict" convention as eligibility.
    const metadataCheck = checkPdfMetadata(pdfInfo, revisionCount);
    const integrityCheck = checkTransactionIntegrity(transactions, file.type.startsWith("image/"));
    const authReasons = [...metadataCheck.reasons, ...integrityCheck.reasons];
    const authenticityStatus =
      metadataCheck.status === "FLAGGED" || integrityCheck.status === "FLAGGED" ? "FLAGGED" : "PASSED";
    if (authReasons.length === 0) {
      authReasons.push(
        metadataCheck.status === "NOT_APPLICABLE"
          ? "No signs of alteration in the extracted transaction data. This statement was submitted as an image, so PDF-structure checks (revision history, generating software) don't apply."
          : "Document authenticity verified — no signs of tampering detected. PDF structure, generating software, and transaction arithmetic are all consistent with an unaltered bank-issued statement."
      );
    }

    statement = await db.bankStatement.create({
      data: {
        sessionId: session.id, fileName: file.name, filePath: relativePath, mimeType: file.type,
        status: finalStatus,
        extractedText: text,
        transactionsJson: JSON.stringify(transactions),
        metricsJson: JSON.stringify(metrics),
        eligibilityFlag: flag,
        eligibilityReasonsJson: JSON.stringify(reasons),
        authenticityStatus,
        authenticityReasonsJson: JSON.stringify(authReasons),
      },
    });

    // Folds a FLAGGED verdict into the Lead's own risk flags — same
    // summary.riskFlags array /api/submit populates and the queue's
    // riskSeverity badge reads from — so a possibly-tampered statement
    // surfaces on the underwriter queue itself, not only a case already
    // opened to this panel. Keyed by BANK_STATEMENT_AUTHENTICITY_RISK_FLAG_CODE
    // so a later, cleaner re-upload replaces (not duplicates) this flag, and
    // drops it again if that later upload comes back clean — same pattern
    // liveness-result already uses for IDENTITY_RISK_FLAG_CODE.
    if (session.lead.summary) {
      const summary: InitialSummary = JSON.parse(session.lead.summary.summaryJson);
      const otherFlags = summary.riskFlags.filter((f) => f.code !== BANK_STATEMENT_AUTHENTICITY_RISK_FLAG_CODE);
      summary.riskFlags = authenticityStatus === "FLAGGED" ? [...otherFlags, bankStatementAuthenticityRiskFlag(authReasons)] : otherFlags;
      const writes: Prisma.PrismaPromise<any>[] = [
        db.initialSummaryDocument.update({ where: { id: session.lead.summary.id }, data: { summaryJson: JSON.stringify(summary) } }),
        db.lead.update({
          where: { id: session.lead.id },
          data: { riskFlagCount: summary.riskFlags.length, riskSeverity: riskSeverityOf(summary.riskFlags) },
        }),
      ];
      await db.$transaction(writes);
    }
  }

  return NextResponse.json({ statement });
}
