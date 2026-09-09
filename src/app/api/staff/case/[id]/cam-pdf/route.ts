import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateCamPdf, type CamSnapshot } from "@/lib/camPdf";
import { getTenantConfig } from "@/lib/tenantConfig";

// Renders ONE stored, immutable CAM snapshot as a PDF — never live case
// data (see camSnapshot.ts's own doc comment for why). `snapshotId`
// selects a specific past generation (for the history view); omitted, it
// renders the latest one. `mode=inline` opens in-browser instead of
// forcing a download — same file either way, just how the browser is told
// to handle the response.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = req.nextUrl.searchParams.get("mode");
  const snapshotId = req.nextUrl.searchParams.get("snapshotId");

  const memo = snapshotId
    ? await db.creditAppraisalMemo.findUnique({ where: { id: snapshotId } })
    : await db.creditAppraisalMemo.findFirst({ where: { leadId: id }, orderBy: { generatedAt: "desc" } });

  if (!memo || memo.leadId !== id) {
    return NextResponse.json({ error: "No CAM generated yet for this case — use \"Generate CAM\" first." }, { status: 404 });
  }

  const tenant = await getTenantConfig();
  const snapshot: CamSnapshot = JSON.parse(memo.snapshotJson);
  const pdfBuffer = await generateCamPdf({ tenantName: tenant.displayName, generatedBy: memo.generatedBy, generatedAt: memo.generatedAt.toISOString(), snapshot });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${mode === "inline" ? "inline" : "attachment"}; filename="cam-${snapshot.applicationRef}-${memo.generatedAt.toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
