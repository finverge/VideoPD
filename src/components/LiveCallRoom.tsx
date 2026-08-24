"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, PhoneCall, Loader2, AlertTriangle, Users, WifiOff, Headphones, Eye, EyeOff, Captions } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallRoom, type CallParticipant } from "@/lib/useCallRoom";
import { Button } from "@/components/ui/Button";
import type { LangCode } from "@/types";

// Same self-hosted signaling server for both the borrower and underwriter
// side of a call — see server/signaling-server.ts and src/lib/useCallRoom.ts
// for what it actually does and its honest STUN-only limitation. Defaults
// to the local dev signaling server; override via NEXT_PUBLIC_SIGNALING_URL
// for any other deployment.
const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "ws://localhost:4001";

/** Drop-in live video call panel — pass the same roomId on both the
 * borrower's VideoPD page and the underwriter's case page (this app keys it
 * off the VideoPD session token) and whoever opens it second connects to
 * whoever opened it first. No recording, no server-side media handling —
 * genuinely real-time only. */
export function LiveCallRoom({
  roomId,
  displayName,
  analyzeLiveness = false,
  transcribe = false,
  lang = "en",
}: {
  roomId: string;
  displayName: string;
  /** Pass true only on the instance being monitored (the borrower's own
   * call) — runs real blink/gaze detection on this participant's own
   * outgoing video and broadcasts it to everyone else in the room as a live
   * indicator. See useCallRoom's own doc comment for the full explanation. */
  analyzeLiveness?: boolean;
  /** Real-time transcription of this participant's own speech (Web Speech
   * API — see useCallRoom's own doc comment). Safe to enable on every
   * instance in a call; each side only ever transcribes its own mic. */
  transcribe?: boolean;
  lang?: LangCode;
}) {
  const {
    joined, localStream, participants, error, audioOnly, connectionQuality, transcriptSegments,
    join, leave, toggleMic, toggleCamera, setAudioOnly,
  } = useCallRoom({
    signalingUrl: SIGNALING_URL,
    roomId,
    displayName,
    analyzeLiveness,
    transcribe,
    lang,
  });
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [joining, setJoining] = useState(false);
  const transcriptListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptListRef.current?.scrollTo({ top: transcriptListRef.current.scrollHeight, behavior: "smooth" });
  }, [transcriptSegments]);

  async function handleJoin() {
    setJoining(true);
    await join();
    setJoining(false);
  }

  if (!joined) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-ink-200 p-6 text-center dark:border-ink-700">
        <Users className="h-8 w-8 text-ink-300 dark:text-ink-600" />
        <p className="max-w-xs text-sm text-ink-500 dark:text-ink-400">
          Join a real, live video call — not a recording. Both sides need to open this to connect.
        </p>
        {error && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
        <Button onClick={handleJoin} disabled={joining} icon={joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}>
          {joining ? "Connecting…" : "Join live call"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <VideoTile stream={audioOnly ? null : localStream} label={`${displayName} (you)`} muted mirrored audioOnly={audioOnly} />
        {participants.map((p) => (
          <VideoTile key={p.peerId} stream={p.stream} label={p.name} connectionState={p.connectionState} audioOnly={!p.videoActive} liveSignal={p.liveSignal} />
        ))}
        {participants.length === 0 && (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-ink-50 p-3 text-center text-xs text-ink-400 dark:bg-ink-800/40">
            Waiting for the other participant to join…
          </div>
        )}
      </div>

      {/* Live transcript — real speech-to-text (Web Speech API) from each
          participant's own instance, broadcast to everyone in the room and
          persisted per-segment (see useCallRoom's transcribe option). Only
          shown when at least one side actually has it on — an empty,
          permanently-blank panel would just be confusing chrome. */}
      {transcribe && (
        <div className="rounded-xl border border-ink-100 bg-ink-50/50 dark:border-ink-800 dark:bg-ink-800/30">
          <div className="flex items-center gap-1.5 border-b border-ink-100 px-3 py-1.5 dark:border-ink-800">
            <Captions className="h-3.5 w-3.5 text-ink-400" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Live transcript</p>
          </div>
          <div ref={transcriptListRef} className="max-h-32 space-y-1 overflow-y-auto px-3 py-2">
            {transcriptSegments.length === 0 ? (
              <p className="text-xs italic text-ink-400">Nothing transcribed yet — starts as soon as someone speaks.</p>
            ) : (
              transcriptSegments.map((s, i) => (
                <p key={i} className="text-xs leading-relaxed text-ink-700 dark:text-ink-300">
                  <span className="font-semibold text-ink-500 dark:text-ink-400">{s.speakerName}:</span> {s.text}
                </p>
              ))
            )}
          </div>
        </div>
      )}

      {/* Real, measured signal (RTCPeerConnection.getStats() — packet loss /
          round-trip time), not a guess — but advisory only, same as every
          other check in this app: it suggests, the participant decides. */}
      {connectionQuality === "weak" && !audioOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/20">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <WifiOff className="h-3.5 w-3.5 shrink-0" /> Your connection looks weak — video may be choppy.
          </p>
          <button
            onClick={() => setAudioOnly(true)}
            className="shrink-0 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
          >
            Switch to audio-only
          </button>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex items-center justify-center gap-3">
        <ControlButton
          active={micOn}
          onClick={() => {
            const next = !micOn;
            setMicOn(next);
            toggleMic(next);
          }}
          icon={micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          label={micOn ? "Mute" : "Unmute"}
        />
        <ControlButton
          active={camOn && !audioOnly}
          disabled={audioOnly}
          onClick={() => {
            const next = !camOn;
            setCamOn(next);
            toggleCamera(next);
          }}
          icon={camOn && !audioOnly ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          label={camOn ? "Stop video" : "Start video"}
        />
        <button
          onClick={() => setAudioOnly(!audioOnly)}
          aria-label={audioOnly ? "Turn video back on" : "Switch to audio-only (saves bandwidth)"}
          title={audioOnly ? "Turn video back on" : "Switch to audio-only (saves bandwidth)"}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors",
            audioOnly
              ? "border-sprout-300 bg-sprout-50 text-sprout-700 dark:border-sprout-800 dark:bg-sprout-950/30 dark:text-sprout-400"
              : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
          )}
        >
          <Headphones className="h-4 w-4" />
        </button>
        <button
          onClick={leave}
          className="flex h-11 items-center gap-1.5 rounded-full bg-red-500 px-4 text-sm font-semibold text-white hover:bg-red-600"
          aria-label="Leave call"
        >
          <PhoneOff className="h-4 w-4" /> Leave call
        </button>
      </div>
      {audioOnly && (
        <p className="text-center text-[11px] text-ink-400">Audio-only mode — your video isn't being sent to save bandwidth.</p>
      )}
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-ink-200 bg-white text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
          : "border-red-200 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
      )}
    >
      {icon}
    </button>
  );
}

