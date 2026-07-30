import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { AMBIENT_FOCUS_EVENT, AmbientCanvas } from "@/components/AmbientCanvas";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MentorControls } from "@/features/student/MentorControls";
import {
  fetchStudentAssessments,
  fetchStudentLessonProgress,
  fetchStudentSettings,
  upsertStudentSettings,
} from "@/lib/api";
import {
  DEFAULT_MENTOR,
  DEFAULT_VOICE,
  store,
  type MentorConfig,
  type VoiceSettings,
} from "@/lib/jargon-store";
import type { StudentAssessmentBundle } from "@/lib/types";
import { AssessmentSurface } from "@/student/AssessmentSurface";
import { ChatWindow } from "@/student/ChatWindow";
import { CheckpointsPanel } from "@/student/CheckpointsPanel";
import { checkpointWorkDue } from "@/student/checkpoints";
import { ClassesPanel } from "@/student/ClassesPanel";
import { ResourcesPanel } from "@/student/ResourcesPanel";
import { ReportsPanel } from "@/student/ReportsPanel";
import { StudentSidebar } from "@/student/StudentSidebar";
import { LessonTree } from "@/student/LessonTree";
import { StudentHome } from "@/student/StudentHome";
import { Transcript } from "@/student/Transcript";
import { useConversation } from "@/student/useConversation";
import {
  DEFAULT_TURN_MODE,
  modeAccentValue,
  turnModeSpec,
  type TurnMode,
} from "@/student/turnModes";
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
//
// The one piece of state deliberately NOT in the URL: an open assessment attempt. The
// AssessmentSurface carries a focus lock (no accidental dismiss mid-test), and URL state would
// re-open a locked overlay on refresh/back in a way that fights that posture.

export type StudentAppProps = {
  email: string;
  section: StudentSection;
  destination?: StudentDestination;
  onSelectSection: (section: StudentSection) => void;
  onSelectDestination: (destination: StudentDestination) => void;
  onCloseDestination: () => void;
  onNewConversation: () => void;
  onSelectMenuItem: (item: StudentMenuItem) => void;
};

// Loose validation for the cross-device settings read: student_settings stores jsonb we wrote
// ourselves, but a malformed row must degrade to defaults, never crash the shell.
function asMentorConfig(value: unknown): MentorConfig | null {
  if (!value || typeof value !== "object") return null;
  return { ...DEFAULT_MENTOR, ...(value as Partial<MentorConfig>) };
}
function asVoiceSettings(value: unknown): VoiceSettings | null {
  if (!value || typeof value !== "object") return null;
  return { ...DEFAULT_VOICE, ...(value as Partial<VoiceSettings>) };
}

