import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Persists one real-time transcript segment from the live call (see
// useCallRoom.ts's transcribe option — each participant's own browser runs
// Web Speech API on their own mic and posts each recognized final result
// here as it happens). Same trust boundary as /api/call/[token] itself
// (anyone who can reach the call with this token can already see far more
// sensitive data), and same "no side effect on session status" principle —
// posting a transcript segment doesn't advance/complete anything.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { speakerName, text } = (await req.json()) as { speakerName?: string; text?: string };
  if (!speakerName || !text?.trim()) {
    return NextResponse.json({ error: "speakerName and text are required." }, { status: 400 });
  }

  const session = await db.videoPdSession.findUnique({ where: { token } });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });

  const segment = await db.callTranscriptSegment.create({
    data: { sessionId: session.id, speakerName, text: text.trim() },
  });
  return NextResponse.json({ segment });
}