function VideoTile({
  stream,
  label,
  muted,
  mirrored,
  connectionState,
  audioOnly,
  liveSignal,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirrored?: boolean;
  connectionState?: CallParticipant["connectionState"];
  /** True when this participant's video isn't currently flowing — either
   * they deliberately switched to audio-only, or (for a remote participant)
   * their own connection dropped the video track outright. Either way,
   * show a clear audio-only placeholder rather than a frozen/black frame. */
  audioOnly?: boolean;
  /** Live blink/gaze signal this participant is broadcasting about
   * themselves (see useCallRoom's analyzeLiveness option) — real detection,
   * running continuously during the call, not the async Step 1 clip. */
  liveSignal?: CallParticipant["liveSignal"];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const connecting = connectionState && connectionState !== "connected";

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-ink-900">
      {audioOnly ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-ink-800">
          <Headphones className="h-6 w-6 text-white/50" />
          <span className="text-[10px] font-medium text-white/50">Audio only</span>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted={muted} className={cn("h-full w-full object-cover", mirrored && "-scale-x-100")} />
          {!stream && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-white/60" />
            </div>
          )}
        </>
      )}
      {liveSignal && (
        <div
          className={cn(
            "absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white",
            !liveSignal.faceDetected ? "bg-ink-600/80" : liveSignal.lookingAway ? "bg-amber-500/90" : "bg-sprout-500/90"
          )}
        >
          {!liveSignal.faceDetected ? (
            <>
              <EyeOff className="h-3 w-3" /> No face
            </>
          ) : liveSignal.lookingAway ? (
            <>
              <EyeOff className="h-3 w-3" /> Looking away
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" /> {liveSignal.blinkCount}
            </>
          )}
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white">
        {label}
        {connecting ? ` · ${connectionState}` : ""}
      </div>
    </div>
  );
}
