# VideoPD Voice Biometrics microservice

A real Python microservice, separate from the main Next.js app, exposing
three endpoints:

1. **Voice consistency** (`POST /voice-consistency`) — extracts a speaker
   embedding from each of two clips and compares them. A low similarity
   means the voice in one clip doesn't match the other.
2. **Multi-speaker scan** (`POST /multi-speaker`) — slides a window across
   one clip, embeds each non-silent window, and clusters the embeddings.
   More than one cluster means more than one distinct voice was captured.
3. **Deepfake check** (`POST /deepfake-check`) — samples frames from a clip
   and runs each through a real pretrained face-manipulation image
   classifier. See "Deepfake/lip-sync" below for what this is and isn't.

Two callers use these, both staff-triggered from the case page's "Run voice
check" button (`src/app/api/staff/voice-check/[applicationId]/route.ts`):

- **Guided-flow recordings** — `VIDEOPD_LIVENESS` (selfie step) vs.
  `VIDEOPD_BUSINESS_VERIFICATION` (business-verification step), both real
  video files with real audio narration tracks (confirmed in
  `CameraCapture.tsx`). Consistency between the two, plus a multi-speaker
  scan of each.
- **Tier 1 live-call recording** — `LIVE_CALL_RECORDING`, a borrower-side,
  audio-only recording of the live underwriter call (see
  `LiveCallRoom`'s `recordForVoiceCheck` prop and
  `useCallAudioRecorder.ts`). Consistency against the selfie-step recording
  (as the reference voice), plus a multi-speaker scan of the call itself.
  Requires the borrower's explicit on-screen consent before the call can be
  joined — see `LiveCallRoom.tsx`'s consent gate. Post-call analysis only,
  not real-time (Tier 2) — the call itself is still genuinely real-time
  peer-to-peer WebRTC with no server-side media access; only the
  borrower's own browser records its own outgoing audio, uploaded once the
  call ends.

## Why a separate Python service

Everything else in this app (face-api.js, Tesseract.js, Web Speech API, PDF
text/metadata extraction) runs either in-browser or via a free HTTP API —
no heavy native ML runtime anywhere in the Next.js app. Real speaker
embeddings need PyTorch and real trained models (SpeechBrain's ECAPA-TDNN,
Resemblyzer) — there's no JS-native equivalent with comparable accuracy.
This is a genuinely different architecture from the rest of the app: a
standalone FastAPI service the Next.js API routes call out to over HTTP,
not a library import.

## What this honestly is NOT

- **Not pyannote or NeMo.** Both are the real state-of-the-art diarization
  tools researched for this feature, and both were deliberately not used:
  pyannote's pretrained pipelines are gated on HuggingFace (need a
  per-environment auth token + accepted license), NeMo's toolkit is a much
  heavier install. The multi-speaker scan here is a simpler, self-contained
  window-embed-cluster approach instead (see `diarize.py`'s own doc
  comment) — treat its speaker-count as an advisory signal worth a listen,
  not a courtroom-grade diarization result.
