import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import {
  AlertCircle,
  AudioLines,
  Check,
  ChevronDown,
  ClipboardList,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Menu,
  Paperclip,
  Pause,
  Play,
  RotateCcw,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { MaterialComments } from "@/features/comms/MaterialComments";
import { Composer, type ComposerHandle, type ComposerLanguage } from "@/components/Composer";
import { GradientCard } from "@/components/GradientCard";
import { LessonMilestones } from "@/components/LessonMilestones";
import { ModalCard } from "@/components/ModalCard";
import { CodeArea } from "@/components/CodeArea";
import { ReadAloudAction } from "@/components/ReadAloudAction";
import { QuizPanel } from "@/features/student/QuizPanel";
import { StudentNav, type NavKey } from "@/features/student/StudentNav";
import { Sidebar } from "@/features/student/shell/Sidebar";
import { ViewHost } from "@/features/student/shell/ViewHost";
import { isStudentView, type StudentView } from "@/features/student/shell/studentViews";
import { ProfileMenu } from "@/features/student/shell/ProfileMenu";
import { ChatStepperRail, ChatStepperStrip } from "@/features/student/chat/ChatStepper";
import { useStudentNavData } from "@/hooks/useStudentNavData";
import {
  DEFAULT_MENTOR,
  DEFAULT_VOICE,
  store,
  type MentorConfig,
  type VoiceSettings,
} from "@/lib/jargon-store";
import {
  fetchLiveSessionViewers,
  fetchSessionHold,
  fetchLearningTurns,
  fetchTeacherLiveComments,
  fetchStudentAssignments,
  fetchStudentAssessments,
  fetchLatestLearningSession,
  onAuthStateChange,
  fetchLessonActivities,
  fetchStudentCatalog,
  fetchStudentSettings,
  fetchReviewDue,
  getSubmissionFileSignedUrl,
  upsertStudentSettings,
  createRealtimeVoiceSession,
  getLessonResourceSignedUrl,
  getLessonResourceThumbnailSignedUrl,
  getMentorAudio,
  getSession,
  fetchPrimaryRole,
  roleHome,
  invokeJargonRun,
  invokeTypedChat,
  recordResourceInteraction,
  recordVoiceInteraction,
  submitAssignment,
  submissionFileState,
  MAX_SUBMISSION_FILES,
  MAX_SUBMISSION_FILE_BYTES,
} from "@/lib/api";
import { formatScore } from "@/lib/format";
import { runJavaScript, runPython, type RunResult } from "@/lib/code-runner";
import { tokenizeJargon, type JargonTokenKind } from "@/lib/jargon-syntax";
import { supabase } from "@/lib/supabase";
import type {
  JargonRunResponse,
  ChatInputModality,
  LearningSession,
  LearningTurn,
  Lesson,
  LessonActivity,
  LessonArc,
  LessonChatResource,
  LiveSessionViewer,
  SessionHold,
  MentorPreferences,
  StudentAssignmentBundle,
  StudentAssessmentBundle,
  TeacherLiveComment,
  TypedChatAnswer,
  TypedChatEnvelope,
  VoiceInteractionEvent,
} from "@/lib/types";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [{ title: "Jargon" }, { name: "description", content: "Your conversation with Jargon." }],
  }),
  // Workspace views live in the URL (?view=grades) so back button, refresh, and deep links all
  // work; absent/invalid = the tutor chat.
  validateSearch: (s: Record<string, unknown>): { view?: StudentView } => ({
    view: isStudentView(s.view) ? s.view : undefined,
  }),
  component: ChatPage,
});

type RuntimeRunResult = RunResult & { raw?: JargonRunResponse };

type ChatCodeBlock = { language: ComposerLanguage; source: string };
type ChatChoice = { id?: string; label?: string; text?: string; value?: string };

type Msg =
  | {
      id: string;
      role: "user";
      text: string;
      code?: ChatCodeBlock;
      inputModality?: ChatInputModality;
      transcriptConfidence?: number | null;
      createdAt?: string;
    }
  | {
      id: string;
      role: "bot";
      text: string;
      code?: ChatCodeBlock;
      choices?: ChatChoice[];
      resources?: LessonChatResource[];
      createdAt?: string;
      // Error bubbles must never become the "latest mentor message" — that would strip the
      // live quiz choices off the real question with no recovery path.
      isError?: boolean;
      // The failed turn's answer payload, so the error bubble's Retry can re-send it.
      retryAnswer?: TypedChatAnswer;
      // The choice the student picked on this (quiz) message — kept so history shows WHICH
      // option was selected after the live buttons retire.
      chosen?: string;
    }
  | { id: string; role: "teacher"; text: string; createdAt?: string }
  | { id: string; role: "output"; ok: boolean; output: string; lang: ComposerLanguage }
  | { id: string; role: "thinking" };

const uid = () => Math.random().toString(36).slice(2);

function mentorToPreferences(mentor: MentorConfig): MentorPreferences {
  return {
    pace:
      mentor.verbosity === "Concise"
        ? "brief"
        : mentor.verbosity === "Detailed"
          ? "guided"
          : "balanced",
    tone: mentor.tone === "Friendly" ? "encouraging" : "neutral",
    hint_level:
      mentor.difficulty === "Gentle"
        ? "low"
        : mentor.difficulty === "Challenging"
          ? "high"
          : "medium",
    mode: mentor.mode,
  };
}

// Client-side lesson arc from the fetched activities + the session cursor, so progress shows
// immediately on load / resume. Per-turn envelopes carry an authoritative lesson_arc that
// supersedes this. Null for single-step lessons (nothing to show).
function deriveLessonArc(
  activities: LessonActivity[],
  currentActivityId: string | null,
): LessonArc | null {
  if (!Array.isArray(activities) || activities.length <= 1) return null;
  const sorted = [...activities].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const titleOf = (a: LessonActivity, i: number) => a.title || `Step ${i + 1}`;
  let idx = sorted.findIndex((a) => a.id === currentActivityId);
  if (idx < 0) idx = 0;
  const completed = sorted.slice(0, idx).map((a, i) => ({ step: i + 1, title: titleOf(a, i) }));
  const upcoming = sorted
    .slice(idx + 1)
    .map((a, i) => ({ step: idx + 2 + i, title: titleOf(a, idx + 1 + i) }));
  return {
    step: idx + 1,
    total: sorted.length,
    current: { title: titleOf(sorted[idx], idx) },
    completed,
    upcoming,
    next: upcoming[0] || null,
  };
}

function turnToMessage(turn: LearningTurn): Msg | null {
  if (turn.role === "student") {
    const modality =
      typeof turn.payload?.input_modality === "string"
        ? (turn.payload.input_modality as ChatInputModality)
        : undefined;
    const confidence =
      typeof turn.payload?.transcript_confidence === "number"
        ? turn.payload.transcript_confidence
        : null;
    return {
      id: turn.id,
      role: "user",
      text: turn.content,
      inputModality: modality,
      transcriptConfidence: confidence,
      createdAt: turn.created_at,
    };
  }
  if (turn.role === "mentor" || turn.role === "system") {
    const payload = turn.payload || {};
    const choices = Array.isArray(payload.choices) ? (payload.choices as ChatChoice[]) : undefined;
    const resources = Array.isArray(payload.resources)
      ? (payload.resources as LessonChatResource[])
      : undefined;
    return {
      id: turn.id,
      role: "bot",
      text: turn.content,
      choices,
      resources,
      createdAt: turn.created_at,
    };
  }
  return null;
}

function liveCommentToMessage(comment: TeacherLiveComment): Msg {
  return {
    id: `teacher-live-${comment.id}`,
    role: "teacher",
    text: comment.content,
    createdAt: comment.created_at,
  };
}

function sortTimedMessages(messages: Msg[]) {
  return [...messages].sort((a, b) => {
    const aTime = "createdAt" in a && a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = "createdAt" in b && b.createdAt ? Date.parse(b.createdAt) : 0;
    return aTime - bTime;
  });
}

function envelopeMessage(envelope: TypedChatEnvelope): Msg {
  return {
    id: uid(),
    role: "bot",
    text: envelope.reply || "I'm ready.",
    choices: envelope.choices?.length ? envelope.choices : undefined,
    resources: envelope.resources?.length ? envelope.resources : undefined,
    createdAt: new Date().toISOString(),
  };
}

function formatRunOutput(result: JargonRunResponse) {
  const output = result.output?.length ? result.output.join("\n") : "";
  // The run fn's error shape mirrors each error into output as "[ERROR] …" — skip
  // errors already present so the student doesn't read the same message twice.
  const errors = (result.errors || [])
    .filter((entry) => entry && !output.includes(entry))
    .join("\n");
  return [output, errors].filter(Boolean).join("\n") || "(no output)";
}

