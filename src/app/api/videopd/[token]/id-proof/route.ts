import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";

// Serves the borrower's own ID proof back to their own VideoPD session, so
// Step 1's on-device face-match (src/lib/faceMatch.ts) has something to
// compare the liveness capture against. Token-scoped, same authorization
// boundary as the rest of this borrower-facing flow — deliberately not
// api/staff/evidence/[id], which is the staff cockpit's own read path and
// authorized differently. Serves both images and PDFs (a PDF ID proof is a
// real, common shape — DigiLocker/scanned Aadhaar downloads); the client
// dispatches on Content-Type and renders a PDF's first page to an image
// before running face detection (descriptorFromIdProofUrl in faceMatch.ts).
// A 404 here still means "genuinely nothing on file" — never an error, the
// caller always treats it as "skip face-match".
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await db.videoPdSession.findUnique({
    where: { token },
    include: { lead: { select: { applicationId: true } } },
  });
  if (!session) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });

  const idProof = await db.uploadedEvidence.findFirst({
    where: {
      applicationId: session.lead.applicationId,
      type: "ID_PROOF",
      OR: [{ mimeType: { startsWith: "image/" } }, { mimeType: "application/pdf" }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!idProof) return NextResponse.json({ error: "No ID proof on file." }, { status: 404 });

  const absolutePath = path.join(process.cwd(), idProof.filePath);
  try {
    const bytes = await readFile(absolutePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": idProof.mimeType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing on disk." }, { status: 404 });
  }
}
