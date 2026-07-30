import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Square } from "lucide-react";
import { createRealtimeVoiceSession } from "@/lib/api";
import type { VoiceSettings } from "@/lib/jargon-store";
import type { TypedChatEnvelope, VoiceInteractionEvent } from "@/lib/types";

// Live voice for the v6 student surface — ported whole from the retired /chat route's
// RealtimeVoicePanel (6f00e2a^). A WebRTC session to the realtime voice model: the student's
// mic streams up, the mentor's voice streams back, and the model calls a submit_voice_turn tool
// whose transcript is posted through the NORMAL turn loop (onSubmitVoiceTurn) — so a spoken
// answer is graded by exactly the same server path as a typed one, and raw audio is never
// stored (the transcript + modality metadata is the record; see OPEN_QUESTIONS voice policy).

// Live voice needs WebRTC + mic capture — on browsers without them (locked-down school
// profiles) the toggle must simply not render, not error on tap. Kept module-private so this
// file exports only components (react-refresh); the mount site (ChatWindow) runs the same check.
function voiceSupported(): boolean {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

type RealtimeEvent = Record<string, unknown> & {
  type?: string;
  item?: Record<string, unknown>;
  response?: Record<string, unknown>;
  transcript?: string;
  arguments?: string;
  call_id?: string;
  name?: string;
};

export type VoicePanelProps = {
  accessToken: string;
  lessonId: string;
  sessionId: string | null;
  voice: VoiceSettings;
  autoStart?: boolean;
  onClose?: () => void;
  onVoiceEvent: (event: VoiceInteractionEvent) => void | Promise<void>;
  onSubmitVoiceTurn: (
    text: string,
    confidence?: number | null,
  ) => Promise<TypedChatEnvelope | null | "busy">;
};

export function VoicePanel({
  accessToken,
  lessonId,
  sessionId,
  voice,
  autoStart,
  onClose,
  onVoiceEvent,
  onSubmitVoiceTurn,
}: VoicePanelProps) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [message, setMessage] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const submittedCallIdsRef = useRef<Set<string>>(new Set());
  // In-flight + last-utterance guards: the realtime model can re-call the tool with the same
  // transcript under a fresh call id, and overlapping submissions must never race.
  const turnInFlightRef = useRef(false);
  const lastSubmittedRef = useRef<{ text: string; at: number; reply: string } | null>(null);
  const startedRef = useRef(false);
  // Mirror `status` into a ref so event-handler closures (data-channel close, connect timeout)
  // read the live value instead of the stale one captured at handler-creation time.
  const statusRef = useRef<"idle" | "connecting" | "live" | "error">("idle");
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supported = voiceSupported();

  const stop = useCallback(
    (nextMessage = "Live voice stopped.") => {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      channelRef.current?.close();
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
        audioRef.current.remove();
      }
      channelRef.current = null;
      pcRef.current = null;
      streamRef.current = null;
      audioRef.current = null;
      submittedCallIdsRef.current.clear();
      setStatus("idle");
      setMessage(nextMessage);
      void onVoiceEvent({ event_type: "voice_session_ended", input_modality: "audio_session" });
    },
    [onVoiceEvent],
  );

  // Keep the status ref in sync for closures that outlive a render.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Unmount = full teardown. The mount site unmounts this panel whenever the composer goes
  // away (hold, lesson switch), and the mic must never stay hot with no reachable controls.
  useEffect(() => {
    return () => {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      channelRef.current?.close();
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
        audioRef.current.remove();
      }
    };
  }, []);

  const sendToolResult = (callId: string, output: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  };

  const submitRealtimeTurn = async (callId: string, args: Record<string, unknown>) => {
    if (submittedCallIdsRef.current.has(callId)) return;
    const text =
      typeof args.text === "string" && args.text.trim()
        ? args.text.trim()
        : typeof args.transcript === "string"
          ? args.transcript.trim()
          : lastTranscript.trim();
    const confidence = typeof args.confidence === "number" ? args.confidence : null;
    if (!text) {
      // Do NOT mark the call as submitted — a later completed call with the same id must still run.
      sendToolResult(callId, {
        status: "error",
        reply: "I did not catch that. Please say it one more time.",
      });
      return;
    }
    // Dedup beyond call ids: the realtime model can re-invoke the tool with the SAME
    // transcript under a NEW call id (each tool result prompts another response). The window
    // is deliberately SHORT — a model re-call lands within ~1-2s of the tool result, while a
    // student legitimately repeating the same short answer ("b", "yes") for the NEXT question
    // can't arrive that fast (the mentor hasn't finished speaking the reply). A longer window
    // would swallow real answers.
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]+/gu, "")
      .replace(/\s+/g, " ");
    const last = lastSubmittedRef.current;
    if (last && normalized && last.text === normalized && Date.now() - last.at < 3_000) {
      submittedCallIdsRef.current.add(callId);
      sendToolResult(callId, { status: "ok", reply: last.reply });
      return;
    }
    if (turnInFlightRef.current) {
      // Don't mark submitted — the model may retry once the in-flight turn resolves.
      sendToolResult(callId, {
        status: "error",
        reply: "One moment — I'm still checking your previous answer.",
      });
      return;
    }
    submittedCallIdsRef.current.add(callId);
    turnInFlightRef.current = true;
    setLastTranscript(text);
    setMessage("Sending your spoken answer to Jargon…");
    void onVoiceEvent({
      event_type: "voice_turn_submitted",
      input_modality: "audio_session",
      transcript: text,
      transcript_confidence: confidence,
    });
    try {
      const envelope = await onSubmitVoiceTurn(text, confidence);
      if (envelope === "busy") {
        // A typed/choice turn was in flight on the page — same handling as the local
        // in-flight gate; un-mark the call so a retry can go through.
        submittedCallIdsRef.current.delete(callId);
        sendToolResult(callId, {
          status: "error",
          reply: "One moment — I'm still checking your previous answer.",
        });
        return;
      }
      if (envelope) {
        lastSubmittedRef.current = {
          text: normalized,
          at: Date.now(),
          reply: envelope.reply || "",
        };
      }
      void onVoiceEvent({
        event_type: "voice_tool_result",
        input_modality: "audio_session",
        payload: {
          status: envelope?.status || "error",
          stage: envelope?.stage || null,
          next_action: envelope?.next_action || null,
        },
      });
      sendToolResult(callId, {
        status: envelope?.status || "error",
        reply: envelope?.reply || "The Mentor could not answer that yet.",
        stage: envelope?.stage || null,
        next_action: envelope?.next_action || null,
        choices: envelope?.choices || [],
      });
      setMessage("Live voice is listening.");
    } finally {
      turnInFlightRef.current = false;
    }
  };

  const maybeHandleFunctionCall = (event: RealtimeEvent) => {
    const candidates = [
      event.item,
      event.response && Array.isArray(event.response.output)
        ? (event.response.output as Record<string, unknown>[]).find(
            (item) => item?.type === "function_call",
          )
        : null,
      event,
    ].filter(Boolean) as Record<string, unknown>[];

    for (const item of candidates) {
      const itemType = String(item.type || "");
      const name = String(item.name || "");
      const callId = String(item.call_id || item.callId || "");
      const rawArgs = item.arguments;
      const itemStatus = String(item.status || "");
      if (name !== "submit_voice_turn" || !callId) continue;
      // Only act on a COMPLETED call with fully-buffered arguments. The streaming shapes
      // (response.output_item.added / .delta) carry an absent or empty/partial `arguments`
      // string; firing on those would submit an empty turn AND lock the callId so the real
      // completed call is then ignored.
      if (typeof rawArgs !== "string" || rawArgs.trim() === "") continue;
      if (itemType === "function_call" && itemStatus && itemStatus !== "completed") continue;
      try {
        void submitRealtimeTurn(callId, JSON.parse(rawArgs) as Record<string, unknown>);
      } catch {
        void submitRealtimeTurn(callId, { text: lastTranscript });
      }
      return;
    }
  };

  const handleRealtimeEvent = (event: RealtimeEvent) => {
    if (event.type === "session.created") {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      setStatus("live");
      setMessage("Live voice is listening.");
      void onVoiceEvent({ event_type: "voice_session_ready", input_modality: "audio_session" });
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string"
    ) {
      setLastTranscript(event.transcript);
    }
    maybeHandleFunctionCall(event);
  };

  const start = async () => {
    if (!supported) {
      setStatus("error");
      setMessage("Live voice is not available in this browser.");
      return;
    }
    setStatus("connecting");
    setMessage("Opening microphone…");
    void onVoiceEvent({ event_type: "voice_session_started", input_modality: "audio_session" });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const pc = new RTCPeerConnection({
        // A public STUN server helps ICE traverse mobile-carrier NAT; harmless when the
        // realtime endpoint already offers a directly-reachable candidate.
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      // Remote Mentor audio. iOS Safari (WebKit) will NOT play a WebRTC MediaStream from a
      // detached element via the `autoplay` attribute — the element must be in the DOM,
      // marked playsInline, and have .play() called (which succeeds here because start() runs
      // inside the user's tap gesture). Mirrors the working read-aloud path.
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioRef.current = audio;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        void audio.play().catch(() => {
          // Autoplay can still be blocked in rare cases; the session is otherwise live.
        });
      };
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      // Drive "live" off the actual transport state (robust regardless of the app-layer
      // session.created event name), and recover from a failed/lost connection instead of
      // sitting on "connecting"/"live" forever.
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        const state = pc.connectionState;
        if (state === "connected") {
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          setStatus("live");
          setMessage("Live voice is listening.");
        } else if (state === "failed") {
          stop("Live voice connection lost.");
          setStatus("error");
          setMessage("Live voice connection lost. Tap Retry.");
        }
      };

      const channel = pc.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("message", (event) => {
        try {
          handleRealtimeEvent(JSON.parse(event.data as string) as RealtimeEvent);
        } catch {
          // Realtime event parsing should never kill the voice session.
        }
      });
      channel.addEventListener("open", () => {
        setMessage("Live voice is warming up…");
      });
      channel.addEventListener("close", () => {
        if (statusRef.current === "live") {
          setStatus("error");
          setMessage("Live voice closed. Tap Retry.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const realtime = await createRealtimeVoiceSession({
        accessToken,
        lessonId,
        sessionId,
        voice: voice.voiceName,
        sdp: offer.sdp || "",
      });
      await pc.setRemoteDescription({ type: "answer", sdp: realtime.sdp });
      // Stay in "connecting" until the peer connection actually reaches "connected"
      // (or session.created arrives). Arm a timeout so a handshake that never connects
      // surfaces a recoverable error rather than a stuck "connecting" state.
      setMessage("Connecting to your mentor…");
      connectTimerRef.current = setTimeout(() => {
        if (statusRef.current !== "live") {
          stop("Live voice could not connect.");
          setStatus("error");
          setMessage("Live voice could not connect. Tap Retry.");
        }
      }, 15000);
    } catch (error) {
      void onVoiceEvent({
        event_type: "voice_session_failed",
        input_modality: "audio_session",
        payload: { error: (error as Error).message || "unknown" },
      });
      // Tear down first (stop() resets status to idle), THEN surface the error so the
      // error state isn't immediately overwritten.
      stop("Live voice could not start.");
      setStatus("error");
      setMessage((error as Error).message || "Live voice could not start.");
    }
  };

  // One-shot auto-start when the panel opens (the student already opted in by tapping the
  // voice button, so we don't make them press Start again).
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
    // `start` is intentionally excluded — this must run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-card border border-border bg-depth-card px-4 py-3.5 shadow-card">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            status === "live"
              ? "bg-success/15 text-success"
              : status === "error"
                ? "bg-danger/15 text-danger"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {status === "live" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-success/30" />
          )}
          <AudioLines className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-body font-medium text-foreground">
            Live voice
            <span className="text-overline uppercase tracking-[0.08em] text-muted-foreground">
              {voice.voiceName}
            </span>
          </div>
          <div className="mt-0.5 truncate text-meta text-muted-foreground">
            {message ||
              "Talk with your mentor out loud — your spoken answers submit automatically."}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status === "idle" || status === "error" ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!accessToken}
            className="inline-flex items-center gap-2 rounded-pill border border-border px-3 py-2 text-meta font-medium text-foreground transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-50"
          >
            <AudioLines className="h-3.5 w-3.5" strokeWidth={1.8} /> Retry
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            stop();
            onClose?.();
          }}
          aria-label="Close voice mode"
          className="inline-flex items-center gap-2 rounded-pill bg-foreground px-4 py-2 text-meta font-medium text-background transition-opacity duration-(--dur-fast) hover:opacity-90"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />{" "}
          {status === "live" || status === "connecting" ? "Stop" : "Close"}
        </button>
      </div>
    </div>
  );
}
