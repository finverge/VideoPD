import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.videoPdQuestionConfig.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const question = await db.videoPdQuestionConfig.update({ where: { id }, data: { status: "ARCHIVED" } });
  return NextResponse.json({ question });
}
