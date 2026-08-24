"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { averageEAR, estimateYawOffset, BlinkTracker, LOOKED_AWAY_YAW_THRESHOLD } from "@/lib/liveness";
import { SPEECH_LOCALE } from "@/lib/i18n";
import { describeGetUserMediaError } from "@/lib/mediaErrors";
import type { LangCode } from "@/types";
// faceModels.ts pulls in face-api.js/TensorFlow.js — a large bundle. Loaded
// dynamically inside startLivenessAnalysis below, only on the code path
// that actually runs analyzeLiveness, so every other page that uses this
// hook (the underwriter's case page, the 3rd-party guest page) doesn't pay
// for it in their initial bundle.

/**
 * Real, self-hosted WebRTC calling — no Daily/Twilio/Agora account, no
 * vendor SDK (see the "plain live video call, skip Pipecat" scope decision:
 * Pipecat is an AI-agent orchestration framework, not a fit for two humans
 * just talking to each other). This hook does the peer-connection side;
 * server/signaling-server.ts relays join/offer/answer/ICE messages between
 * peers in the same room and never touches the actual media, which flows
 * directly peer-to-peer once negotiated.
 *
 * NAT traversal: STUN (Google's public server) always; a self-hosted TURN
 * relay (coturn, see turnserver.conf and api/turn-credentials/route.ts) too,
 * when one is configured — join() fetches short-lived TURN credentials at
 * call time and adds them to the ICE server list. Without a TURN server
 * configured (TURN_STATIC_AUTH_SECRET unset), this degrades to STUN-only
 * exactly as before: resolves NAT for most home/mobile networks, not
 * symmetric NATs or some corporate firewalls.
 */

const STUN_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/turn-credentials");
    if (!res.ok) return STUN_SERVERS; // no TURN configured — STUN-only, same as before this existed
    const { urls, username, credential } = await res.json();
    return [...STUN_SERVERS, { urls, username, credential }];
  } catch {
    return STUN_SERVERS; // network hiccup fetching TURN creds shouldn't block the call — just falls back to STUN
  }
}

// getUserMedia's error .name distinguishes real, different causes that all
// used to collapse into one vague "Couldn't access camera/microphone." —
// most importantly NotReadableError ("device already in use"), which is
// exactly what happens testing both the underwriter and borrower sides in
// two tabs of the same browser on one machine: most devices have exactly
// one camera, and it can't stream to two getUserMedia calls at once, so
// the second tab to join genuinely can't get a camera, not a bug in the
// call logic itself. Reported live as "video recording is not happening"
// when testing that exact two-tabs-one-machine setup.
export type ConnectionQuality = "good" | "weak" | "unknown";

/** The live liveness/attention signal a peer broadcasts about themselves
 * while analyzeLiveness is on (see useCallRoom's join option below) — real
 * per-frame blink/gaze detection (src/lib/liveness.ts), the same math
 * already verified for the async Step 1 recording, now running continuously
 * during the live call instead of a single clip. Advisory display only. */
export interface LiveSignal {
  blinkCount: number;
  lookingAway: boolean;
  faceDetected: boolean;
  updatedAt: number; // Date.now() when received, so a stale/stopped feed can be told apart from "currently looking away"
}

export interface CallParticipant {
  peerId: string;
  name: string;
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  /** Whether this participant's video track is currently actually flowing
   * (real WebRTC track.muted/unmuted events — reflects reality whether they
   * deliberately went audio-only or their network just dropped the video),
   * not merely whether they have a video track at all. */
  videoActive: boolean;
  liveSignal: LiveSignal | null;
}

/** One live transcript line — either this participant's own speech or
 * another participant's, broadcast over the same signal channel as the
 * liveness data above. speakerName is whatever displayName that
 * participant joined with. */
export interface TranscriptSegment {
  speakerName: string;
  text: string;
  at: number; // Date.now() when produced, for stable ordering/keys
}

