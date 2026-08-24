"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LangCode } from "@/types";
import { SPEECH_LOCALE } from "@/lib/i18n";

/**
 * Real ASR/TTS for the local prototype, via the browser's Web Speech API
 * (SpeechRecognition + SpeechSynthesis) — best supported in Chrome/Edge.
 *
 * This intentionally sits behind the same shape the production ASR/TTS
 * integration will use (FIN-HLD-VIDEOPD-2.0 Section 8: Bhashini / Azure
 * Speech / Google Cloud Speech, gated by the FSD Section 5.5 acceptance
 * thresholds). Swapping the implementation inside this file is the whole
 * migration — callers only ever see `useSpeech()`.
 */

interface UseSpeechOptions {
  lang: LangCode;
  onResult?: (transcript: string, isFinal: boolean) => void;
}

// Maps the Web Speech API's terse error codes to a message a borrower can act on.
function describeSpeechError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Please allow microphone permission and try again.";
    case "no-speech":
      return "I didn't hear anything. Please try again.";
    case "audio-capture":
      return "No microphone was found on this device.";
    case "network":
      return "A network issue interrupted voice recognition. Please try again.";
    default:
      return "Voice input isn't working right now — please type instead.";
  }
}

export function useSpeech({ lang, onResult }: UseSpeechOptions) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  // Chunks the recognizer has already settled on as final within the
  // current listening session (see startListening's continuous: true below)
  // — accumulated across any pauses, only ever joined and reported once the
  // session actually ends, not per-chunk.
  const finalChunksRef = useRef<string[]>([]);

  useEffect(() => {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    setSupported(Boolean(SpeechRecognitionCtor));
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SpeechRecognitionCtor) {
      setSupported(false);
      return;
    }

    setError(null);
    finalChunksRef.current = [];
    const recognition: SpeechRecognition = new SpeechRecognitionCtor();
    recognition.lang = SPEECH_LOCALE[lang];
    recognition.interimResults = true;
    // continuous: true — was false, which made the browser treat ANY brief
    // pause mid-sentence as "end of speech" and tear the whole recognition
    // session down, forcing a re-click of the mic to keep going. Reported
    // live: "getting disconnected if there is a little pause between words,
    // need to click on mic multiple times." continuous keeps the session
    // alive across pauses — the recognizer still settles on individual
    // final phrases as it goes (each pause can still produce its own
    // isFinal chunk), so those are accumulated in finalChunksRef rather
    // than reported one-by-one; the combined text only gets reported once
    // via onend below, so one mic press still produces one complete answer,
    // however many pauses were in it.
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalChunksRef.current.push(res[0].transcript);
        else interim += res[0].transcript;
      }
      const settledSoFar = finalChunksRef.current.join(" ");
      const combined = [settledSoFar, interim].filter(Boolean).join(" ");
      setInterimTranscript(combined);
      if (combined) onResultRef.current?.(combined, false);
    };

    recognition.onerror = (event: any) => {
      // "no-speech" fires routinely now that a session can sit through a
      // real pause waiting for more speech, and "aborted" fires on every
      // explicit stopListening() call below — neither is a real error to
      // surface; onend always fires right after either one and finalizes
      // whatever was actually captured.
      if (event?.error !== "no-speech" && event?.error !== "aborted") {
        setError(describeSpeechError(event?.error ?? "unknown"));
      }
    };
    recognition.onend = () => {
      setListening(false);
      const finalText = finalChunksRef.current.join(" ").trim();
      finalChunksRef.current = [];
      setInterimTranscript("");
      if (finalText) onResultRef.current?.(finalText, true);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError(describeSpeechError("unknown"));
      setListening(false);
    }
  }, [lang]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH_LOCALE[lang];
      utterance.rate = 0.95; // slightly slower default rate — Tuning Guide Section 6.5
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang === SPEECH_LOCALE[lang]);
      if (match) utterance.voice = match;
      window.speechSynthesis.speak(utterance);
    },
    [lang]
  );

  const cancelSpeaking = useCallback(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  return { listening, supported, interimTranscript, error, startListening, stopListening, speak, cancelSpeaking };
}
