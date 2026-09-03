# VideoPD 2.0 — Future Work

This tracks what's deliberately **not** built in the current guided-flow VideoPD
implementation, and why — so the gap between "what the BRD (`FIN-BRD-VIDEOPD-2.0`
v1.3) describes" and "what this prototype delivers" is explicit rather than
discovered later. Each item below references the BRD requirement it relates to.

The scope decision behind this list: BRD Section 14 (Risks) itself recommends
sequencing delivery — "prioritize a VideoPD 2.0 MVP (core identity/liveness +
basic scoring) before the full fraud-detection and Agentic AI Co-Pilot feature
set." What's built started as Steps 9–15 of the BRD's process flow (Section 6)
delivered as a **sequential guided flow** — the borrower records short clips
and answers questions one at a time — with **rule-based** scoring. A real,
self-hosted **live call** (item 1 below) has since been added as an
additional path alongside that guided flow, not a replacement for it, along
with real (not rule-based-only) liveness/face-match/gaze detection (item 3).
The honest ceiling for a local prototype either way — not a shortcut taken
silently.

## 1. Real live video calling (BR-26) — built, including a real TURN relay; one real gap left

**What's built:** real, self-hosted WebRTC calling (`server/signaling-server.ts`,
`src/lib/useCallRoom.ts`) — no Daily/Twilio/Agora account, no vendor SDK.
A "join call" UI exists on both the borrower's VideoPD page and the
underwriter's case page, mesh-connecting up to 6 participants in one room
(verified 2-way and 3-way via a headless signaling-protocol test suite — join
broadcast, offer/answer/ICE relay, disconnect handling, capacity enforcement).
BR-26's multi-party ask is covered by a segment-aware 3rd-party entry point
(`/call/[token]`) — a training institute contact for student loans, a
business/workshop contact for business loans — generated from the
underwriter's case page, scoped to show only the segment and business/institute
name, none of the loan's financial data.

NAT traversal now includes a real, self-hosted TURN relay, not just STUN —
the official `coturn/coturn` Docker image (`turnserver.conf`), with short-lived
per-session credentials minted server-side via coturn's standard REST-API
scheme (`src/app/api/turn-credentials/route.ts`, HMAC-SHA1 from a server-only
secret — never a static username/password baked into the client bundle). An
npm TURN server (`node-turn`) was tried first and reverted — it pulled in
`js-yaml`/`log4js` versions with high-severity, no-fix-available DoS
vulnerabilities, not an acceptable tradeoff for a financial-services
prototype. **This was verified for real**, not just "the container didn't
crash": a live browser fetched real credentials from the API route, opened an
`RTCPeerConnection` against the running coturn container, and received an
actual `typ relay` ICE candidate with a real external IP — proof the
credential scheme and the relay allocation both genuinely work, independent
of the camera-access limitation below. Runs via `docker run` (see README);
gracefully degrades to STUN-only if the container isn't running or
`TURN_STATIC_AUTH_SECRET` isn't set.

**Also built (requested live):** real-time transcription of the call —
each participant's own browser runs continuous speech-to-text (Web Speech
API, same tech already used for the chatbot's voice input) on their own
microphone, broadcasts each recognized segment to the room over the
existing signal channel, and persists it (`CallTranscriptSegment`) for
later review on the underwriter's case page. Honest constraints: it can
only transcribe what a participant's own local mic picks up, not "listen
in" on the remote side directly, so a complete transcript needs every
participant to have it running on their own instance (on by default on all
three call surfaces — borrower, underwriter, 3rd-party guest); Chrome/Edge
only, same as everywhere else this browser API is used in this app. The
persistence route and underwriter display are verified end-to-end against
the real running server; the actual speech recognition itself couldn't be —
same camera/mic-access sandbox limitation as the rest of this item.

**What's still missing:** the coturn container currently binds to whatever
this machine's Docker Desktop exposes — real cross-network reachability from
an arbitrary demo network depends on where this actually gets deployed (a
real, port-forwarded/publicly-reachable host), the same requirement the
signaling server already has. And, unchanged: **the live media path — two
real people, two real cameras, an actual video call — has never been
tested.** This development environment blocks camera access entirely, so
that whole path (as opposed to the TURN relay itself, now genuinely verified)
is confirmed correct by code review against the WebRTC spec, not a live run.
A real multi-device test on an actual network is the one thing left standing
between this and being demo-ready.

