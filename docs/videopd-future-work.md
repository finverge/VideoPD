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

## 3. Real fraud/deepfake/voice-biometric/behavioral detection (BR-31, BR-32, BR-33, BR-41) — liveness/gaze built, deepfake/voice still refused

**What's built:** real liveness (blink detection via Eye Aspect Ratio on
face-api.js landmarks, on-device, `src/lib/liveness.ts`), real biometric
face-matching (selfie/live-call frame vs. ID proof photo, face-recognition
descriptor distance, `src/lib/faceMatch.ts`), and a real — not faked —
partial slice of coaching-detection: discrete off-camera glance counting
(not just cumulative time looking away), running both during the async Step 1
recording and continuously during a live call, normalized by clip/call
duration rather than a flat threshold. All advisory, surfaced on the
underwriter's Identity Verification panel and folded into the case's risk
flags (visible on the queue, not just the case detail page), never
auto-decisioning.

**What's still missing, deliberately not attempted:** deepfake/synthetic-video
detection, voiceprint/voice-biometric matching, response-timing/hesitation
analysis, and the background-voice/lip-sync-anomaly slice of coaching-detection
(BR-41). These remain genuinely hard ML problems needing a trained model or a
licensed vendor — no credible open-source path was found, so rather than fake
a result, none of this was attempted.

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

## 6. Scanned-PDF OCR fallback

The bank-statement pipeline (`src/lib/bankStatement.ts`) tries a PDF's native
text layer first, then falls back to ICR/OCR for image files. A **scanned
PDF with no text layer** currently gets flagged `NEEDS_REVIEW` rather than
OCR'd, because that requires rasterizing PDF pages to images first (a native
renderer, e.g. `pdfjs-dist` + `canvas`) — deferred given this environment's
history of native-binary install issues with canvas-family packages. A
borrower can work around this today by photographing the statement instead
(routes to the OCR path directly).

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

## 8. Full Live Consistency Engine (BR-42)

**What's built:** one real, honest cross-check — declared monthly income
(from the original application) vs. the income pattern found in the bank
statement, flagged if they differ by >40%.

**What's missing:** cross-checking the borrower's free-text VideoPD Q&A
answers against application data more broadly (the BRD's own example is
"stated income vs. declared household cash flow" mentioned in conversation
during this build too). Matching two numbers reliably is straightforward;
extracting comparable claims from free-text answers needs real NLU, not
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

## 12. Background/async statement processing

Bank-statement extraction currently runs synchronously inside the upload
request (OCR can take several seconds). Fine for a prototype; a production
build should queue it and let the borrower continue to the next step while
it completes.

## 13. Session step-resume — done

If a borrower's browser reloads mid-session, each completed step's data is
safely persisted (answers, uploaded captures, statement), and the UI now
resumes at the exact step they left off rather than restarting from the
welcome screen. `VideoPdSession.currentStep` is written on every step
transition and read back on load.

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
