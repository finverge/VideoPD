// Standalone PDF text-layer extraction, run as a child process (see
// src/lib/bankStatement.ts) rather than required in-process — pdf-parse's
// vendored, webpack-bundled pdf.js corrupts across repeated calls inside a
// long-lived Next.js dev-server process, so a fresh one-shot `node` process
// is used instead.
//
// Uses fs.readFileSync deliberately, not fs.promises.readFile — confirmed by
// direct reproduction that pdf-parse's internal pdf.js intermittently
// mis-parses the trailer/XRef table of a buffer obtained via the async read
// (identical bytes, sync read always succeeds, async read reliably fails)
// — almost certainly a byteOffset/pooled-buffer assumption somewhere in
// pdf.js's older bundled build. This is a short-lived one-shot process, so
// the sync read has no concurrency downside here.
const fs = require("fs");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const filePath = process.argv[2];
if (!filePath) {
  console.error(JSON.stringify({ error: "usage: node extract-pdf.js <file>" }));
  process.exit(1);
}

// Revision count for document-authenticity checking (src/lib/bankStatement.ts's
// checkPdfMetadata) — a legitimately single-pass-generated PDF has exactly one
// "%%EOF" marker at the very end. A PDF that was later opened and re-saved by
// an editor gets a new revision APPENDED (its own new xref/trailer/%%EOF),
// leaving the original bytes intact underneath — a well-known, real PDF
// forensics technique, not something invented for this: counting "%%EOF"
// occurrences in the raw bytes reveals how many times the file was saved.
// Read as latin1 (byte-for-byte, not a text encoding) since this is scanning
// literal ASCII bytes in a binary file, not decoding text content.
function countRevisions(bytes) {
  const raw = bytes.toString("latin1");
  const matches = raw.match(/%%EOF/g);
  return matches ? matches.length : 0;
}

try {
  const bytes = fs.readFileSync(filePath);
  const revisionCount = countRevisions(bytes);
  pdfParse(bytes)
    .then((result) => {
      process.stdout.write(JSON.stringify({ text: result.text, info: result.info ?? null, revisionCount }));
    })
    .catch((err) => {
      console.error(JSON.stringify({ error: err.message ?? String(err) }));
      process.exit(1);
    });
} catch (err) {
  console.error(JSON.stringify({ error: err.message ?? String(err) }));
  process.exit(1);
}