## 2. Hybrid edge-cloud deployment & audio-only fallback (BR-27, BR-28) — fallback built, edge-cloud infra not

**What's built:** now that item 1's live calling exists, a real audio-only
fallback — either participant can drop their outgoing video
(`RTCRtpSender.replaceTrack(null)`, which genuinely stops sending video RTP,
not the same as a muted-but-still-transmitting track) to save bandwidth, plus
a real connection-quality signal (`RTCPeerConnection.getStats()` — packet
loss, round-trip time) that suggests the switch when the connection looks
weak. Advisory only, same as every other signal in this app — it suggests,
the participant decides.

**What's still missing:** the BRD's specific edge-cloud model (regional media
relay nodes) and deliberate Opus-codec-only handling — this uses the
browser's default WebRTC codec negotiation, not a configured Opus-only path.
No regional infrastructure; a single signaling server, wherever it's deployed.

## 3. Real fraud/deepfake/voice-biometric/behavioral detection (BR-31, BR-32, BR-33, BR-41) — liveness/gaze/voice-biometrics/deepfake/lip-sync all built

**What's built:** real liveness (blink detection via Eye Aspect Ratio on
face-api.js landmarks, on-device, `src/lib/liveness.ts`), real biometric
face-matching (selfie/live-call frame vs. ID proof photo, face-recognition
descriptor distance, `src/lib/faceMatch.ts`), a real — not faked —
partial slice of coaching-detection: discrete off-camera glance counting
(not just cumulative time looking away), running both during the async Step 1
recording and continuously during a live call, normalized by clip/call
duration rather than a flat threshold; and, as of this build, real
**voice-biometric matching and multi-speaker detection** (requested live —
see `voice-service/README.md` for the full picture). A separate Python
microservice (SpeechBrain ECAPA-TDNN speaker embeddings, Resemblyzer
fallback + a window-embed-cluster multi-speaker scan) is called from two
places:

- The two guided-flow recordings (`VIDEOPD_LIVENESS` vs.
  `VIDEOPD_BUSINESS_VERIFICATION`) — voice consistency between them, plus a
  multi-speaker scan of each.
- **Tier 1 live-call recording** — the borrower's own browser records its
  own outgoing audio (audio-only, never video) during the live call, behind
  an explicit on-screen consent step, and uploads it as `LIVE_CALL_RECORDING`
  evidence when the call ends. Compared against the selfie-step recording
  for consistency, and scanned for a second voice.

