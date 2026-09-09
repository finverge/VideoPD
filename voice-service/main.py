"""
Voice-biometrics + deepfake microservice for VideoPD — real speaker-
embedding comparison (SpeechBrain ECAPA-TDNN, Resemblyzer fallback), a real
window-embed-cluster multi-speaker scan (Resemblyzer), a frame-level
deepfake/face-manipulation classifier (deepfake.py), a Phase 1
work-premises asset checklist (asset_detection.py, fixed 80-category
COCO vocabulary), a segment-specific zero-shot custom asset detector
(custom_asset_detection.py, open-vocabulary OWLv2 — genuinely detects the
segment-specific equipment names the COCO model never could, no
fine-tuning required), and storefront/signage text recognition
(signage_ocr.py, EasyOCR scene-text OCR — reads what's actually printed
on signboards/hoardings, genuinely different from the two object
detectors above), over the recordings VideoPD sessions produce:
VIDEOPD_LIVENESS (selfie step), VIDEOPD_BUSINESS_VERIFICATION
(business-verification step), and LIVE_CALL_RECORDING (Tier 1 live-call
audio). See README.md for what this is/isn't and why it's a separate
service.

Run: .venv-voice/Scripts/python.exe -m uvicorn main:app --port 8077
(from this directory — see README.md for the one-time model-download note)
"""
import json
import tempfile
import os

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from audio_extract import extract_wav_samples, duration_seconds
from embeddings import embed_ecapa, embed_resemblyzer, cosine_similarity
from diarize import estimate_speaker_count
from deepfake import analyze_video as analyze_video_deepfake
from lipsync_check import analyze_video as analyze_video_lipsync
from asset_detection import analyze_video as analyze_video_assets
from custom_asset_detection import analyze_video as analyze_video_custom_assets
from signage_ocr import analyze_video as analyze_video_signage

app = FastAPI(title="VideoPD Voice Biometrics", version="0.1.0")

MIN_CLIP_SECONDS = 1.5
# ECAPA-TDNN default per SpeechBrain's own spkrec-ecapa-voxceleb model card
# (published EER threshold on VoxCeleb1). Not calibrated against Lakshya's
# actual borrower population — see README.md "Calibration" section. Treat
# a FLAGGED result as advisory, not an auto-reject gate.
ECAPA_SAME_SPEAKER_THRESHOLD = 0.25
# Resemblyzer's own demo scripts compare L2-normalized d-vectors with a
# similar cosine-similarity convention; its typical same-speaker range runs
# higher than ECAPA's. Same calibration caveat applies.
RESEMBLYZER_SAME_SPEAKER_THRESHOLD = 0.75


class VoiceConsistencyResponse(BaseModel):
    method: str  # "ecapa-tdnn" | "resemblyzer-fallback"
    similarity: float
    threshold: float
    same_speaker: bool
    clip_a_seconds: float
    clip_b_seconds: float
    note: str


class MultiSpeakerResponse(BaseModel):
    speaker_count: int
    multiple_voices_detected: bool
    windows_analyzed: int
    windows_skipped_silence: int
    insufficient_audio: bool
    note: str


class DeepfakeResponse(BaseModel):
    frames_analyzed: int
    flagged_frames: int
    fake_frame_ratio: float
    flagged: bool
    model: str
    insufficient_frames: bool
    note: str


class LipSyncResponse(BaseModel):
    score: float
    flagged: bool
    model: str
    frames_analyzed: int
    insufficient_frames: bool
    no_face_detected: bool
    note: str


class AssetDetectionItem(BaseModel):
    label: str
    count: int
    confidence: float
    thumbnail: str | None = None  # base64 JPEG data URI cropped from the detection's own box — real visual evidence, not just a label/number


class AssetDetectionResponse(BaseModel):
    frames_analyzed: int
    checklist: list[AssetDetectionItem]
    model: str
    insufficient_frames: bool
    note: str


class CustomAssetDetectionResponse(BaseModel):
    frames_analyzed: int
    checklist: list[AssetDetectionItem]
    model: str
    insufficient_frames: bool
    no_queries: bool
    note: str


