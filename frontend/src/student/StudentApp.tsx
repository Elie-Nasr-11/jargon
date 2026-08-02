import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MentorControls } from "@/features/student/MentorControls";
import {
  fetchClassScopedLessons,
  fetchStudentAssessments,
  fetchStudentClasses,
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
import type { Lesson, StudentAssessmentBundle, StudentClass } from "@/lib/types";
import { AssessmentSurface } from "@/student/AssessmentSurface";
import { ChatWindow } from "@/student/ChatWindow";
import {
  ChatDock,
  MediaStageScope,
  MediaStageViewer,
  useMediaStageController,
} from "@/student/MediaStage";
import { CheckpointsPanel } from "@/student/CheckpointsPanel";
import { ClassList, ClassSwitcher } from "@/student/ClassList";
import { ClassSummary } from "@/student/ClassSummary";
import { checkpointRowsByClass } from "@/student/checkpoints";
import { ResourcesPanel } from "@/student/ResourcesPanel";
import { MentorNoteCard, ProfilePanel } from "@/student/ProfilePanel";
import { ReportsPanel } from "@/student/ReportsPanel";
import { ResizeHandle } from "@/student/ResizeHandle";
import { StudentSidebar } from "@/student/StudentSidebar";
import { LessonTree } from "@/student/LessonTree";
import { LessonWelcome } from "@/student/LessonWelcome";
import { SuggestionRows, buildReentrySuggestions } from "@/student/suggestions";
import { StudentHome } from "@/student/StudentHome";
import { Transcript } from "@/student/Transcript";
import { useConversation } from "@/student/useConversation";
import { DEFAULT_TURN_MODE, type TurnMode } from "@/student/turnModes";
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
  // The selected class (URL ?class=). Absent on Home = the Overview; Learn falls back to
  // the first class for tree scoping.
  classId?: string;
  onSelectClass: (classId: string | null) => void;
  onSelectSection: (section: StudentSection) => void;
  onSelectDestination: (destination: StudentDestination) => void;
  onCloseDestination: () => void;
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
  classId,
  onSelectClass,
  onSelectSection,
  onSelectDestination,
  onCloseDestination,
  onSelectMenuItem,
}: StudentAppProps) {
  // TurnMode is conversation state, not navigation state — it belongs to the chat, not the URL.
  // It persists across turns until the student changes it (the convention every LLM chat uses).
  const [turnMode, setTurnMode] = useState<TurnMode>(DEFAULT_TURN_MODE);
  const conversation = useConversation();
  // The sidebar is a docked column at lg+ and a drawer below it. Without the drawer there is no
  // navigation at all on a phone, which is where a lot of students actually are.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The docked column collapses to a 64px icon rail (reference desktop-app mechanics);
  // the choice sticks across visits. The mobile drawer is always the full column.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("jargon.sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const setCollapsed = (next: boolean) => {
    setSidebarCollapsed(next);
    try {
      localStorage.setItem("jargon.sidebar-collapsed", next ? "1" : "0");
    } catch {
      // Storage can be unavailable (private mode) — the toggle still works for the session.
    }
  };

  // Draggable column widths (sidebar + media panel), persisted like the collapse choice.
  // Clamps live here so a stale stored value can never wedge a column off screen.
  const clampSidebar = (w: number) => Math.min(400, Math.max(200, w));
  const clampMedia = (w: number) => {
    const max = Math.max(320, Math.min(900, Math.round(window.innerWidth * 0.7)));
    return Math.min(max, Math.max(320, w));
  };
  const readWidth = (key: string, fallback: number, clamp: (w: number) => number) => {
    try {
      const raw = Number(localStorage.getItem(key));
      return Number.isFinite(raw) && raw > 0 ? clamp(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readWidth("jargon.sidebar-width", 260, clampSidebar),
  );
  const [mediaWidth, setMediaWidth] = useState(() =>
    readWidth("jargon.media-width", 480, clampMedia),
  );
  // Live values for drag math + persistence without re-binding handlers per pixel.
  const dragStartRef = useRef(0);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const mediaWidthRef = useRef(mediaWidth);
  mediaWidthRef.current = mediaWidth;
  const [draggingSidebar, setDraggingSidebar] = useState(false);
  const persistWidth = (key: string, value: number) => {
    try {
      localStorage.setItem(key, String(Math.round(value)));
    } catch {
      // Best-effort persistence.
    }
  };

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

  // The open assessment attempt (focused overlay). Deliberately local state, not URL — see the
  // component comment.
  const [openAssessmentId, setOpenAssessmentId] = useState<string | null>(null);

  // ---- Class context ----------------------------------------------------------------------
  // The student's classes (sidebar list, switcher) and the selected class's scoped lessons
  // (the Learn tree + the class summary). URL ?class= is authoritative; Learn falls back to
  // the first class so the tree is never the whole catalog.
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchStudentClasses()
      .then((rows) => !cancelled && setClasses(rows))
      .catch(() => !cancelled && setClasses([]));
    return () => {
      cancelled = true;
    };
  }, []);
  const scopeClassId = classId ?? classes?.[0]?.id ?? null;
  const summaryClass = classId && classes ? (classes.find((k) => k.id === classId) ?? null) : null;

  const [classLessons, setClassLessons] = useState<Lesson[] | null>(null);
  useEffect(() => {
    if (!scopeClassId) {
      setClassLessons(null);
      return;
    }
    let cancelled = false;
    setClassLessons(null);
    void fetchClassScopedLessons(scopeClassId)
      .then((rows) => !cancelled && setClassLessons(rows))
      .catch(() => !cancelled && setClassLessons(null));
    return () => {
      cancelled = true;
    };
  }, [scopeClassId]);

  // Per-class work rows: due tags in the sidebar list + each summary's work section.
  const rowsByClass = assessments ? checkpointRowsByClass(assessments) : new Map<string, never[]>();
  const dueByClass = new Map<string, number>();
  for (const [id, rows] of rowsByClass) {
    dueByClass.set(id, rows.filter((r) => r.state === "todo" || r.state === "in_progress").length);
  }

  const destinationSpec = destination ? DESTINATIONS.find((d) => d.id === destination) : undefined;

  // The media stage: shell-owned because it drives the Learn layout (side = media in a right
  // panel, full = media with the chat docked). Any ResourceCard below raises it via context.
  const mediaStage = useMediaStageController();
  const stageOpen = mediaStage.stage !== null;
  // The stage renders in the Learn layout; raising it from Home or a destination panel jumps
  // there so the expansion is visible instead of happening behind the current surface.
  useEffect(() => {
    if (!stageOpen) return;
    if (destination) onCloseDestination();
    if (section !== "learn") onSelectSection("learn");
    // Intentionally keyed on stageOpen alone: this is an "on raise" jump, not an invariant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageOpen]);

  // Every nav action closes the drawer; the docked column is unaffected.
  const closeDrawer = () => setDrawerOpen(false);
  const openLesson = (lessonId: string) => {
    // Opening a lesson is a Learn act — jump back to the conversation so the switch is
    // visible rather than happening behind whatever panel is open.
    closeDrawer();
    onSelectSection("learn");
    // Chat-flow Phase 1: each lesson starts back on the spine — a Discuss detour in the
    // previous lesson must not silently carry its register (and its gates-off ceiling)
    // into the next one.
    setTurnMode(DEFAULT_TURN_MODE);
    void conversation.openLesson(lessonId);
  };
  // The section menus: Home = Overview + class list, Learn = the selected class's units and
  // lessons under a switcher.
  const sidebarBody =
    section === "home" ? (
      <ClassList
        classes={classes ?? []}
        selectedClassId={classId ?? null}
        dueByClass={dueByClass}
        onSelectClass={(next) => {
          closeDrawer();
          onSelectClass(next);
        }}
      />
    ) : (
      <>
        <ClassSwitcher
          classes={classes ?? []}
          selectedClassId={scopeClassId}
          onSelectClass={(next) => {
            closeDrawer();
            onSelectClass(next);
          }}
        />
        <LessonTree
          lessons={classLessons ?? conversation.lessons}
          currentLessonId={conversation.lesson?.id ?? null}
          progress={progress}
          onOpenLesson={openLesson}
          disabled={conversation.sending || conversation.booting}
        />
      </>
    );
  const sidebar = (
    <StudentSidebar
      email={email}
      section={section}
      onSelectSection={(next) => {
        closeDrawer();
        onSelectSection(next);
      }}
      onSelectMenuItem={onSelectMenuItem}
    >
      {sidebarBody}
    </StudentSidebar>
  );

  // A never-opened lesson (blank, no mentor pretext): the welcome shows materials in the
  // transcript area while the three suggested first moves hug the composer below.
  const freshLesson =
    !conversation.booting &&
    !conversation.error &&
    !conversation.messages.length &&
    conversation.lesson;

  // Chat-flow Phase 1: a conversation the student walked away from (last message > 30 min
  // old) gets re-entry rows instead of a blank composer. Sending anything makes the newest
  // message fresh, so the rows retire themselves after the first turn back.
  const lastMessageAt = (() => {
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      const message = conversation.messages[i];
      if ("createdAt" in message && message.createdAt) return Date.parse(message.createdAt);
    }
    return null;
  })();
  const staleReturn =
    !conversation.booting &&
    !conversation.error &&
    conversation.messages.length > 0 &&
    lastMessageAt !== null &&
    Date.now() - lastMessageAt > 30 * 60 * 1000
      ? conversation.lesson
      : null;

  // Chat-flow Phase 1: the checkpoint DOCK — the panel above the message box the server's
  // prompt has been promising ("your checkpoint work is docked above the message box").
  // Due/in-progress work for the class in scope, capped at two rows; a tap opens the
  // assessment surface. Scored/waiting rows stay off the dock — it is a to-do surface.
  const dockRows = (rowsByClass.get(scopeClassId ?? "") ?? [])
    .filter((row) => row.state === "todo" || row.state === "in_progress")
    .slice(0, 2);
  const checkpointDock = dockRows.length ? (
    <div className="mb-1.5 flex flex-col gap-1">
      {dockRows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => setOpenAssessmentId(row.id)}
          className="flex items-center gap-2.5 rounded-pill border px-3.5 py-1.5 text-left transition-colors duration-(--dur-fast) hover:brightness-105"
          style={{
            borderColor: "color-mix(in oklab, var(--mode-assignment) 40%, transparent)",
            background: "color-mix(in oklab, var(--mode-assignment) 12%, var(--background))",
          }}
        >
          <span
            className="shrink-0 font-mono text-overline uppercase tracking-[0.14em]"
            style={{
              color: "color-mix(in oklab, var(--mode-assignment) 60%, var(--foreground))",
            }}
          >
            {row.state === "in_progress" ? "Resume" : "Checkpoint"}
          </span>
          <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
          <span className="shrink-0 text-meta text-muted-foreground">
            {row.dueAt
              ? `due ${new Date(row.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : "open"}
          </span>
        </button>
      ))}
    </div>
  ) : null;

  // The conversation surface, one instance reused by every Learn layout (plain, bottom-half
  // under the stage, or docked while media is full screen).
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const chatSurface = (
    <ChatWindow
      mode={turnMode}
      onModeChange={setTurnMode}
      // The streamed placeholder keeps one id while its text grows — fold the text length
      // in so autoscroll tracks the live reply too (the near-bottom guard still applies).
      scrollKey={
        lastMessage
          ? `${lastMessage.id}:${lastMessage.role === "thinking" ? (lastMessage.text?.length ?? 0) : 0}`
          : ""
      }
      offers={conversation.offers}
      // Resources is not a conversation mode — it opens the materials destination.
      onOpenResources={() => onSelectDestination("resources")}
      sending={conversation.sending || conversation.booting}
      onSend={(text, attachments) => conversation.sendText(text, turnMode, attachments)}
      onSendCode={(code, language) => void conversation.sendCode(code, language, turnMode)}
      sessionResources={conversation.resources}
      composerLead={
        checkpointDock || freshLesson || staleReturn ? (
          <>
            {checkpointDock}
            {freshLesson || staleReturn ? (
              // The tapped suggestion becomes the (first or returning) turn and sets its TurnMode.
              <SuggestionRows
                lesson={(freshLesson || staleReturn) as Lesson}
                activities={conversation.activities}
                suggestions={
                  staleReturn ? buildReentrySuggestions(staleReturn as Lesson) : undefined
                }
                disabled={conversation.sending}
                onSuggest={(prompt, mode) => {
                  setTurnMode(mode);
                  conversation.sendText(prompt, mode);
                }}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {conversation.booting ? (
        <p className="mx-auto w-full max-w-3xl px-4 text-body text-muted-foreground">
          Opening your conversation…
        </p>
      ) : conversation.error && !conversation.messages.length ? (
        <p className="mx-auto w-full max-w-3xl px-4 text-body text-danger">{conversation.error}</p>
      ) : !conversation.messages.length && conversation.lesson ? (
        <LessonWelcome lesson={conversation.lesson} />
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
  );

  return (
    <MediaStageScope value={mediaStage}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {/* Flat, solid shell: the page IS the background — no ambient layer, no shadows; the
          sidebar reads as a column of the same surface separated by a clean hairline. */}
        {/* ONE toggle button, fixed at the screen's top-left, mounted in both states — it
            literally cannot move on collapse/expand; only its icon flips. The sidebar header
            leaves a gutter for it (insetForToggle). */}
        <button
          type="button"
          onClick={() => setCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          className="fixed left-2 top-3 z-[var(--z-header)] hidden h-8 w-8 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground lg:flex"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-[15px] w-[15px]" strokeWidth={1.6} />
          ) : (
            <PanelLeftClose className="h-[15px] w-[15px]" strokeWidth={1.6} />
          )}
        </button>

        {/* The column stays mounted and SLIDES: width animates to 0 (content clipped at its
            natural width so nothing squishes mid-flight). The transition is suspended while
            the resize handle drags so the width tracks the pointer 1:1. */}
        <aside
          aria-label="Sidebar"
          aria-hidden={sidebarCollapsed}
          style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          className={`hidden h-full shrink-0 overflow-hidden bg-depth-sub lg:block ${
            sidebarCollapsed ? "border-r border-transparent" : "border-r border-border"
          } ${draggingSidebar ? "" : "transition-[width,border-color] duration-(--dur)"}`}
        >
          <div style={{ width: sidebarWidth }} className="h-full">
            <StudentSidebar
              email={email}
              section={section}
              onSelectSection={onSelectSection}
              onSelectMenuItem={onSelectMenuItem}
              insetForToggle
            >
              {sidebarBody}
            </StudentSidebar>
          </div>
        </aside>
        {!sidebarCollapsed ? (
          <div className="hidden lg:contents">
            <ResizeHandle
              ariaLabel="Resize sidebar"
              onStart={() => {
                dragStartRef.current = sidebarWidthRef.current;
                setDraggingSidebar(true);
              }}
              onDelta={(dx) => setSidebarWidth(clampSidebar(dragStartRef.current + dx))}
              onEnd={() => {
                setDraggingSidebar(false);
                persistWidth("jargon.sidebar-width", sidebarWidthRef.current);
              }}
            />
          </div>
        ) : null}

        {/* Below lg the same column lives in a drawer (Radix Sheet: focus trap, ESC, scrim). */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-[280px] border-border bg-depth-sub p-0 lg:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="fixed left-3 top-3 z-[var(--z-header)] flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground lg:hidden"
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
              <div className="min-h-0 flex-1 overflow-y-auto">
                {destination === "resources" ? (
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
                    {/* The standing mentor note shapes HOW the mentor teaches — it
                        belongs with these controls, not on the Profile page. */}
                    <MentorNoteCard />
                  </div>
                ) : destination === "profile" ? (
                  <ProfilePanel />
                ) : (
                  // reports — grades + proficiency.
                  <ReportsPanel />
                )}
              </div>
            </section>
          ) : section === "home" ? (
            summaryClass ? (
              // A class is selected in the sidebar: its summary page owns the main area.
              <ClassSummary
                klass={summaryClass}
                lessons={classLessons}
                progress={progress}
                currentLessonId={conversation.lesson?.id ?? null}
                assignmentRows={rowsByClass.get(summaryClass.id) ?? []}
                onOpenLesson={openLesson}
                onOpenAssessment={(id) => setOpenAssessmentId(id)}
              />
            ) : (
              <StudentHome
                lessons={conversation.lessons}
                onOpenLesson={openLesson}
                assessments={assessments}
                onOpenAssessment={(id) => setOpenAssessmentId(id)}
                classCount={classes ? classes.length : null}
                progress={progress}
                currentLessonId={conversation.lesson?.id ?? null}
              />
            )
          ) : (
            // Learn: the conversation, optionally sharing the area with the media stage.
            //   no stage   → the conversation owns the whole area.
            //   side stage → media in a right-hand panel; the conversation keeps the rest
            //                (the Claude/Codex desktop pattern).
            //   full stage → media owns the area; the conversation docks bottom-right.
            <div className="relative flex min-h-0 flex-1">
              {mediaStage.stage?.mode === "full" ? (
                <>
                  <MediaStageViewer
                    stage={mediaStage.stage}
                    onMode={mediaStage.setMode}
                    onClose={mediaStage.close}
                  />
                  <ChatDock>{chatSurface}</ChatDock>
                </>
              ) : (
                <>
                  {chatSurface}
                  {mediaStage.stage ? (
                    <>
                      <ResizeHandle
                        ariaLabel="Resize media panel"
                        onStart={() => {
                          dragStartRef.current = mediaWidthRef.current;
                        }}
                        // The panel grows as the handle moves LEFT (dx negative).
                        onDelta={(dx) => setMediaWidth(clampMedia(dragStartRef.current - dx))}
                        onEnd={() => persistWidth("jargon.media-width", mediaWidthRef.current)}
                      />
                      <aside
                        aria-label="Media panel"
                        style={{ width: mediaWidth }}
                        className="flex max-w-[70vw] shrink-0 flex-col border-l border-border"
                      >
                        <MediaStageViewer
                          stage={mediaStage.stage}
                          onMode={mediaStage.setMode}
                          onClose={mediaStage.close}
                        />
                      </aside>
                    </>
                  ) : null}
                </>
              )}
            </div>
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
    </MediaStageScope>
  );
}