function languageLabel(lang: ComposerLanguage) {
  if (lang === "jargon") return "Jargon";
  return lang === "python" ? "Python" : "JavaScript";
}

function choiceLabel(choice: ChatChoice) {
  return choice.text || choice.label || choice.value || choice.id || "Choice";
}

function choiceValue(choice: ChatChoice) {
  return choice.id || choice.value || choice.label || choice.text || "";
}

function normalizeLanguage(language: string | undefined): ComposerLanguage {
  const value = (language || "").trim().toLowerCase();
  if (value === "python" || value === "py") return "python";
  if (value === "javascript" || value === "js" || value === "typescript" || value === "ts") {
    return "javascript";
  }
  return "jargon";
}

type MessageSegment = { kind: "text"; text: string } | { kind: "code"; code: ChatCodeBlock };

function parseFencedBlocks(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text))) {
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({
      kind: "code",
      code: {
        language: normalizeLanguage(match[1]),
        source: match[2].replace(/\n$/, ""),
      },
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments.length ? segments : [{ kind: "text", text }];
}

function parseRunMessage(text: string): { text: string; code: ChatCodeBlock } | null {
  const match = text.match(/^Ran\s+(Jargon|Python|JavaScript):\n\n([\s\S]+)$/i);
  if (!match) return null;
  const language = normalizeLanguage(match[1]);
  return {
    text: `Ran ${languageLabel(language)}:`,
    code: {
      language,
      source: match[2],
    },
  };
}

const jargonTokenClass: Record<JargonTokenKind, string> = {
  plain: "",
  command: "font-semibold text-[var(--jargon-syntax-command)]",
  condition: "font-semibold text-[var(--jargon-syntax-condition)]",
  comment: "italic text-[var(--jargon-syntax-comment)]",
  string: "text-[var(--jargon-syntax-string)]",
  number: "text-[var(--jargon-syntax-number)]",
  bracket: "text-[var(--jargon-syntax-bracket)]",
};

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function ChatPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activities, setActivities] = useState<LessonActivity[]>([]);
  const [learningSession, setLearningSession] = useState<LearningSession | null>(null);
  const [lessonArc, setLessonArc] = useState<LessonArc | null>(null);
  const [lessonId, setLessonId] = useState<string>("lesson1");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mentor, setMentor] = useState<MentorConfig>(DEFAULT_MENTOR);
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  // Ref twin of `sending` for callbacks that fire from stale closures (voice, choice buttons).
  const sendingRef = useRef(false);
  // The in-flight turn's promise, so a "busy" caller (a resolving code run) can await it and retry.
  const inFlightTurnRef = useRef<Promise<TypedChatEnvelope | null> | null>(null);
  // True while a code run is executing — blocks new sends so the run's mentor review can't be
  // silently dropped by the in-flight gate when it resolves.
  const [runInFlight, setRunInFlight] = useState(false);
  // The lesson finished (from a live envelope or a resumed complete session). Swaps the
  // composer for a completion banner until the student opts into a follow-up chat.
  const [lessonComplete, setLessonComplete] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [booting, setBooting] = useState(true);
  // Bumping this re-runs the bootstrap effect — the boot-failure screen's Retry.
  const [bootAttempt, setBootAttempt] = useState(0);
  const [surfaceError, setSurfaceError] = useState("");
  const [liveViewers, setLiveViewers] = useState<LiveSessionViewer[]>([]);
  const [viewerClock, setViewerClock] = useState(() => Date.now());
  // True while a teacher has paused this session (Phase 3). Composer is locked + a banner shows.
  const [sessionHeld, setSessionHeld] = useState(false);
  // The active workspace view comes from the URL (?view=); absent = the tutor chat. The mobile
  // drawer is the only remaining transient nav surface; settings still open as small modals until
  // the header profile menu lands.
  const { view } = Route.useSearch();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A DM channel to deep-link the Messages view into (from a direct_message notification click).
  const [dmDeepLinkChannel, setDmDeepLinkChannel] = useState<string | null>(null);
  // Persistent nav data: badge counts + the notifications list (shared with the Notifications
  // surface) — stays live while any view is open.
  const navData = useStudentNavData();
  // The quiz being taken, as a modal over the chat (the /quiz route is retired).
  const [openQuizId, setOpenQuizId] = useState<string | null>(null);
  // Count of skills due for spaced review — a small dismissible nudge card, once per browser session.
  const [reviewNudge, setReviewNudge] = useState<number | null>(null);
  // Scroll UX: only auto-stick when the student is already near the bottom; otherwise offer a
  // jump-to-latest button instead of yanking them down mid-read.
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const [assignments, setAssignments] = useState<StudentAssignmentBundle>({
    assignments: [],
    recipients: [],
    submissions: [],
    files: [],
  });
  const [assessments, setAssessments] = useState<StudentAssessmentBundle>({
    assessments: [],
    items: [],
    recipients: [],
    attempts: [],
    itemAttempts: [],
    quizzes: [],
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // When true, the live-voice panel replaces the composer input row.
  const [voiceMode, setVoiceMode] = useState(false);

  const currentLesson = useMemo(
    () => lessons.find((lesson) => lesson.id === lessonId) || null,
    [lessonId, lessons],
  );
  const starterCode =
    activities.find((activity) => activity.response_mode === "code")?.starter_code ||
    currentLesson?.sample_code ||
    `// Write Jargon here\nPRINT "hello from jargon"`;
  // Newest REAL mentor message — the only bubble whose quiz choices are live. Error bubbles
  // are skipped so a failed send can't strip the active question's buttons.
  const lastBotId = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "bot" && !m.isError) return m.id;
    }
    return null;
  }, [msgs]);
  const activeLiveViewers = useMemo(
    () =>
      liveViewers.filter(
        (viewer) =>
          viewer.status === "active" &&
          viewer.last_seen_at &&
          viewerClock - Date.parse(viewer.last_seen_at) < 45_000,
      ),
    [liveViewers, viewerClock],
  );

  // Auto-stick when the composer grows, but only if already near the bottom. Bound on [booting]
  // so it attaches AFTER the boot screen unmounts (the refs are null while booting).
  useEffect(() => {
    const el = composerWrapRef.current;
    if (booting || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      const distance = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
      if (distance < 180) {
        requestAnimationFrame(() => {
          sc.scrollTo({ top: sc.scrollHeight, behavior: "auto" });
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [booting]);

  // Track whether the student is near the bottom; scrolled-away shows the jump button.
  useEffect(() => {
    const sc = scrollRef.current;
    if (booting || !sc) return;
    const onScroll = () => {
      const distance = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
      const near = distance < 180;
      nearBottomRef.current = near;
      setShowJump(!near);
      if (near) setNewBelow(false);
    };
    onScroll();
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => sc.removeEventListener("scroll", onScroll);
  }, [booting]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    // Smart-stick: follow new messages only when already near the bottom; when the student has
    // scrolled up to read history, flag "new below" instead of yanking them down.
    // Depend on the array identity, not just its length: replacing the "thinking" bubble with
    // the mentor reply keeps the length constant but must still scroll the reply into view.
    if (nearBottomRef.current) {
      sc.scrollTo({ top: sc.scrollHeight, behavior: "smooth" });
    } else {
      setNewBelow(true);
    }
  }, [msgs]);

  useEffect(() => {
    const id = window.setInterval(() => setViewerClock(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // Keep the realtime connection authenticated for the page's lifetime — the handler in
  // api.ts re-sets realtime auth on every token refresh, so the teacher live-view
  // subscriptions survive past the first token's expiry (~1h).
  useEffect(() => {
    const { data } = onAuthStateChange(() => {});
    return () => data.subscription.unsubscribe();
  }, []);

  const loadLesson = async (
    nextLessonId: string,
    token: string,
    nextMentor: MentorConfig,
    seedFromChat = true,
  ) => {
    setSurfaceError("");
    setSending(true);
    setLessonArc(null); // clear immediately so no stale strip flashes during the fetch
    setLessonComplete(false);
    setFollowUp(false);
    try {
      const [lessonActivities, latest] = await Promise.all([
        fetchLessonActivities(nextLessonId),
        fetchLatestLearningSession(nextLessonId),
      ]);
      setActivities(lessonActivities);
      setLearningSession(latest);
      setSessionId(latest?.id || null);
      setLessonComplete(latest?.status === "complete");
      // Show progress immediately (envelopes will supersede with the authoritative arc).
      setLessonArc(deriveLessonArc(lessonActivities, latest?.current_activity_id || null));

      if (latest) {
        const [turns, comments] = await Promise.all([
          fetchLearningTurns(latest.id),
          fetchTeacherLiveComments(latest.id),
        ]);
        const mapped = sortTimedMessages([
          ...(turns.map(turnToMessage).filter(Boolean) as Msg[]),
          ...comments.map(liveCommentToMessage),
        ]);
        if (mapped.length) {
          setMsgs(mapped);
          return;
        }
      }

      if (!seedFromChat) return;
      setMsgs([{ id: uid(), role: "thinking" }]);
      const envelope = await invokeTypedChat({
        accessToken: token,
        lessonId: nextLessonId,
        mentorPreferences: mentorToPreferences(nextMentor),
      });
      setSessionId(envelope.session_id);
      setLearningSession((previous) =>
        previous
          ? { ...previous, id: envelope.session_id || previous.id, stage: envelope.stage }
          : null,
      );
      if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
      setMsgs([envelopeMessage(envelope)]);
    } catch (error) {
      // Single surface: the dismissible error banner (no duplicate in-stream bot bubble).
      setSurfaceError((error as Error).message || "Could not load the live lesson.");
    } finally {
      setSending(false);
      setBooting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      try {
        const session = await getSession();
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const role = await fetchPrimaryRole(session.access_token, session.user.id);
        if (role !== "student") {
          navigate({ to: roleHome(role), replace: true });
          return;
        }
        // Pin the student's currently-open lesson into the scoped catalog so class scoping can
        // never strand them mid-lesson with no way back to their in-progress work.
        const [liveLessons, liveAssignments, liveAssessments, serverSettings] = await Promise.all([
          fetchStudentCatalog(store.getLessonId()),
          fetchStudentAssignments(),
          fetchStudentAssessments(),
          fetchStudentSettings().catch(() => null),
        ]);
        if (!alive) return;
        const selected =
          liveLessons.find((lesson) => lesson.id === store.getLessonId())?.id ||
          liveLessons[0]?.id ||
          "lesson1";
        // Prefer server-persisted prefs when present (cross-device), else localStorage. Converge
        // the store so both layers agree; a failed/absent read silently keeps the local values.
        const savedMentor =
          serverSettings?.mentor_settings && typeof serverSettings.mentor_settings === "object"
            ? { ...store.getMentor(), ...(serverSettings.mentor_settings as Partial<MentorConfig>) }
            : store.getMentor();
        const savedVoice =
          serverSettings?.voice_settings && typeof serverSettings.voice_settings === "object"
            ? { ...store.getVoice(), ...(serverSettings.voice_settings as Partial<VoiceSettings>) }
            : store.getVoice();
        if (serverSettings?.mentor_settings) store.setMentor(savedMentor);
        if (serverSettings?.voice_settings) store.setVoice(savedVoice);
        setAccessToken(session.access_token);
        setEmail(session.user.email || "");
        setLessons(liveLessons);
        setAssignments(liveAssignments);
        setAssessments(liveAssessments);
        setLessonId(selected);
        setMentor(savedMentor);
        setVoice(savedVoice);
        // Best-effort review nudge: a small once-per-browser-session card when skills are due.
        void fetchReviewDue()
          .then((rows) => {
            if (alive && rows.length && !sessionStorage.getItem("jargon-review-nudge")) {
              setReviewNudge(rows.length);
            }
          })
          .catch(() => {});
        await loadLesson(selected, session.access_token, savedMentor);
      } catch (error) {
        if (!alive) return;
        setSurfaceError((error as Error).message || "Could not start Jargon.");
        setBooting(false);
      }
    };
    bootstrap();
    return () => {
      alive = false;
    };
  }, [navigate, bootAttempt]);

  useEffect(() => {
    if (!sessionId) {
      setLiveViewers([]);
      return;
    }

    let active = true;
    void fetchLiveSessionViewers(sessionId)
      .then((viewers) => {
        if (active) setLiveViewers(viewers);
      })
      .catch(() => {
        if (active) setLiveViewers([]);
      });
    void fetchSessionHold(sessionId)
      .then((hold) => {
        if (active) setSessionHeld(hold?.active === true);
      })
      .catch(() => {
        if (active) setSessionHeld(false);
      });

    const upsertViewer = (viewer: LiveSessionViewer) => {
      setLiveViewers((current) => {
        const exists = current.some((item) => item.id === viewer.id);
        return exists
          ? current.map((item) => (item.id === viewer.id ? viewer : item))
          : [viewer, ...current];
      });
      setViewerClock(Date.now());
    };

    const channel = supabase
      .channel(`student-live-intervention-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_session_viewers",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const viewer = payload.new as LiveSessionViewer | null;
          if (viewer?.id) upsertViewer(viewer);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "teacher_live_comments",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const comment = payload.new as TeacherLiveComment | null;
          if (!comment?.id || comment.visibility !== "student_visible") return;
          const nextMessage = liveCommentToMessage(comment);
          setMsgs((current) =>
            current.some((message) => message.id === nextMessage.id)
              ? current
              : [...current, nextMessage],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_holds",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const hold = payload.new as SessionHold | null;
          setSessionHeld(hold?.active === true);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const updateMentor = (next: MentorConfig) => {
    setMentor(next);
    store.setMentor(next);
    // Best-effort cross-device persistence; localStorage stays the source of truth.
    void upsertStudentSettings({ mentor_settings: next }).catch(() => {});
  };

  const updateVoice = (next: VoiceSettings) => {
    setVoice(next);
    store.setVoice(next);
    void upsertStudentSettings({ voice_settings: next }).catch(() => {});
  };

  const addMsg = (m: Msg) => setMsgs((prev) => [...prev, m]);

  const replaceThinking = (thinkingId: string, message: Msg) => {
    setMsgs((previous) => previous.filter((m) => m.id !== thinkingId).concat(message));
  };

  // client_msg_id source — crypto.randomUUID is missing on older student devices and
  // non-secure contexts; every send funnels through here, so it must never throw.
  const newClientMsgId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // THE single send path for every turn type (typed text, voice text, quiz choice, code run).
  // One in-flight gate lives here — as a ref, because voice/choice callbacks fire from event
  // listeners whose closures hold stale `sending` state. Returns "busy" (instead of silently
  // dropping) when a turn is already in flight so callers can wait and retry; the in-flight
  // promise is exposed via inFlightTurnRef for exactly that. Every answer carries a
  // client_msg_id so the server can recognize duplicate deliveries.
  const sendTurn = async (input: {
    answer: TypedChatAnswer;
    optimistic: Msg[];
    errorText: string;
  }): Promise<TypedChatEnvelope | null | "busy"> => {
    if (!accessToken) return null;
    if (sessionHeld) {
      addMsg({
        id: uid(),
        role: "bot",
        text: "Your teacher paused the session to step in — hang tight until they resume it.",
      });
      return null;
    }
    if (sendingRef.current) return "busy";
    sendingRef.current = true;
    setSending(true);
    for (const m of input.optimistic) addMsg(m);
    const thinkingId = uid();
    setMsgs((p) => [...p, { id: thinkingId, role: "thinking" }]);
    const turn = (async () => {
      try {
        const envelope = await invokeTypedChat({
          accessToken,
          lessonId,
          sessionId,
          answer: { ...input.answer, client_msg_id: newClientMsgId() },
          mentorPreferences: mentorToPreferences(mentor),
        });
        setSessionId(envelope.session_id);
        // Merge the orchestrator's session snapshot (F7): status, step cursor, and the
        // sticky activities-done flag stay in sync without a refetch.
        setLearningSession((previous) =>
          previous
            ? {
                ...previous,
                id: envelope.session_id || previous.id,
                stage: envelope.stage,
                ...(envelope.session
                  ? {
                      status: envelope.session.status,
                      current_activity_id: envelope.session.current_activity_id,
                      activities_complete: envelope.session.activities_complete,
                    }
                  : {}),
              }
            : previous,
        );
        if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
        // Server-authoritative hold: a turn submitted while paused comes back held → re-lock.
        if (envelope.held) setSessionHeld(true);
        if (
          envelope.stage === "complete" ||
          envelope.next_action === "complete" ||
          envelope.session?.status === "complete"
        ) {
          setLessonComplete(true);
        }
        replaceThinking(thinkingId, envelopeMessage(envelope));
        return envelope;
      } catch (error) {
        replaceThinking(thinkingId, {
          id: uid(),
          role: "bot",
          isError: true,
          text: (error as Error).message || input.errorText,
          // Keep the payload so the error bubble's Retry re-sends the same turn.
          retryAnswer: input.answer,
        });
        return null;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    })();
    inFlightTurnRef.current = turn;
    return turn;
  };

  const submitTextAnswer = async (
    text: string,
    options?: { inputModality?: ChatInputModality; transcriptConfidence?: number | null },
  ): Promise<TypedChatEnvelope | null | "busy"> =>
    sendTurn({
      answer: {
        mode: "text",
        text,
        input_modality: options?.inputModality || "typed",
        transcript_confidence: options?.transcriptConfidence ?? null,
      },
      optimistic: [
        {
          id: uid(),
          role: "user",
          text,
          inputModality: options?.inputModality,
          transcriptConfidence: options?.transcriptConfidence ?? null,
        },
      ],
      errorText: "The mentor could not answer.",
    });

  const sendUser = async (
    text: string,
    options?: { inputModality?: ChatInputModality; transcriptConfidence?: number | null },
  ) => {
    await submitTextAnswer(text, options);
  };

  const sendChoice = async (choice: ChatChoice) => {
    const selected = choiceLabel(choice);
    const selectedValue = choiceValue(choice);
    if (!selectedValue) return;
    // Stamp the pick on the quiz message so history keeps showing WHICH option was chosen
    // after the live buttons retire.
    const quizMsgId = lastBotId;
    if (quizMsgId) {
      setMsgs((prev) =>
        prev.map((m) =>
          m.id === quizMsgId && m.role === "bot" ? { ...m, chosen: selectedValue } : m,
        ),
      );
    }
    await sendTurn({
      answer: { mode: "multiple_choice", choice_id: selectedValue },
      optimistic: [{ id: uid(), role: "user", text: `Selected: ${selected}` }],
      errorText: "The mentor could not check that answer.",
    });
  };

  // Re-send a failed turn from its error bubble (the bubble is removed; the original user
  // message is already in the stream, so no new optimistic message is added).
  const retryTurn = async (msg: Msg) => {
    if (msg.role !== "bot" || !msg.retryAnswer) return;
    const answer = msg.retryAnswer;
    setMsgs((prev) => prev.filter((m) => m.id !== msg.id));
    await sendTurn({ answer, optimistic: [], errorText: "The mentor could not answer." });
  };

  // Start the lesson over: a turn WITHOUT a session id makes the server open a FRESH session
  // (which becomes the newest, so future visits resume it). The old session's transcript stays
  // saved server-side; only this screen resets.
  const restartLesson = async () => {
    if (!accessToken || sendingRef.current) return;
    if (!window.confirm("Start this lesson over from step 1? Your previous work stays saved."))
      return;
    setVoiceMode(false);
    setSessionId(null);
    setLearningSession(null);
    setLessonComplete(false);
    setFollowUp(false);
    setSurfaceError("");
    setLessonArc(deriveLessonArc(activities, null));
    setSending(true);
    setMsgs([{ id: uid(), role: "thinking" }]);
    try {
      const envelope = await invokeTypedChat({
        accessToken,
        lessonId,
        mentorPreferences: mentorToPreferences(mentor),
      });
      setSessionId(envelope.session_id);
      if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
      setMsgs([envelopeMessage(envelope)]);
    } catch (error) {
      setSurfaceError((error as Error).message || "Could not restart the lesson.");
      setMsgs([]);
    } finally {
      setSending(false);
    }
  };

  // View navigation: the URL is the single source of truth (?view=…; null = tutor chat).
  const goView = (next: StudentView | null) => {
    void navigate({ to: "/chat", search: next ? { view: next } : {} });
  };

  // Opening a lesson from the Classes view LOADS it in place (chat.tsx owns loadLesson), then
  // returns to the chat view — the old modal-era same-route navigate never actually reloaded.
  const openLessonFromView = (nextLessonId: string) => {
    store.setLessonId(nextLessonId);
    goView(null);
    if (nextLessonId === lessonId) return; // already the open lesson — just come back to it
    setLessonId(nextLessonId);
    if (accessToken) void loadLesson(nextLessonId, accessToken, mentor);
  };

  // ESC steps out of a view back to the chat — unless something closer consumed it (quiz dialog,
  // popovers) or the student is typing.
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      goView(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Leaving the Review view refreshes the sidebar's due count (a completed guided review just
  // changed it).
  const prevViewRef = useRef<StudentView | undefined>(undefined);
  useEffect(() => {
    if (prevViewRef.current === "review" && view !== "review") {
      navData.refreshReviewCount();
    }
    prevViewRef.current = view;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const runCode = async (code: string, lang: ComposerLanguage): Promise<RuntimeRunResult> => {
    setRunInFlight(true);
    try {
      if (lang === "python") return await runPython(code);
      if (lang === "javascript") return await runJavaScript(code);
      if (!accessToken) return { ok: false, output: "You need to sign in again." };
      const result = await invokeJargonRun({ accessToken, code, answers: [] });
      return {
        ok: result.status === "ok",
        output: formatRunOutput(result),
        raw: result,
      };
    } finally {
      setRunInFlight(false);
    }
  };

  const sendCodeResult = async (code: string, lang: ComposerLanguage, result: RuntimeRunResult) => {
    // The run feedback must ALWAYS render, even when the mentor review is gated or fails —
    // the student needs to see what their code did.
    addMsg({
      id: uid(),
      role: "user",
      text: `Ran ${languageLabel(lang)}:`,
      code: { language: lang, source: code },
    });
    addMsg({
      id: uid(),
      role: "output",
      ok: result.ok,
      output: result.output || "(no output)",
      lang,
    });
    const turn = {
      answer: {
        mode: "code" as const,
        code,
        run_result: result.raw || { ok: result.ok, output: result.output, language: lang },
      },
      optimistic: [] as Msg[],
      errorText: "The mentor could not review that run.",
    };
    if ((await sendTurn(turn)) === "busy") {
      // A turn was in flight when the run resolved — wait it out, then retry once so the run
      // still gets its mentor review (and its learning_turns record for the teacher).
      await inFlightTurnRef.current?.catch(() => {});
      await sendTurn(turn);
    }
  };

  const submitStudentAssignment = async (input: {
    assignmentId: string;
    content: string;
    code: string;
    files: File[];
  }) => {
    const submitted = await submitAssignment({
      assignmentId: input.assignmentId,
      content: input.content,
      code: input.code,
      files: input.files,
    });
    setAssignments((current) => ({
      assignments: current.assignments,
      recipients: current.recipients.map((recipient) =>
        recipient.id === submitted.recipient.id ? submitted.recipient : recipient,
      ),
      submissions: [
        submitted.submission,
        ...current.submissions.filter((submission) => submission.id !== submitted.submission.id),
      ],
      files: [
        ...submitted.files,
        ...current.files.filter((file) => file.submission_id !== submitted.submission.id),
      ],
    }));
    const assignment = assignments.assignments.find((item) => item.id === input.assignmentId);
    addMsg({
      id: uid(),
      role: "user",
      text: `Submitted assignment: ${assignment?.title || "Assignment"}`,
    });
  };

  const useCodeInEditor = (code: ChatCodeBlock) => {
    // Loading code must always surface the editor: if the completion banner is covering the
    // composer, opt into follow-up mode first.
    if (lessonComplete) setFollowUp(true);
    composerRef.current?.loadCode({ code: code.source, language: code.language });
    requestAnimationFrame(() => {
      composerWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  };

  const handleResourceEvent = useCallback(
    async (
      resource: LessonChatResource,
      eventType: "shown" | "opened" | "played" | "paused" | "completed" | "downloaded",
      progress?: { progress_seconds?: number; progress_percent?: number },
    ) => {
      try {
        await recordResourceInteraction({
          resource_id: resource.id,
          session_id: sessionId,
          lesson_id: lessonId,
          event_type: eventType,
          ...progress,
        });
      } catch {
        // Resource interaction telemetry should never block the lesson conversation.
      }
    },
    [lessonId, sessionId],
  );

  const handleVoiceEvent = useCallback(
    async (event: VoiceInteractionEvent) => {
      try {
        await recordVoiceInteraction({
          session_id: sessionId,
          lesson_id: lessonId,
          ...event,
        });
      } catch {
        // Voice telemetry should never block the lesson conversation.
      }
    },
    [lessonId, sessionId],
  );

  if (!email || booting) {
    return (
      <div
        className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden"
        style={{ background: "var(--background)" }}
      >
        <AmbientCanvas intensity={0.35} />
        <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-[760px] flex-1 flex-col items-center justify-center gap-3 px-5">
          <div className="text-center text-[14px] text-muted-foreground">
            {surfaceError || "Opening Jargon\u2026"}
          </div>
          {surfaceError ? (
            <button
              type="button"
              onClick={() => {
                setSurfaceError("");
                setBooting(true);
                setBootAttempt((attempt) => attempt + 1);
              }}
              className="rounded-full border border-border px-4 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              Try again
            </button>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="relative h-dvh overflow-hidden" style={{ background: "var(--background)" }}>
      <AmbientCanvas intensity={0.35} />

      <div className="relative z-[var(--z-base)] grid h-full grid-rows-[60px_minmax(0,1fr)]">
        <header
          className="z-[var(--z-header)] backdrop-blur-md"
          style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
        >
          <div className="hairline h-full">
            <div className="flex h-full w-full items-center justify-between gap-2 px-4 sm:px-6">
              <button
                type="button"
                onClick={() => {
                  if (view) goView(null);
                  else scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                aria-label={
                  view ? "Back to the conversation" : "Scroll to the top of the conversation"
                }
                className="font-serif text-[22px] tracking-tight"
              >
                Jargon
              </button>
              <div className="flex items-center gap-2">
                {/* Mobile drawer trigger — desktop nav is the persistent sidebar. Its dot covers
                    what the sidebar rows would show (messages + review); notifications live on
                    the avatar at every size. */}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Menu"
                  className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground sm:h-9 sm:w-9 lg:hidden"
                >
                  <Menu className="h-[20px] w-[20px]" strokeWidth={1.6} />
                  {navData.dmUnread || navData.reviewDueCount > 0 ? (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
                  ) : null}
                </button>
                <ProfileMenu
                  email={email ?? ""}
                  mentor={mentor}
                  onMentorChange={updateMentor}
                  voice={voice}
                  onVoiceChange={updateVoice}
                  notifications={navData.notifications}
                  notificationsUnread={navData.notificationsUnread}
                  onMarkRead={navData.markNotificationRead}
                  onMarkAll={navData.markAllNotificationsRead}
                  onOpenDm={(channelId) => {
                    setDmDeepLinkChannel(channelId);
                    navData.clearDmUnread();
                    goView("messages");
                  }}
                />
              </div>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_264px]">
          {/* Workspace stack: the chat pane is ALWAYS mounted (its session, draft, voice, and
              realtime state must survive view switches) and merely hidden under an active view —
              visibility (not display:none) keeps its layout alive so scroll positions and the
              composer's observers stay valid. */}
          <div className="relative grid min-h-0">
            <div
              className={`col-start-1 row-start-1 flex min-h-0 flex-col ${
                view ? "pointer-events-none invisible" : ""
              }`}
              inert={view ? true : undefined}
            >
              <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-[820px] flex-1 flex-row px-5 pt-10">
                {/* Integrated progress rail — the chat column's left gutter (md+); mobile gets a
                    strip above the stream instead. Lives OUTSIDE the stream scroll container so
                    it never scrolls away. */}
                <div className="hidden w-14 shrink-0 md:flex">
                  {lessonArc ? (
                    <ChatStepperRail
                      arc={lessonArc}
                      activities={activities}
                      onRestart={restartLesson}
                    />
                  ) : null}
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {lessonArc ? (
                    <div className="md:hidden">
                      <ChatStepperStrip
                        arc={lessonArc}
                        activities={activities}
                        onRestart={restartLesson}
                      />
                    </div>
                  ) : null}
                  {activeLiveViewers.length ? (
                    <div className="mb-3 flex justify-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-info/40 bg-info/12 px-3 py-1.5 text-[12px] text-info">
                        <span className="h-1.5 w-1.5 rounded-full bg-info" />
                        Teacher viewing
                        {activeLiveViewers.length > 1 ? ` · ${activeLiveViewers.length}` : ""}
                      </div>
                    </div>
                  ) : null}
                  {sessionHeld ? (
                    <div className="mb-3 flex justify-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/12 px-3.5 py-1.5 text-[12px] text-warning">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                        Your teacher paused the session — hang tight
                      </div>
                    </div>
                  ) : null}
                  {surfaceError && !booting ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
                      <span className="min-w-0 flex-1">{surfaceError}</span>
                      <button
                        type="button"
                        onClick={() => setSurfaceError("")}
                        className="shrink-0 text-[12px] underline underline-offset-2"
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                  {reviewNudge ? (
                    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px] text-foreground">
                      <RotateCcw className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
                      <span className="min-w-0 flex-1">
                        {reviewNudge} {reviewNudge === 1 ? "skill is" : "skills are"} due for a
                        quick review.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.setItem("jargon-review-nudge", "1");
                          setReviewNudge(null);
                          goView("review");
                        }}
                        className="shrink-0 rounded-full border border-border px-3 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        Review now
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.setItem("jargon-review-nudge", "1");
                          setReviewNudge(null);
                        }}
                        aria-label="Dismiss review reminder"
                        className="shrink-0 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Later
                      </button>
                    </div>
                  ) : null}
                  <div
                    ref={scrollRef}
                    className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pb-5"
                  >
                    {msgs.map((m) => (
                      <MessageRow
                        key={m.id}
                        msg={m}
                        // Quiz choices are live ONLY on the newest mentor message — historical bubbles
                        // keep their text but their buttons are gone, so an old quiz can't be re-answered.
                        choicesActive={m.id === lastBotId}
                        choicesDisabled={sending || runInFlight}
                        onUseCode={useCodeInEditor}
                        onChooseChoice={sendChoice}
                        onRetry={retryTurn}
                        onResourceEvent={handleResourceEvent}
                        voice={voice}
                        accessToken={accessToken || ""}
                        lessonId={lessonId}
                        sessionId={sessionId}
                        onVoiceEvent={handleVoiceEvent}
                      />
                    ))}
                    {showJump ? (
                      <div className="sticky bottom-1 z-10 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setNewBelow(false);
                            scrollRef.current?.scrollTo({
                              top: scrollRef.current.scrollHeight,
                              behavior: "smooth",
                            });
                          }}
                          className="elev-hover inline-flex items-center gap-1.5 rounded-pill border border-border bg-depth-card/95 px-3.5 py-1.5 text-meta font-medium text-foreground shadow-raised backdrop-blur"
                        >
                          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                          {newBelow ? "New messages" : "Jump to latest"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div
                    ref={composerWrapRef}
                    className="relative z-30 shrink-0 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
                  >
                    <WorkDock
                      lessonId={lessonId}
                      assignments={assignments}
                      assessments={assessments}
                      onSubmitAssignment={submitStudentAssignment}
                      onOpenQuiz={setOpenQuizId}
                    />
                    {lessonComplete && !followUp ? (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border/60 bg-depth-card px-5 py-4 shadow-raised">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-foreground">
                            Lesson complete
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                            Nice work. Pick your next lesson, or keep chatting about this one.
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => goView("classes")}
                            className="rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90"
                          >
                            Pick your next lesson
                          </button>
                          <button
                            type="button"
                            onClick={() => setFollowUp(true)}
                            className="rounded-full border border-border px-4 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            Ask a follow-up
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {/* Keep the Composer MOUNTED (hidden) during voice so its state — code edits,
              imperative handle for "Use this code" — survives entering/leaving voice mode. */}
                    <div
                      className={voiceMode || (lessonComplete && !followUp) ? "hidden" : undefined}
                    >
                      <Composer
                        ref={composerRef}
                        key={lessonId}
                        initialCode={starterCode}
                        initialLanguage="jargon"
                        onSendText={sendUser}
                        onRunCode={runCode}
                        onSendCodeResult={sendCodeResult}
                        onVoiceEvent={handleVoiceEvent}
                        // Lock inputs while a teacher has the session paused (Phase 3).
                        sending={sending || sessionHeld}
                        canStartVoice
                        onStartVoice={() => setVoiceMode(true)}
                      />
                    </div>
                    {voiceMode ? (
                      <RealtimeVoicePanel
                        accessToken={accessToken || ""}
                        lessonId={lessonId}
                        sessionId={sessionId}
                        voice={voice}
                        autoStart
                        onClose={() => setVoiceMode(false)}
                        onVoiceEvent={handleVoiceEvent}
                        onSubmitVoiceTurn={async (text, confidence) =>
                          submitTextAnswer(text, {
                            inputModality: "audio_session",
                            transcriptConfidence: confidence ?? null,
                          })
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </main>
            </div>

            {view ? (
              <div key={view} className="col-start-1 row-start-1 flex min-h-0 flex-col">
                <ViewHost
                  view={view}
                  onBack={() => goView(null)}
                  onGo={goView}
                  currentLessonTitle={currentLesson?.title ?? null}
                  onOpenLesson={openLessonFromView}
                  accessToken={accessToken}
                  mentorPreferences={mentorToPreferences(mentor)}
                  dmDeepLinkChannel={dmDeepLinkChannel}
                />
              </div>
            ) : null}
          </div>

          {/* Persistent desktop sidebar — same-room furniture over the ambient canvas, always
              live even while a view is open. */}
          <aside className="hidden min-h-0 border-l border-border bg-[var(--surface-1)] backdrop-blur-md lg:flex">
            <Sidebar
              activeKey={view ?? "chat"}
              reviewDueCount={navData.reviewDueCount}
              messagesUnread={navData.dmUnread}
              onSelect={(key) => goView(key === "chat" ? null : key)}
            />
          </aside>
        </div>
      </div>

      <StudentNav
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        email={email ?? ""}
        reviewDueCount={navData.reviewDueCount}
        messagesUnread={navData.dmUnread}
        onSelect={(key) => {
          setDrawerOpen(false);
          if (key === "chat") {
            goView(null);
            return;
          }
          if (key === "messages") {
            setDmDeepLinkChannel(null);
            navData.clearDmUnread();
          }
          goView(key);
        }}
      />

      {/* Quiz-taking stays a FOCUSED modal over whatever surface is open (assessment deserves an
          intentional frame). Closing re-fetches the assessments bundle so the work bar reflects a
          fresh submission. */}
      <ModalCard
        open={openQuizId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setOpenQuizId(null);
            void fetchStudentAssessments()
              .then(setAssessments)
              .catch(() => {});
          }
        }}
        title="Quiz"
        size="large"
      >
        {openQuizId ? (
          <QuizPanel assessmentId={openQuizId} accessToken={accessToken || ""} voice={voice} />
        ) : null}
      </ModalCard>
    </div>
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

function RealtimeVoicePanel({
  accessToken,
  lessonId,
  sessionId,
  voice,
  autoStart,
  onClose,
  onVoiceEvent,
  onSubmitVoiceTurn,
}: {
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
}) {
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
  const supported =
    typeof window !== "undefined" &&
    "RTCPeerConnection" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia);

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
    setMessage("Sending your spoken answer to Jargon...");
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
    setMessage("Opening microphone...");
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
          handleRealtimeEvent(JSON.parse(event.data) as RealtimeEvent);
        } catch {
          // Realtime event parsing should never kill the voice session.
        }
      });
      channel.addEventListener("open", () => {
        setMessage("Live voice is warming up...");
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
      setMessage("Connecting to the Mentor...");
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
    <div className="mt-2 flex items-center justify-between gap-3 rounded-3xl border border-border bg-background/70 px-4 py-4">
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
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            Live voice
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {voice.voiceName}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {message || "Talk with the Mentor out loud — your spoken answers submit automatically."}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status === "idle" || status === "error" ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!accessToken}
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
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
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />{" "}
          {status === "live" || status === "connecting" ? "Stop" : "Close"}
        </button>
      </div>
    </div>
  );
}

// The slim work bar: one "Work due · N" row above the composer that expands into the full
// assignment/quiz cards. Collapsed by default so due work stays one tap away without pushing
// the composer down; renders nothing when the current lesson has no work.
function WorkDock({
  lessonId,
  assignments,
  assessments,
  onSubmitAssignment,
  onOpenQuiz,
}: {
  lessonId: string;
  assignments: StudentAssignmentBundle;
  assessments: StudentAssessmentBundle;
  onSubmitAssignment: Parameters<typeof AssignmentDock>[0]["onSubmitAssignment"];
  onOpenQuiz: (assessmentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const assignmentCount = assignments.assignments.filter(
    (a) => a.status === "assigned" && a.lesson_id === lessonId,
  ).length;
  const assessmentCount = assessments.assessments.filter(
    (a) => a.status === "published" && a.lesson_id === lessonId,
  ).length;
  const count = assignmentCount + assessmentCount;
  if (!count) return null;
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 rounded-pill border border-border bg-depth-card px-4 py-2 text-left shadow-card transition-colors duration-(--dur-fast) hover:bg-muted/50"
      >
        <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          Work due · {count}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>
      {expanded ? (
        <div className="mt-2">
          <AssignmentDock
            lessonId={lessonId}
            bundle={assignments}
            onSubmitAssignment={onSubmitAssignment}
          />
          <AssessmentDock lessonId={lessonId} bundle={assessments} onOpenQuiz={onOpenQuiz} />
        </div>
      ) : null}
    </div>
  );
}

function AssessmentDock({
  lessonId,
  bundle,
  onOpenQuiz,
}: {
  lessonId: string;
  bundle: StudentAssessmentBundle;
  onOpenQuiz: (assessmentId: string) => void;
}) {
  const visibleAssessments = bundle.assessments
    .filter((assessment) => assessment.status === "published" && assessment.lesson_id === lessonId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (!visibleAssessments.length) return null;

  return (
    <div className="mb-3 space-y-2">
      {visibleAssessments.map((assessment) => {
        const recipient = bundle.recipients.find((item) => item.assessment_id === assessment.id);
        const attempts = bundle.attempts.filter(
          (attempt) => attempt.assessment_id === assessment.id,
        );
        const latestAttempt = attempts[0] || null;
        const questionCount = bundle.items.filter(
          (item) => item.assessment_id === assessment.id,
        ).length;
        return (
          <GradientCard key={assessment.id} innerClassName="overflow-hidden">
            <div className="bg-background/70 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Quiz · {recipient?.status || "assigned"}
                  </div>
                  <div className="mt-1 text-[13.5px] font-medium text-foreground">
                    {assessment.title}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    {questionCount} question{questionCount === 1 ? "" : "s"}
                    {assessment.due_at ? ` · Due ${formatChatDateTime(assessment.due_at)}` : ""}
                  </div>
                  {latestAttempt?.final_score !== null &&
                  latestAttempt?.final_score !== undefined ? (
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                      Latest score {formatScore(latestAttempt.final_score, "not graded")}
                    </div>
                  ) : recipient?.status === "submitted" ? (
                    <div className="mt-1 text-[11.5px] text-warning">
                      Submitted · pending teacher review
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenQuiz(assessment.id)}
                  className="inline-flex shrink-0 items-center justify-center rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted"
                >
                  {recipient?.status === "complete" ? "View result" : "Open quiz"}
                </button>
              </div>
            </div>
          </GradientCard>
        );
      })}
    </div>
  );
}

function AssignmentDock({
  lessonId,
  bundle,
  onSubmitAssignment,
}: {
  lessonId: string;
  bundle: StudentAssignmentBundle;
  onSubmitAssignment: (input: {
    assignmentId: string;
    content: string;
    code: string;
    files: File[];
  }) => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      { content: string; code: string; files: File[]; saving: boolean; message: string }
    >
  >({});
  const visibleAssignments = bundle.assignments
    .filter((assignment) => assignment.status === "assigned" && assignment.lesson_id === lessonId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (!visibleAssignments.length) return null;

  const getDraft = (assignmentId: string) =>
    drafts[assignmentId] || { content: "", code: "", files: [], saving: false, message: "" };

  const setDraft = (
    assignmentId: string,
    patch: Partial<{
      content: string;
      code: string;
      files: File[];
      saving: boolean;
      message: string;
    }>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [assignmentId]: {
        content: current[assignmentId]?.content || "",
        code: current[assignmentId]?.code || "",
        files: current[assignmentId]?.files || [],
        saving: current[assignmentId]?.saving || false,
        message: current[assignmentId]?.message || "",
        ...patch,
      },
    }));
  };

  const submit = async (assignmentId: string) => {
    const draft = getDraft(assignmentId);
    if (!draft.content.trim() && !draft.code.trim() && !draft.files.length) {
      setDraft(assignmentId, { message: "Add text, code, or a file before submitting." });
      return;
    }
    setDraft(assignmentId, { saving: true, message: "" });
    try {
      await onSubmitAssignment({
        assignmentId,
        content: draft.content,
        code: draft.code,
        files: draft.files,
      });
      setDraft(assignmentId, {
        content: "",
        code: "",
        files: [],
        saving: false,
        message: "Submitted.",
      });
    } catch (error) {
      setDraft(assignmentId, {
        saving: false,
        message: (error as Error).message || "Could not submit assignment.",
      });
    }
  };

  return (
    <div className="mb-3 space-y-2">
      {visibleAssignments.map((assignment) => {
        const recipient = bundle.recipients.find((item) => item.assignment_id === assignment.id);
        const submissions = bundle.submissions.filter(
          (submission) => submission.assignment_id === assignment.id,
        );
        const latestSubmission = submissions[0] || null;
        const submissionFiles = latestSubmission
          ? bundle.files.filter((file) => file.submission_id === latestSubmission.id)
          : [];
        const draft = getDraft(assignment.id);
        const expanded = expandedId === assignment.id;
        return (
          <GradientCard key={assignment.id} innerClassName="overflow-hidden">
            <div className="bg-background/70 p-3">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : assignment.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Assignment · {recipient?.status || "assigned"}
                  </span>
                  <span className="mt-1 block text-[13.5px] font-medium text-foreground">
                    {assignment.title}
                  </span>
                  {assignment.due_at ? (
                    <span className="mt-1 block text-[11.5px] text-muted-foreground">
                      Due {formatChatDateTime(assignment.due_at)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground">
                  {expanded ? "Close" : "Open"}
                </span>
              </button>

              {expanded ? (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                    {assignment.instructions || "Submit your work when ready."}
                  </p>

                  {latestSubmission ? (
                    <div className="mt-3 rounded-2xl border border-border bg-background/45 p-3">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        Latest submission · {latestSubmission.status}
                      </div>
                      {latestSubmission.feedback ? (
                        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">
                          {latestSubmission.feedback}
                        </p>
                      ) : (
                        <p className="text-[12.5px] text-muted-foreground">
                          Waiting for teacher feedback.
                        </p>
                      )}
                      <div className="mt-2 text-[11.5px] text-muted-foreground">
                        Score:{" "}
                        {latestSubmission.score === null
                          ? "not graded"
                          : formatScore(latestSubmission.score, "not graded")}
                      </div>
                      {submissionFiles.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {submissionFiles.map((file) => {
                            const fileState = submissionFileState(file);
                            // Students can open their OWN submitted files: the storage SELECT
                            // policy already permits owner reads for non-quarantined, non-purged
                            // paths, so a signed URL works here just like teacher-side.
                            if (fileState === "available") {
                              return (
                                <button
                                  key={file.id}
                                  type="button"
                                  onClick={() => {
                                    void getSubmissionFileSignedUrl(file)
                                      .then((url) => window.open(url, "_blank", "noopener"))
                                      .catch(() => {});
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <Paperclip className="h-3 w-3" strokeWidth={1.7} />
                                  {file.original_filename}
                                </button>
                              );
                            }
                            return (
                              <span
                                key={file.id}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground"
                              >
                                <Paperclip className="h-3 w-3" strokeWidth={1.7} />
                                {file.original_filename}
                                {fileState === "quarantined" ? " · flagged" : ""}
                                {fileState === "purged" ? " · removed" : ""}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-2">
                    <textarea
                      value={draft.content}
                      onChange={(event) => setDraft(assignment.id, { content: event.target.value })}
                      placeholder="Write your answer..."
                      className="min-h-[74px] rounded-2xl border border-border bg-background/65 px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <CodeArea
                      value={draft.code}
                      onChange={(code) => setDraft(assignment.id, { code })}
                      height={120}
                      placeholder="Optional code..."
                    />
                    <input
                      type="file"
                      multiple
                      accept="image/*,application/pdf,.doc,.docx,.txt,.md,.rtf,.csv,.zip,.py,.js,.ts,.java,.c,.cpp,.h,.cs,.html,.css,.json"
                      onChange={(event) => {
                        const picked = Array.from(event.target.files || []);
                        if (picked.length > MAX_SUBMISSION_FILES) {
                          setDraft(assignment.id, {
                            files: [],
                            message: `Attach at most ${MAX_SUBMISSION_FILES} files.`,
                          });
                          event.target.value = "";
                          return;
                        }
                        const tooBig = picked.find((f) => f.size > MAX_SUBMISSION_FILE_BYTES);
                        if (tooBig) {
                          setDraft(assignment.id, {
                            files: [],
                            message: `"${tooBig.name}" is too large — files must be under ${Math.round(
                              MAX_SUBMISSION_FILE_BYTES / (1024 * 1024),
                            )} MB.`,
                          });
                          event.target.value = "";
                          return;
                        }
                        setDraft(assignment.id, { files: picked, message: "" });
                      }}
                      className="rounded-2xl border border-border bg-background/65 px-3 py-2 text-[12.5px] text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:text-foreground"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11.5px] text-muted-foreground">
                        {draft.message
                          ? draft.message
                          : draft.files.length
                            ? `${draft.files.length} file${draft.files.length === 1 ? "" : "s"} ready`
                            : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void submit(assignment.id)}
                        disabled={draft.saving}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
                        {draft.saving ? "Submitting..." : "Submit"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </GradientCard>
        );
      })}
    </div>
  );
}

function MessageRow({
  msg,
  choicesActive = false,
  choicesDisabled = false,
  onUseCode,
  onChooseChoice,
  onRetry,
  onResourceEvent,
  voice,
  accessToken,
  lessonId,
  sessionId,
  onVoiceEvent,
}: {
  msg: Msg;
  // Choices render only on the newest mentor message; disabled while a turn is in flight.
  choicesActive?: boolean;
  choicesDisabled?: boolean;
  onUseCode: (code: ChatCodeBlock) => void;
  onChooseChoice: (choice: ChatChoice) => void;
  onRetry: (msg: Msg) => void;
  onResourceEvent: (
    resource: LessonChatResource,
    eventType: "shown" | "opened" | "played" | "paused" | "completed" | "downloaded",
    progress?: { progress_seconds?: number; progress_percent?: number },
  ) => Promise<void>;
  voice: VoiceSettings;
  accessToken: string;
  lessonId: string;
  sessionId: string | null;
  onVoiceEvent: (event: VoiceInteractionEvent) => void | Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.26, ease: "power2.out" },
    );
  }, []);

  if (msg.role === "user") {
    const parsedRun = msg.code ? null : parseRunMessage(msg.text);
    const code = msg.code || parsedRun?.code;
    const text = parsedRun?.text || msg.text;
    const copyText = code ? `${text}\n\n${code.source}` : msg.text;

    return (
      <div ref={ref} className="flex justify-end">
        <div className="flex max-w-[85%] flex-col items-end gap-2">
          <div className="whitespace-pre-wrap rounded-card border border-border/50 bg-depth-card px-4 py-2.5 text-[14.5px] leading-relaxed text-foreground shadow-card">
            {text}
          </div>
          {msg.inputModality === "dictated" || msg.inputModality === "audio_session" ? (
            <span className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {msg.inputModality === "audio_session" ? "Voice" : "Dictated"}
            </span>
          ) : null}
          {code && (
            <div className="w-full min-w-0 md:min-w-[420px]">
              <HistoryCodePanel code={code} onUseCode={onUseCode} />
            </div>
          )}
          <CopyAction text={copyText} />
        </div>
      </div>
    );
  }

  if (msg.role === "thinking") {
    return (
      <div ref={ref} className="flex">
        <div className="px-3 py-3">
          <span aria-label="Jargon is thinking" className="run-bounce-loader">
            <span className="run-bounce-dot" />
            <span className="run-bounce-dot" />
            <span className="run-bounce-dot" />
          </span>
        </div>
      </div>
    );
  }

  if (msg.role === "output") {
    return (
      <div ref={ref} className="flex">
        <div className="w-full">
          <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {msg.ok ? "Output" : "Error"} \u00B7 {languageLabel(msg.lang)}
          </div>
          <pre
            className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-[var(--code-background)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--code-foreground)]"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {msg.output}
          </pre>
          <div className="mt-1.5">
            <CopyAction text={msg.output} />
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === "teacher") {
    return (
      <div ref={ref} className="flex">
        <div className="w-full max-w-[92%] space-y-2">
          <div className="rounded-card border border-info/40 bg-info/12 px-4 py-3 backdrop-blur-sm">
            <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-info">Teacher</div>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
              {msg.text}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyAction text={msg.text} />
            <ReadAloudAction
              text={msg.text}
              voice={voice}
              accessToken={accessToken}
              lessonId={lessonId}
              sessionId={sessionId}
              onVoiceEvent={onVoiceEvent}
            />
          </div>
        </div>
      </div>
    );
  }

  // A failed turn: visibly an error (not a lookalike mentor reply), with an inline Retry that
  // re-sends the original payload.
  if (msg.isError) {
    return (
      <div ref={ref} className="flex">
        <div className="w-full max-w-[92%]">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger/40 bg-danger/10 px-4 py-3 backdrop-blur-sm">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] text-danger">
                <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                Something went wrong
              </div>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
                {msg.text}
              </p>
            </div>
            {msg.retryAnswer ? (
              <button
                type="button"
                disabled={choicesDisabled}
                onClick={() => onRetry(msg)}
                className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex">
      <div className="w-full max-w-[92%] space-y-3">
        <MessageContent text={msg.text} onUseCode={onUseCode} />
        {msg.choices?.length && choicesActive ? (
          <div className="flex flex-wrap gap-2">
            {msg.choices.map((choice, index) => (
              <button
                key={`${choiceValue(choice)}-${index}`}
                type="button"
                disabled={choicesDisabled}
                onClick={() => onChooseChoice(choice)}
                className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {choiceLabel(choice)}
              </button>
            ))}
          </div>
        ) : msg.choices?.length && msg.chosen ? (
          // A retired quiz keeps its options visible with the student's pick highlighted.
          <div className="flex flex-wrap gap-2" aria-label="Your answer">
            {msg.choices.map((choice, index) => {
              const picked = choiceValue(choice) === msg.chosen;
              return (
                <span
                  key={`${choiceValue(choice)}-${index}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${
                    picked
                      ? "border-foreground/50 bg-foreground/10 font-medium text-foreground"
                      : "border-border/60 text-muted-foreground opacity-70"
                  }`}
                >
                  {picked ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> : null}
                  {choiceLabel(choice)}
                </span>
              );
            })}
          </div>
        ) : null}
        {msg.resources?.length ? (
          <div className="space-y-2">
            {msg.resources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                onResourceEvent={onResourceEvent}
              />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <CopyAction text={msg.text} />
          <ReadAloudAction
            text={msg.text}
            voice={voice}
            accessToken={accessToken}
            lessonId={lessonId}
            sessionId={sessionId}
            onVoiceEvent={onVoiceEvent}
          />
        </div>
        {msg.code && <HistoryCodePanel code={msg.code} onUseCode={onUseCode} />}
      </div>
    </div>
  );
}

function ResourceCard({
  resource,
  onResourceEvent,
}: {
  resource: LessonChatResource;
  onResourceEvent: (
    resource: LessonChatResource,
    eventType: "shown" | "opened" | "played" | "paused" | "completed" | "downloaded",
    progress?: { progress_seconds?: number; progress_percent?: number },
  ) => Promise<void>;
}) {
  const [openedUrl, setOpenedUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void onResourceEvent(resource, "shown");
  }, [onResourceEvent, resource]);

  useEffect(() => {
    let cancelled = false;
    if (!resource.thumbnail_path && !resource.thumbnail_url) {
      setThumbnailUrl("");
      return () => {
        cancelled = true;
      };
    }
    void getLessonResourceThumbnailSignedUrl(resource)
      .then((url) => {
        if (!cancelled) setThumbnailUrl(url);
      })
      .catch(() => {
        if (!cancelled) setThumbnailUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [resource]);

  const mediaProgress = (element: HTMLMediaElement) => ({
    progress_seconds: Math.round(element.currentTime || 0),
    progress_percent:
      element.duration && Number.isFinite(element.duration)
        ? Math.min(100, Math.round((element.currentTime / element.duration) * 100))
        : undefined,
  });

  const openResource = async () => {
    setBusy(true);
    try {
      const url =
        resource.resource_type === "youtube"
          ? youtubeEmbedUrl(resource.external_url || "") || resource.external_url || ""
          : await getLessonResourceSignedUrl(resource);
      if (!url) throw new Error("Resource URL is missing.");
      await onResourceEvent(resource, "opened");

      if (shouldRenderInline(resource)) {
        setOpenedUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      // The visible button state is enough for V1; the mentor flow should keep moving.
    } finally {
      setBusy(false);
    }
  };

  return (
    <GradientCard innerClassName="overflow-hidden">
      <div className="bg-background/55 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="mt-1 hidden h-24 w-16 shrink-0 rounded-2xl border border-border object-cover sm:block"
              />
            ) : null}
            <div className="min-w-0">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <FileText className="h-3.5 w-3.5" strokeWidth={1.6} />
                {resource.resource_type}
              </div>
              <h3 className="text-[14px] font-medium text-foreground">{resource.title}</h3>
              {resource.student_instructions ? (
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {resource.student_instructions}
                </p>
              ) : resource.description ? (
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {resource.description}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void openResource()}
            disabled={busy}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {shouldRenderInline(resource) ? (
              <Play className="h-3.5 w-3.5" strokeWidth={1.7} />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
            {busy ? "Opening..." : "Open"}
          </button>
        </div>

        {openedUrl ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-[var(--code-background)]">
            {resource.resource_type === "youtube" || resource.resource_type === "pdf" ? (
              <iframe
                title={resource.title}
                src={openedUrl}
                className="h-[320px] w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : resource.resource_type === "video" ? (
              <video
                src={openedUrl}
                className="max-h-[360px] w-full"
                controls
                onPlay={(event) =>
                  void onResourceEvent(resource, "played", mediaProgress(event.currentTarget))
                }
                onPause={(event) =>
                  void onResourceEvent(resource, "paused", mediaProgress(event.currentTarget))
                }
                onEnded={(event) =>
                  void onResourceEvent(resource, "completed", mediaProgress(event.currentTarget))
                }
              />
            ) : resource.resource_type === "audio" ? (
              <audio
                src={openedUrl}
                className="w-full p-3"
                controls
                onPlay={(event) =>
                  void onResourceEvent(resource, "played", mediaProgress(event.currentTarget))
                }
                onPause={(event) =>
                  void onResourceEvent(resource, "paused", mediaProgress(event.currentTarget))
                }
                onEnded={(event) =>
                  void onResourceEvent(resource, "completed", mediaProgress(event.currentTarget))
                }
              />
            ) : resource.resource_type === "image" ? (
              <img
                src={openedUrl}
                alt={resource.title}
                className="max-h-[360px] w-full object-contain"
              />
            ) : null}
          </div>
        ) : null}

        <MaterialComments resourceId={resource.id} />
      </div>
    </GradientCard>
  );
}

function shouldRenderInline(resource: LessonChatResource) {
  return ["youtube", "pdf", "video", "audio", "image"].includes(resource.resource_type);
}

function youtubeEmbedUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : host === "youtube.com"
          ? url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop()
          : "";
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : "";
  } catch {
    return "";
  }
}

function formatChatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// Minimal inline markdown for tutor prose: **bold** -> emphasized key term. Everything else
// stays plain text (newlines preserved by the parent's whitespace-pre-wrap).
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => {
    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) {
      return (
        <b key={i} className="font-semibold text-foreground">
          {bold[1]}
        </b>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// A short affirming lead sentence ending in "!" ("Nice work!") becomes the shiny headline.
function splitOpeningBeat(text: string): { beat: string | null; rest: string } {
  const lead = text.replace(/^\s+/, "");
  const match = lead.match(/^([^\n.!?]{1,64}!)(?:\s+|$)/);
  if (match) return { beat: match[1], rest: lead.slice(match[0].length) };
  return { beat: null, rest: text };
}

function MessageContent({
  text,
  onUseCode,
}: {
  text: string;
  onUseCode: (code: ChatCodeBlock) => void;
}) {
  const segments = parseFencedBlocks(text);
  let beatConsumed = false;

  return (
    <div className="space-y-3">
      {segments.map((segment, index) => {
        if (segment.kind === "code") {
          return (
            <HistoryCodePanel
              key={`${segment.kind}-${index}`}
              code={segment.code}
              onUseCode={onUseCode}
            />
          );
        }

        if (!segment.text.trim()) return null;

        // Only the first prose segment can carry the opening beat.
        let beat: string | null = null;
        let body = segment.text;
        if (!beatConsumed) {
          beatConsumed = true;
          const split = splitOpeningBeat(segment.text);
          beat = split.beat;
          body = split.rest;
        }

        return (
          <div
            key={`${segment.kind}-${index}`}
            className="whitespace-pre-wrap text-body-lg text-foreground"
          >
            {beat ? <span className="tutor-beat">{beat.replace(/\*\*/g, "")}</span> : null}
            {body.trim() ? renderInline(body) : null}
          </div>
        );
      })}
    </div>
  );
}

function HistoryCodePanel({
  code,
  onUseCode,
}: {
  code: ChatCodeBlock;
  onUseCode: (code: ChatCodeBlock) => void;
}) {
  return (
    <GradientCard innerClassName="overflow-hidden">
      <div className="overflow-hidden rounded-[inherit] bg-[var(--code-background)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {languageLabel(code.language)}
          </span>
          <div className="flex items-center gap-2">
            <CopyAction text={code.source} label="Copy code" />
            <button
              type="button"
              aria-label="Use in editor"
              title="Use in editor"
              onClick={() => onUseCode(code)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Code2 className="h-[14px] w-[14px]" strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <pre
          className="max-h-[320px] overflow-auto whitespace-pre-wrap px-4 py-3 text-[12.5px] leading-relaxed text-[var(--code-foreground)]"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {code.language === "jargon" ? (
            <HighlightedJargonCode source={code.source} />
          ) : (
            code.source
          )}
        </pre>
      </div>
    </GradientCard>
  );
}

function HighlightedJargonCode({ source }: { source: string }) {
  return (
    <>
      {tokenizeJargon(source).map((token, index) => (
        <span key={`${token.kind}-${index}`} className={jargonTokenClass[token.kind]}>
          {token.text}
        </span>
      ))}
    </>
  );
}

function CopyAction({ text, label = "Copy" }: { text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  const copy = async () => {
    try {
      await copyToClipboard(text);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={status === "copied" ? "Copied" : status === "error" ? "Copy failed" : label}
      title={status === "copied" ? "Copied" : status === "error" ? "Copy failed" : label}
      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {status === "copied" ? (
        <Check className="h-[14px] w-[14px]" strokeWidth={1.9} />
      ) : status === "error" ? (
        <AlertCircle className="h-[14px] w-[14px]" strokeWidth={1.9} />
      ) : (
        <Copy className="h-[14px] w-[14px]" strokeWidth={1.8} />
      )}
    </button>
  );
}