class SignageOcrItem(BaseModel):
    text: str
    confidence: float
    thumbnail: str | None = None  # base64 JPEG data URI cropped from the reading's own box — same evidence pattern as AssetDetectionItem.thumbnail
    is_neighbor_reference: bool = False  # keyword-matched ("next to"/"near"/"opposite"/...) — see signage_ocr.py's _is_neighbor_reference doc comment for exactly how and its real limits


class SignageOcrResponse(BaseModel):
    frames_analyzed: int
    checklist: list[SignageOcrItem]
    model: str
    insufficient_frames: bool
    note: str


@app.get("/health")
def health():
    return {"status": "ok"}


async def _save_upload(f: UploadFile) -> str:
    suffix = os.path.splitext(f.filename or "")[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await f.read())
        return tmp.name


@app.post("/voice-consistency", response_model=VoiceConsistencyResponse)
async def voice_consistency(clip_a: UploadFile = File(...), clip_b: UploadFile = File(...)):
    """Compares the voice in two clips from the same VideoPD session (e.g.
    the selfie-step recording vs. the business-verification recording).
    A low similarity is an advisory "possible voice mismatch between
    capture steps" signal — see README.md for what it can't tell you."""
    path_a = path_b = None
    try:
        path_a = await _save_upload(clip_a)
        path_b = await _save_upload(clip_b)

        samples_a, sr_a = extract_wav_samples(path_a)
        samples_b, sr_b = extract_wav_samples(path_b)
        dur_a, dur_b = duration_seconds(samples_a, sr_a), duration_seconds(samples_b, sr_b)

        if dur_a < MIN_CLIP_SECONDS or dur_b < MIN_CLIP_SECONDS:
            raise HTTPException(
                status_code=422,
                detail=f"Clip too short for a reliable comparison (need >= {MIN_CLIP_SECONDS}s each; "
                       f"got {dur_a:.1f}s and {dur_b:.1f}s).",
            )

        emb_a = embed_ecapa(samples_a, sr_a)
        emb_b = embed_ecapa(samples_b, sr_b)
        if emb_a is not None and emb_b is not None:
            method = "ecapa-tdnn"
            threshold = ECAPA_SAME_SPEAKER_THRESHOLD
        else:
            method = "resemblyzer-fallback"
            threshold = RESEMBLYZER_SAME_SPEAKER_THRESHOLD
            emb_a = embed_resemblyzer(samples_a, sr_a)
            emb_b = embed_resemblyzer(samples_b, sr_b)

        similarity = cosine_similarity(emb_a, emb_b)
        same_speaker = similarity >= threshold

        return VoiceConsistencyResponse(
            method=method,
            similarity=round(similarity, 4),
            threshold=threshold,
            same_speaker=same_speaker,
            clip_a_seconds=round(dur_a, 1),
            clip_b_seconds=round(dur_b, 1),
            note=(
                "Advisory signal, not a courtroom-grade voiceprint match — threshold is the "
                f"{method} library's published default, not calibrated against this lender's "
                "own borrower population."
            ),
        )
    finally:
        for p in (path_a, path_b):
            if p and os.path.exists(p):
                os.unlink(p)


@app.post("/multi-speaker", response_model=MultiSpeakerResponse)
async def multi_speaker(clip: UploadFile = File(...)):
    """Scans one clip for more than one distinct voice — a real signal for
    'someone else was talking in this recording', NOT a semantic judgment
    of whether that voice was coaching the borrower (that would need
    content/intent understanding this service doesn't attempt — see
    README.md)."""
    path = None
    try:
        path = await _save_upload(clip)
        samples, sr = extract_wav_samples(path)
        dur = duration_seconds(samples, sr)
        if dur < MIN_CLIP_SECONDS:
            raise HTTPException(
                status_code=422,
                detail=f"Clip too short for a reliable scan (need >= {MIN_CLIP_SECONDS}s; got {dur:.1f}s).",
            )

        result = estimate_speaker_count(samples, sr)

        if result.insufficient_audio:
            note = "Too little non-silent audio in this clip to estimate a speaker count."
        else:
            note = (
                "Window-embed-cluster estimate (Resemblyzer + agglomerative clustering), not a "
                "pretrained diarization model — treat >1 as 'worth an underwriter listen', not a "
                "confirmed second speaker. See README.md for why pyannote/NeMo weren't used."
            )

        return MultiSpeakerResponse(
            speaker_count=result.speaker_count,
            multiple_voices_detected=result.speaker_count > 1,
            windows_analyzed=result.windows_analyzed,
            windows_skipped_silence=result.windows_skipped_silence,
            insufficient_audio=result.insufficient_audio,
            note=note,
        )
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


