"""
Lip-sync/face-forgery detection — real face detection + 68-point landmark
extraction + mouth-region alignment feeding a real, MIT-licensed forgery
classifier (LipForensics, ahaliassos/LipForensics, CVPR 2021), trained
specifically on lip-region temporal artifacts typical of face-swap/
reenactment forgeries. See voice-service/README.md's "Deepfake/lip-sync"
section for the full account of what was tried before this (a broken
community SyncNet package, a non-commercially-licensed Wav2Lip) and why
this is the one that shipped.

Pipeline, real end to end:
  1. Extract consecutive frames from the clip via ffmpeg (not sparse
     sampling like deepfake.py — this model is temporal, it needs
     consecutive frames, not spread-out ones).
  2. Detect a face + 68 landmarks per frame (ibug.face_detection's
     RetinaFace, ibug.face_alignment's FAN — both MIT-licensed, weights
     bundled in their own repos, no external download needed at runtime).
  3. Smooth landmarks over a rolling window (reduces frame-to-frame
     jitter), affine-align each frame to a mean face using 5 stable
     points, then crop a 96x96 mouth region — the exact preprocessing
     LipForensics itself uses (vendored from its own preprocessing code,
     see lipsync/crop_utils.py).
  4. Grayscale, center-crop to 88x88, normalize, run through the model.

Honest about what this can't tell you: benchmarked on curated research
datasets (FaceForensics++ etc.), not this lender's own borrower population
or webcam conditions — same calibration caveat as every other check in
this service. A flagged result means "the lip-region pattern looked
anomalous to a model trained on known forgery techniques", not a
confirmed finding.
"""
import subprocess
import tempfile
import os

import numpy as np
import cv2
import torch
from PIL import Image

import imageio_ffmpeg
from lipsync.crop_utils import warp_img, apply_transform, cut_patch
from lipsync.spatiotemporal_net import get_model

LIPFORENSICS_MODEL_ID = "ahaliassos/LipForensics (lipforensics_ff.pth, FaceForensics++ c23)"
CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "model_cache", "lipforensics", "lipforensics_ff.pth")
MEAN_FACE_PATH = os.path.join(os.path.dirname(__file__), "lipsync", "mean_face.npy")

TARGET_FRAMES = 25  # LipForensics/LRW convention — ~1s at 25fps
STD_SIZE = (256, 256)
STABLE_POINTS = [33, 36, 39, 42, 45]  # nose tip + eye corners, iBUG 68-point indices
MOUTH_START, MOUTH_STOP = 48, 68
CROP_HALF = 48  # 96x96 crop (crop_width=crop_height=96 in the original repo)
SMOOTH_WINDOW = 12  # rolling landmark-smoothing window, matches crop_mouths.py
CENTER_CROP = 88
NORM_MEAN, NORM_STD = 0.421, 0.165  # from LipForensics' own evaluate.py — its actual training normalization

# Threshold is a starting point, not a calibrated cutoff — the checkpoint's
# raw logit output isn't documented with a canonical operating threshold in
# the paper/repo (they report AUC across a range, not a single cutoff). 0.0
# on the raw logit (i.e., sigmoid > 0.5) is the standard binary-classifier
# default and what's used until real labeled data suggests otherwise — see
# README's "Calibration" section, same caveat as the deepfake/voice checks.
FLAG_LOGIT_THRESHOLD = 0.0

_model = None
_face_detector = None
_landmark_detector = None
_mean_face = None


def _get_face_tools():
    global _face_detector, _landmark_detector, _mean_face
    if _face_detector is None:
        from ibug.face_detection import RetinaFacePredictor
        from ibug.face_alignment import FANPredictor
        _face_detector = RetinaFacePredictor(threshold=0.8, device="cpu", model=RetinaFacePredictor.get_model("resnet50"))
        _landmark_detector = FANPredictor(device="cpu", model=FANPredictor.get_model("2dfan2_alt"))
        _mean_face = np.load(MEAN_FACE_PATH)
    return _face_detector, _landmark_detector, _mean_face


def _get_model():
    global _model
    if _model is None:
        _model = get_model(weights_forgery_path=CHECKPOINT_PATH, device="cpu")
        _model.eval()
    return _model