Both staff-triggered (not automatic — the voice service is a separate
process that isn't guaranteed running, and its similarity/distance
thresholds are each library's published default, not calibrated against
Lakshya's own borrower population), surfaced on the case page's "Voice
biometrics" panel, and folded into the case's risk flags the same generic
way every other check is, reaching the draft-recommendation agent and both
underwriter/approver roles automatically.

Real limitation worth being explicit about: the live call itself is
genuine peer-to-peer WebRTC (`useCallRoom.ts`) with no server-side media
access at all — Tier 1 is post-call analysis of a recording the borrower's
own browser made, not real-time. True real-time in-call alerts (Tier 2)
would need rolling audio chunks shipped off the browser during the call and
a reworked streaming-inference pipeline — scoped in conversation, not
built; revisit if Tier 1 proves useful in practice.

**Deepfake detection is now built** (frame-level image classifier — see
item 10e for the full account) — no longer "not attempted." **Lip-sync
analysis is now built too** (LipForensics, a real face-forgery detector
trained on lip-region temporal artifacts — see item 10f for the full
account, including the two real dead ends hit first: a broken PyPI package,
then a non-commercially-licensed generator).

Still missing: response-timing/hesitation analysis, and — distinct
from "a second voice was detected" above — actually judging whether that
second voice was *coaching* the borrower, which would need real content/
intent understanding this app doesn't have anywhere (see
`underwriterAgent.ts`'s own doc comment on this same boundary).

## 4. Document authenticity checks (BR-15, BR-34)

Hologram/font/layout checks on ID documents, and an assessment of whether the
shown environment is plausible/not staged. Needs a document-forensics model or
vendor API — not attempted; current document evidence only gets the existing
basic quality check (format/size/legibility), not an authenticity check.

## 5. Geo-tagging, device fingerprinting, cross-session analytics (BR-35, BR-36) — done, with one real gap

**What's built:** real geo-tagging — `navigator.geolocation` captures lat/lng
on evidence upload where the borrower grants permission (`UploadDropzone.tsx`),
stored on `UploadedEvidence`. Real, client-side device fingerprinting
(`src/lib/deviceFingerprint.ts`) — canvas-rendering signature + WebGL
renderer/vendor string + navigator/screen signals, hashed — the same class
of technique open-source fingerprinting libraries use, not a proprietary
trick. Two real cross-applicant checks now run at the two points where they
matter: `MULTIPLE_APPLICATIONS` at submit time (same borrower, another
application already on file) and its mirror, `SHARED_DEVICE` (same device
fingerprint, a *different* borrower — the loan-stacking/device-farm
pattern), plus a lexical answer-similarity check at VideoPD completion
(Sørensen–Dice on word bigrams, `answerSimilarity()` in
`src/lib/mockChecks.ts`) that flags a Q&A answer closely matching another
applicant's answer to the same question — literal or lightly-reworded reuse,
not semantic similarity.

**What's still missing:** "abnormal score patterns across the portfolio"
(statistical outlier detection across all leads' scores/risk levels) — not
attempted. And the fingerprint itself is the prototype ceiling, not
enterprise-grade: no reference-device database, no drift tracking across
browser updates, no protection against a fraud operator deliberately
spoofing the signals it reads. The answer-similarity check is explicitly
lexical, not NLU — it catches reused wording, not two different phrasings of
the same idea (that's item 8's still-missing gap, unchanged).

## 6. Scanned-PDF OCR fallback — built

The bank-statement pipeline (`src/lib/bankStatement.ts`) tries a PDF's native
text layer first. A **scanned PDF with no text layer** used to get flagged
`NEEDS_REVIEW` outright; now it falls back to rasterizing each page
(`scripts/rasterize-pdf.py`, PyMuPDF — a real, pip-installable-without-a-
native-compiler renderer, distinct from the `pdfjs-dist`+`node-canvas` path
this entry originally proposed, which would have hit the same native-compile
wall as `webrtcvad` did for the voice-biometrics work) and OCRing each
rendered page (Tesseract.js, same engine already used for plain-image
uploads). Capped at 15 pages. The result is labeled `viaOcr: true` end to
end, so the existing OCR-noise caveat on the transaction-integrity check
(`checkTransactionIntegrity`) applies to a rasterized-then-OCR'd PDF exactly
as it already did for a plain photographed statement — no separate handling
needed, same signal, same honesty caveat.

Verified live against a real synthetic scanned PDF (text rendered as a page
image, no text layer, confirmed via `extract-pdf.js` returning empty text
first) through the actual running API route: OCR recovered all 7 statement
lines correctly, transactions parsed and reconciled, `EligibilityFlag:
ELIGIBLE`, and the PDF-structure authenticity check ran for real (not
`NOT_APPLICABLE`) since a rasterized-then-OCR'd PDF still has real PDF
structure (revision count, Producer/Creator) to check, unlike a plain image
upload. A borrower can still work around a scanned PDF by photographing the
statement directly too (routes straight to the plain-image OCR path).

## 7. Real bank-statement format coverage

The transaction parser (`parseTransactions` in `bankStatement.ts`) handles a
generic `date … description … amount(s) … balance` line shape and infers
debit/credit from the balance delta between lines — deliberately not a
per-bank template library (which is most of what makes a tool like Perfios
valuable — hundreds of maintained bank-specific layouts) or an Account
Aggregator API integration. Statements in unusual layouts will parse
partially or trigger `NEEDS_REVIEW`; there's no silent wrong-answer path
(low-confidence extraction always routes to manual review) but coverage is
narrower than a commercial analyzer.

## 8. Full Live Consistency Engine (BR-42) — the BRD's own worked example is done; broader NLU still isn't

**What's built:** two real, honest cross-checks, both numeric — matching
numbers reliably is straightforward, so both were built; extracting
comparable claims from open-ended free text still needs real NLU (see what's
missing below, unchanged there).

- Declared monthly income (from the original application) vs. the income
  pattern found in the bank statement, flagged if they differ by >40%.
- Stated income *spoken during the VideoPD Q&A itself* vs. the income
  declared on the application (`isIncomeQuestion`/`extractStatedIncomeFromAnswer`/
  `checkIncomeConsistency` in `mockChecks.ts`, wired into
  `api/videopd/[token]/complete/route.ts`) — this is the BRD's own literal
  worked example ("stated income vs. declared household cash flow"). Gated
  by the question's `key` containing "income" (language-independent, since
  the question's displayed *text* is in whatever language the borrower saw
  it in) — none of the 9 originally-seeded questions ask about income
  directly, so one was added per segment through the same real
  translate-and-approve pipeline the admin question UI uses, not
  hand-typed translations.

**What's still missing:** cross-checking *other* free-text VideoPD Q&A
content against application data beyond the income example — e.g., a
farmer's described crop/land details against `segmentFieldsJson`, or a
business owner's stated operations against `businessType`. That's a
genuinely different, harder problem than the two numeric checks above:
extracting comparable claims from open-ended free text needs real NLU, not
attempted here.

## 9. Configurable scoring model calibrated to Lakshya's credit parameters (BR-43) — real generic defaults built, calibration still pending

**What's built:** `scoreAnswer()` in `src/lib/videoPdQuestions.ts` — a
transparent, word-count-based proxy for "did the borrower engage
meaningfully," explicitly not attempting to judge answer *content*. The
question set itself is DB-backed and admin-managed (`/staff/questions`,
`VideoPdQuestionConfig`) with a draft → translate → review → approve
workflow. This closes the "configurable question set" half of BR-43's ask.

On the *scoring* half: rather than leave this fully blocked, it's split into
what's genuinely generic (buildable honestly today) versus what's genuinely
Lakshya-specific (not). Two real, industry-standard microfinance/NBFC
underwriting ratios now run on every submission (`src/lib/riskParameters.ts`,
`runAutoAnalysis` in `mockChecks.ts`): a loan-to-income multiple cap (was a
hardcoded `36` magic number, now configurable) and an EMI-to-income
affordability check (a standard reducing-balance EMI estimate against
stated income, FOIR-style — verified against known EMI-calculator reference
values before being wired in). Both are **real, staff-editable numbers**
(`RiskParameters` table, `/staff/risk-parameters`, Approver-only to change,
`api/staff/risk-parameters`), seeded with generic defaults, not invented
Lakshya-specific weights — this is exactly the BR-43 seam: Lakshya (or
Lakshya via the underwriter team) enters their real numbers during UAT or
in production, as a form submission, no engineering change or redeploy.

**Now segment-specific, not one global set:** `RiskParameters` is keyed per
segment (FARMER / VOCATIONAL_STUDENT / BUSINESS_OWNER), each independently
editable at `/staff/risk-parameters` (segment-tabbed). Real reason, not
just architecture for its own sake: farm income is seasonal/harvest-cycle,
and a vocational-student applicant typically has no current income at all
(the loan is against future earning potential or a guarantor) — both
genuinely don't fit the "stable monthly income" assumption the EMI check
makes, which the page says outright per segment. All three segments still
start from the *same* generic numbers, though — there's no rigorous, citable
basis yet to invent different starting values per segment, and doing that
would just be different-flavored fabrication instead of no fabrication.
(For VOCATIONAL_STUDENT specifically, the existing `income > 0` guard on the
EMI check already means it's silently skipped when no income is stated —
honest, but worth knowing.)

**Now a real, bounded first step on judging answer *content*:** BR-43's
scoring model still needs a real content judgment this prototype can't
provide (no rubric, no NLU) — unchanged. But one honest, narrow, real signal
now runs alongside it: `answerEchoesQuestion()` in `mockChecks.ts` flags an
answer that substantially just repeats the question's own wording back
rather than contributing new content (deterministic word-overlap, verified
against 5 synthetic cases before being wired in). This is explicitly **not**
a judgment of whether an answer is credit-relevant, truthful, or plausible —
it only catches a narrow, low-effort/scripted-response pattern, and the
flag's own detail text says so rather than overclaiming.

**What's still genuinely missing:** Lakshya's own calibration of the risk
parameters (BRD Section 12's dependency, unchanged), segment-specific
*values* (the architecture now supports them; no defensible numbers exist
yet to put there), and the real content-judgment BR-43 ultimately needs —
echo-detection is a narrow slice, not that. The EMI ratio also doesn't
factor in `existingObligations` — that field is free text, not a structured
number, so it's honestly excluded rather than parsed unreliably; the flag's
own detail text says so.

## 10. Tamper-proof, digitally signed dossier PDF (BR-44)

The Actionable Dossier is currently a JSON blob (`VideoPdSession.dossierJson`)
rendered in the underwriter workspace UI — not a digitally signed/watermarked
PDF artifact. No signing infrastructure (e.g., a certificate/HSM-backed
signing service) is wired up.

## 10a. Bank statement authenticity / tamper detection (requested live) — real checks built, visual/logo forgery explicitly out of scope

**What's built:** two real, deterministic document-authenticity signals,
neither an ML/forensic claim — just inspecting what's actually in the file:

- **PDF metadata/structure** (`checkPdfMetadata`): revision count (a PDF
  edited/re-saved after its original creation leaves a real, standard extra
  `%%EOF` marker in the raw bytes — see `scripts/extract-pdf.js`'s
  `countRevisions`), the Producer/Creator naming an image/design editor
  (Photoshop, GIMP, Canva, …) rather than a banking/reporting system, and the
  PDF's own internal ModDate meaningfully after its CreationDate.
- **Transaction arithmetic reconciliation** (`checkTransactionIntegrity`):
  each row's transaction amount and its running balance are extracted
  independently from the same line (the balance-delta comparison in
  `parseTransactions` only decides debit-vs-credit's *sign*; the amount's
  own *value* is a separate capture group) — so verifying the balance
  actually moved by the stated amount is a real, non-circular check, not a
  re-derivation of the same number. Catches the classic tell of a doctored
  statement: one number edited without correcting the other.

Both feed a combined `authenticityStatus`/`authenticityReasonsJson` on
`BankStatement`, shown loudly on the underwriter's case page either way — a
clean result gets an explicit "Document authenticity verified — no signs of
tampering detected" statement, not silence, and a flagged one also joins the
Lead's queue-level risk flags (`BANK_STATEMENT_AUTHENTICITY`), same pattern
as identity verification. Verified end-to-end against a real generated PDF
with both signals deliberately present (Photoshop metadata + one tampered
transaction line) through the actual running route.

**What's explicitly NOT attempted:** detecting a doctored logo or altered
visual content within the page image itself. That needs real image-
forensics ML (error-level analysis, copy-move forgery detection) — the same
"genuinely hard ML problem, no credible path without a trained model or
vendor" category as deepfake/lip-sync detection above, not attempted rather
than faked.

## 11. Bilingual transcript (BR-45) — done, with one caveat

The dossier now includes a real English translation alongside each Q&A
answer (`answerTextEn` in `VideoPdSession.dossierJson`, computed once at
session-completion time via `src/lib/translate.ts` — MyMemory's free,
keyless translation API, not a paid vendor). Same one-shot pattern is used
for the question bank itself: an admin's English prompt is auto-translated
into the other 5 languages at creation time for review before approval.

**Caveat:** MyMemory is a free, rate-limited service with no uptime SLA — a
translation call can legitimately fail (network issue, quota), and when it
does the original text is kept with `translationAvailable: false` rather
than a fabricated or silently-missing translation. Worth a real vendor
(Azure Translator, Google Cloud Translation) before production, but the
integration seam (`translateText()`) doesn't change shape if swapped.

## 12. Background/async statement processing — done

Bank-statement extraction used to run synchronously inside the upload
request (OCR can take several seconds, longer with the scanned-PDF fallback
item 6 added). Now split: the route saves the file, creates the
`BankStatement` row as `PENDING`, and responds immediately; extraction,
parsing, eligibility, and authenticity checks run afterward in a genuine
fire-and-forget background task (`processStatement` in
`api/videopd/[token]/bank-statement/route.ts`) that updates the same row —
and folds risk flags into the Lead's summary — once it finishes. The
borrower's own upload UI (`StatementStep` in `videopd/[token]/page.tsx`)
needed no changes: it already only waited for the upload request itself to
resolve, never called `.json()` on the response, and its "processing…" /
"received, thank you" copy was already accurate for an async model (it
never claimed "fully analyzed"). The underwriter's case page now polls
every 3s while the latest statement is `PENDING`, stopping itself once it
resolves, so the real result appears without a manual refresh.

Verified live: uploaded a scanned PDF (the slowest path — rasterize + OCR),
confirmed the upload response returned the `PENDING` row immediately rather
than waiting on extraction, then confirmed via direct polling that the row
transitioned to `EXTRACTED` with correct metrics/eligibility/authenticity
data a few seconds later, fully unattended.

Real, stated limitation: this fire-and-forget approach is correct because
this app runs as a long-lived Node process (`next dev`/`next start`) — the
promise genuinely keeps running after the response is sent. It would NOT be
correct on a serverless/edge deployment (e.g. Vercel functions), which can
suspend or kill a function once its response is sent with no guarantee an
un-awaited promise finishes. A real production deployment on serverless
infra would need an actual queue (a DB-backed job table polled by a worker,
or a managed queue service), not this in-process technique.

## 13. Session step-resume — done

If a borrower's browser reloads mid-session, each completed step's data is
safely persisted (answers, uploaded captures, statement), and the UI now
resumes at the exact step they left off rather than restarting from the
welcome screen. `VideoPdSession.currentStep` is written on every step
transition and read back on load.

## 10b. Draft underwriter recommendation (requested live as "replace the underwriter with an AI agent") — built as decision support, autonomous decisioning explicitly refused

Requested live, verbatim, as full autonomous approve/reject with reduced
human intervention. **Refused as asked** — this is exactly the "Automated,
non-underwriter-reviewed credit decisioning" the Permanent scope boundaries
section below excludes, and that exclusion reflects a real regulatory
reality for lending (human accountability/explainability for adverse
credit decisions), not just an arbitrary scoping choice.

**What was built instead** (`src/lib/underwriterAgent.ts`): a
"Draft recommendation" button that synthesizes the real signals already on
the case page (risk flags, bank statement eligibility/authenticity, identity
verification, skill/intent score) into a suggested APPROVE/REJECT with
written reasoning citing the specific real signals — purely to pre-fill the
underwriter's own notes field. Deterministic rule synthesis, explicitly
labeled as such in its own output text ("not a language model") — this app
has no real free/keyless LLM API to honestly call, so rather than fake an
"AI-generated" writeup, it states plainly what it actually is, same footing
as every other advisory check here.

Real control checks, verified live: the drafting function is pure (no `db`
import, no `fetch` call — confirmed by reading its own source) and only
ever calls `setNotes`/`setDraftSuggestion` client-side; nothing writes to
the database until the underwriter explicitly clicks Recommend Approve/
Reject themselves, same two buttons as before, both always independently
clickable regardless of what the draft suggests. Verified against a real
seeded case with a genuine high-severity flag (tampered bank statement):
clicking the button filled the notes with a correct REJECT draft citing the
real reasons, the "Suggested: REJECT" badge appeared, and the database
confirmed `underwriterRecommendation` stayed `null` and the case stayed
`UNDER_REVIEW` — nothing was submitted by the draft itself. The notes are
permanently prefixed `[AI-drafted — reviewed before submission]` if used,
so the audit trail always shows what originated as a draft vs. what the
underwriter wrote themselves.

## 10c. Voice biometrics — deepfake/lip-sync/voice-biometric/coaching pipeline (requested live, named tools challenged/researched), built for the parts with a real open-source path

Requested live as a full pipeline using three named tools: "VeriFusion for
deepfake + lip-sync detection, SpeechBrain + Resemblyzer for voice
biometrics, Demucs for background-voice coaching detection." Researched
each rather than answering from memory, per-tool verdict below, then built
what actually checked out real — see section 3 above for the fuller
picture, `voice-service/README.md` for the technical detail.

- **VeriFusion** — could not be verified as a real, accessible open-source
  project via search. Not used. Real alternatives exist for lip-sync
  detection specifically (SyncNet, LIPINC, LipFD, DeepFake-O-Meter v2.0) but
  are research-grade code, not maintained libraries — not attempted this
  round; see section 3's "still missing" list.
- **SpeechBrain + Resemblyzer** — real, verified, built. ECAPA-TDNN
  (SpeechBrain) as the primary speaker-embedding model, Resemblyzer as an
  automatic fallback if the SpeechBrain model fails to load, both honestly
  labeled in every API response's `method` field.
- **Demucs** — real, but it's music vocal/instrument separation, not
  speaker-vs-speaker separation; the research found supports it only as a
  modest diarization *preprocessing* step, not a coaching detector by
  itself. Not used — the multi-speaker scan does direct window-embed-cluster
  diarization on the raw audio instead (see `diarize.py`'s own doc comment
  for why pyannote/NeMo, the actual state-of-the-art diarization tools,
  weren't used either: both need either a gated HuggingFace auth token or a
  much heavier install than fits a prototype).

**What got built**: two staff-triggered checks (voice consistency, 
multi-speaker scan) over the two guided-flow recordings, PLUS a Tier 1
live-call version — the borrower's own browser records its own audio
(consent-gated, audio-only) during the live call and uploads it when the
call ends, analyzed the same way. All four resulting risk flags stay
"medium"/advisory (thresholds are each library's published default, not
calibrated against real Lakshya borrowers) and flow through the same
generic risk-flag path as every other check, reaching the draft-
recommendation agent and both maker/checker roles automatically.

**Explicitly not built**: true real-time in-call alerts (Tier 2) — scoped
in conversation (would need rolling audio chunks shipped off the browser
during the live call, a reworked streaming-inference pipeline, and a
live-alert channel back to the underwriter), not built; and "coaching" as
a confirmed judgment — a detected second voice is a real signal worth a
listen, not proof of coaching, which would need content/intent
understanding this app doesn't have (same boundary as
`underwriterAgent.ts`'s "NOT CONSIDERED" list).

## 10e. Deepfake detection (requested live, explicitly acknowledged as research-grade, "implement anyway for demo purpose") — deepfake built, lip-sync's first candidate concretely blocked (see 10f for what shipped instead)

Follow-up to 10c above, which had left both deepfake and lip-sync as "not
attempted this round." Asked again, explicitly accepting the research-grade
framing — both were genuinely attempted this time, not just researched.

**Deepfake — built** (`voice-service/deepfake.py`, `POST /deepfake-check`).
Samples 8 frames from a guided-flow recording via ffmpeg, classifies each
with [`prithivMLmods/Deepfake-Detect-Siglip2`](https://huggingface.co/prithivMLmods/Deepfake-Detect-Siglip2)
(a real, downloadable, correctly-labeled Siglip2 image classifier via the
standard `transformers` API), and flags if enough sampled frames score
above a fake-probability threshold. Frame-level image forensics only, not
video-native or temporal analysis — stated in the risk-flag text itself.
Verified end-to-end: real ffmpeg frame extraction, real model inference,
correct label mapping (`{0: 'Fake', 1: 'Real'}`, matched by searching
`id2label` rather than a hardcoded index), and a full pipeline run against
a real test video that correctly, confidently flagged an obviously-synthetic
(SVG-drawn) face as fake — a real, if indirect, sanity check that the model
discriminates sensibly. Wired into the same staff-triggered "Run voice
check" flow, same generic risk-flag path, and — per the explicit ask —
**admin-toggleable** (`FeatureSettings.deepfakeCheckEnabled`, a new
Approver-only toggle on `/staff/risk-parameters`) so it can be turned off
without an engineering change.

**Lip-sync — genuinely attempted, concretely blocked, not shipped.** Found
and installed `syncnet-python` (PyPI, MIT-licensed, a real community port
of the original SyncNet with matching pretrained weights mirrored on
HuggingFace by the same maintainer). Actually tested it, not just read the
README: every documented public entry point evaluates to `None` at import
time (`SyncNetPipeline`, `SyncNetInstance` imported the top-level way), and
the package's own bundled example script fails with `ModuleNotFoundError:
No module named 'syncnet_pipeline'` — a broken import in the package's own
shipped code, version 0.2.2. The underlying legacy implementation is real
and importable directly, bypassing the broken package init, but using it
correctly means hand-assembling the original multi-stage pipeline (face
detection → tracking → per-shot cropping → audio alignment → model
evaluation) from a Beta-status third-party port with no working reference
to check against — a real risk of shipping a plausible-looking but silently
wrong "confidence score" to an underwriter. Not shipped as `syncnet-python`.

## 10f. Lip-sync detection, take two (asked directly: "can we replace SyncNet with Wav2Lip?") — Wav2Lip rejected on license, LipForensics shipped instead

Wav2Lip (`Rudrabha/Wav2Lip`) isn't actually a lip-sync *detector* — it's a
*generator* (edits a video's mouth movement to match new audio). What it
uses internally to judge sync quality (the LSE-C/LSE-D metrics cited
throughout the lip-sync research literature) is itself a SyncNet-
architecture discriminator, so "replace SyncNet with Wav2Lip" wasn't quite
a like-for-like swap to begin with. More decisively: its GitHub README
states the repository "can only be used for personal/research/non-
commercial purposes" — confirmed by cloning the real repo and reading the
actual LICENSE/README text, not assumed. A genuine legal blocker for a
commercial lending product, unrelated to whether the code works. Rejected
on that basis alone.

**What shipped instead**: [LipForensics](https://github.com/ahaliassos/LipForensics)
(`ahaliassos/LipForensics`, CVPR 2021, MIT-licensed — confirmed by reading
the actual LICENSE file) — architecturally the right kind of tool from the
start: a real face-forgery detector trained specifically on lip-region
temporal artifacts, not a generator. Full real pipeline built and verified
end-to-end against a real photograph: ffmpeg frame extraction → real face
detection + 68-point landmarks (`ibug.face_detection`/`ibug.face_alignment`,
MIT-licensed, weights bundled in-repo — sidesteps a real dead end hit along
the way, the original `face-alignment` PyPI package's own weight host,
`adrianbulat.com`, being unreachable from this sandbox) → mouth-region
alignment/crop (vendored directly from LipForensics' own preprocessing
code) → the real pretrained forgery classifier. One real bug found and
fixed in the vendored code: the original checkpoint loader hardcoded a
CUDA device regardless of what was requested, crashing on this CPU-only
machine even when `device="cpu"` was passed explicitly.

Wired the same way as deepfake detection — same staff-triggered "Run voice
check" flow, same generic risk-flag path (`LIP_SYNC_ANOMALY`), and its own
independent admin toggle (`FeatureSettings.lipSyncCheckEnabled`). Full
technical account in `voice-service/README.md`'s "Deepfake/lip-sync"
section.

## 10d. ID-document text cross-check (self-identified gap, approved to build) — done

Previously listed in `underwriterAgent.ts`'s own "NOT CONSIDERED" doc comment:
face-match (`faceMatch.ts`) only ever compares the ID proof PHOTO against the
borrower's liveness recording — nothing checked whether the ID NUMBER printed
on the document matched what the borrower typed into the application form.
A borrower could upload someone else's (or a fabricated) ID photo bearing
their own typed number and nothing would catch the mismatch.

**What's built** (`src/lib/idProofCheck.ts`): OCRs the ID_PROOF photo at
upload time (`api/upload/route.ts`, same Tesseract.js engine as the bank-
statement OCR path) and regex-extracts an ID number, compared against the
declared `idNumber`. Reliable extraction only exists for ID types with a
genuinely consistent national format — Aadhaar (12 digits), PAN (5 letters +
4 digits + 1 letter, a fixed government-mandated format), and Voter ID/EPIC
(3 letters + 7 digits). Driving licence numbers vary too much by issuing
state to match reliably by pattern — deliberately returns "not attempted"
rather than guessing and producing unreliable false mismatches. Result is
stored on the ID_PROOF evidence row's own `authenticityStatus`/
`authenticityNotes` (previously unused for this evidence type), which the
case page's evidence grid already renders generically — no UI changes
needed. A `FLAGGED` result folds into `Lead.summary.riskFlags`
(`ID_PROOF_NUMBER_MISMATCH`, "medium"/advisory — OCR misreads on a
photographed card are common) at `/api/submit` time, reaching the queue,
the case page, and the draft-recommendation agent the same generic way
every other check does.

Image-only for now — a PDF ID proof would need the same PDF-to-image
rendering step item 6 above just added for bank statements; not yet wired
up for ID proofs specifically. Verified live: a real OCR'd test ID card
image through the actual upload/submit API routes, both a matching and a
deliberately mismatched declared number, confirmed correct `PASSED`/
`FLAGGED` results and risk-flag folding.

## Permanent scope boundaries (not "future work" — explicitly excluded)

These aren't gaps to close later; they're BRD Section 7.2 exclusions that
should stay excluded:

- **Automated, non-underwriter-reviewed credit decisioning or auto-approval.**
  Every eligibility flag and fraud/consistency signal in this build is
  advisory input to the existing maker-checker workflow — never a verdict
  that bypasses it. This must hold for any future work above too.
- **Native mobile apps** — web-responsive only, per BRD Section 7.2.
- **New loan products or credit-policy changes** — this program changes the
  origination/verification channel, not credit policy itself.
