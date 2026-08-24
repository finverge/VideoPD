import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";

// Serves an uploaded evidence file back to the staff cockpit. Files live
// under uploads/ (outside public/, deliberately not statically servable —
// see api/upload/route.ts) so this is the only read path for them, same as
// a real document vault would front object storage with an authorized route
// rather than a public URL.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const evidence = await db.uploadedEvidence.findUnique({ where: { id } });
  if (!evidence) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const absolutePath = path.join(process.cwd(), evidence.filePath);
  try {
    const bytes = await readFile(absolutePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": evidence.mimeType,
        "Content-Disposition": `inline; filename="${evidence.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing on disk." }, { status: 404 });
  }
}
