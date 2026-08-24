"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, Sparkles, User, Volume2, VolumeX, PhoneCall, MicOff, AlertTriangle } from "lucide-react";
import { useSpeech } from "@/lib/speech";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { LangCode, ChatMessage, SegmentCode } from "@/types";

interface PendingConfirm {
  fieldKey: string;
  value: string | number;
  displayValue: string;
}

export function ChatPanel({
  applicationId,
  lang,
  segment,
  activeFieldKey,
  activeFieldLabel,
  onFieldUpdate,
  className,
}: {
  applicationId: string;
  lang: LangCode;
  segment?: SegmentCode | null;
  activeFieldKey: string | null;
  activeFieldLabel: string | null;
  onFieldUpdate: (key: string, value: string | number) => void;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [missCount, setMissCount] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);

  const { listening, supported, interimTranscript, error: micError, startListening, stopListening, speak } = useSpeech({
    lang,
    onResult: (text, isFinal) => {
      if (isFinal && text) {
        setInput("");
        void sendMessage(text, "voice");
      }
    },
  });

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    const greeting = t(lang, "chatGreeting", { lang: lang.toUpperCase() });
    pushMessage("assistant", greeting, "text");
    if (voiceOn) speak(greeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, interimTranscript]);

  function pushMessage(role: "user" | "assistant", text: string, channel: "voice" | "text") {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, role, text, channel, createdAt: new Date().toISOString() },
    ]);
  }

  async function sendMessage(text: string, channel: "voice" | "text") {
    if (!text.trim() || sending) return;
    pushMessage("user", text, channel);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          language: lang,
          channel,
          userText: text,
          segment: segment ?? null,
          pendingFieldKey: pendingConfirm ? null : activeFieldKey,
          awaitingConfirmField: pendingConfirm?.fieldKey ?? null,
          awaitingConfirmValue: pendingConfirm?.value ?? null,
          awaitingConfirmDisplay: pendingConfirm?.displayValue ?? null,
        }),
      });
      const data = await res.json();
      pushMessage("assistant", data.assistantText, "text");
      if (voiceOn) speak(data.assistantText);

      if (data.fieldUpdate) {
        onFieldUpdate(data.fieldUpdate.key, data.fieldUpdate.value);
        setPendingConfirm(null);
        setMissCount(0);
      } else if (data.requiresConfirmation) {
        setPendingConfirm(data.requiresConfirmation);
      } else if (data.escalate) {
        setMissCount((c) => c + 1);
      } else {
        setPendingConfirm(null);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-lift dark:border-ink-800 dark:bg-ink-900", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-100 bg-gradient-to-r from-ink-900 to-ink-800 px-4 py-3.5 dark:border-ink-800">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sprout-400 to-sprout-600 text-white">
            <Sparkles className="h-4.5 w-4.5" />
            {listening && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse-ring rounded-full bg-sprout-400" />
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-white">Lakshya Assistant</p>
            <p className="text-[11px] font-medium text-ink-300">
              {activeFieldLabel ? `Asking: ${activeFieldLabel}` : "Ready to help"}
            </p>
          </div>
        </div>
        <button
          onClick={() => setVoiceOn((v) => !v)}
          className="rounded-full p-2 text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Toggle voice replies"
        >
          {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {interimTranscript && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-md bg-sprout-100 px-3.5 py-2 text-sm italic text-sprout-700 dark:bg-sprout-900/30 dark:text-sprout-300">
              {interimTranscript}…
            </div>
          </div>
        )}
        {sending && (
          <div className="flex items-center gap-1.5 pl-1">
            <Dot delay={0} />
            <Dot delay={0.15} />
            <Dot delay={0.3} />
          </div>
        )}
        {missCount >= 2 && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
          >
            <PhoneCall className="h-3.5 w-3.5" />
            {t(lang, "chatEscalate")}
          </motion.button>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-ink-100 p-3 dark:border-ink-800">
        {!supported && (
          <p className="mb-2 text-center text-[11px] font-medium text-ink-400">{t(lang, "chatMicNotSupported")}</p>
        )}
        <AnimatePresence>
          {supported && micError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-2 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {micError}
            </motion.p>
          )}
        </AnimatePresence>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const val = input;
            setInput("");
            void sendMessage(val, "text");
          }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            disabled={!supported}
            onClick={() => (listening ? stopListening() : startListening())}
            className={cn(
              "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors disabled:opacity-30",
              listening
                ? "bg-red-500 text-white"
                : "bg-ink-100 text-ink-600 hover:bg-sprout-100 hover:text-sprout-700 dark:bg-ink-800 dark:text-ink-300"
            )}
            aria-label="Toggle microphone"
          >
            {listening ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
            {listening && (
              <span className="absolute -inset-1 -z-10 animate-pulse-ring rounded-2xl bg-red-400" />
            )}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? t(lang, "chatListening") : t(lang, "chatPlaceholder")}
            className="h-11 flex-1 rounded-2xl border-2 border-ink-100 bg-ink-50/50 px-4 text-sm outline-none transition-colors focus:border-sprout-400 focus:bg-white dark:border-ink-700 dark:bg-ink-800/50 dark:text-white dark:focus:border-sprout-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink-900 text-white transition-transform active:scale-90 disabled:opacity-30 dark:bg-white dark:text-ink-900"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-end gap-2", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sprout-400 to-sprout-600 text-white">
          <Sparkles className="h-3 w-3" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "rounded-br-md bg-ink-900 text-white dark:bg-white dark:text-ink-900"
            : "rounded-bl-md bg-ink-50 text-ink-800 dark:bg-ink-800 dark:text-ink-100"
        )}
      >
        {message.text}
      </div>
      {isUser && (
        <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-300">
          <User className="h-3 w-3" />
        </div>
      )}
    </motion.div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="h-1.5 w-1.5 rounded-full bg-ink-300 dark:bg-ink-600"
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ repeat: Infinity, duration: 1, delay }}
    />
  );
}
