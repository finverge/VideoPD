/**
 * Minimal, correct CSV writer — RFC 4180 quoting (wrap in double-quotes and
 * double any internal quote whenever a field contains a comma, quote, or
 * newline; leave everything else bare). No dependency — this is the whole
 * job: naive comma-joining breaks on real data this app already has
 * (addresses with commas, notes with newlines), so this isn't optional
 * polish, it's the difference between a CSV that opens correctly in Excel
 * and one that silently misaligns columns.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvField).join(","));
  // CRLF line endings — the RFC 4180 convention, and what avoids Excel on
  // Windows occasionally mis-rendering LF-only CSVs as one run-on line.
  return lines.join("\r\n") + "\r\n";
}
