import { useState } from "react";
import { ChatWindow } from "@/student/ChatWindow";
import { StudentSidebar } from "@/student/StudentSidebar";
import { LessonTree } from "@/student/LessonTree";
import { Transcript } from "@/student/Transcript";
import { useConversation } from "@/student/useConversation";
import { DEFAULT_TURN_MODE, turnModeSpec, type TurnMode } from "@/student/turnModes";
import {
  DESTINATIONS,
  type StudentDestination,
  type StudentMenuItem,
  type StudentSection,
} from "@/student/navigation";

// The student shell: sidebar + main area. Presentational — nav state is owned by the route so
// it can live in the URL (back/forward, refresh, and deep links all work), and this component
// just renders what it's given.
//
// Home is the LMS. Learn is the conversation. A destination (Classes, Resources, …) takes over
// the main area regardless of section, and closing it returns to the section underneath.

export type StudentAppProps = {
  email: string;
  section: StudentSection;
  destination?: StudentDestination;
  notificationsUnread: number;
  onSelectSection: (section: StudentSection) => void;
  onSelectDestination: (destination: StudentDestination) => void;
  onCloseDestination: () => void;
  onNewConversation: () => void;
  onSelectMenuItem: (item: StudentMenuItem) => void;
};

export function StudentApp({
  email,
  section,
  destination,
  notificationsUnread,
  onSelectSection,
  onSelectDestination,
  onCloseDestination,
  onNewConversation,
  onSelectMenuItem,
}: StudentAppProps) {
  // TurnMode is conversation state, not navigation state — it belongs to the chat, not the URL.
  // It persists across turns until the student changes it (the convention every LLM chat uses).
  const [turnMode, setTurnMode] = useState<TurnMode>(DEFAULT_TURN_MODE);
  const conversation = useConversation();

  const destinationSpec = destination ? DESTINATIONS.find((d) => d.id === destination) : undefined;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        aria-label="Sidebar"
        className="hidden h-full w-[260px] shrink-0 border-r border-border/60 lg:block"
      >
        <StudentSidebar
          email={email}
          section={section}
          destination={destination}
          notificationsUnread={notificationsUnread}
          onSelectSection={onSelectSection}
          onSelectDestination={onSelectDestination}
          onNewConversation={onNewConversation}
          onSelectMenuItem={onSelectMenuItem}
        >
          <LessonTree
            lessons={conversation.lessons}
            currentLessonId={conversation.lesson?.id ?? null}
            onOpenLesson={(lessonId) => {
              // Opening a lesson is a Learn act — jump back to the conversation so the switch
              // is visible rather than happening behind whatever panel is open.
              onSelectSection("learn");
              void conversation.openLesson(lessonId);
            }}
            disabled={conversation.sending || conversation.booting}
          />
        </StudentSidebar>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {destinationSpec ? (
          <section className="flex min-h-0 flex-1 flex-col px-6 py-6">
            <header className="mb-4 flex items-baseline gap-3">
              <h1 className="font-serif text-[22px] tracking-tight text-foreground">
                {destinationSpec.label}
              </h1>
              <p className="text-meta text-muted-foreground">{destinationSpec.hint}</p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={onCloseDestination}
                className="rounded-control px-2 py-1 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
              >
                Close
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
              {destinationSpec.label} is not built yet. The nav entry is real so the shell can be
              navigated end to end; this panel is where it will live.
            </div>
          </section>
        ) : section === "home" ? (
          <section className="flex min-h-0 flex-1 flex-col px-6 py-6">
            <h1 className="mb-4 font-serif text-[22px] tracking-tight text-foreground">Home</h1>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
              The LMS view — what's due, recent work, and your classes at a glance. Not built yet.
            </div>
          </section>
        ) : turnMode === "checkpoints" ? (
          // Checkpoints is a view-only mode (sendsTurn: false). It must show its surface and put
          // the composer away rather than leave a chatbox that silently swallows messages.
          <section className="flex min-h-0 flex-1 flex-col px-6 py-6">
            <header className="mb-4 flex items-baseline gap-3">
              <h1 className="font-serif text-[22px] tracking-tight text-foreground">Checkpoints</h1>
              <p className="text-meta text-muted-foreground">{turnModeSpec("checkpoints").hint}</p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setTurnMode(DEFAULT_TURN_MODE)}
                className="rounded-control px-2 py-1 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
              >
                Back to the conversation
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
              What's due and what you've handed in. Not built yet.
            </div>
          </section>
        ) : (
          <ChatWindow
            mode={turnMode}
            onModeChange={setTurnMode}
            sending={conversation.sending || conversation.booting}
            onSend={(text) => conversation.sendText(text, turnMode)}
          >
            {conversation.booting ? (
              <p className="text-body text-muted-foreground">Opening your conversation…</p>
            ) : conversation.error && !conversation.messages.length ? (
              <p className="text-body text-danger">{conversation.error}</p>
            ) : (
              <Transcript
                messages={conversation.messages}
                disabled={conversation.sending}
                onChoose={(choiceId, label) => {
                  // Answering a quiz is a Quiz-mode act. The server fails closed on a choice sent
                  // in a conversation mode (correct), but that would read as a dead button — so
                  // picking an option moves the student into Quiz rather than being refused.
                  setTurnMode("quiz");
                  void conversation.sendChoice(choiceId, label, "quiz");
                }}
              />
            )}
          </ChatWindow>
        )}
      </main>
    </div>
  );
}