// Connection-quality thresholds for the audio-fallback suggestion below —
// commonly cited rules of thumb (packet loss above ~5-10% and round-trip
// time above a few hundred ms are both widely treated as the point video
// call quality becomes clearly degraded), not thresholds empirically tuned
// against this app's own real traffic. Advisory only, same as every other
// heuristic in this codebase (see src/lib/mockChecks.ts) — this suggests,
// it never auto-switches anyone off video.
const QUALITY_POLL_MS = 3000;
const PACKET_LOSS_WEAK_THRESHOLD = 0.08;
const RTT_WEAK_THRESHOLD_S = 0.4;

async function assessPeerQuality(pc: RTCPeerConnection): Promise<ConnectionQuality> {
  if (pc.connectionState !== "connected") return "unknown";
  try {
    const stats = await pc.getStats();
    let packetsLost = 0;
    let packetsReceived = 0;
    let rtt: number | null = null;
    stats.forEach((report: any) => {
      if (report.type === "inbound-rtp" && report.kind === "video") {
        packetsLost += report.packetsLost ?? 0;
        packetsReceived += report.packetsReceived ?? 0;
      }
      if (report.type === "candidate-pair" && report.state === "succeeded" && typeof report.currentRoundTripTime === "number") {
        rtt = report.currentRoundTripTime;
      }
    });
    const total = packetsLost + packetsReceived;
    if (total === 0 && rtt === null) return "unknown";
    const lossRate = total > 0 ? packetsLost / total : 0;
    if (lossRate > PACKET_LOSS_WEAK_THRESHOLD || (rtt !== null && rtt > RTT_WEAK_THRESHOLD_S)) return "weak";
    return "good";
  } catch {
    return "unknown";
  }
}

