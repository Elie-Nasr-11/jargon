import { useEffect, useRef, useState } from "react";
import { Pause, RotateCcw, Volume2 } from "lucide-react";
import { getMentorAudio } from "@/lib/api";
import { stripMarkdown } from "@/lib/format";
import type { VoiceSettings } from "@/lib/jargon-store";
import type { VoiceInteractionEvent } from "@/lib/types";

// The read-aloud (TTS) control: play/pause + replay. Fetches server audio and falls back to the
// browser's speechSynthesis on failure. Extracted from chat.tsx so any text surface can offer it
// (mentor bubbles, teacher comments, quiz questions).

export function ReadAloudAction({
  text,
  voice,
  accessToken,
  lessonId,
  sessionId,
  onVoiceEvent,
}: {
  text: string;
  voice: VoiceSettings;
  accessToken: string;
  lessonId: string;
  sessionId: string | null;
  onVoiceEvent: (event: VoiceInteractionEvent) => void | Promise<void>;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fallbackSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (fallbackUtteranceRef.current && fallbackSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [fallbackSupported]);

  if (!text.trim()) return null;

  // Speak clean prose: markdown marks would be read out literally ("asterisk asterisk").
  const speechText = stripMarkdown(text);

  const finish = () => {
    setSpeaking(false);
    setPaused(false);
    void onVoiceEvent({
      event_type: "read_aloud_finished",
      duration_seconds: startedAtRef.current
        ? Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000))
        : null,
    });
    audioRef.current = null;
    fallbackUtteranceRef.current = null;
    startedAtRef.current = null;
  };

  const playFallback = () => {
    if (!fallbackSupported) throw new Error("Browser speech is not available.");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.rate = voice.readAloudRate;
    utterance.onend = finish;
    utterance.onerror = finish;
    fallbackUtteranceRef.current = utterance;
    startedAtRef.current = Date.now();
    setSpeaking(true);
    setPaused(false);
    void onVoiceEvent({ event_type: "read_aloud_started" });
    window.speechSynthesis.speak(utterance);
  };

  const play = async () => {
    if (speaking && paused) {
      if (audioRef.current) {
        await audioRef.current.play();
      } else if (fallbackSupported) {
        window.speechSynthesis.resume();
      }
      setPaused(false);
      return;
    }
    audioRef.current?.pause();
    if (fallbackSupported) window.speechSynthesis.cancel();
    setLoading(true);
    try {
      const audio = await getMentorAudio({
        accessToken,
        text: speechText,
        lessonId,
        sessionId,
        voice: voice.voiceName,
        rate: voice.readAloudRate,
      });
      const element = new Audio(audio.audio_url);
      element.playbackRate = voice.readAloudRate;
      element.onended = finish;
      element.onerror = finish;
      audioRef.current = element;
      startedAtRef.current = Date.now();
      setSpeaking(true);
      setPaused(false);
      void onVoiceEvent({
        event_type: "read_aloud_started",
        payload: {
          provider: "openai",
          model: audio.model,
          voice: audio.voice,
          cache_hit: audio.cache_hit,
        },
      });
      await element.play();
    } catch {
      void onVoiceEvent({ event_type: "read_aloud_failed" });
      try {
        playFallback();
      } catch {
        finish();
      }
    } finally {
      setLoading(false);
    }
  };

  const pause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    } else if (fallbackSupported) {
      window.speechSynthesis.pause();
    }
    setPaused(true);
  };

  const replay = () => {
    audioRef.current?.pause();
    if (fallbackSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
    requestAnimationFrame(() => void play());
  };

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-1">
      <button
        type="button"
        onClick={speaking && !paused ? pause : () => void play()}
        aria-label={speaking && !paused ? "Pause read aloud" : "Read this aloud"}
        title={speaking && !paused ? "Pause" : "Read aloud"}
        disabled={loading}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {loading ? (
          <span className="run-bounce-loader scale-75" aria-label="Preparing audio">
            <span className="run-bounce-dot" />
            <span className="run-bounce-dot" />
            <span className="run-bounce-dot" />
          </span>
        ) : speaking && !paused ? (
          <Pause className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <Volume2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </button>
      <button
        type="button"
        onClick={replay}
        aria-label="Replay"
        title="Replay"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </span>
  );
}
