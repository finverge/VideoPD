import { NextRequest, NextResponse } from "next/server";
import { mkdir, open } from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { extractText, parseTransactions, computeMetrics, computeEligibility } from "@/lib/bankStatement";

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({ where: { token } });
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
  const { text, status: extractStatus } = await extractText(absolutePath, file.type);

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

    statement = await db.bankStatement.create({
      data: {
        sessionId: session.id, fileName: file.name, filePath: relativePath, mimeType: file.type,
        status: finalStatus,
        extractedText: text,
        transactionsJson: JSON.stringify(transactions),
        metricsJson: JSON.stringify(metrics),
        eligibilityFlag: flag,
        eligibilityReasonsJson: JSON.stringify(reasons),
      },
    });
  }

  return NextResponse.json({ statement });
}