- **Not a "coaching" detector.** Detecting a second voice is not the same
  as confirming that voice was coaching the borrower on answers — that
  would need real content/intent understanding, which is a boundary this
  whole app has held everywhere else (no real LLM/NLU available — see
  `underwriterAgent.ts`'s own doc comment). A flagged clip means "an
  underwriter should listen to this", not "coaching confirmed".
- **Deepfake detection is real but narrow — see "Deepfake/lip-sync" below.**
  Frame-level image classification only, not video-native or temporal
  analysis, not an ensemble, not the maintained production tooling a real
  deployment would want.
- **Not calibrated to Lakshya's borrower population.** The similarity/
  distance thresholds in `main.py` are each library's own published
  default (SpeechBrain's VoxCeleb1 EER threshold; Resemblyzer's typical
  demo convention). Nobody has run this against a labeled set of real
  Lakshya sessions to check the false-positive/false-negative rate. Until
  that happens, a FLAGGED result should stay advisory (feeds underwriter
  judgment) rather than an auto-reject gate — same pattern already used for
  bank-statement authenticity and identity-verification flags.

## Deepfake/lip-sync

Requested live, explicitly acknowledged as research-grade, "implement for
demo purpose anyway." Both halves were genuinely attempted, not just
researched — here's exactly what happened with each.

**Deepfake detection — built** (`deepfake.py`, `POST /deepfake-check`).
Samples 8 evenly-spaced frames from a clip (ffmpeg — the same bundled
binary `audio_extract.py` already uses), runs each through
[`prithivMLmods/Deepfake-Detect-Siglip2`](https://huggingface.co/prithivMLmods/Deepfake-Detect-Siglip2)
(a Siglip2 image classifier fine-tuned for real/fake face classification,
loaded via the standard `transformers` `from_pretrained` API — no research-
code cloning), and reports the fraction of frames that scored above a
fake-probability threshold. What this genuinely is: real inference against
a real, downloadable, correctly-labeled model. What it isn't: an ensemble,
a maintained production deepfake-detection product, or anything that looks
at motion/flicker/temporal consistency across frames — it judges each
frame as a still image. Real false-positive risk on ordinary compression
artifacts, poor lighting, or low-resolution webcam footage — stated
explicitly in the risk-flag text an underwriter sees, not just here. Gated
behind `FeatureSettings.deepfakeCheckEnabled` (see
`src/lib/featureSettings.ts`) — off, and this check simply doesn't run.

**Lip-sync detection — built** (`lipsync/`, `lipsync_check.py`,
`POST /lip-sync-check`), after two real dead ends worth recording so they
don't get re-explored:

- `syncnet-python` (PyPI, MIT-licensed) looked promising on research — a
  community port of the original SyncNet, with matching pretrained weights
  mirrored on HuggingFace. Actually installed and tested, not just read
  about: every documented public entry point evaluates to `None` at import
  time (`SyncNetPipeline`, `SyncNetInstance` both `None`), and the
  package's own bundled example script fails with `ModuleNotFoundError: No
  module named 'syncnet_pipeline'` — a broken relative import in the
  package's own shipped code, version 0.2.2.
- Wav2Lip (`Rudrabha/Wav2Lip`) was considered next — its own evaluation
  code computes the same LSE-C/LSE-D lip-sync metrics researchers cite
  everywhere, via a SyncNet-architecture discriminator. But its repository
  is explicitly licensed "personal/research/non-commercial purposes
  only" — confirmed by reading the actual README, not assumed. A real
  license blocker for a commercial lending product, unrelated to whether
  the code works. Not used, on that basis alone.

**What actually shipped**: [LipForensics](https://github.com/ahaliassos/LipForensics)
(`ahaliassos/LipForensics`, CVPR 2021) — MIT-licensed (confirmed by reading
the LICENSE file), and architecturally the right kind of tool in the first
place: a real face-forgery *detector* trained specifically on lip-region
temporal artifacts, not a lip-sync *generator* like Wav2Lip. Real pipeline,
verified end to end against a real photograph (not a placeholder):

1. Extract ~25 consecutive frames via ffmpeg, resampled to 25fps (the
   model's training convention — it needs consecutive frames, not spread-
   out sampling like the deepfake check above).
2. Detect a face and 68-point landmarks per frame —
   [`ibug.face_detection`](https://github.com/hhj1897/face_detection)
   (RetinaFace) and [`ibug.face_alignment`](https://github.com/hhj1897/face_alignment)
   (FAN), both MIT-licensed, weights bundled directly in their own repos
   (no runtime download — see "Setup" below for why that matters: the
   original `face-alignment` PyPI package's own weight host,
   `adrianbulat.com`, is unreachable from this sandbox; these forks solve
   that by shipping the weights in the repo itself).
3. Smooth landmarks over a 12-frame rolling window, affine-align each
   frame to a mean face using 5 stable points, crop a 96×96 mouth region —
   vendored directly from LipForensics' own preprocessing code
   (`lipsync/crop_utils.py`, MIT-licensed, unmodified logic).
4. Grayscale, center-crop to 88×88, normalize with LipForensics' own
   training statistics, run through the real pretrained model
   (`lipforensics_ff.pth`, downloaded from the authors' own linked
   checkpoint, loaded and verified — real forward pass, real output).

One real bug fixed along the way: the original `get_model()` hardcoded
`storage.cuda(device)` in its checkpoint loader regardless of the
requested device, crashing even when `device="cpu"` was passed explicitly
— patched in the vendored copy (`lipsync/spatiotemporal_net.py`) to use
`map_location=device` directly.

Same calibration honesty as everything else here: LipForensics was
benchmarked on curated research datasets (FaceForensics++, CelebDF-v2,
etc.), not this lender's own borrower population or webcam conditions.
Gated behind `FeatureSettings.lipSyncCheckEnabled`, separately from the
deepfake toggle — it's a heavier, slower check with its own real cost.

## Asset detection

Requested live, from a specific customer ask relayed after a demo: "AI
capabilities and risk assessment using work-premises video capture to
measure various asset parameters ... and provide some kind of scoring."
Scoped down deliberately to exactly the piece that's honestly buildable
today — a checklist, not a score — after a written feasibility note laid
out what a real asset *score* would actually require (Lakshya's own
labeled/outcome data, which doesn't exist yet). This is that Phase 1.

**What it is** (`asset_detection.py`, `POST /asset-detection-check`).
Samples 6 evenly-spaced frames from the business-verification clip (same
ffmpeg extraction `deepfake.py` already uses — imported, not duplicated),
runs each through **RT-DETR** (`PekingU/rtdetr_r50vd_coco_o365`, Apache-2.0,
via `transformers`), pretrained on COCO's 80 everyday categories — chair,
laptop, tv, car, truck, motorcycle, refrigerator, oven, and more — and
aggregates which categories were seen with reasonable confidence (≥0.6)
across the sampled frames into a `{label, count, confidence, thumbnail}`
checklist, sorted by count (`thumbnail` is a base64 JPEG cropped straight
from the detection's own box — real visual evidence, not just a label and
a number the underwriter has to take on faith).

Originally shipped with torchvision's Faster R-CNN; swapped to RT-DETR
after researching current open-source options and — critically — testing
the leading candidates directly on this app's own real footage rather
than trusting published benchmarks alone. RT-DETR ran ~2-3x faster per
frame on this machine's CPU, and its confidence on the one false positive
found on real business-verification footage (an AC unit misread as
`refrigerator`) came in meaningfully lower (33-37%) than Faster R-CNN's
had (65%) — correctly filtered out at the existing 0.6 threshold where
the old model let it through. Same COCO-80 category set either way; a
small label-normalization map handles the handful of spelling
differences between RT-DETR's checkpoint and this codebase's existing
category names (motorbike→motorcycle, aeroplane→airplane, etc.) so
nothing downstream needed to change. (Also evaluated and rejected for
this slot: **Grounding DINO** — higher published zero-shot accuracy, but
on this app's own real test footage it produced 9 false positives
including garbled merged labels, vs. RT-DETR's clean, accurate result —
and it's a fixed-vocabulary swap-in either way, so the accuracy
comparison that mattered was this one, not Grounding DINO's actual
strength, which is open-vocabulary detection — see the "Custom asset
detection" section below for that comparison instead.)

**What it honestly is NOT**, same directness as the deepfake/lip-sync
section above:

- Not domain-specific. COCO's 80 categories are general everyday objects —
  a tractor, an irrigation pump, a sewing machine, a loom, none of these
  are COCO categories. A real asset may go completely undetected, or get
  mapped to a loosely-related COCO class the model actually knows.
- Not a valuation or condition assessment. Detecting two `chair`s doesn't
  mean two similarly-valuable chairs — the model has no concept of
  condition, brand, or worth.
- Not independently benchmarked against Lakshya's own borrower population
  or premises types — same "advisory, not calibrated" standing every
  other check in this service carries.
- No liveness-clip counterpart. The selfie-step recording isn't a
  premises video — nothing to detect assets in.

**The weighted checklist score** (requested live, in-house-owned — see
`src/lib/assetDetectionSegmentSettings.ts`'s `computeAssetChecklistScore`):
an Approver assigns a point value per item, per segment, to the
AI-detected COCO categories above, the zero-shot custom-detected items
below, AND a curated list of India-relevant equipment names (sewing
machine, lathe, irrigation pump), whichever labels end up present across
all three (AI-detected either way, or manually confirmed by the
underwriter). Said plainly, everywhere this number is shown: **it's an
admin-configured rubric, not a validated asset valuation** — this
codebase's usual honesty-over-score principle (see `underwriterAgent.ts`'s
own Phase 1/Phase 2 framing) still holds. Turning it into something
outcome-calibrated is exactly what Phase 2 below still needs, unchanged.

Gated behind `FeatureSettings.assetDetectionCheckEnabled` (see
`src/lib/featureSettings.ts`) — off, and neither check below runs.
Surfaced to the underwriter as a plain checklist (`src/app/staff/case/[id]/page.tsx`),
not folded into risk flags — there's no pass/fail verdict to fold in.

## Custom asset detection (zero-shot)

Requested live, direct pushback on the Phase 1 checklist above: "we're
still using COCO categories only, not the custom objects a segment
actually needs." Fair — and a real gap, not one this note explains away.
The fix is a genuinely different KIND of model, not just a bigger version
of the same one.

**What it is** (`custom_asset_detection.py`, `POST /custom-asset-detection-check`).
[OWLv2](https://huggingface.co/google/owlv2-base-patch16-ensemble)
(`google/owlv2-base-patch16-ensemble`, Apache-2.0) is an
**open-vocabulary/zero-shot** object detector — unlike
`asset_detection.py`'s RT-DETR, its vocabulary isn't fixed at
training time. It takes arbitrary text queries *at inference time* and
tries to locate them in the frame. Fed each segment's own configured
manual-item list (`AssetDetectionSegmentSettings.manualItemsJson` — "a
sewing machine", "an irrigation pump", "a tractor") as the query set, no
fine-tuning, no training dataset, nothing scraped or licensed — which is
exactly what makes this buildable at all without Lakshya's data. Same
frame-sampling/aggregation shape as `asset_detection.py` (6 frames, max
count + best confidence per label), confidence threshold 0.15 (OWLv2's
score distribution runs lower than a closed-vocabulary detector's — not
comparable 1:1 with the 0.6 used above).

Verified working in development, not just imported: correctly detected a
cup, spoon, and plate that were actually present in a real photo, and
correctly detected *nothing* for a query ("a sewing machine") that wasn't
in the photo — a true negative, not indiscriminate positives. ~2.8s/frame
on CPU (no GPU in this environment), ~17s for a full 6-frame/10-query run
— workable alongside the other checks.

**Evaluated and deliberately kept over Grounding DINO**, the other
leading open-vocabulary option (Apache-2.0, higher published zero-shot
accuracy — 52.5% AP on COCO vs. OWLv2's lower typical numbers). Tested
head-to-head on this app's own real business-verification footage before
deciding anything: Grounding DINO ran ~65% slower per frame (4.67s vs.
2.8s) AND produced 9 false-positive detections on a frame OWLv2 only
mis-flagged once, including garbled merged labels ("a sewing machine an
embroidery machine an overlock machine a welding machine a lathe
machine" reported as one confused string) from its multi-phrase
prompting. A real case of a model's published benchmark lead not
transferring to this app's actual footage — kept OWLv2 on that evidence,
not on the leaderboard number.

**What it honestly is NOT**:

- Not as accurate as a fine-tuned closed-vocabulary detector. Zero-shot
  detection trades training-free flexibility for real accuracy cost,
  especially on visually-similar or unusual machinery (a power tiller vs.
  a generic piece of farm equipment).
- Never benchmarked against real Indian farm/workshop/institute premises
  footage — the coffee-cup/spoon/plate test above is real evidence the
  pipeline *works*, not evidence of accuracy on this lender's actual use
  case.
- Not a replacement for the underwriter's own judgment. Its high-confidence
  hits (≥0.3) pre-fill the manual-tick checkboxes on first check, but only
  once — the underwriter's own edits from that point on are never
  overwritten by a later run (see `runVoiceCheck.ts`'s own doc comment).

**Phase 2**, if Lakshya wants it further than this: fine-tuning a
detector on Lakshya's own labeled premises photos (real accuracy gains
over zero-shot) and a real, outcome-calibrated score — both still need
Lakshya's own data first, not something to invent client-side.

## Setup (one-time)

```bash
# from sourcecode/
python -m venv .venv-voice
# Pinned to 2.11.0, not latest: the PyTorch CPU wheel index currently
# publishes torch up to 2.13.0 but torchaudio only up to 2.11.0 (hit live —
# an unpinned `torch` install grabbed 2.13.0, and speechbrain's import chain
# calls a torchaudio API (`list_audio_backends`) that was removed by 2.11.0
# regardless, so keep both pinned to the same tested version).
.venv-voice/Scripts/python.exe -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.11.0 torchaudio==2.11.0 torchvision==0.26.0
cd voice-service
../.venv-voice/Scripts/python.exe -m pip install webrtcvad-wheels
../.venv-voice/Scripts/python.exe -m pip install resemblyzer --no-deps
../.venv-voice/Scripts/python.exe -m pip install librosa soundfile scipy click
../.venv-voice/Scripts/python.exe -m pip install -r requirements.txt
# easyocr (signage_ocr.py), --no-deps — its declared opencv-python-headless
# dependency collides with opencv-contrib-python above (both provide "cv2");
# the already-installed cv2 already satisfies everything easyocr needs.
../.venv-voice/Scripts/python.exe -m pip install python-bidi==0.6.11 Shapely==2.1.2 pyclipper==1.4.0
../.venv-voice/Scripts/python.exe -m pip install easyocr==1.7.2 --no-deps
```

`torchvision` is pinned alongside torch/torchaudio in that first command,
not left to `requirements.txt` — installing it unpinned later pulls the
latest torch as a side effect (torchvision 0.28.0 wants torch 2.13.0) and
silently re-breaks the torchaudio pairing above. Hit live doing exactly
this while adding the deepfake check (`transformers`' `AutoImageProcessor`
needs torchvision) — if you ever add a package that pulls in `torch`
transitively, re-check `python -c "import torch, torchaudio; print(torch.__version__, torchaudio.__version__)"`
afterward.

The `webrtcvad`/`resemblyzer` steps are separate because `resemblyzer`'s
declared dependency on the real `webrtcvad` package fails to build on
Windows without MSVC Build Tools (hit live in this environment — no C
compiler present). `webrtcvad-wheels` is a real PyPI package that ships
prebuilt Windows wheels for the same `webrtcvad` import; installing
`resemblyzer` with `--no-deps` skips its attempt to rebuild the real one
from source, then its actual runtime dependencies are installed directly.

### Lip-sync check's face detection/alignment (one more one-time step)

The lip-sync check needs two more packages that aren't on PyPI in a usable
form — they're installed from source, editable, with their model weights
bundled directly in the repo (see "Deepfake/lip-sync" above for why: the
original `face-alignment` PyPI package's weight host is unreachable from
this sandbox; these forks ship the weights in the repo itself instead):

```bash
cd voice-service
mkdir -p vendor
git clone https://github.com/hhj1897/face_alignment.git vendor/ibug_face_alignment
git clone https://github.com/hhj1897/face_detection.git vendor/ibug_face_detection
rm -rf vendor/ibug_face_alignment/.git vendor/ibug_face_detection/.git
../.venv-voice/Scripts/python.exe -m pip install -e vendor/ibug_face_alignment
../.venv-voice/Scripts/python.exe -m pip install -e vendor/ibug_face_detection
```

Both clones are sizeable (~185MB and ~380MB — real bundled RetinaFace/FAN
model weights, not padding) and gitignored; each environment fetches its
own copy, same as `.venv-voice` itself.

The LipForensics checkpoint also needs a one-time download (144MB, from
the paper authors' own linked Google Drive file — real, verified working,
but slower/less reliable than a CDN, so don't be surprised if it's slow):

```bash
../.venv-voice/Scripts/python.exe -m pip install gdown
mkdir -p model_cache/lipforensics
../.venv-voice/Scripts/python.exe -m gdown "https://drive.google.com/uc?id=1wfZnxZpyNd5ouJs0LjVls7zU0N_W73L7" -O model_cache/lipforensics/lipforensics_ff.pth
```

Also hit live and worth knowing about: speechbrain's model download defaults
to symlinking cached HuggingFace files into `savedir`, which fails on
Windows without Developer Mode or an admin shell (`WinError 1314`). Fixed in
`embeddings.py` by passing `local_strategy=LocalStrategy.COPY` — nothing
extra to do here, just don't remove that if you touch the loader.

CPU-only PyTorch is used deliberately — the clips are short (seconds, not
hours) so CPU inference is fine, and it sidesteps CUDA/driver version
matching (this machine's CUDA 13.1 is newer than most prebuilt GPU wheels
target).

The first real request to `/voice-consistency` downloads the ECAPA-TDNN
model weights from HuggingFace (~80MB, cached under
`voice-service/model_cache/` after that). If that download fails for any
reason (no network reachable from wherever this runs), the endpoint falls
back to Resemblyzer automatically and says so in the response's `method`
field — it does not fail silently.

## Run

```bash
cd voice-service
../.venv-voice/Scripts/python.exe run_supervised.py
```

Not the bare `uvicorn main:app` command this doc used to show — see "Concurrency & memory discipline" below for why that alone isn't safe to leave running under real traffic, and `run_supervised.py`'s own doc comment for exactly what it does. The direct command still works for a one-off manual check (`python main.py`), just don't leave it as the thing actually serving requests.

## Concurrency & memory discipline (production go-live hardening)

Found operating this service directly, not theoretical — two real problems with running it as a single bare uvicorn process under real traffic:

1. **No real concurrency.** Every route handler is `async def`, but each one used to call its actual inference function synchronously and unawaited. FastAPI only auto-offloads a route to a threadpool for a plain `def` handler — `async def` with a blocking call inside runs that CPU-bound work directly on the event loop, so one request (each takes real seconds to a couple of minutes for the heaviest checks) froze the entire process for every other caller, including `/health`. Two underwriters running a check at the same moment didn't run in parallel — the second was fully blocked, not just slower. **Fixed**: every heavy call now goes through `run_in_threadpool` (`starlette.concurrency`), releasing the event loop to keep dispatching other requests while one runs on a worker thread. Verified live, not assumed: two identical warm requests fired simultaneously completed in ~1.4-1.5s each, against a ~2.0s sequential baseline — genuine overlap, not ~4s (what full serialization would produce).

2. **Unbounded memory.** Each check module lazy-loads its own model(s) into a module-level global the first time it's used and never releases them (deliberate — avoids reloading a model every request) — but a process that's been hit by all 7 endpoint types at least once has SpeechBrain, Resemblyzer, LipForensics, the deepfake classifier, RT-DETR, OWLv2, and EasyOCR all resident simultaneously. Measured directly: a fresh process sits around 60-100MB; one full run of every check type grows it to ~3.3GB, and it never comes back down — there's no reliable per-model unload path against PyTorch's own caching allocator. **Fixed**: `main.py` self-recycles via `server.should_exit` (graceful — finishes in-flight requests first, verified live: requests still in flight when the threshold hit all completed successfully) after `VOICE_SERVICE_MAX_REQUESTS` requests (default 40, override via env var), and `run_supervised.py` watches for the process exiting and restarts it immediately — verified live across multiple recycle cycles, including automatic recovery from a real port-bind failure.

Why a hand-rolled watchdog instead of gunicorn's own `--max-requests` (the standard tool for exactly this problem): gunicorn's worker model needs POSIX `fork()`, so it can't run at all on Windows — and this project's actual dev/demo machine is Windows. A real Linux production deployment can use gunicorn (`gunicorn -k uvicorn.workers.UvicornWorker -w N --max-requests 40 --max-requests-jitter 10 main:app`) or Docker/systemd restart policies instead of `run_supervised.py` — `main.py` always exits(0) cleanly regardless of what's supervising it, so these are alternatives, not something that needs to coexist with the watchdog.

**Sizing, not a guess**: this platform's own infra-sizing work capped real expected volume at ~1000 applications/month — even a busy day is a handful of concurrent voice-checks, not hundreds. One well-behaved (non-blocking, self-recycling) process comfortably covers that. If real traffic ever needs more than one CPU core's worth of throughput, `run_supervised.py`'s own doc comment covers running several on different ports behind a simple reverse proxy — deliberately not built speculatively, since nothing in this codebase's actual traffic pattern needs it yet.

## Calling it from the Next.js app

See `src/lib/voiceBiometrics.ts` — a thin `fetch` wrapper around this
service's endpoints (`/voice-consistency`, `/multi-speaker`,
`/deepfake-check`, `/lip-sync-check`, `/asset-detection-check`,
`/custom-asset-detection-check`), with the service URL read from
`VOICE_SERVICE_URL` (defaults to `http://127.0.0.1:8077`) so a real
deployment can point it at wherever this service actually runs.
