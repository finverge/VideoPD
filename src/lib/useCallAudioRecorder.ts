"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Tier 1 live-call voice biometrics — records ONLY this participant's own
 * outgoing audio during a live call (never the remote participant's, never
 * video), so it can be analyzed after the call the same way the guided-flow
 * VIDEOPD_LIVENESS/VIDEOPD_BUSINESS_VERIFICATION clips already are (see
 * voice-service/README.md). Deliberately audio-only, not video — the voice
 * check only ever needs audio, so recording video too would just be
 * capturing more of the borrower than the feature actually uses.
 *
 * This is separate from useCallRoom itself (which never records anything —
 * see its own doc comment) so the call machinery stays "genuinely real-time
 * only" by default; a caller has to explicitly opt in by using this hook
 * and wiring startRecording/stopAndGetBlob around the call lifecycle, same
 * as LiveCallRoom's recordForVoiceCheck prop does.
 *
 * No consent logic lives here — that's a UI concern (see LiveCallRoom's
 * consent gate before join). This hook just does the actual recording once
 * the caller decides it's allowed to.
 */

function pickAudioMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "audio/webm";
}

export function useCallAudioRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");

  /** Starts recording this stream's audio tracks only. Safe to call once
   * per call session (e.g. when `localStream` first appears after join) —
   * calling it again while already recording is a no-op. */
  const startRecording = useCallback((stream: MediaStream) => {
    if (recorderRef.current) return; // already recording this session
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return; // mic denied/unavailable — nothing to record

    const audioOnlyStream = new MediaStream(audioTracks);
    const mimeType = pickAudioMimeType();
    mimeTypeRef.current = mimeType;
    chunksRef.current = [];

    const recorder = new MediaRecorder(audioOnlyStream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(1000); // 1s timeslice so a crash/abrupt stop still leaves most of the audio in chunksRef
    recorderRef.current = recorder;
  }, []);

  /** Stops recording (if active) and resolves with the finished Blob, or
   * null if nothing was ever recorded (mic never available, or
   * startRecording was never called). Safe to call multiple times — later
   * calls just resolve null once already stopped. */
  const stopAndGetBlob = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      recorderRef.current = null;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: mimeTypeRef.current }) : null;
        chunksRef.current = [];
        recorderRef.current = null;
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  // Safety net: if the component unmounts while still recording (borrower
  // navigates away mid-call rather than clicking Leave), stop the recorder
  // so it isn't left dangling — the in-progress blob is discarded, not
  // uploaded, since there's no controlled "call ended" moment to hang the
  // upload off of here.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
  }, []);

  return { startRecording, stopAndGetBlob };
}
