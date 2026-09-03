"""
Work-premises asset detection — Phase 1 of the customer-requested "AI
asset scoring" capability. Deliberately scoped to exactly Phase 1 as
proposed to Lakshya, no further: a real, off-the-shelf object-detection
model producing a CHECKLIST of generic categories visible in the
work-premises video (VIDEOPD_BUSINESS_VERIFICATION) — NOT identification
of specific asset types (an irrigation pump vs. a generic pipe), NOT a
valuation, and NOT a score. Phase 2 (domain-specific recognition + a real,
outcome-calibrated score) needs Lakshya's own labeled data first — see the
feasibility note this was scoped from.

How this works: samples a handful of frames from the video (the same
ffmpeg extraction deepfake.py already uses — imported from there rather
than duplicated), runs each frame through RT-DETR, an Apache-2.0,
transformers-native, real-time detection transformer pretrained on COCO's
80 everyday categories (chair, laptop, tv, car, truck, motorcycle,
refrigerator, oven, and more), and aggregates which categories were seen
with reasonable confidence across the sampled frames.

Originally shipped with torchvision's Faster R-CNN; swapped to RT-DETR
after a real, hands-on comparison (not just published benchmarks) on
this app's own real business-verification footage — RT-DETR ran ~2-3x
faster per frame AND scored its one false positive on that real footage
(an AC unit misread as "refrigerator") meaningfully lower (33-37%) than
Faster R-CNN had (65%), meaning it's correctly filtered out at this same
0.6 threshold where the old model let it through. Same COCO-80 category
set either way — RT-DETR's checkpoint uses a few different label
spellings (motorbike/aeroplane/sofa/pottedplant/diningtable/tvmonitor)
which RTDETR_LABEL_MAP below normalizes back to this codebase's existing
canonical names, so nothing downstream (category config, weights,
segment defaults) needed to change.

Honest about what this can't tell you:
  - COCO's 80 categories are general everyday objects, not anything
    domain-specific to farm/workshop/small-business equipment. A tractor,
    an irrigation pump, a sewing machine, a loom — none of these are COCO
    categories; a real one may go completely undetected, or get mapped to
    a loosely-related COCO class the model actually knows.
  - Presence/count detection only, not valuation or condition. Detecting
    two `chair`s doesn't mean two similarly-valuable chairs — the model
    has no concept of condition, brand, or worth. This is exactly why
    nothing downstream turns this into a numeric score by itself.
  - Confidence-threshold detections on ordinary handheld/webcam footage —
    false positives/negatives on cluttered scenes, poor lighting, motion
    blur, or partial occlusion are expected, same real-world caveat as
    the deepfake/lip-sync checks this shares an evidence source with.
  - Not independently benchmarked against Lakshya's own borrower
    population or premises types — same "advisory, not calibrated"
    standing every other check in this service carries.
"""
import os

import torch
from PIL import Image

from deepfake import extract_frames
from detection_thumbnails import crop_thumbnail

DEFAULT_NUM_FRAMES = 6  # fewer than deepfake's 8 — a detection forward pass is heavier per frame than image classification
CONFIDENCE_THRESHOLD = 0.6
MODEL_NAME = "rtdetr_r50vd_coco_o365 (RT-DETR, COCO-pretrained)"
_CHECKPOINT = "PekingU/rtdetr_r50vd_coco_o365"

# RT-DETR's checkpoint spells 6 of the 80 COCO categories differently from
# this codebase's existing canonical names (src/lib/assetDetectionCategories.ts,
# also what Faster R-CNN's torchvision weights used) — normalized here so
# every downstream category/weight/segment config keeps working unchanged.
_RTDETR_LABEL_MAP = {
    "motorbike": "motorcycle",
    "aeroplane": "airplane",
    "sofa": "couch",
    "pottedplant": "potted plant",
    "diningtable": "dining table",
    "tvmonitor": "tv",
}

_model = None
_processor = None


def _get_model():
    global _model, _processor
    if _model is None:
        from transformers import RTDetrForObjectDetection, RTDetrImageProcessor
        _processor = RTDetrImageProcessor.from_pretrained(_CHECKPOINT)
        _model = RTDetrForObjectDetection.from_pretrained(_CHECKPOINT)
        _model.eval()
    return _model, _processor


def detect_frame(image_path: str) -> list[dict]:
    """Returns every detection above CONFIDENCE_THRESHOLD in one frame, as
    a list of {label, confidence, box} — box is [x1, y1, x2, y2] in the
    source image's own pixel coordinates (post_process_object_detection
    already rescales to target_sizes, i.e. the original image)."""
    model, processor = _get_model()
    image = Image.open(image_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_object_detection(
        outputs, target_sizes=torch.tensor([image.size[::-1]]), threshold=CONFIDENCE_THRESHOLD,
    )[0]
    detections = []
    for label_idx, score, box in zip(results["labels"].tolist(), results["scores"].tolist(), results["boxes"].tolist()):
        label = model.config.id2label[label_idx]
        label = _RTDETR_LABEL_MAP.get(label, label)
        detections.append({"label": label, "confidence": round(score, 4), "box": box})
    return detections


def analyze_video(video_path: str, num_frames: int = DEFAULT_NUM_FRAMES) -> dict:
    frame_paths = extract_frames(video_path, num_frames)
    try:
        if len(frame_paths) == 0:
            return {"framesAnalyzed": 0, "checklist": [], "model": MODEL_NAME, "insufficientFrames": True}

        # For each distinct label seen anywhere, report the MAX count seen
        # within any single frame — not a sum across frames. The same
        # object staying in view across several sampled frames must not
        # be counted as if there were several of them. Also track the
        # single highest-confidence detection per label (which frame, which
        # box) so a thumbnail can be cropped from it below — real visual
        # evidence for the underwriter, not just a label and a number.
        max_count_per_label: dict[str, int] = {}
        best_confidence_per_label: dict[str, float] = {}
        best_detection_per_label: dict[str, dict] = {}
        for p in frame_paths:
            detections = detect_frame(p)
            counts: dict[str, int] = {}
            for d in detections:
                counts[d["label"]] = counts.get(d["label"], 0) + 1
                if d["confidence"] > best_confidence_per_label.get(d["label"], 0.0):
                    best_confidence_per_label[d["label"]] = d["confidence"]
                    best_detection_per_label[d["label"]] = {"framePath": p, "box": d["box"]}
            for label, count in counts.items():
                max_count_per_label[label] = max(max_count_per_label.get(label, 0), count)

        checklist = []
        for label, count in sorted(max_count_per_label.items(), key=lambda kv: -kv[1]):
            best = best_detection_per_label[label]
            try:
                thumbnail = crop_thumbnail(best["framePath"], best["box"])
            except Exception:
                thumbnail = None  # a thumbnail failure shouldn't take down the whole checklist result
            checklist.append({
                "label": label, "count": count, "confidence": round(best_confidence_per_label[label], 4),
                "thumbnail": thumbnail,
            })
        return {"framesAnalyzed": len(frame_paths), "checklist": checklist, "model": MODEL_NAME, "insufficientFrames": False}
    finally:
        for p in frame_paths:
            try:
                os.unlink(p)
            except OSError:
                pass
        try:
            os.rmdir(os.path.dirname(frame_paths[0])) if frame_paths else None
        except OSError:
            pass
