# Finverge VideoPD 2.0 — Digital Loan Origination Portal (prototype)

A working local prototype of the **Digital Loan Origination Portal + VideoPD 2.0 +
Underwriter Workspace** modules described in `FIN-BRD-VIDEOPD-2.0`,
`FIN-FSD-VIDEOPD-2.0`, and `FIN-HLD-VIDEOPD-2.0` (see `D:\Finverge\Docs\Products\VideoPD`).

This is **prototype-fidelity**, not production code: real frontend, real backend logic,
real on-device ML for liveness/face-matching, real self-hosted WebRTC calling, a real
local database — but external integrations (SMS gateway, cloud storage, LOS platform,
enterprise liveness/fraud vendors) are mocked, stubbed, or deliberately not attempted
where no honest path exists. See "What's mocked" and `docs/videopd-future-work.md` for
the precise, itemized gap list against the BRD — that file is the source of truth for
what's deliberately not built and why; this README is the orientation layer on top of it.

## What's implemented

**Borrower application portal**
- Landing flow — language selection (6 launch languages, FSD §5.4), segment selection
  (Farmer / Vocational Student / Business Owner), mobile OTP login (FR-BWP-04).
- Adaptive multi-step application form — core sections (FSD §4.3.1) + segment-specific
  fields (FSD §4.3.2), with save & resume (FR-BWP-05/06).
- AI voice + text chatbot (FSD §5) — **real** browser-based speech recognition/synthesis
  (Web Speech API), guided form-filling with read-back confirmation (FR-CHB-06/07), FAQ
  answering from pre-approved content (FR-CHB-03), human-escalation prompt after repeated
  misses (FR-CHB-04). Chatbot and manual form share one state — switch between them anytime
  (FR-CHB-08).
- Document/photo/video upload (FSD §6) — camera capture or file picker, real geo-tagging
  (`navigator.geolocation`), quality checks.
- LOS Auto-Analysis & Lead creation (FSD §7) — completeness/consistency risk flags
  (incomplete fields, flagged document quality, requested-amount-vs-income outlier,
  repeat applicant), an Initial Summary Document, and a Lead record, on submission.

**VideoPD 2.0** (`/videopd/[token]`) — a guided, resumable flow the borrower opens from a
link the underwriter sends:
- Liveness capture with **real, on-device** blink detection (Eye Aspect Ratio on
  face-api.js landmarks, `src/lib/liveness.ts`) and **real** face-matching against the
  applicant's ID proof photo (`src/lib/faceMatch.ts`) — both run entirely client-side, no
  vendor API. Live borrower-facing feedback during recording (blink confirmation, an
  off-camera nudge). Off-camera-glance coaching-detection (discrete glance counting,
  normalized by clip length, not a flat threshold) is the one honestly-buildable slice of
  BR-41's coaching-detection ask — see `docs/videopd-future-work.md` item 3 for exactly
  what this does and doesn't cover.
- A skill/intent Q&A (DB-backed, admin-managed question bank with a draft → auto-translate
  → review → approve workflow at `/staff/questions`), business/asset verification capture,
  and bank-statement upload with real parsing (native PDF text layer, OCR fallback via
  Tesseract.js for scanned images) and an income-consistency check.
- Session step-resume — a mid-session reload picks up at the exact step left off, not the
  welcome screen.
- **Real, self-hosted live video calling** — no Daily/Twilio/Agora account. A borrower ↔
  underwriter call, plus a segment-aware 3rd-party entry point (`/call/[token]`) for a
  training institute contact (student loans) or a business/workshop contact (business
  loans) to join and show their premises live. Mesh-connects up to 6 participants. Real
  audio-only fallback (actually stops sending video, not just muting it) and an advisory
  weak-connection suggestion based on real `RTCPeerConnection.getStats()`. Real-time
  liveness/attention monitoring can run continuously during a call, not just the recorded
  clip, broadcasting a live indicator to everyone else in the room. See
  `docs/videopd-future-work.md` item 1 for the one real gap (no TURN relay) and the one
  thing this hasn't been tested against (a real camera/network — this dev environment
  blocks `getUserMedia`).

**Underwriter Workspace** (`/staff`)
- Staff login (Underwriter / Approver roles), a searchable/filterable case queue with risk
  badges, and a case detail page bringing together the borrower profile, segment fields,
  risk flags, uploaded evidence, an Identity Verification panel (the liveness/face-match
  result — a side-by-side photo comparison, blink/glance/face-match stat chips, a clear
  verdict), VideoPD verification status, the live-call panel, and the chatbot transcript.
- Maker-checker decision workflow — an Underwriter recommends, an Approver confirms or
  sends the case back, with a full multi-round audit trail (`LeadDecision`) and a
  race-condition-safe claim (atomic update, not read-then-write).
- Question bank admin — draft, auto-translate, review, and approve VideoPD questions before
  they ever reach a borrower.
- Actionable Dossier — a skill/intent score and PDF download once a session completes.

