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

// Async/background processing (previously ran fully synchronously in this
// route, blocking the borrower's upload step for however long extraction
// took — several seconds even before the scanned-PDF OCR fallback, worse
// after it). The route now does only the fast part (save the file, create a
// PENDING row) before responding, and kicks off the slow part
// (processStatement below) WITHOUT awaiting it.
//
// Honest about what "background" means here: this is a genuine fire-and-
// forget on Node's event loop, not a faked delay — the promise really does
// keep running after the response is sent, and really does update the DB
// row when it finishes, verified live (see docs/videopd-future-work.md
// item 12). That's correct on a long-lived Node process, which is how this
// app runs (`next dev` / `next start`). It would NOT be correct as-is on a
// serverless/edge deployment (e.g. Vercel functions) — those environments
// can suspend or kill a function once its response is sent, with no
// guarantee an un-awaited promise gets to finish. A real production
// deployment on serverless infra would need an actual queue (e.g. a
// database-backed job table polled by a worker, or a managed queue
// service) rather than this in-process fire-and-forget. For this
// self-hosted Node prototype, the fire-and-forget is genuinely correct,
// not a shortcut standing in for something that doesn't work.
async function processStatement(
  statementId: string,
  absolutePath: string,
  mimeType: string,
  sessionId: string,
  leadId: string,
) {
  try {
    const { text, status: extractStatus, pdfInfo, revisionCount, viaOcr } = await extractText(absolutePath, mimeType);

    if (extractStatus === "FAILED") {
      await db.bankStatement.update({ where: { id: statementId }, data: { status: "FAILED" } });
      return;
    }

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
    const integrityCheck = checkTransactionIntegrity(transactions, viaOcr);
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

    await db.bankStatement.update({
      where: { id: statementId },
      data: {
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
    const summaryDoc = await db.initialSummaryDocument.findUnique({ where: { leadId } });
    if (summaryDoc) {
      const summary: InitialSummary = JSON.parse(summaryDoc.summaryJson);
      const otherFlags = summary.riskFlags.filter((f) => f.code !== BANK_STATEMENT_AUTHENTICITY_RISK_FLAG_CODE);
      summary.riskFlags = authenticityStatus === "FLAGGED" ? [...otherFlags, bankStatementAuthenticityRiskFlag(authReasons)] : otherFlags;
      const writes: Prisma.PrismaPromise<any>[] = [
        db.initialSummaryDocument.update({ where: { id: summaryDoc.id }, data: { summaryJson: JSON.stringify(summary) } }),
        db.lead.update({
          where: { id: leadId },
          data: { riskFlagCount: summary.riskFlags.length, riskSeverity: riskSeverityOf(summary.riskFlags) },
        }),
      ];
      await db.$transaction(writes);
    }
  } catch (e) {
    // A background failure must still resolve the row out of PENDING —
    // otherwise a crash here would leave the borrower's upload looking
    // permanently "processing" forever, silently, with no way for the
    // underwriter to tell a real failure from something still running.
    console.error("[bank-statement] background processing failed:", e);
    await db.bankStatement.update({ where: { id: statementId }, data: { status: "FAILED" } }).catch(() => {});
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({ where: { token }, include: { lead: true } });
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

  // fsync before the background step reads it back — extractText spawns a
  // separate `node`/`python` process to read this file, and plain
  // writeFile()'s resolved promise does not guarantee Windows has made the
  // write visible to another process's read yet. Confirmed by reproduction:
  // the exact same bytes, read moments after a from-a-different-process
  // readFile, intermittently came back with a corrupted PDF trailer/XRef
  // table; an explicit fsync eliminates the race. Matters even more now
  // that the read happens from a background task rather than inline.
  const handle = await open(absolutePath, "w");
  await handle.writeFile(bytes);
  await handle.sync();
  await handle.close();
  const relativePath = path.relative(process.cwd(), absolutePath);

  // Fast path only from here — create the row as PENDING and respond
  // immediately. Extraction/parsing/eligibility/authenticity (potentially
  // several seconds, longer with the scanned-PDF OCR fallback) happens in
  // processStatement below, deliberately not awaited.
  const statement = await db.bankStatement.create({
    data: { sessionId: session.id, fileName: file.name, filePath: relativePath, mimeType: file.type, status: "PENDING" },
  });

  processStatement(statement.id, absolutePath, file.type, session.id, session.leadId).catch((e) => {
    console.error("[bank-statement] processStatement rejected unexpectedly:", e);
  });

  return NextResponse.json({ statement });
}
