import { db } from "@/lib/db";
import { getAssetDetectionSegmentSettings } from "@/lib/assetDetectionSegmentSettings";
import type { SegmentCode } from "@/types";

// Maker-checker workflow for a segment's whole asset scorecard (AI
// category allow-list + score weights + manual reference items, edited
// together as one snapshot) — see AssetScorecardRevision's schema doc
// comment for the full picture. The live configuration
// (AssetDetectionSegmentSettings) only ever changes through
// decideAssetScorecardRevision below approving one of these, never
// through a direct save from the config page.

export async function listScorecardRevisions(segment: SegmentCode) {
  return db.assetScorecardRevision.findMany({
    where: { segment },
    orderBy: { createdAt: "desc" },
  });
}

export async function proposeScorecardRevision(
  segment: SegmentCode,
  categories: string[],
  weights: Record<string, number>,
  manualItems: string[],
  proposedBy: string,
  note: string | null,
) {
  return db.assetScorecardRevision.create({
    data: {
      segment,
      categoriesJson: JSON.stringify(categories),
      weightsJson: JSON.stringify(weights),
      manualItemsJson: JSON.stringify(manualItems),
      proposedBy,
      note,
    },
  });
}

export type DecideScorecardRevisionResult =
  | { ok: true; revision: Awaited<ReturnType<typeof db.assetScorecardRevision.update>> }
  | { ok: false; error: string; status: number };

// Approves or rejects a pending revision. Enforces genuine four-eyes
// review — decidedBy must be a different person than proposedBy, checked
// here rather than just trusting the Approver-role gate the caller (the
// API route) already applies, since a single Approver account could
// otherwise propose AND approve their own change. Approving copies the
// revision's full snapshot onto the live AssetDetectionSegmentSettings row
// (getAssetDetectionSegmentSettings ensures it exists first).
export async function decideScorecardRevision(
  revisionId: string,
  decidedBy: string,
  decision: "APPROVED" | "REJECTED",
): Promise<DecideScorecardRevisionResult> {
  const existing = await db.assetScorecardRevision.findUnique({ where: { id: revisionId } });
  if (!existing) return { ok: false, error: "Revision not found.", status: 404 };
  if (existing.status !== "PENDING") {
    return { ok: false, error: `This revision was already ${existing.status.toLowerCase()}.`, status: 409 };
  }
  if (decision === "APPROVED" && existing.proposedBy === decidedBy) {
    return { ok: false, error: "Maker-checker: the person who proposed a scorecard change can't also approve it — ask another Approver to review it.", status: 403 };
  }

  const revision = await db.assetScorecardRevision.update({
    where: { id: revisionId },
    data: { status: decision, decidedBy, decidedAt: new Date() },
  });

  if (decision === "APPROVED") {
    await getAssetDetectionSegmentSettings(existing.segment as SegmentCode); // ensure a row exists
    await db.assetDetectionSegmentSettings.update({
      where: { segment: existing.segment },
      data: {
        categoriesJson: existing.categoriesJson,
        weightsJson: existing.weightsJson,
        manualItemsJson: existing.manualItemsJson,
        updatedBy: decidedBy,
      },
    });
  }

  return { ok: true, revision };
}
