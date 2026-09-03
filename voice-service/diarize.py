"""
Multi-speaker scan — a real, self-contained diarization approach, NOT
pyannote or NeMo.

Why not pyannote/NeMo (the tools actually named in the researched
landscape): pyannote's pretrained pipelines are gated on HuggingFace —
using them requires the deployer to accept a license on huggingface.co and
supply an auth token per-environment. NeMo's toolkit is a much heavier,
harder-to-install dependency chain. Neither is a "pip install and go" fit
for a prototype microservice, and standing up gated auth for a demo isn't
honest infrastructure. So this does real diarization a simpler way:

  1. Slide a fixed window across the clip (default 1.5s, 0.75s hop).
  2. Skip windows below an RMS energy floor (silence/near-silence — cheap
     energy-based VAD, not a trained voice-activity model, but real and
     directly checkable).
  3. Embed every surviving window with Resemblyzer.
  4. Agglomerative-cluster the embeddings (cosine distance, threshold-based
     — no fixed "k", so it can genuinely conclude "1 speaker").
  5. Report the cluster count as the speaker-count estimate.

This is a legitimate technique (window-embed-cluster is literally what
pyannote's older clustering-based pipelines do internally too), just
without a pretrained VAD/diarization head on top — so treat the output as
"multiple distinct voices detected" advisory signal, not a courtroom-grade
speaker count. That honesty boundary is stated again in the API response
itself, not just here.
"""
from dataclasses import dataclass

import numpy as np
from sklearn.cluster import AgglomerativeClustering

from embeddings import _get_resemblyzer, _resample

WINDOW_SEC = 1.5
HOP_SEC = 0.75
SILENCE_RMS_FLOOR = 0.01  # empirical, on [-1, 1] float32 samples
# Cosine-distance threshold for "different speaker" — Resemblyzer embeddings
# of the same speaker in clean single-mic audio typically land well under
# this; tuned conservatively (higher threshold = fewer false "2nd speaker"
# splits from head-turns/mic distance changes of the SAME person).
CLUSTER_DISTANCE_THRESHOLD = 0.45
MIN_WINDOWS_FOR_ESTIMATE = 4


@dataclass
class DiarizationResult:
    speaker_count: int
    windows_analyzed: int
    windows_skipped_silence: int
    insufficient_audio: bool
    cluster_sizes: list[int]


def _windows(samples: np.ndarray, sr: int):
    win = int(WINDOW_SEC * sr)
    hop = int(HOP_SEC * sr)
    for start in range(0, max(len(samples) - win, 0) + 1, hop):
        yield samples[start:start + win]


def estimate_speaker_count(samples: np.ndarray, sr: int) -> DiarizationResult:
    if sr != 16000:
        samples = _resample(samples, sr, 16000)
        sr = 16000

    from resemblyzer import preprocess_wav
    encoder = _get_resemblyzer()

    embeddings = []
    skipped = 0
    total = 0
    for chunk in _windows(samples, sr):
        total += 1
        rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))
        if rms < SILENCE_RMS_FLOOR:
            skipped += 1
            continue
        wav = preprocess_wav(chunk, source_sr=sr)
        if len(wav) == 0:
            skipped += 1
            continue
        embeddings.append(encoder.embed_utterance(wav))

    if len(embeddings) < MIN_WINDOWS_FOR_ESTIMATE:
        return DiarizationResult(
            speaker_count=0,
            windows_analyzed=total,
            windows_skipped_silence=skipped,
            insufficient_audio=True,
            cluster_sizes=[],
        )

    X = np.stack(embeddings)
    clustering = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        linkage="average",
        distance_threshold=CLUSTER_DISTANCE_THRESHOLD,
    ).fit(X)

    labels = clustering.labels_
    sizes = [int((labels == c).sum()) for c in sorted(set(labels))]
    # Drop clusters that are just 1-2 stray windows out of many — a single
    # brief outlier window (cough, mic pop, a word half-cut by the window
    # boundary) shouldn't itself read as "a second speaker was present".
    real_clusters = [s for s in sizes if s >= 2 or len(embeddings) < 6]

    return DiarizationResult(
        speaker_count=max(len(real_clusters), 1),
        windows_analyzed=total,
        windows_skipped_silence=skipped,
        insufficient_audio=False,
        cluster_sizes=sizes,
    )
