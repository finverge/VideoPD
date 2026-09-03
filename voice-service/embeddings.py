"""
Speaker-embedding extraction. Two real, independent libraries, used for
different jobs (matches what was actually researched and told to the user —
see docs/videopd-future-work.md section 11):

- SpeechBrain (ECAPA-TDNN, speechbrain/spkrec-ecapa-voxceleb) — primary
  embedding model for the one-shot "are these two clips the same voice"
  comparison. Slower per call, more accurate, this is the model actually
  used in real speaker-verification products.
- Resemblyzer — used for the sliding-window multi-speaker scan, where we
  need dozens of embeddings per clip. It's the lighter/faster of the two,
  which is the whole reason to reach for it there instead of re-running
  ECAPA-TDNN on every window.

Both are loaded lazily and cached at module level so the FastAPI process
pays the model-load cost once, not per request. If the SpeechBrain download
fails (e.g. no network reachable from wherever this ends up deployed), the
one-shot comparison falls back to Resemblyzer too and the API response says
so explicitly via "method" — this service never silently swaps techniques
without telling the caller.
"""
import numpy as np
import librosa as _librosa
import torchvision as _torchvision  # noqa: F401 — import-order warmup only, see below

# Warm up librosa's lazy `samplerate` submodule resolution, AND torchvision's
# own native-op registration, eagerly at import time — before SpeechBrain
# (which has its own lazy-loaded optional integrations, e.g. k2_fsa) gets a
# chance to load first. Two separate real bugs, same root cause and same
# fix shape:
#   1. Hit live: calling /voice-consistency (loads ECAPA/SpeechBrain first)
#      then /multi-speaker (the first real librosa.resample call, inside
#      resemblyzer's preprocess_wav) crashed with "ImportError: Lazy import
#      of ... speechbrain.integrations.k2_fsa failed".
#   2. Hit live again adding the deepfake check: calling /voice-consistency
#      first, then /deepfake-check (transformers' AutoImageProcessor, which
#      imports torchvision) crashed with "RuntimeError: ... already a kernel
#      registered ... for Meta dispatch key" inside torchvision's own
#      `_meta_registrations.py`.
# Both librosa's lazy module loader and torchvision's `register_fake`/
# `torch.library` machinery do Python stack introspection
# (`inspect.getframeinfo`/`inspect.stack()`) as part of their own normal
# operation — and if a SpeechBrain `LazyModule` proxy for an unresolved
# optional integration is sitting anywhere on the accessible call stack when
# that introspection runs, touching it triggers ITS resolution attempt,
# which fails (k2 genuinely isn't installed — an optional integration) and
# crashes the otherwise-unrelated caller. Forcing BOTH librosa's and
# torchvision's first real touch to happen here, before speechbrain is ever
# imported, avoids the collision entirely for both — order-of-first-use
# otherwise depended on which endpoint a caller happened to hit first in a
# given server process, which is not something this service should be
# fragile to. (Confirmed empirically: reproduced the second crash on demand,
# then confirmed `import torchvision` before speechbrain's first use fixes
# it, same as the librosa case.)
_librosa.resample(np.zeros(1600, dtype=np.float32), orig_sr=16000, target_sr=16000)

_ecapa_model = None
_ecapa_load_failed = False
_resemblyzer_encoder = None


def _get_resemblyzer():
    global _resemblyzer_encoder
    if _resemblyzer_encoder is None:
        from resemblyzer import VoiceEncoder
        _resemblyzer_encoder = VoiceEncoder()
    return _resemblyzer_encoder


def _get_ecapa():
    global _ecapa_model, _ecapa_load_failed
    if _ecapa_load_failed:
        return None
    if _ecapa_model is None:
        try:
            from speechbrain.inference.speaker import EncoderClassifier
            from speechbrain.utils.fetching import LocalStrategy
            _ecapa_model = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir="model_cache/spkrec-ecapa-voxceleb",
                # Windows without Developer Mode/admin can't create the
                # symlinks speechbrain defaults to (hit live: WinError 1314,
                # "A required privilege is not held by the client") — copy
                # the cached HuggingFace files instead of linking them.
                local_strategy=LocalStrategy.COPY,
            )
        except Exception:
            _ecapa_load_failed = True
            return None
    return _ecapa_model


def embed_ecapa(samples: np.ndarray, sr: int) -> np.ndarray | None:
    """Returns a 192-d ECAPA-TDNN embedding, or None if the model couldn't
    be loaded (caller should fall back to Resemblyzer and label the
    response honestly)."""
    model = _get_ecapa()
    if model is None:
        return None
    import torch
    if sr != 16000:
        samples = _resample(samples, sr, 16000)
    wav = torch.from_numpy(samples).float().unsqueeze(0)
    with torch.no_grad():
        emb = model.encode_batch(wav)
    return emb.squeeze().cpu().numpy()


def embed_resemblyzer(samples: np.ndarray, sr: int) -> np.ndarray:
    from resemblyzer import preprocess_wav
    encoder = _get_resemblyzer()
    if sr != 16000:
        samples = _resample(samples, sr, 16000)
    wav = preprocess_wav(samples, source_sr=16000)
    return encoder.embed_utterance(wav)


def _resample(samples: np.ndarray, sr: int, target_sr: int) -> np.ndarray:
    if sr == target_sr:
        return samples
    # Lightweight resample (no extra dependency beyond numpy) — fine for the
    # short clips this service handles; audio_extract.py already asks
    # ffmpeg for 16kHz directly so this is a rarely-hit safety net, not the
    # normal path.
    duration = len(samples) / sr
    target_len = int(duration * target_sr)
    x_old = np.linspace(0, duration, num=len(samples), endpoint=False)
    x_new = np.linspace(0, duration, num=target_len, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-8)
    b = b / (np.linalg.norm(b) + 1e-8)
    return float(np.dot(a, b))
