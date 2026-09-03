import type { SegmentCode } from "@/types";

// The exact 80 COCO 2017 category labels the asset detector (RT-DETR, see
// voice-service/asset_detection.py) can output. Originally pulled from
// torchvision's FasterRCNN_ResNet50_FPN_Weights.DEFAULT.meta["categories"]
// (with the "__background__"/"N/A" placeholder entries stripped) when this
// used Faster R-CNN; verified unchanged after the RT-DETR swap — same
// COCO-80 label set, RT-DETR's own checkpoint spells 6 of them differently
// (motorbike/aeroplane/sofa/pottedplant/diningtable/tvmonitor), normalized
// back to these canonical names in asset_detection.py's own label map so
// this list and everything built on it didn't need to change. Used two
// places:
//   1. src/app/staff/risk-parameters/page.tsx — the admin checklist of
//      which categories to surface, default all selected.
//   2. src/lib/runVoiceCheck.ts — filters a check's raw detections down to
//      only the categories the admin left enabled before storing them.
export const ASSET_DETECTION_CATEGORIES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
  "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
  "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
  "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
  "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
  "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
  "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
  "teddy bear", "hair drier", "toothbrush",
] as const;

export type AssetDetectionCategory = (typeof ASSET_DETECTION_CATEGORIES)[number];

// Curated, per-segment starting selection — used to seed a segment's
// AssetDetectionSegmentSettings row the first time it's touched (see
// src/lib/assetDetectionSegmentSettings.ts), NOT "all 80": most of COCO's
// 80 categories (kite, frisbee, teddy bear, wine glass, zebra, hot dog...)
// are never going to appear in an Indian farm/institute/small-business
// premises video, and surfacing them as a live "detected asset" reads as
// noise, not signal. This is a judgment call, not a validated model — COCO
// has no domain-specific categories for any of these premises types (no
// "tractor", "sewing machine", "loom", "workbench"), so this is the best
// available curation of which of the 80 GENERIC categories are at least
// plausible to see in each segment's premises footage, not a claim that
// the list is complete or authoritative. Admin-editable per segment at
// /staff/risk-parameters — "Select all"/"Clear all" there can still
// override this starting point in either direction.
export const ASSET_DETECTION_DEFAULT_CATEGORIES_BY_SEGMENT: Record<SegmentCode, readonly string[]> = {
  // Farm premises — plausible livestock (COCO happens to include cow,
  // sheep, horse), farm transport, and basic tools/furniture. Excludes
  // COCO's other animals (elephant, zebra, giraffe, bear) as not remotely
  // plausible on an Indian farm.
  FARMER: [
    "person", "bicycle", "car", "motorcycle", "truck", "bus",
    "cow", "sheep", "horse", "bird", "dog", "cat",
    "bench", "chair", "bottle", "knife", "scissors", "clock", "backpack", "suitcase",
  ],
  // Training-institute premises (FSD's "show us your institute" step) —
  // classroom furniture, basic electronics, and study/tool items plausible
  // in a tailoring/computer/trade classroom.
  VOCATIONAL_STUDENT: [
    "person", "chair", "bench", "dining table", "couch",
    "tv", "laptop", "keyboard", "mouse", "cell phone", "remote",
    "book", "clock", "backpack", "suitcase", "scissors", "bottle", "cup", "bowl",
  ],
  // Business/workshop premises — spans retail, manufacturing, and service
  // businesses (this app's BUSINESS_OWNER segment isn't industry-specific),
  // so this leans broader: transport, furniture, office electronics, and
  // small-appliance/kitchen items plausible for a retail or food business.
  BUSINESS_OWNER: [
    "person", "car", "truck", "motorcycle", "bicycle", "bus",
    "chair", "couch", "bench", "dining table", "potted plant",
    "tv", "laptop", "keyboard", "mouse", "cell phone", "remote",
    "refrigerator", "microwave", "oven", "toaster", "sink",
    "scissors", "knife", "clock", "book", "vase", "bottle", "cup", "bowl",
    "backpack", "suitcase", "handbag",
  ],
};

