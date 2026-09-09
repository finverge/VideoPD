import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateDossierPdf, type DossierPdfInput } from "@/lib/dossierPdf";
import { getTenantConfig } from "@/lib/tenantConfig";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: { application: true, videoPdSession: true },
  });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!lead.videoPdSession || lead.videoPdSession.status !== "COMPLETE" || !lead.videoPdSession.dossierJson) {
    return NextResponse.json({ error: "No completed VideoPD dossier for this case." }, { status: 409 });
  }

  const dossier = JSON.parse(lead.videoPdSession.dossierJson);
  const tenant = await getTenantConfig();
  const input: DossierPdfInput = {
    tenantName: tenant.displayName,
    applicantName: lead.application.fullName || "—",
    mobile: "", // filled below via a second query to avoid a wider include on the hot path
    segment: lead.application.segment,
    refNumber: lead.id.slice(-8).toUpperCase(),
    requestedAmount: lead.application.requestedAmount,
    tenureMonths: lead.application.tenureMonths,
    loanPurpose: lead.application.loanPurpose,
    skillIntentScore: lead.videoPdSession.skillIntentScore ?? dossier.skillIntentScore ?? 0,
    generatedAt: dossier.generatedAt ?? lead.videoPdSession.completedAt?.toISOString() ?? new Date().toISOString(),
    livenessCaptured: dossier.livenessCaptured ?? false,
    businessVerificationCaptured: dossier.businessVerificationCaptured ?? false,
    flags: dossier.flags ?? [],
    bankStatement: dossier.bankStatement ?? null,
    answers: dossier.answers ?? [],
  };

  const borrower = await db.borrower.findUnique({ where: { id: lead.application.borrowerId } });
  input.mobile = borrower?.mobile ?? "—";

  const pdfBuffer = await generateDossierPdf(input);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="videopd-dossier-${input.refNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