export function StudentApp({
  email,
  section,
  destination,
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

  // Mentor + voice settings: localStorage is the fast source of truth (useConversation reads
  // store.getMentor() every turn); student_settings is the cross-device copy. On mount the
  // server copy hydrates the local one; every save writes through to both (server best-effort —
  // a failed upsert never blocks the student's change from taking effect locally).
  const [mentor, setMentor] = useState<MentorConfig>(() => store.getMentor());
  const [voice, setVoice] = useState<VoiceSettings>(() => store.getVoice());
  useEffect(() => {
    let cancelled = false;
    void fetchStudentSettings()
      .then((settings) => {
        if (cancelled || !settings) return;
        const mentorRemote = asMentorConfig(settings.mentor_settings);
        const voiceRemote = asVoiceSettings(settings.voice_settings);
        if (mentorRemote) {
          setMentor(mentorRemote);
          store.setMentor(mentorRemote);
        }
        if (voiceRemote) {
          setVoice(voiceRemote);
          store.setVoice(voiceRemote);
        }
      })
      .catch(() => {
        // Offline or unmigrated — localStorage already seeded the state.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const saveMentor = (next: MentorConfig) => {
    setMentor(next);
    store.setMentor(next);
    void upsertStudentSettings({ mentor_settings: next }).catch(() => {});
  };
  const saveVoice = (next: VoiceSettings) => {
    setVoice(next);
    store.setVoice(next);
    void upsertStudentSettings({ voice_settings: next }).catch(() => {});
  };

  // Per-lesson progress for the tree's fractions + dots. Refreshed after every completed send:
  // a turn is the only client act that can move a session's progress, so that edge is exactly
  // when the fractions can go stale.
  const [progress, setProgress] = useState<Record<string, number>>({});
  const refreshProgress = useCallback(() => {
    void fetchStudentLessonProgress()
      .then(setProgress)
      .catch(() => {
        // Keep the last known map rather than blanking dots on a transient failure.
      });
  }, []);
  const prevSendingRef = useRef(false);
  useEffect(() => {
    if (prevSendingRef.current && !conversation.sending) refreshProgress();
    prevSendingRef.current = conversation.sending;
  }, [conversation.sending, refreshProgress]);
  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  // The formal-work bundle: one fetch feeds the sidebar badge, Home's due strip, the
  // Checkpoints panel, and the assessment surface. Refreshed after a submit lands.
  const [assessments, setAssessments] = useState<StudentAssessmentBundle | null>(null);
  const refreshAssessments = useCallback(() => {
    void fetchStudentAssessments()
      .then(setAssessments)
      .catch(() => {
        // Signed-out or transient failure — an empty bundle keeps the surfaces honest
        // ("nothing assigned") without an error takeover.
        setAssessments(
          (current) =>
            current ?? {
              assessments: [],
              items: [],
              recipients: [],
              attempts: [],
              itemAttempts: [],
              quizzes: [],
            },
        );
      });
  }, []);
  useEffect(() => {
    refreshAssessments();
  }, [refreshAssessments]);
  const workDue = assessments ? checkpointWorkDue(assessments) : 0;

  // The open assessment attempt (focused overlay). Deliberately local state, not URL — see the
  // component comment.
  const [openAssessmentId, setOpenAssessmentId] = useState<string | null>(null);

  const destinationSpec = destination ? DESTINATIONS.find((d) => d.id === destination) : undefined;

  // ---- Ambient wiring (DESIGN_V6 §2): the student surface's single AmbientCanvas. ----------
  // focusSignal is a monotonic counter; each bump fires one uFocus bloom in the canvas.
  const [focusSignal, setFocusSignal] = useState(0);
  const bumpFocus = useCallback(() => setFocusSignal((n) => n + 1), []);

  // Bloom on mentor reply arrival. A reply lands as [..., thinking] -> [..., bot]: the previous
  // array holding a "thinking" placeholder is what distinguishes a live reply from transcript
  // hydration (boot / lesson switch set the whole array at once, no placeholder) — so history
  // loads never bloom.
  const prevMessagesRef = useRef(conversation.messages);
  useEffect(() => {
    const prev = prevMessagesRef.current;
    const next = conversation.messages;
    prevMessagesRef.current = next;
    const last = next[next.length - 1];
    if (prev.some((m) => m.role === "thinking") && last && last.role === "bot" && !last.isError) {
      bumpFocus();
    }
  }, [conversation.messages, bumpFocus]);

  // Bloom on TurnMode change (the ambient hue lerps in sync — same state drives both).
  const prevModeRef = useRef(turnMode);
  useEffect(() => {
    if (prevModeRef.current !== turnMode) {
      prevModeRef.current = turnMode;
      bumpFocus();
    }
  }, [turnMode, bumpFocus]);

  // Bloom on lesson completion, observed off the lesson arc: only an incomplete -> complete
  // transition WITHIN the same lesson fires (resuming an already-finished lesson hydrates the
  // arc complete on load and must not bloom). Conservative by design — see the arc note below.
  const arcSeenRef = useRef<{ lessonId: string | null; incomplete: boolean }>({
    lessonId: null,
    incomplete: false,
  });
  useEffect(() => {
    const arc = conversation.lessonArc;
    const lessonId = conversation.lesson?.id ?? null;
    // "Complete" = every step reported done. An arc merely sitting ON its last step still has
    // completed.length === total - 1, so this cannot fire early; if the server never emits a
    // fully-done arc, this detector simply stays silent rather than guessing.
    const complete =
      !!arc &&
      arc.total > 0 &&
      (arc.completed.length >= arc.total || (arc.steps_done?.length ?? 0) >= arc.total);
    const seen = arcSeenRef.current;
    if (seen.lessonId === lessonId && seen.incomplete && complete) bumpFocus();
    arcSeenRef.current = { lessonId, incomplete: !!arc && !complete };
  }, [conversation.lessonArc, conversation.lesson, bumpFocus]);

  // Bloom on the Home memory card's first reveal — StudentHome announces it via the ambient
  // focus DOM event (the least-invasive channel: no prop threading through the Home tree).
  useEffect(() => {
    const onAmbientFocus = () => bumpFocus();
    window.addEventListener(AMBIENT_FOCUS_EVENT, onAmbientFocus);
    return () => window.removeEventListener(AMBIENT_FOCUS_EVENT, onAmbientFocus);
  }, [bumpFocus]);

  // Hue: the active TurnMode's accent while the conversation is on stage; neutral (the brand
  // rainbow) on Home and destinations. modeAccentValue keeps the progression-honesty
  // desaturation for Discuss/Open — the ambient tells the same truth as the chat chrome.
  const ambientHue =
    !destinationSpec && section === "learn" ? modeAccentValue(turnModeSpec(turnMode)) : null;
  // Intensity: 0.22 on working surfaces, raised to 0.35 for Home's entry moment (§2 allows up
  // to 0.5 on entry surfaces; Home stays below the login ceiling). While an assessment attempt
  // has the screen focus-locked, the ambient dims out of the way (§6: "ambient dims while
  // locked") — the canvas glides between targets, so none of these are hard cuts.
  const ambientIntensity = openAssessmentId
    ? 0.1
    : !destinationSpec && section === "home"
      ? 0.35
      : 0.22;

  // Every nav action closes the drawer; the docked column is unaffected.
  const closeDrawer = () => setDrawerOpen(false);
  const openLesson = (lessonId: string) => {
    // Opening a lesson is a Learn act — jump back to the conversation so the switch is
    // visible rather than happening behind whatever panel is open.
    closeDrawer();
    onSelectSection("learn");
    void conversation.openLesson(lessonId);
  };
  const sidebar = (
    <StudentSidebar
      email={email}
      section={section}
      destination={destination}
      workDue={workDue}
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
        progress={progress}
        onOpenLesson={openLesson}
        disabled={conversation.sending || conversation.booting}
      />
    </StudentSidebar>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* The ONE ambient layer for the whole student surface (DESIGN_V6 §2 — no second WebGL
          context per page). Sidebar and main sit at z-base so the wash stays underneath. */}
      <AmbientCanvas intensity={ambientIntensity} hue={ambientHue} focusSignal={focusSignal} />
      <aside
        aria-label="Sidebar"
        className="relative z-[var(--z-base)] hidden h-full w-[260px] shrink-0 border-r border-border/60 lg:block"
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

      <main className="relative z-[var(--z-base)] flex min-h-0 min-w-0 flex-1 flex-col">
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              {destination === "classes" ? (
                <ClassesPanel
                  currentLessonId={conversation.lesson?.id ?? null}
                  onOpenLesson={openLesson}
                />
              ) : destination === "resources" ? (
                // The Resources PILL in the chatbox links here too — the current lesson's
                // published materials plus anything the mentor attached this session.
                <ResourcesPanel
                  lessonId={conversation.lesson?.id ?? null}
                  sessionId={conversation.sessionId}
                  sessionResources={conversation.resources}
                />
              ) : destination === "checkpoints" ? (
                <CheckpointsPanel
                  bundle={assessments}
                  onOpenAssessment={(id) => setOpenAssessmentId(id)}
                />
              ) : destination === "customize" ? (
                // MentorControls already exists and works; Customize is its home on this
                // surface. Saved to the local store (useConversation reads it per turn) and
                // written through to student_settings for cross-device carry.
                <div className="mx-auto w-full max-w-2xl">
                  <MentorControls
                    mentor={mentor}
                    onChange={saveMentor}
                    voice={voice}
                    onVoiceChange={saveVoice}
                  />
                </div>
              ) : (
                // reports — grades + proficiency.
                <ReportsPanel />
              )}
            </div>
          </section>
        ) : section === "home" ? (
          <StudentHome
            lessons={conversation.lessons}
            onResumeLesson={openLesson}
            assessments={assessments}
            onOpenAssessment={(id) => setOpenAssessmentId(id)}
          />
        ) : (
          <ChatWindow
            mode={turnMode}
            onModeChange={setTurnMode}
            offers={conversation.offers}
            // Resources is not a conversation mode — it opens the materials destination.
            onOpenResources={() => onSelectDestination("resources")}
            sending={conversation.sending || conversation.booting}
            onSend={(text, attachments) => conversation.sendText(text, turnMode, attachments)}
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

      {openAssessmentId ? (
        <AssessmentSurface
          assessmentId={openAssessmentId}
          bundle={assessments}
          onClose={() => setOpenAssessmentId(null)}
          onFinished={refreshAssessments}
        />
      ) : null}
    </div>
  );
}
