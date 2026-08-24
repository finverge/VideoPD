import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Mock OTP endpoint — stands in for the SMS gateway named as a BRD Section 12
 * dependency (FIN-BRD-VIDEOPD-2.0 v1.3). No real SMS is sent; in dev mode the
 * code is returned in the response so the flow is testable end-to-end. A real
 * build swaps the `generateAndStore` + response shape for an actual gateway
 * call and never returns the code to the client.
 */

function randomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, mobile, code, language } = body as {
    action: "request" | "verify";
    mobile: string;
    code?: string;
    language?: string;
  };

  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return NextResponse.json({ error: "A valid 10-digit mobile number is required." }, { status: 400 });
  }

  const borrower = await db.borrower.upsert({
    where: { mobile },
    update: language ? { language: language as any } : {},
    create: { mobile, language: (language as any) ?? "en" },
  });

  if (action === "request") {
    const otp = randomCode();
    await db.otpCode.create({
      data: {
        borrowerId: borrower.id,
        code: otp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    const isDev = process.env.NODE_ENV !== "production";
    return NextResponse.json({
      ok: true,
      borrowerId: borrower.id,
      // DEV ONLY — a real gateway integration never echoes the OTP back to the client.
      devCode: isDev ? otp : undefined,
    });
  }

  if (action === "verify") {
    if (!code) return NextResponse.json({ error: "Code is required." }, { status: 400 });
    const latest = await db.otpCode.findFirst({
      where: { borrowerId: borrower.id, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!latest || latest.expiresAt < new Date()) {
      return NextResponse.json({ error: "Code expired. Please request a new one." }, { status: 400 });
    }
    if (latest.code !== code) {
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }
    await db.otpCode.update({ where: { id: latest.id }, data: { consumedAt: new Date() } });
    await db.borrower.update({ where: { id: borrower.id }, data: { mobileVerified: true } });
    return NextResponse.json({ ok: true, borrowerId: borrower.id });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
