import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const application = await db.loanApplication.findUnique({
    where: { id },
    // lead: the wizard page redirects here once status leaves DRAFT (a
    // borrower revisiting their own /apply/[id] link after submitting) —
    // needs the lead id to know where to send them.
    include: { evidence: true, transcripts: { orderBy: { createdAt: "asc" } }, borrower: true, lead: true },
  });
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ application });
}

// FR-BWP-05 — auto-save after every completed section / upload.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { fields, currentStep, segmentFields } = body as {
    fields?: Record<string, unknown>;
    currentStep?: number;
    segmentFields?: Record<string, unknown>;
  };

  const existing = await db.loanApplication.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Application is no longer editable." }, { status: 409 });
  }

  const data: Record<string, unknown> = { lastActiveAt: new Date() };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      // Only allow known scalar columns through — avoids writing arbitrary keys.
      if (k in existing) data[k] = v;
    }
  }
  if (typeof currentStep === "number") data.currentStep = currentStep;
  if (segmentFields) {
    const merged = {
      ...(existing.segmentFieldsJson ? JSON.parse(existing.segmentFieldsJson) : {}),
      ...segmentFields,
    };
    data.segmentFieldsJson = JSON.stringify(merged);
  }

  const application = await db.loanApplication.update({ where: { id }, data: data as any });
  return NextResponse.json({ application });
}
