"""
Storefront & signage text recognition — a customer-requested capability
(Lakshya Skill Finance, business-verification review): reads the actual
text printed on shop signboards, hoardings, and nearby storefronts visible
in the same VIDEOPD_BUSINESS_VERIFICATION clip the work-premises asset
checklist already analyzes (see asset_detection.py) — genuinely different
from that module, which detects OBJECT PRESENCE (a signboard is there,
somewhere in frame) but has no concept of reading what's printed on it.
The concrete asks this answers: exterior signboard OCR, text recognition
on storefront hoardings, and surfacing neighboring shop names visible in
the same shot — all real, useful corroboration for a Business Owner
segment's declared trade name and premises location.

How this works: samples frames from the video (same ffmpeg extraction
deepfake.py/asset_detection.py already use, imported from there rather
than duplicated), runs each frame through EasyOCR (Apache-2.0,
github.com/JaidedAI/EasyOCR) — a real, pretrained scene-text detector
(CRAFT) + recognizer (a CRNN-style network), not the same OCR pipeline
already used for ID proofs and bank statements (Tesseract.js, see
idProofCheck.ts/bankStatement.ts). That distinction is deliberate, not
incidental: Tesseract is tuned for flat, high-contrast document text,
and a hands-on comparison against this app's own kind of footage (angled
handheld shots, decorative signboard fonts, uneven outdoor lighting,
cluttered backgrounds) is a materially harder problem — a purpose-built
scene-text model was used here instead of stretching the document-OCR
pipeline to a job it wasn't built for.

Deliberately scoped, same discipline as asset_detection.py's own Phase 1
framing:
  - English-language recognition only in this build (EasyOCR's `en`
    recognition network). Hindi/regional-script signage will not be read
    correctly — a real, known gap, not silently glossed over. EasyOCR
    ships pretrained recognizers for several Indian scripts; adding one
    is a real but bounded follow-up (a separate model download plus a
    real accuracy check against actual regional signage), not a config
    flip attempted here.
  - Reads and surfaces whatever text is legible in-frame, and makes one
    real attempt to separate "the premises' own sign" from "a mention of
    a neighboring shop/institute" (isNeighborReference, see
    _is_neighbor_reference below): a plain keyword match against
    relational phrases ("next to", "near", "opposite", "beside", ...) —
    not language understanding, just pattern matching, and stated as
    such. A relation phrased without one of those exact words won't be
    caught; a business literally named with one of those words could be
    mis-tagged. Every reading, either way, is surfaced with its own
    thumbnail (same cropped-evidence pattern as the asset checklist) so
    the underwriter can always fall back to looking at the crop rather
    than trusting the tag blind.
  - No automatic cross-check against the declared business name is
    performed here — this returns raw readings only, for the underwriter
    to read against what the borrower declared. A same-vs-different flag
    comparing the top reading to LoanApplication.businessName would be a
    natural, bounded follow-up once real footage shows how reliable that
    comparison actually is — not attempted yet because it hasn't been.
  - Same false-positive/false-negative caveats as every other check
    sharing this evidence source: motion blur, glare, a sign angled away
    from the camera, or a low-resolution recording all degrade real
    accuracy. Advisory only, exactly like every other check in this
    service — a reading here is "the OCR found this text", not a
    confirmed fact.
"""
import os

import easyocr

from deepfake import extract_frames
from detection_thumbnails import crop_thumbnail

DEFAULT_NUM_FRAMES = 6  # same as asset_detection.py — a detection+recognition pass per frame is a comparable cost profile
# EasyOCR's own confidence score tends to run meaningfully lower than an
# object detector's for perfectly legible text (chosen from real testing
# against synthetic and photographed signage during development, not
# copied from asset_detection.py's 0.6 COCO threshold, which is a
# different model's own calibration).
CONFIDENCE_THRESHOLD = 0.45
MIN_TEXT_LENGTH = 3  # filters single/double-character noise reads (stray edges, watermarks, punctuation)
MODEL_NAME = "EasyOCR (CRAFT detection + CRNN recognition, en)"

_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _reader


