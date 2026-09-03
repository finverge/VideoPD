"""
Deepfake detection — frame-level image forensics, NOT video-native or
temporal analysis. Requested live, built despite being flagged research-
grade: no maintained production deepfake-detection package exists (same
conclusion reached researching this earlier — see
docs/videopd-future-work.md's "10c" section). What IS real and usable:
several community-trained image classifiers on HuggingFace, built on
`transformers`, with a standard `from_pretrained` API — no research-code
cloning, no exotic native dependencies.

How this actually works: samples a handful of frames from the video (via
ffmpeg — same bundled binary audio_extract.py already uses), runs each
through a real pretrained face-manipulation image classifier, and reports
the fraction that scored above a fake-probability threshold.

Honest about what this can't tell you:
  - It's a SINGLE community-trained model (prithivMLmods/Deepfake-Detect-
    Siglip2 — a Siglip2 image classifier fine-tuned for real/fake face
    classification), not an ensemble, not the original authors' own
    production tooling, not independently benchmarked against Lakshya's own
    footage.
  - Frame-level only — no analysis of temporal consistency, flicker, or
    motion artifacts across frames, which is where a lot of real deepfake
    detection signal actually lives.
  - Real false-positive risk on ordinary compression artifacts, poor
    lighting, or low-resolution webcam footage — this is stated explicitly
    in the risk-flag text surfaced to the underwriter (see
    src/lib/mockChecks.ts's deepfakeRiskFlag), not just here.
"""
import subprocess
import tempfile
import os

import imageio_ffmpeg
from PIL import Image

DEEPFAKE_MODEL_ID = "prithivMLmods/Deepfake-Detect-Siglip2"
FAKE_LABEL_SUBSTRING = "fake"  # matched case-insensitively against the model's own id2label strings, not a hardcoded index — see _fake_label_index below
DEFAULT_NUM_FRAMES = 8
FAKE_THRESHOLD = 0.6  # a single frame's fake-probability above this counts toward the flagged ratio
FLAG_RATIO_THRESHOLD = 0.5  # this fraction of sampled frames must clear FAKE_THRESHOLD before the overall clip is flagged

_processor = None
_model = None
_fake_label_index = None


def _get_model():
    global _processor, _model, _fake_label_index
    if _model is None:
        from transformers import AutoImageProcessor, AutoModelForImageClassification
        _processor = AutoImageProcessor.from_pretrained(DEEPFAKE_MODEL_ID)
        _model = AutoModelForImageClassification.from_pretrained(DEEPFAKE_MODEL_ID)
        _model.eval()
        id2label = _model.config.id2label
        matches = [i for i, label in id2label.items() if FAKE_LABEL_SUBSTRING in label.lower()]
        if not matches:
            raise RuntimeError(f"Could not find a '{FAKE_LABEL_SUBSTRING}' label in model output classes: {id2label}")
        _fake_label_index = matches[0]
    return _processor, _model, _fake_label_index


def extract_frames(video_path: str, num_frames: int = DEFAULT_NUM_FRAMES) -> list[str]:
    """Extracts num_frames evenly-spaced JPEG frames via ffmpeg. Returns a
    list of temp file paths — caller is responsible for cleanup."""
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    # Real duration probe (ffmpeg -i writes format info to stderr even
    # without an output file) so frames are spaced across the WHOLE clip,
    # not just clustered at the start.
    probe = subprocess.run([ffmpeg_exe, "-i", video_path], capture_output=True, timeout=30)
    stderr = probe.stderr.decode("utf-8", errors="replace")
    duration = None
    for line in stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            time_str = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = time_str.split(":")
            duration = int(h) * 3600 + int(m) * 60 + float(s)
            break
    if not duration or duration <= 0:
        duration = 10.0  # fallback — still produces a real (if less evenly spaced) sample

    tmp_dir = tempfile.mkdtemp(prefix="deepfake-frames-")
    frame_paths = []
    for i in range(num_frames):
        timestamp = duration * (i + 0.5) / num_frames  # midpoint of each of num_frames equal segments
        out_path = os.path.join(tmp_dir, f"frame-{i}.jpg")
        proc = subprocess.run(
            [ffmpeg_exe, "-y", "-ss", str(timestamp), "-i", video_path, "-frames:v", "1", "-q:v", "2", out_path],
            capture_output=True, timeout=30,
        )
        if proc.returncode == 0 and os.path.exists(out_path):
            frame_paths.append(out_path)
    return frame_paths


def classify_frame(image_path: str) -> float:
    """Returns the model's fake-probability for one frame, 0.0-1.0."""
    import torch
    processor, model, fake_idx = _get_model()
    image = Image.open(image_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
        probs = torch.nn.functional.softmax(logits, dim=-1)[0]
    return float(probs[fake_idx])


def analyze_video(video_path: str, num_frames: int = DEFAULT_NUM_FRAMES) -> dict:
    frame_paths = extract_frames(video_path, num_frames)
    try:
        if len(frame_paths) == 0:
            return {"framesAnalyzed": 0, "flaggedFrames": 0, "fakeFrameRatio": 0.0, "flagged": False, "model": DEEPFAKE_MODEL_ID, "insufficientFrames": True}
        scores = [classify_frame(p) for p in frame_paths]
        flagged_count = sum(1 for s in scores if s >= FAKE_THRESHOLD)
        ratio = flagged_count / len(scores)
        return {
            "framesAnalyzed": len(scores),
            "flaggedFrames": flagged_count,
            "fakeFrameRatio": round(ratio, 4),
            "perFrameScores": [round(s, 4) for s in scores],
            "flagged": ratio >= FLAG_RATIO_THRESHOLD,
            "model": DEEPFAKE_MODEL_ID,
            "insufficientFrames": False,
        }
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
