import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, PauseCircle, Undo2 } from "lucide-react";
import { store } from "@/lib/jargon-store";
import { prefersReducedMotion } from "@/lib/motion";
import { Chatbox } from "@/student/Chatbox";
import { VoicePanel } from "@/student/VoicePanel";
import { useConversationChannel } from "@/student/useConversation";
import type { ComposerLanguage } from "@/lib/composerLanguage";
import type { ChatAttachment, LessonChatResource } from "@/lib/types";
import type { LessonOffers, TurnMode } from "@/student/turnModes";

// The conversation surface: a scrolling transcript with the chatbox beneath it.
//
// It deliberately has NO border and NO mode label of its own. Mode chrome belongs to the stretch
// of conversation it describes, not to the window — one lesson can contain several modes, so a
// single window-level border would be a lie about which part was which. Transcript draws a
// bordered, labelled section per run of messages; the chatbox tints itself to the mode you are
// about to send in.
//
// Session-level live state (teacher presence, the pause hold, the revisit frame) comes off the
// conversation channel rather than props: the shell that composes this window forwards only the
// original prop surface (see the channel note in useConversation).

export type ChatWindowProps = {
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  offers: LessonOffers;
  onOpenResources: () => void;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onSendCode?: (code: string, language: ComposerLanguage) => void;
  sending?: boolean;
  // What the mentor has attached this session — feeds the composer's resource-reference picker.
  sessionResources?: LessonChatResource[];
  // Rendered on the composer's centered axis, directly above the chatbox — the suggested
  // first moves for a fresh lesson live here so they hug the input, not the transcript.
  composerLead?: ReactNode;
  // Chat-flow Phase 1: the latest message's id. A change means the transcript grew (or a
  // placeholder resolved) — the window scrolls to the bottom, unless the student has
  // scrolled up to reread. Empty string = no messages.
  scrollKey?: string;
  // The transcript. Supplied by the route so this component stays presentational.
  children?: ReactNode;
};

export function ChatWindow({
  mode,
  onModeChange,
  offers,
  onOpenResources,
  onSend,
  onSendCode,
  sending,
  sessionResources,
  composerLead,
  scrollKey,
  children,
}: ChatWindowProps) {
  const channel = useConversationChannel();
  // Autoscroll: keep the newest message in view. Instant on the first paint of a
  // conversation (a reload should land at the bottom, not animate there), smooth after;
  // never yanks a student who scrolled up more than ~200px to reread.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sawFirstKeyRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollKey) return;
    const first = !sawFirstKeyRef.current;
    sawFirstKeyRef.current = true;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (!first && !nearBottom) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: first || prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [scrollKey]);
  // Live voice is window-owned state: opening the panel is a conversation-surface act, and the
  // panel must unmount (full WebRTC/mic teardown) whenever this window goes away.
  const [voiceOpen, setVoiceOpen] = useState(false);
  const held = channel.held;

  // A hold must not leave the mic hot: the teacher paused the mentor, and the voice loop
  // auto-submitting turns would just bounce off the held gate. Unmounting runs the panel's
  // full cleanup.
  useEffect(() => {
    if (held) setVoiceOpen(false);
  }, [held]);

  // Live voice needs WebRTC + mic capture (mirrors VoicePanel's own guard) plus a live
  // conversation to submit into.
  const canVoice =
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(channel.accessToken && channel.lessonId);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4">
      <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col">
        {/* Live-session status chips, centered above the transcript. Presence first (ambient,
            informational), then the hold (blocking, warning-toned). */}
        {channel.teacherViewers > 0 || held || channel.revisitFrontier ? (
          <div className="flex shrink-0 flex-col items-center gap-2 pb-2">
            {channel.teacherViewers > 0 ? (
              <div className="inline-flex items-center gap-2 rounded-pill border border-info/40 bg-info/10 px-3 py-1.5 text-meta text-info">
                <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                Teacher viewing
                {channel.teacherViewers > 1 ? ` · ${channel.teacherViewers}` : ""}
              </div>
            ) : null}
            {held ? (
              <div
                role="status"
                className="inline-flex items-center gap-2 rounded-pill border border-warning/40 bg-warning/10 px-3.5 py-1.5 text-meta text-warning"
              >
                <PauseCircle className="h-3.5 w-3.5 animate-pulse" strokeWidth={1.8} />
                Your teacher paused the session — hang tight
              </div>
            ) : null}
            {/* Flow v3 backtracking: while the server holds a revisit frame open, one tap
                returns to exactly where the lesson left off. */}
            {channel.revisitFrontier && !held ? (
              <button
                type="button"
                onClick={channel.sendResume}
                disabled={sending || channel.sending}
                className="inline-flex items-center gap-2 rounded-pill border border-info/40 bg-info/10 px-3.5 py-1.5 text-meta text-info transition-colors duration-(--dur-fast) hover:bg-info/20 disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
                Revisiting an earlier step — return to where you were
              </button>
            ) : null}
          </div>
        ) : null}

        {/* The transcript owns the full window width — its mode rules span edge to edge —
            while each section keeps its MESSAGES in a centered, width-capped reading column
            (full-bleed text across a 1440px window is unreadable). The composer sits on that
            same centered axis so the conversation reads as one column. */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 pt-2"
        >
          {children}
        </div>

        <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">
          {composerLead}
          <Chatbox
            mode={mode}
            onModeChange={onModeChange}
            offers={offers}
            onOpenResources={onOpenResources}
            onSend={onSend}
            onSendCode={onSendCode}
            onToggleVoice={canVoice ? () => setVoiceOpen((v) => !v) : undefined}
            voiceActive={voiceOpen}
            lessonId={channel.lessonId}
            sessionResources={sessionResources}
            onVoiceEvent={channel.voiceEvent}
            // The hold locks the composer as well as the send path — a typeable box whose
            // Send silently fails would read as broken, not paused.
            disabled={sending || held}
          />
          {voiceOpen && canVoice ? (
            <VoicePanel
              accessToken={channel.accessToken}
              lessonId={channel.lessonId!}
              sessionId={channel.sessionId}
              voice={store.getVoice()}
              autoStart
              onClose={() => setVoiceOpen(false)}
              onVoiceEvent={channel.voiceEvent}
              onSubmitVoiceTurn={(text, confidence) =>
                channel.sendVoiceTurn(text, mode, confidence)
              }
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
