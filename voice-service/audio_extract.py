"""
Decodes an uploaded video/audio file (webm/opus from MediaRecorder, mp4, or
already-audio) down to 16kHz mono WAV samples, via a bundled static ffmpeg
binary (imageio-ffmpeg — no system ffmpeg install needed/available on this
machine, confirmed absent from PATH).

Real decode, not a stub: this is the same ffmpeg binary distributed by the
imageio-ffmpeg PyPI package, just invoked as a subprocess instead of via a
system install.
"""
import subprocess
import tempfile
import os
import numpy as np
import soundfile as sf
import imageio_ffmpeg

TARGET_SR = 16000


def extract_wav_samples(input_path: str) -> tuple[np.ndarray, int]:
    """Returns (mono_samples_float32, sample_rate). Raises RuntimeError with
    ffmpeg's own stderr on decode failure (e.g. file has no audio track at
    all) rather than silently returning empty audio."""
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        proc = subprocess.run(
            [
                ffmpeg_exe, "-y", "-i", input_path,
                "-vn",  # no video
                "-ac", "1",  # mono
                "-ar", str(TARGET_SR),
                "-f", "wav",
                out_path,
            ],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed to extract audio (exit {proc.returncode}): "
                f"{proc.stderr.decode('utf-8', errors='replace')[-800:]}"
            )
        samples, sr = sf.read(out_path, dtype="float32")
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        return samples, sr
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


def duration_seconds(samples: np.ndarray, sr: int) -> float:
    return len(samples) / float(sr) if sr else 0.0