export function useCallRoom({
  signalingUrl,
  roomId,
  displayName,
  analyzeLiveness = false,
  transcribe = false,
  lang = "en",
}: {
  signalingUrl: string;
  roomId: string;
  displayName: string;
  /** When true, runs the same real blink/gaze detection used for the async
   * Step 1 recording (src/lib/liveness.ts) continuously on this
   * participant's own outgoing video for as long as they're in the call,
   * and broadcasts the result to every other participant's liveSignal —
   * the "real-time continuous monitoring" capability, now that both the
   * detection primitives and live-call infrastructure exist. Opt-in and
   * one-directional: intended for the borrower's own call instance, not the
   * underwriter's — nobody is monitored without deliberately turning this on
   * for their own outgoing feed. */
  analyzeLiveness?: boolean;
  /** When true, runs continuous speech-to-text (Web Speech API, same tech
   * as the chatbot's voice input — src/lib/speech.ts) on this participant's
   * own microphone for as long as they're in the call, broadcasts each
   * recognized segment to every other participant (transcriptSegments
   * below), and persists it to the session's CallTranscriptSegment record.
   * Each side transcribes its own audio — Web Speech API has no way to
   * listen to a remote MediaStreamTrack directly, only the local mic, so a
   * full transcript needs every participant to opt in on their own
   * instance. Genuinely real, not a placeholder: Chrome/Edge only (limited/
   * no support elsewhere), and quality depends on the same real-world
   * factors any speech recognizer does (accent, background noise, network). */
  transcribe?: boolean;
  lang?: LangCode;
}) {
  const [joined, setJoined] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<Map<string, CallParticipant>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [audioOnly, setAudioOnlyState] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>("unknown");
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const videoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerNamesRef = useRef<Map<string, string>>(new Map());
  const joiningRef = useRef(false);
  const qualityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(STUN_SERVERS);
  const livenessIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisVideoRef = useRef<HTMLVideoElement | null>(null);
  const blinkTrackerRef = useRef<BlinkTracker | null>(null);
  const livenessAnalyzingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcribingRef = useRef(false); // true only while the call wants transcription active — recognition.onend uses this to decide whether to auto-restart or genuinely stop

  const updateParticipant = useCallback((peerId: string, patch: Partial<CallParticipant>) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      const existing = next.get(peerId) ?? {
        peerId,
        name: peerId,
        stream: null,
        connectionState: "new" as RTCPeerConnectionState,
        videoActive: true,
        liveSignal: null,
      };
      next.set(peerId, { ...existing, ...patch });
      return next;
    });
  }, []);

  const removeParticipant = useCallback((peerId: string) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
    pcsRef.current.get(peerId)?.close();
    pcsRef.current.delete(peerId);
    videoSendersRef.current.delete(peerId);
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const stopLivenessAnalysis = useCallback(() => {
    if (livenessIntervalRef.current) {
      clearInterval(livenessIntervalRef.current);
      livenessIntervalRef.current = null;
    }
    if (analysisVideoRef.current) {
      analysisVideoRef.current.srcObject = null;
      analysisVideoRef.current = null;
    }
    blinkTrackerRef.current = null;
  }, []);

  const stopTranscription = useCallback(() => {
    transcribingRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  // Continuous speech-to-text on this participant's own mic for the whole
  // call, not the chat's single-utterance mode (src/lib/speech.ts's
  // useSpeech, continuous: false) — a live call needs to keep listening
  // across pauses. Web Speech API's own `continuous: true` still
  // legitimately stops on some browsers after enough silence (fires
  // onend), so this restarts itself for as long as transcribingRef stays
  // true, rather than treating every onend as "the call ended".
  const startTranscription = useCallback(() => {
    const SpeechRecognitionCtor =
      typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!SpeechRecognitionCtor) return; // not supported on this browser — silently no transcript from this side, same as everywhere else this API is used

    transcribingRef.current = true;

    const startOne = () => {
      if (!transcribingRef.current) return;
      const recognition: SpeechRecognition = new SpeechRecognitionCtor();
      recognition.lang = SPEECH_LOCALE[lang] ?? SPEECH_LOCALE.en;
      recognition.interimResults = false; // only final segments get broadcast/persisted — interim text changes too fast to be a useful transcript line
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (!res.isFinal) continue;
          const text = res[0].transcript.trim();
          if (!text) continue;
          const segment: TranscriptSegment = { speakerName: displayName, text, at: Date.now() };
          setTranscriptSegments((prev) => [...prev, segment]);
          send({ type: "signal", payload: { kind: "transcript", speakerName: displayName, text } });
          fetch(`/api/call/${roomId}/transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ speakerName: displayName, text }),
          }).catch(() => {}); // best-effort persistence — a dropped save shouldn't interrupt the live call or the live transcript view, which already has it via the broadcast above
        }
      };

      recognition.onerror = () => {
        // "no-speech"/"aborted" etc. are normal over a whole call (silence,
        // brief network hiccups) — onend below handles restarting either way.
      };
      recognition.onend = () => {
        if (transcribingRef.current) startOne(); // still in the call and still wanted — keep listening
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        // start() can throw if called again too quickly after a previous
        // instance's stop() hasn't fully settled — the next onend/restart
        // cycle recovers on its own, nothing to surface to the user for one
        // skipped restart.
      }
    };

    startOne();
  }, [displayName, lang, roomId, send]);

  // Runs the same real blink/gaze detection as the async Step 1 recording,
  // continuously, on this participant's own outgoing video for as long as
  // they're in the call — an offscreen <video> element bound to the local
  // stream feeds face-api.js, same as CameraCapture's analysis loop.
  // Broadcasts the result over the signaling channel every tick (small JSON
  // numbers/booleans, not media) so every other participant's liveSignal
  // updates in real time.
  const startLivenessAnalysis = useCallback(
    async (stream: MediaStream) => {
      let faceapi: typeof import("@/lib/faceModels").faceapi;
      try {
        const models = await import("@/lib/faceModels");
        await models.loadFaceModels();
        faceapi = models.faceapi;
      } catch {
        return; // model load failure shouldn't break the call — just no live signal
      }

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      analysisVideoRef.current = video;
      blinkTrackerRef.current = new BlinkTracker();

      livenessIntervalRef.current = setInterval(async () => {
        if (livenessAnalyzingRef.current || video.readyState < 2) return;
        livenessAnalyzingRef.current = true;
        try {
          const result = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
          if (result) {
            blinkTrackerRef.current?.update(averageEAR(result.landmarks));
            const yaw = estimateYawOffset(result.landmarks);
            send({
              type: "signal",
              payload: {
                kind: "liveness",
                blinkCount: blinkTrackerRef.current?.totalBlinks ?? 0,
                lookingAway: Math.abs(yaw) > LOOKED_AWAY_YAW_THRESHOLD,
                faceDetected: true,
              },
            });
          } else {
            send({
              type: "signal",
              payload: { kind: "liveness", blinkCount: blinkTrackerRef.current?.totalBlinks ?? 0, lookingAway: false, faceDetected: false },
            });
          }
        } catch {
          // one failed tick shouldn't stop the loop — just skip broadcasting this round
        } finally {
          livenessAnalyzingRef.current = false;
        }
      }, 800);
    },
    [send]
  );

  const createPeerConnection = useCallback(
    (remotePeerId: string) => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcsRef.current.set(remotePeerId, pc);
      updateParticipant(remotePeerId, { name: peerNamesRef.current.get(remotePeerId) ?? remotePeerId, connectionState: pc.connectionState });

      localStreamRef.current?.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStreamRef.current!);
        if (track.kind === "video") videoSendersRef.current.set(remotePeerId, sender);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: "ice-candidate", to: remotePeerId, payload: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        updateParticipant(remotePeerId, { stream: e.streams[0] ?? null });
        if (e.track.kind === "video") {
          // Real WebRTC signal for "is video actually arriving right now" —
          // fires on genuine network media-flow changes, not just on
          // whether a video track exists. Covers both the other side
          // deliberately going audio-only and their connection just
          // dropping the video stream outright.
          updateParticipant(remotePeerId, { videoActive: !e.track.muted });
          e.track.onmute = () => updateParticipant(remotePeerId, { videoActive: false });
          e.track.onunmute = () => updateParticipant(remotePeerId, { videoActive: true });
        }
      };
      pc.onconnectionstatechange = () => {
        updateParticipant(remotePeerId, { connectionState: pc.connectionState });
      };
      return pc;
    },
    [send, updateParticipant]
  );

  const join = useCallback(async () => {
    if (joiningRef.current || joined) return;
    joiningRef.current = true;
    setError(null);

    let stream: MediaStream;
    try {
      // Fetch TURN credentials alongside getUserMedia rather than after it —
      // independent, no reason to serialize them. fetchIceServers() never
      // rejects (falls back to STUN-only internally), so Promise.all here
      // can't fail because of it.
      const [gotStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
        fetchIceServers().then((servers) => {
          iceServersRef.current = servers;
        }),
      ]);
      stream = gotStream;
    } catch (e: any) {
      joiningRef.current = false;
      setError(describeGetUserMediaError(e?.name));
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    if (analyzeLiveness) startLivenessAnalysis(stream);
    if (transcribe) startTranscription();

    const peerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ws = new WebSocket(signalingUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", room: roomId, peerId, name: displayName }));
    };

    ws.onerror = () => setError("Couldn't reach the signaling server.");
    ws.onclose = () => {
      joiningRef.current = false;
    };

    ws.onmessage = async (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "joined") {
        joiningRef.current = false;
        setJoined(true);
        // We're the newer arrival — initiate offers to everyone already here.
        for (const p of msg.peers as { peerId: string; name: string }[]) {
          peerNamesRef.current.set(p.peerId, p.name);
          const pc = createPeerConnection(p.peerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: "offer", to: p.peerId, payload: offer });
        }
        return;
      }

      if (msg.type === "peer-joined") {
        peerNamesRef.current.set(msg.peerId, msg.name);
        updateParticipant(msg.peerId, { name: msg.name });
        return; // the new peer initiates the offer; we just wait for it
      }

      if (msg.type === "peer-left") {
        removeParticipant(msg.peerId);
        return;
      }

      if (msg.type === "offer") {
        const pc = pcsRef.current.get(msg.from) ?? createPeerConnection(msg.from);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "answer", to: msg.from, payload: answer });
        return;
      }

      if (msg.type === "answer") {
        await pcsRef.current.get(msg.from)?.setRemoteDescription(new RTCSessionDescription(msg.payload));
        return;
      }

      if (msg.type === "ice-candidate") {
        await pcsRef.current.get(msg.from)?.addIceCandidate(new RTCIceCandidate(msg.payload));
        return;
      }

      if (msg.type === "signal" && msg.payload?.kind === "liveness") {
        updateParticipant(msg.from, {
          liveSignal: {
            blinkCount: Number(msg.payload.blinkCount) || 0,
            lookingAway: Boolean(msg.payload.lookingAway),
            faceDetected: Boolean(msg.payload.faceDetected),
            updatedAt: Date.now(),
          },
        });
        return;
      }

      if (msg.type === "signal" && msg.payload?.kind === "transcript") {
        // Only append what OTHER participants broadcast — this side's own
        // segments are already appended locally the moment recognition
        // produces them (startTranscription above), so appending again here
        // would duplicate every one of this side's own lines.
        const speakerName = typeof msg.payload.speakerName === "string" ? msg.payload.speakerName : "Unknown";
        const text = typeof msg.payload.text === "string" ? msg.payload.text : "";
        if (text) setTranscriptSegments((prev) => [...prev, { speakerName, text, at: Date.now() }]);
        return;
      }

      if (msg.type === "room-full") {
        joiningRef.current = false;
        setError("This call already has the maximum number of participants.");
        return;
      }

      if (msg.type === "error") {
        setError(typeof msg.message === "string" ? msg.message : "Signaling error.");
        return;
      }
    };
  }, [signalingUrl, roomId, displayName, joined, analyzeLiveness, startLivenessAnalysis, transcribe, startTranscription, createPeerConnection, send, updateParticipant, removeParticipant]);

  const leave = useCallback(() => {
    send({ type: "leave" });
    wsRef.current?.close();
    wsRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    videoSendersRef.current.clear();
    peerNamesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    joiningRef.current = false;
    if (qualityIntervalRef.current) {
      clearInterval(qualityIntervalRef.current);
      qualityIntervalRef.current = null;
    }
    stopLivenessAnalysis();
    stopTranscription();
    setLocalStream(null);
    setParticipants(new Map());
    setJoined(false);
    setAudioOnlyState(false);
    setConnectionQuality("unknown");
  }, [send, stopLivenessAnalysis, stopTranscription]);

  // Leave the call if the component unmounts while still connected — a
  // borrower/underwriter navigating away shouldn't leave a dangling peer.
  useEffect(() => {
    return () => {
      leave();
    };
  }, [leave]);

  const toggleMic = useCallback((enabled: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }, []);
  const toggleCamera = useCallback((enabled: boolean) => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }, []);

  /**
   * The actual low-bandwidth fallback: replaceTrack(null) on every peer's
   * video sender stops sending video RTP entirely (not the same as
   * toggleCamera's track.enabled=false, which still sends — typically
   * black — video frames and keeps costing upload bandwidth). No
   * renegotiation needed; replaceTrack keeps the same transceiver. Audio
   * keeps flowing unaffected. Reversible — flipping back re-attaches the
   * original video track to every sender.
   */
  const setAudioOnly = useCallback((enabled: boolean) => {
    setAudioOnlyState(enabled);
    const videoTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    videoSendersRef.current.forEach((sender) => {
      sender.replaceTrack(enabled ? null : videoTrack).catch(() => {});
    });
  }, []);

  // Best-effort connection-quality polling (see assessPeerQuality above) —
  // advisory only. Surfaces a "your connection looks weak" suggestion in
  // the UI; never switches anyone to audio-only automatically.
  useEffect(() => {
    if (!joined) return;
    qualityIntervalRef.current = setInterval(async () => {
      const pcs = Array.from(pcsRef.current.values());
      if (pcs.length === 0) {
        setConnectionQuality("unknown");
        return;
      }
      const results = await Promise.all(pcs.map(assessPeerQuality));
      setConnectionQuality(results.some((q) => q === "weak") ? "weak" : results.every((q) => q === "unknown") ? "unknown" : "good");
    }, QUALITY_POLL_MS);
    return () => {
      if (qualityIntervalRef.current) clearInterval(qualityIntervalRef.current);
    };
  }, [joined]);

  return {
    joined,
    localStream,
    participants: Array.from(participants.values()),
    error,
    audioOnly,
    connectionQuality,
    transcriptSegments,
    join,
    leave,
    toggleMic,
    toggleCamera,
    setAudioOnly,
  };
}
