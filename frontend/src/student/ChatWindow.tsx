import type { ReactNode } from "react";
import { Chatbox } from "@/student/Chatbox";
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

export type ChatWindowProps = {
  mode: TurnMode;
  onModeChange: (mode: TurnMode) => void;
  offers: LessonOffers;
  onOpenResources: () => void;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onSendCode?: (code: string, language: ComposerLanguage) => void;
  onToggleVoice?: () => void;
  voiceActive?: boolean;
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
  onToggleVoice,
  voiceActive,
  sending,
  children,
}: ChatWindowProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4">
      <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col">
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
            onToggleVoice={onToggleVoice}
            voiceActive={voiceActive}
            disabled={sending}
          />
        </div>
      </section>
    </div>
  );
}