MIN_CLIP_SECONDS_VIDEO = 1.0


@app.post("/deepfake-check", response_model=DeepfakeResponse)
async def deepfake_check(clip: UploadFile = File(...)):
    """Frame-level deepfake/face-manipulation check — see deepfake.py's own
    doc comment for exactly what this is and its real limitations. NOT
    video-native or temporal analysis, NOT a maintained production
    detector, a single community-trained image classifier applied per
    sampled frame."""
    path = None
    try:
        path = await _save_upload(clip)
        result = analyze_video_deepfake(path)

        if result["insufficientFrames"]:
            note = "Couldn't extract any usable frames from this clip — nothing to analyze."
        else:
            note = (
                "Frame-level image-forensics classifier (a single community-trained model, not a "
                "maintained production deepfake detector), applied to sampled frames — not video-native "
                "or temporal analysis. Real false-positive risk on compression artifacts, poor lighting, "
                "or low-resolution footage. Treat a flagged result as worth a look, not a confirmed finding."
            )

        return DeepfakeResponse(
            frames_analyzed=result["framesAnalyzed"],
            flagged_frames=result["flaggedFrames"],
            fake_frame_ratio=result["fakeFrameRatio"],
            flagged=result["flagged"],
            model=result["model"],
            insufficient_frames=result["insufficientFrames"],
            note=note,
        )
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


@app.post("/lip-sync-check", response_model=LipSyncResponse)
async def lip_sync_check(clip: UploadFile = File(...)):
    """Lip-region face-forgery check — see lipsync_check.py's own doc
    comment for the full pipeline (real face detection + landmarks +
    mouth-crop alignment feeding a real, MIT-licensed forgery classifier,
    LipForensics). Temporal, not frame-independent like /deepfake-check —
    needs consecutive frames, so it's slower."""
    path = None
    try:
        path = await _save_upload(clip)
        result = analyze_video_lipsync(path)

        if result["insufficientFrames"]:
            note = (
                "No usable face detected across enough frames to run the check — verify visually."
                if result["noFaceDetected"]
                else "Couldn't extract enough consecutive frames from this clip to run the check."
            )
        else:
            note = (
                "Real face detection + 68-point landmark alignment feeding a lip-region forgery "
                "classifier (LipForensics, MIT-licensed, CVPR 2021) — benchmarked on curated research "
                "datasets, not this lender's own borrower population. Treat a flagged result as worth "
                "a look, not a confirmed finding."
            )

        return LipSyncResponse(
            score=result["score"],
            flagged=result["flagged"],
            model=result["model"],
            frames_analyzed=result["framesAnalyzed"],
            insufficient_frames=result["insufficientFrames"],
            no_face_detected=result["noFaceDetected"],
            note=note,
        )
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


@app.post("/asset-detection-check", response_model=AssetDetectionResponse)
async def asset_detection_check(clip: UploadFile = File(...)):
    """Phase 1 work-premises asset checklist — see asset_detection.py's own
    doc comment for exactly what this is and its real limitations. General-
    purpose COCO-category object detection, NOT domain-specific asset
    recognition, NOT a valuation, NOT a score."""
    path = None
    try:
        path = await _save_upload(clip)
        result = analyze_video_assets(path)

        if result["insufficientFrames"]:
            note = "Couldn't extract any usable frames from this clip — nothing to analyze."
        else:
            note = (
                "General-purpose object detector (RT-DETR, COCO-pretrained, 80 everyday categories) — "
                "not trained on farm/workshop/small-business equipment specifically, so a real asset may "
                "go undetected or map to an unrelated category. Presence/count only, not a valuation "
                "or condition assessment. Treat this as a starting checklist for the underwriter to "
                "verify visually, not a confirmed inventory."
            )

        return AssetDetectionResponse(
            frames_analyzed=result["framesAnalyzed"],
            checklist=[AssetDetectionItem(**item) for item in result["checklist"]],
            model=result["model"],
            insufficient_frames=result["insufficientFrames"],
            note=note,
        )
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