Every risk/liveness/consistency signal in this build is **advisory only** — input to the
maker-checker workflow, never an auto-decision. This holds everywhere, not just where
explicitly noted.

## What's mocked (and why)

| Component | Mocked as | Real integration point |
|---|---|---|
| SMS/WhatsApp OTP gateway | OTP code returned in the API response, dev-mode only | `src/app/api/auth/otp/route.ts` |
| ASR / TTS | Browser Web Speech API (real STT/TTS, not fake — just not the production vendor) | `src/lib/speech.ts` — swap for Bhashini/Azure/Google per FSD §5.5 thresholds |
| NLU / Dialog Manager | Rule-based field extraction + keyword FAQ matching | `src/lib/dialogManager.ts` |
| Document quality check | Heuristic (file size/type) | `src/lib/mockChecks.ts` |
| Document authenticity (ID proof itself — hologram/font/layout) | Not attempted | needs a document-forensics model/vendor |
| Liveness / face-match | **Real** (face-api.js, on-device) — prototype-grade, not enterprise-SDK-grade (FaceTec/Onfido) | `src/lib/liveness.ts`, `src/lib/faceMatch.ts` |
| Live video calling | **Real** (self-hosted WebRTC) — STUN only, no TURN relay | `server/signaling-server.ts`, `src/lib/useCallRoom.ts` |
| Translation | Real calls to MyMemory's free API, not a paid vendor | `src/lib/translate.ts` |
| LOS Auto-Analysis risk scoring | Deterministic heuristics, not ML | `src/lib/mockChecks.ts` |
| Cloud object storage / CDN | Local filesystem (`uploads/`) | `src/app/api/upload/route.ts` |
| LOS platform (external system) | Not built — this app *is* the queue/maker-checker workspace, self-contained, no external LOS sync | see HLD §4 |
| Deepfake / synthetic-voice / voiceprint / lip-sync detection | **Not attempted, deliberately** — no credible open-source path; explicitly refused rather than faked | `docs/videopd-future-work.md` item 3 |

## Running locally

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Open http://localhost:3000. Voice input/output works best in Chrome or Edge (Web Speech
API support varies by browser — the chatbot falls back to text-only automatically if
unsupported, per FR-CHB-08).

**Live video calling** (borrower ↔ underwriter, and the 3rd-party training-institute/
business-contact link) needs its own signaling process running alongside `npm run dev`:

```bash
npm run dev:signaling
```

Optional but recommended — a real, self-hosted TURN relay (coturn), so calls can connect on
networks STUN alone can't traverse (symmetric NAT, some corporate firewalls). Requires Docker
Desktop running:

```bash
docker run -d --name videopd-turn \
  -p 3478:3478/tcp -p 3478:3478/udp -p 49160-49200:49160-49200/udp \
  -v "$(pwd)/turnserver.conf:/etc/coturn/turnserver.conf:ro" \
  coturn/coturn
```

`turnserver.conf`'s `static-auth-secret` must match `TURN_STATIC_AUTH_SECRET` in `.env`
(both are already set to the same generated value — only change them together). Without this
container running, calls fall back to STUN-only automatically — nothing breaks, it's strictly
additive. See `docs/videopd-future-work.md` item 1 for exactly what's been verified about this
(a real relay allocation, confirmed live) versus what hasn't (an actual multi-device call).

## Known gaps to close before this goes anywhere near production

- No real authentication/session security (OTP-verified borrowerId is trusted client-side —
  fine for a local demo, not for the internet). Staff auth is similarly prototype-grade.
- A real TURN relay exists (coturn via Docker) and its relay allocation is verified live —
  but it currently runs on whatever this dev machine's Docker Desktop exposes. Real
  cross-network reachability for an arbitrary demo network depends on deploying it somewhere
  actually publicly reachable, same as the signaling server. See `docs/videopd-future-work.md`
  item 1.
- **The live-call and liveness/face-match ML paths have never been tested against a real
  camera** — this development environment blocks `getUserMedia` entirely, so this is the one
  piece even the TURN relay verification above couldn't reach. Verified as far as protocol
  tests, synthetic-data math checks, a live TURN relay allocation, and code review against
  the WebRTC/face-api.js specs allow; not verified end-to-end with two real people on two
  real devices. Do this before relying on either for a live demo.
- Translations in `src/lib/i18n.ts` are prototype-quality and need the native-speaker QA
  pass described in `FIN-TTG-VIDEOPD-2.0` before any language goes live for real borrowers.
- `npm audit` reports vulnerabilities in `postcss`/`sharp` that only clear on a Next.js 16
  upgrade (a breaking change) — deferred deliberately to stay on stable Next 15; revisit
  before production.
- No automated test suite (protocol-level tests for the signaling server and the
  liveness/glance detection math were run ad hoc during development, not kept as a
  regression suite).
- Full itemized gap list, with what's built vs. what's genuinely missing and why, per BRD
  requirement: `docs/videopd-future-work.md`.
