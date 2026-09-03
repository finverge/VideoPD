"""
Shared helper for asset_detection.py and custom_asset_detection.py — crops
the actual detected region out of the source frame and returns it as a
small base64 JPEG data URI, so the underwriter sees real visual evidence
for a detection (not just a label and a confidence number they have to
take on faith).
"""
import base64
import io

from PIL import Image


def crop_thumbnail(image_path: str, box: list[float], max_dim: int = 160, pad_frac: float = 0.15) -> str:
    """box is [x1, y1, x2, y2] in the source frame's own pixel coordinates
    (both RT-DETR's and OWLv2's post-processing return boxes in that form
    already scaled to the original image size — no further rescaling
    needed here). Pads slightly around the detected
    region so the crop shows a bit of context, not just a tight box that
    can be hard to recognize on its own; resizes down to max_dim on the
    long edge to keep the JSON payload small."""
    image = Image.open(image_path).convert("RGB")
    w, h = image.size
    x1, y1, x2, y2 = box
    bw, bh = max(x2 - x1, 1.0), max(y2 - y1, 1.0)
    x1 = max(0, x1 - bw * pad_frac)
    y1 = max(0, y1 - bh * pad_frac)
    x2 = min(w, x2 + bw * pad_frac)
    y2 = min(h, y2 + bh * pad_frac)
    crop = image.crop((int(x1), int(y1), int(x2), int(y2)))
    crop.thumbnail((max_dim, max_dim))
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