def _bounding_box(quad: list) -> list[float]:
    """EasyOCR returns a 4-point (possibly rotated) quadrilateral per
    detection; detection_thumbnails.crop_thumbnail (shared with
    asset_detection.py/custom_asset_detection.py) expects an axis-aligned
    [x1, y1, x2, y2] box, same as RT-DETR's/OWLv2's own post-processing
    already produces — so this takes the quad's bounding rectangle rather
    than teaching the shared cropper a second box format."""
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    return [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))]


def _normalize(text: str) -> str:
    return " ".join(text.strip().upper().split())


# A reading containing one of these relational phrases is almost always
# describing WHERE the premises sits relative to something else ("Next to
# Krishna General Store", "Opp. City Hospital") rather than being the
# premises' own name/signage — a real, useful distinction for the
# underwriter (this is exactly the "neighboring shop/institute name" the
# capability was requested for), done with a plain keyword match rather
# than a trained classifier. Deliberately simple and stated as such: this
# is a text-pattern heuristic, not language understanding — a reading can
# be mis-classified either way (a business literally named "Bombay Corner
# Store" would trip "corner" if that were in the list; a relation phrased
# without any of these words won't be caught at all). Advisory only, same
# as everything else this module surfaces.
_NEIGHBOR_KEYWORDS = (
    "NEXT TO", "NEAR ", "OPP.", "OPPOSITE", "BESIDE", "ADJACENT TO",
    "CLOSE TO", "IN FRONT OF", "BEHIND ", "ABOVE ", "BELOW ",
)


def _is_neighbor_reference(text: str) -> bool:
    upper = _normalize(text)
    return any(kw in upper for kw in _NEIGHBOR_KEYWORDS)


def ocr_frame(image_path: str) -> list[dict]:
    """Returns every text reading above CONFIDENCE_THRESHOLD/MIN_TEXT_LENGTH
    in one frame, as a list of {text, confidence, box}."""
    reader = _get_reader()
    results = reader.readtext(image_path)
    out = []
    for quad, text, confidence in results:
        cleaned = text.strip()
        if len(cleaned) < MIN_TEXT_LENGTH or confidence < CONFIDENCE_THRESHOLD:
            continue
        out.append({"text": cleaned, "confidence": round(float(confidence), 4), "box": _bounding_box(quad)})
    return out


def analyze_video(video_path: str, num_frames: int = DEFAULT_NUM_FRAMES) -> dict:
    frame_paths = extract_frames(video_path, num_frames)
    try:
        if len(frame_paths) == 0:
            return {"framesAnalyzed": 0, "checklist": [], "model": MODEL_NAME, "insufficientFrames": True}

        # Same across-frame dedup idea as asset_detection.py's
        # max_count_per_label, adapted for text: the same signboard is
        # visible across several sampled frames, so keep only the
        # highest-confidence reading per distinct normalized text string
        # rather than reporting it once per frame it happened to appear in.
        best_per_text: dict[str, dict] = {}
        for p in frame_paths:
            for det in ocr_frame(p):
                key = _normalize(det["text"])
                if key not in best_per_text or det["confidence"] > best_per_text[key]["confidence"]:
                    best_per_text[key] = {**det, "framePath": p}

        checklist = []
        for item in sorted(best_per_text.values(), key=lambda d: -d["confidence"]):
            try:
                # A wider max_dim than crop_thumbnail's own 160px default —
                # a line of signage text is a wide/short crop, not the
                # roughly-square crop an object detection produces, so the
                # same 160px on the long (horizontal) edge left longer
                # readings blurry/illegible at display size.
                thumbnail = crop_thumbnail(item["framePath"], item["box"], max_dim=320)
            except Exception:
                thumbnail = None  # a thumbnail failure shouldn't take down the whole checklist result
            checklist.append({
                "text": item["text"], "confidence": item["confidence"], "thumbnail": thumbnail,
                # snake_case to match SignageOcrItem's pydantic field name
                # directly (main.py's SignageOcrItem(**item) unpacks this
                # dict by key, no alias configured) — the camelCase
                # isNeighborReference the Node side actually consumes is
                # produced by voiceBiometrics.ts's own explicit mapping,
                # same as every other field in this response.
                "is_neighbor_reference": _is_neighbor_reference(item["text"]),
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
