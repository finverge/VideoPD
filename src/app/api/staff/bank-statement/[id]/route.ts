import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";

// Serves an uploaded bank statement file back to the staff cockpit — same
// pattern as api/staff/evidence/[id]. Found missing live: a bank statement
// had no way to be viewed at all from the underwriter side, even though
// the file was genuinely uploaded and stored — this is that read path.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const statement = await db.bankStatement.findUnique({ where: { id } });
  if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const absolutePath = path.join(process.cwd(), statement.filePath);
  try {
    const bytes = await readFile(absolutePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": statement.mimeType,
        "Content-Disposition": `inline; filename="${statement.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing on disk." }, { status: 404 });
  }
}