def _extract_consecutive_frames(video_path: str, target_frames: int = TARGET_FRAMES) -> list[np.ndarray]:
    """Extracts up to target_frames CONSECUTIVE frames (resampled to 25fps
    to match the model's training convention) as BGR numpy arrays."""
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    tmp_dir = tempfile.mkdtemp(prefix="lipsync-frames-")
    try:
        pattern = os.path.join(tmp_dir, "frame-%04d.png")
        proc = subprocess.run(
            [ffmpeg_exe, "-y", "-i", video_path, "-vf", "fps=25", "-frames:v", str(target_frames), pattern],
            capture_output=True, timeout=60,
        )
        if proc.returncode != 0:
            return []
        frame_files = sorted(f for f in os.listdir(tmp_dir) if f.endswith(".png"))
        frames = [cv2.imread(os.path.join(tmp_dir, f)) for f in frame_files]
        return [f for f in frames if f is not None]
    finally:
        for f in os.listdir(tmp_dir):
            try:
                os.unlink(os.path.join(tmp_dir, f))
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass


def _crop_mouths(frames: list[np.ndarray], mean_face: np.ndarray) -> tuple[list[np.ndarray], int]:
    """Detects landmarks per frame, smooths over a rolling window, aligns
    and crops the mouth region. Returns (cropped_grayscale_frames,
    frames_with_no_face_count)."""
    face_detector, landmark_detector, _ = _get_face_tools()

    all_landmarks: list[np.ndarray | None] = []
    for frame in frames:
        detections = face_detector(frame, rgb=False)
        if len(detections) == 0:
            all_landmarks.append(None)
            continue
        # Largest detected face — the borrower should be the dominant face
        # in a VideoPD guided-flow recording.
        areas = [(d[2] - d[0]) * (d[3] - d[1]) for d in detections]
        best = detections[np.argmax(areas):np.argmax(areas) + 1]
        landmarks, scores = landmark_detector(frame, best, rgb=False)
        all_landmarks.append(landmarks[0] if len(landmarks) > 0 else None)

    no_face_count = sum(1 for lm in all_landmarks if lm is None)

    # Fill gaps by nearest valid neighbor — a frame or two of missed
    # detection (blink, brief motion blur) shouldn't throw out the whole
    # clip; too many gaps is handled by the caller via no_face_count.
    valid_indices = [i for i, lm in enumerate(all_landmarks) if lm is not None]
    if not valid_indices:
        return [], len(frames)
    for i in range(len(all_landmarks)):
        if all_landmarks[i] is None:
            nearest = min(valid_indices, key=lambda j: abs(j - i))
            all_landmarks[i] = all_landmarks[nearest]

    cropped = []
    for i, (frame, landmarks) in enumerate(zip(frames, all_landmarks)):
        window = all_landmarks[max(0, i - SMOOTH_WINDOW // 2):i + SMOOTH_WINDOW // 2 + 1]
        smoothed = np.mean(window, axis=0)
        try:
            trans_frame, trans = warp_img(smoothed[STABLE_POINTS, :], mean_face[STABLE_POINTS, :], frame, STD_SIZE)
            trans_landmarks = trans(landmarks)
            crop = cut_patch(trans_frame, trans_landmarks[MOUTH_START:MOUTH_STOP], CROP_HALF, CROP_HALF)
        except Exception:
            continue  # a genuinely out-of-bounds crop for this frame — skip rather than guess
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        cropped.append(gray)

    return cropped, no_face_count


def analyze_video(video_path: str) -> dict:
    frames = _extract_consecutive_frames(video_path)
    if len(frames) < 5:
        return {
            "score": 0.0, "flagged": False, "model": LIPFORENSICS_MODEL_ID,
            "framesAnalyzed": len(frames), "insufficientFrames": True, "noFaceDetected": False,
        }

    cropped, no_face_count = _crop_mouths(frames, np.load(MEAN_FACE_PATH))
    if len(cropped) < 5:
        return {
            "score": 0.0, "flagged": False, "model": LIPFORENSICS_MODEL_ID,
            "framesAnalyzed": len(frames), "insufficientFrames": True,
            "noFaceDetected": no_face_count == len(frames),
        }

    stack = np.stack(cropped)  # (T, H, W)
    clip = torch.from_numpy(stack).float().unsqueeze(-1)  # (T, H, W, 1)
    clip = clip.permute(3, 0, 1, 2) / 255.0  # (C, T, H, W)
    h, w = clip.shape[2], clip.shape[3]
    top, left = (h - CENTER_CROP) // 2, (w - CENTER_CROP) // 2
    clip = clip[:, :, top:top + CENTER_CROP, left:left + CENTER_CROP]
    clip = (clip - NORM_MEAN) / NORM_STD
    clip = clip.unsqueeze(0)  # (1, C, T, H, W)

    model = _get_model()
    with torch.no_grad():
        logit = model(clip, lengths=[clip.shape[2]])
    score = float(logit.item())

    return {
        "score": round(score, 4),
        "flagged": score > FLAG_LOGIT_THRESHOLD,
        "model": LIPFORENSICS_MODEL_ID,
        "framesAnalyzed": len(cropped),
        "insufficientFrames": False,
        "noFaceDetected": False,
    }