// Curated, India-relevant workshop/institute/farm equipment names per
// segment that the AI detector can NEVER recognize — torchvision's
// COCO-pretrained model has a fixed 80-category vocabulary (the list
// above), and none of these are in it. Seeded from domain knowledge, not
// scraped or trained on any image — there's no image behind any of these
// entries, so no licensing exposure, but also no actual detection: these
// are surfaced to the underwriter as manual checkboxes
// (VoiceBiometricCheck.assetChecklistManualTicksJson) for a human to tick
// after visually confirming presence in the video. Admin-editable per
// segment at /staff/risk-parameters, same as the AI category list.
export const ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT: Record<SegmentCode, readonly string[]> = {
  FARMER: [
    "irrigation pump", "power tiller", "tractor", "plough", "thresher",
    "sprayer pump", "water pump", "fodder cutter", "milking machine", "tarpaulin/storage shed",
  ],
  VOCATIONAL_STUDENT: [
    "sewing machine", "embroidery machine", "overlock machine", "welding machine",
    "lathe machine", "drill machine", "soldering iron", "sewing table/workbench",
  ],
  BUSINESS_OWNER: [
    "generator set", "weighing scale", "cash counting machine", "packaging machine",
    "air compressor", "grinder machine", "mixer machine", "computer/POS terminal", "signage/storefront branding",
  ],
};

// Default point value seeded for every category/manual-item a segment
// starts with (both ASSET_DETECTION_DEFAULT_CATEGORIES_BY_SEGMENT and
// ASSET_DETECTION_DEFAULT_MANUAL_ITEMS_BY_SEGMENT share this one keyspace
// — see AssetDetectionSegmentSettings.weightsJson). A deliberately
// judgment-call starting point — items that say more about a functioning
// livelihood (a tractor, a sewing machine, a generator set) start higher
// than items that are just "someone was in the room" (person) or
// incidental (bottle, cup) — NOT a validated valuation. Every weight is
// freely admin-editable at /staff/risk-parameters; treat these as a
// reasonable seed to tune from, not a number to trust as-is.
export const ASSET_DETECTION_DEFAULT_WEIGHTS_BY_SEGMENT: Record<SegmentCode, Record<string, number>> = {
  FARMER: {
    person: 0, bicycle: 2, car: 3, motorcycle: 2, truck: 4, bus: 1,
    cow: 5, sheep: 3, horse: 3, bird: 0, dog: 0, cat: 0,
    bench: 1, chair: 1, bottle: 0, knife: 1, scissors: 1, clock: 0, backpack: 1, suitcase: 1,
    "irrigation pump": 8, "power tiller": 9, tractor: 10, plough: 6, thresher: 8,
    "sprayer pump": 5, "water pump": 5, "fodder cutter": 5, "milking machine": 6, "tarpaulin/storage shed": 3,
  },
  VOCATIONAL_STUDENT: {
    person: 0, chair: 1, bench: 1, "dining table": 1, couch: 1,
    tv: 2, laptop: 5, keyboard: 1, mouse: 1, "cell phone": 2, remote: 0,
    book: 1, clock: 0, backpack: 1, suitcase: 1, scissors: 1, bottle: 0, cup: 0, bowl: 0,
    "sewing machine": 9, "embroidery machine": 8, "overlock machine": 7, "welding machine": 9,
    "lathe machine": 9, "drill machine": 6, "soldering iron": 4, "sewing table/workbench": 3,
  },
  BUSINESS_OWNER: {
    person: 0, car: 3, truck: 4, motorcycle: 2, bicycle: 2, bus: 1,
    chair: 1, couch: 1, bench: 1, "dining table": 1, "potted plant": 0,
    tv: 2, laptop: 5, keyboard: 1, mouse: 1, "cell phone": 2, remote: 0,
    refrigerator: 5, microwave: 3, oven: 4, toaster: 1, sink: 1,
    scissors: 1, knife: 1, clock: 0, book: 0, vase: 0, bottle: 0, cup: 0, bowl: 0,
    backpack: 1, suitcase: 1, handbag: 1,
    "generator set": 8, "weighing scale": 5, "cash counting machine": 6, "packaging machine": 7,
    "air compressor": 6, "grinder machine": 6, "mixer machine": 5, "computer/POS terminal": 6,
    "signage/storefront branding": 4,
  },
};
