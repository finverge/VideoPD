import { db } from "@/lib/db";
import type { SegmentCode } from "@/types";

// CRUD helpers for the underwriter-request / approver-approve workflow on
// custom asset-detection category names — see
// AssetDetectionCategoryRequest's own schema doc comment for the full
// picture, especially the honesty caveat: approving a request does NOT
// teach the detector a new category (COCO's 80-category vocabulary is
// fixed). This is a governance trail, not a live capability toggle.

export async function listCategoryRequests(segment: SegmentCode) {
  return db.assetDetectionCategoryRequest.findMany({
    where: { segment },
    orderBy: { createdAt: "desc" },
  });
}

export async function createCategoryRequest(segment: SegmentCode, label: string, requestedBy: string, note: string | null) {
  return db.assetDetectionCategoryRequest.create({
    data: { segment, label: label.trim(), requestedBy, note },
  });
}
