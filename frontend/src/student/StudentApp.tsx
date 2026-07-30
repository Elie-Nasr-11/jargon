import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GradesPanel } from "@/features/student/GradesPanel";
import { MentorControls } from "@/features/student/MentorControls";
import { store, type MentorConfig, type VoiceSettings } from "@/lib/jargon-store";
import { ChatWindow } from "@/student/ChatWindow";
import { StudentSidebar } from "@/student/StudentSidebar";
import { LessonTree } from "@/student/LessonTree";
import { StudentHome } from "@/student/StudentHome";
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
  // The sidebar is a docked column at lg+ and a drawer below it. Without the drawer there is no
  // navigation at all on a phone, which is where a lot of students actually are.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Mentor + voice settings are per-student and local; Customize edits them and useConversation
  // reads store.getMentor() on every turn, so a change takes effect on the next message.
  const [mentor, setMentor] = useState<MentorConfig>(() => store.getMentor());
  const [voice, setVoice] = useState<VoiceSettings>(() => store.getVoice());
  const saveMentor = (next: MentorConfig) => {
    setMentor(next);
    store.setMentor(next);
  };
  const saveVoice = (next: VoiceSettings) => {
    setVoice(next);
    store.setVoice(next);
  };

  const destinationSpec = destination ? DESTINATIONS.find((d) => d.id === destination) : undefined;

  // Every nav action closes the drawer; the docked column is unaffected.
  const closeDrawer = () => setDrawerOpen(false);
  const sidebar = (
    <StudentSidebar
      email={email}
      section={section}
      destination={destination}
      notificationsUnread={notificationsUnread}
      onSelectSection={(next) => {
        closeDrawer();
        onSelectSection(next);
      }}
      onSelectDestination={(next) => {
        closeDrawer();
        onSelectDestination(next);
      }}
      onNewConversation={() => {
        closeDrawer();
        onNewConversation();
      }}
      onSelectMenuItem={onSelectMenuItem}
    >
      <LessonTree
        lessons={conversation.lessons}
        currentLessonId={conversation.lesson?.id ?? null}
        onOpenLesson={(lessonId) => {
          // Opening a lesson is a Learn act — jump back to the conversation so the switch is
          // visible rather than happening behind whatever panel is open.
          closeDrawer();
          onSelectSection("learn");
          void conversation.openLesson(lessonId);
        }}
        disabled={conversation.sending || conversation.booting}
      />
    </StudentSidebar>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        aria-label="Sidebar"
        className="hidden h-full w-[260px] shrink-0 border-r border-border/60 lg:block"
      >
        {sidebar}
      </aside>

      {/* Below lg the same column lives in a drawer (Radix Sheet: focus trap, ESC, scrim). */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="w-[280px] border-border/60 bg-background p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        className="fixed left-3 top-3 z-[var(--z-header)] flex h-9 w-9 items-center justify-center rounded-full bg-depth-card text-muted-foreground shadow-card hover:text-foreground lg:hidden"
      >
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>

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
            {destination === "resources" ? (
              // The Resources PILL in the chatbox links here, so this must not be a placeholder —
              // a prominent control pointing at "not built yet" is worse than no control.
              <div className="min-h-0 flex-1 overflow-y-auto">
                {conversation.resources.length ? (
                  <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2">
                    {conversation.resources.map((resource) => (
                      <li
                        key={resource.id}
                        className="rounded-card border border-border bg-depth-card p-3"
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-body text-foreground">
                            {resource.title}
                          </span>
                          <span className="shrink-0 text-meta capitalize text-muted-foreground">
                            {resource.resource_type}
                          </span>
                        </div>
                        {resource.description ? (
                          <p className="mt-1 text-meta text-muted-foreground">
                            {resource.description}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
                    Materials your teacher shares appear here as you reach them in the lesson.
                  </p>
                )}
              </div>
            ) : destination === "customize" ? (
              // MentorControls already exists and works; Customize is its home on this surface.
              // Saved to the local store, and useConversation reads it per turn, so a change
              // lands on the next message rather than needing a reload.
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-2xl">
                  <MentorControls
                    mentor={mentor}
                    onChange={saveMentor}
                    voice={voice}
                    onVoiceChange={saveVoice}
                  />
                </div>
              </div>
            ) : destination === "reports" ? (
              // GradesPanel fetches its own rows. It is the deeper view of Home's "Marked"
              // column: every piece of work with class and unit context, not just the recent few.
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl">
                  <GradesPanel />
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-dashed border-border bg-depth-sub p-6 text-body text-muted-foreground">
                {destinationSpec.label} is not built yet. The nav entry is real so the shell can be
                navigated end to end; this panel is where it will live.
              </div>
            )}
          </section>
        ) : section === "home" ? (
          <StudentHome />
        ) : (
          <ChatWindow
            mode={turnMode}
            onModeChange={setTurnMode}
            offers={conversation.offers}
            // Resources is not a conversation mode — it opens the materials destination.
            onOpenResources={() => onSelectDestination("resources")}
            sending={conversation.sending || conversation.booting}
            onSend={(text) => conversation.sendText(text, turnMode)}
            onSendCode={(code, language) => void conversation.sendCode(code, language, turnMode)}
          >
            {conversation.booting ? (
              <p className="text-body text-muted-foreground">Opening your conversation…</p>
            ) : conversation.error && !conversation.messages.length ? (
              <p className="text-body text-danger">{conversation.error}</p>
            ) : (
              <Transcript
                messages={conversation.messages}
                disabled={conversation.sending}
                onRetry={(answer) => void conversation.retry(answer, turnMode)}
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
