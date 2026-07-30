import { useEffect, useState, type ReactNode } from "react";
import { Eye, PauseCircle, Undo2 } from "lucide-react";
import { store } from "@/lib/jargon-store";
import { Chatbox } from "@/student/Chatbox";
import { VoicePanel } from "@/student/VoicePanel";
import { useConversationChannel } from "@/student/useConversation";
import type { ComposerLanguage } from "@/components/Composer";
import type { ChatAttachment } from "@/lib/types";
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
  children,
}: ChatWindowProps) {
  const channel = useConversationChannel();
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

        {/* Both the transcript and the composer sit in the same centered, width-capped column.
            Full-bleed text across a 1440px window is unreadable — every LLM chat caps the
            measure for the same reason, and keeping the composer on the same axis is what makes
            the conversation read as one column rather than two stacked panels. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
          <div className="mx-auto w-full max-w-3xl">{children}</div>
        </div>

        <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">
          <Chatbox
            mode={mode}
            onModeChange={onModeChange}
            offers={offers}
            onOpenResources={onOpenResources}
            onSend={onSend}
            onSendCode={onSendCode}
            onToggleVoice={canVoice ? () => setVoiceOpen((v) => !v) : undefined}
            voiceActive={voiceOpen}
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