@app.post("/custom-asset-detection-check", response_model=CustomAssetDetectionResponse)
async def custom_asset_detection_check(clip: UploadFile = File(...), queries: str = Form(...)):
    """Segment-specific custom asset detection — see
    custom_asset_detection.py's own doc comment for exactly what this is
    and its real limitations. `queries` is a JSON array of text labels
    (a segment's configured manual-item list, e.g. ["sewing machine",
    "irrigation pump"]) — an OPEN-VOCABULARY/zero-shot detector (OWLv2),
    genuinely different from /asset-detection-check's fixed 80-category
    model: no training, no fine-tuning, queries handed in at inference
    time. Real detection, NOT domain-validated — lower baseline accuracy
    than a closed-vocabulary detector, never benchmarked against actual
    Indian farm/workshop/institute footage. Surfaced to the underwriter as
    an AI suggestion to confirm, not an auto-populated fact."""
    path = None
    try:
        parsed_queries = json.loads(queries)
        if not isinstance(parsed_queries, list) or not all(isinstance(q, str) for q in parsed_queries):
            raise HTTPException(status_code=422, detail="queries must be a JSON array of strings.")

        path = await _save_upload(clip)
        result = analyze_video_custom_assets(path, parsed_queries)

        if result["noQueries"]:
            note = "No queries configured for this segment — nothing to look for."
        elif result["insufficientFrames"]:
            note = "Couldn't extract any usable frames from this clip — nothing to analyze."
        else:
            note = (
                "Open-vocabulary/zero-shot object detector (OWLv2) — genuinely different from the fixed "
                "80-category checklist above: no training or fine-tuning, these exact query names were "
                "handed to the model at inference time. Real detection, but zero-shot accuracy runs "
                "meaningfully below a properly fine-tuned detector, and this has never been benchmarked "
                "against real Indian premises footage. Treat this as an AI suggestion to confirm "
                "visually, not a confirmed finding — the underwriter's own tick is still what counts."
            )

        return CustomAssetDetectionResponse(
            frames_analyzed=result["framesAnalyzed"],
            checklist=[AssetDetectionItem(**item) for item in result["checklist"]],
            model=result["model"],
            insufficient_frames=result["insufficientFrames"],
            no_queries=result["noQueries"],
            note=note,
        )
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


@app.post("/signage-ocr-check", response_model=SignageOcrResponse)
async def signage_ocr_check(clip: UploadFile = File(...)):
    """Storefront & signage text recognition — see signage_ocr.py's own
    doc comment for exactly what this is and its real limitations. Reads
    text off shop signboards/hoardings/neighboring storefronts visible in
    the business-verification clip (EasyOCR scene-text model), genuinely
    different from /asset-detection-check and /custom-asset-detection-check
    above, which detect OBJECT PRESENCE, not printed text. English-only in
    this build; every reading is advisory, for the underwriter to read
    against the borrower's declared business name/premises — not an
    automatic cross-check."""
    path = None
    try:
        path = await _save_upload(clip)
        result = analyze_video_signage(path)

        if result["insufficientFrames"]:
            note = "Couldn't extract any usable frames from this clip — nothing to analyze."
        else:
            note = (
                "Scene-text OCR (EasyOCR, English only) over the business-verification recording — reads "
                "whatever legible text appears in frame (signboards, hoardings, neighboring shop/institute "
                "names). Readings that name a neighboring premises are split out separately using a simple "
                "keyword match (\"next to\"/\"near\"/\"opposite\"/...), not language understanding — expect "
                "misses in both directions on real footage. Not cross-checked automatically against the "
                "declared business name. Advisory only — treat a reading as \"the OCR found this text\", "
                "not a confirmed fact."
            )

        return SignageOcrResponse(
            frames_analyzed=result["framesAnalyzed"],
            checklist=[SignageOcrItem(**item) for item in result["checklist"]],
            model=result["model"],
            insufficient_frames=result["insufficientFrames"],
            note=note,
        )
    finally:
        if path and os.path.exists(path):
            os.unlink(path)
