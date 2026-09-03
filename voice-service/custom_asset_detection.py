"""
Segment-specific custom asset detection — the real answer to the honest
gap flagged after Phase 1 shipped: the work-premises checklist could only
ever surface COCO's 80 generic categories (chair, laptop, truck...), never
the segment-specific equipment (a sewing machine, an irrigation pump, a
tractor) underwriters actually care about, because asset_detection.py's
detector (RT-DETR) has a fixed, closed vocabulary baked in at training
time.

This module uses a genuinely different kind of model instead: OWLv2
(google/owlv2-base-patch16-ensemble, Apache-2.0), an OPEN-VOCABULARY /
zero-shot object detector. Unlike a closed-vocabulary detector, it takes
arbitrary text queries at inference time — "a sewing machine", "an
irrigation pump" — and tries to locate them in the image, with NO
fine-tuning and NO training dataset required. That's what makes this
buildable at all without Lakshya's data or scraped/licensed training
images: nothing is trained here, ever. The queries come straight from
each segment's configured manual-item list
(AssetDetectionSegmentSettings.manualItemsJson).

Honest about what this can't tell you (same directness as
asset_detection.py and deepfake.py):
  - Zero-shot detection is real, but its accuracy sits meaningfully below
    a properly fine-tuned closed-vocabulary detector, especially on
    unusual or visually-similar machinery (a power tiller vs. a generic
    piece of farm equipment). Confirmed working on real photos in
    development (correctly found a cup/spoon/plate in a photo and
    correctly found nothing for an object that wasn't there), but NEVER
    validated against real Indian farm/workshop/institute premises
    footage — that validation doesn't exist yet.
  - Confidence-threshold detections on ordinary handheld/webcam footage —
    same false-positive/negative risk on cluttered scenes, poor lighting,
    motion blur as every other check sharing this evidence source.
  - Presence/count only, same as asset_detection.py — not a valuation or
    condition assessment.
  - This does NOT replace the underwriter's manual tick — it's surfaced
    as an AI suggestion the underwriter still confirms/corrects, not an
    auto-populated fact (see runVoiceCheck.ts's own doc comment for
    exactly how the two combine).
"""
import os

import torch
from PIL import Image

from deepfake import extract_frames
from detection_thumbnails import crop_thumbnail

DEFAULT_NUM_FRAMES = 6
CONFIDENCE_THRESHOLD = 0.15  # OWLv2's own examples use a similarly low bar for open-vocabulary queries — its score distribution runs lower than a closed-vocab detector's, not comparable 1:1 with asset_detection.py's 0.6
MODEL_NAME = "google/owlv2-base-patch16-ensemble (OWLv2, zero-shot/open-vocabulary)"

_model = None
_processor = None


def _get_model():
    global _model, _processor
    if _model is None:
        from transformers import Owlv2Processor, Owlv2ForObjectDetection
        _processor = Owlv2Processor.from_pretrained("google/owlv2-base-patch16-ensemble")
        _model = Owlv2ForObjectDetection.from_pretrained("google/owlv2-base-patch16-ensemble")
        _model.eval()
    return _model, _processor


def detect_frame(image_path: str, queries: list[str]) -> list[dict]:
    """Returns every detection above CONFIDENCE_THRESHOLD in one frame, as
    a list of {label, confidence, box} — box is [x1, y1, x2, y2] in the
    source image's own pixel coordinates (post_process_grounded_object_detection
    already rescales to target_sizes, i.e. the original image)."""
    model, processor = _get_model()
    image = Image.open(image_path).convert("RGB")
    inputs = processor(text=[queries], images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    target_sizes = torch.tensor([image.size[::-1]])
    results = processor.post_process_grounded_object_detection(
        outputs=outputs, target_sizes=target_sizes, threshold=CONFIDENCE_THRESHOLD, text_labels=[queries],
    )[0]
    detections = []
    for label, score, box in zip(results["text_labels"], results["scores"].tolist(), results["boxes"].tolist()):
        detections.append({"label": label, "confidence": round(score, 4), "box": box})
    return detections


def analyze_video(video_path: str, queries: list[str], num_frames: int = DEFAULT_NUM_FRAMES) -> dict:
    if not queries:
        return {"framesAnalyzed": 0, "checklist": [], "model": MODEL_NAME, "insufficientFrames": False, "noQueries": True}

    frame_paths = extract_frames(video_path, num_frames)
    try:
        if len(frame_paths) == 0:
            return {"framesAnalyzed": 0, "checklist": [], "model": MODEL_NAME, "insufficientFrames": True, "noQueries": False}
        max_count_per_label: dict[str, int] = {}
        best_confidence_per_label: dict[str, float] = {}
        best_detection_per_label: dict[str, dict] = {}
        for p in frame_paths:
            detections = detect_frame(p, queries)
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
                thumbnail = None
            checklist.append({
                "label": label, "count": count, "confidence": round(best_confidence_per_label[label], 4),
                "thumbnail": thumbnail,
            })
        return {"framesAnalyzed": len(frame_paths), "checklist": checklist, "model": MODEL_NAME, "insufficientFrames": False, "noQueries": False}
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
