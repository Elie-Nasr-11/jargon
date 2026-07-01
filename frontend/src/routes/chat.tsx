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
  Paperclip,
  Pause,
  Play,
  RotateCcw,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { HeaderMenus } from "@/components/HeaderMenus";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Composer, type ComposerHandle, type ComposerLanguage } from "@/components/Composer";
import { GradientCard } from "@/components/GradientCard";
import {
  DEFAULT_MENTOR,
  DEFAULT_VOICE,
  store,
  type Lesson as MenuLesson,
  type MentorConfig,
  type VoiceSettings,
} from "@/lib/jargon-store";
import {
  fetchLiveSessionViewers,
  fetchLearningTurns,
  fetchTeacherLiveComments,
  fetchStudentAssignments,
  fetchStudentAssessments,
  fetchLatestLearningSession,
  fetchLessonActivities,
  fetchLessons,
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
} from "@/lib/api";
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
  MentorPreferences,
  StudentAssignmentBundle,
  StudentAssessmentBundle,
  TeacherLiveComment,
  TypedChatEnvelope,
  VoiceInteractionEvent,
} from "@/lib/types";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [{ title: "Jargon" }, { name: "description", content: "Your conversation with Jargon." }],
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
    }
  | { id: string; role: "teacher"; text: string; createdAt?: string }
  | { id: string; role: "output"; ok: boolean; output: string; lang: ComposerLanguage }
  | { id: string; role: "thinking" };

const uid = () => Math.random().toString(36).slice(2);

const stageProgress: Record<LearningSession["stage"], number> = {
  intro: 0.12,
  teach: 0.28,
  practice: 0.5,
  assessment: 0.72,
  review: 0.88,
  complete: 1,
};

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

function lessonSubtitle(lesson: Lesson) {
  const path = [lesson.course_title, lesson.unit_title].filter(Boolean).join(" · ");
  return (
    [path || lesson.module, lesson.level].filter(Boolean).join(" · ") || lesson.tutor_prompt || ""
  );
}

// A slim "Step N of M" strip under the header + an expandable roadmap of the lesson steps
// (done / current / upcoming), so the student sees the arc the mentor is guiding them through.
function LessonProgress({ arc }: { arc: LessonArc }) {
  const [open, setOpen] = useState(false);
  if (arc.total <= 1) return null;
  const steps: { step: number; title: string; state: "done" | "current" | "upcoming" }[] = [
    ...arc.completed.map((s) => ({ ...s, state: "done" as const })),
    ...(arc.current
      ? [{ step: arc.step, title: arc.current.title, state: "current" as const }]
      : []),
    ...arc.upcoming.map((s) => ({ ...s, state: "upcoming" as const })),
  ];
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-full border border-border bg-background/60 px-3.5 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex flex-1 items-center gap-1" aria-hidden>
          {Array.from({ length: arc.total }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < arc.step - 1
                  ? "bg-foreground/35"
                  : i === arc.step - 1
                    ? "bg-foreground"
                    : "bg-border"
              }`}
            />
          ))}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-foreground">
          Step {arc.step} of {arc.total}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>
      {open ? (
        <ol className="mt-2 space-y-0.5 rounded-2xl border border-border bg-background/70 p-2">
          {steps.map((s) => (
            <li key={s.step} className="flex items-center gap-2.5 px-2 py-1.5 text-[13px]">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                  s.state === "done"
                    ? "bg-success/15 text-success"
                    : s.state === "current"
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {s.state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : s.step}
              </span>
              <span
                className={
                  s.state === "current" ? "font-medium text-foreground" : "text-muted-foreground"
                }
              >
                {s.title}
              </span>
              {s.state === "current" ? (
                <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  now
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function mapLessons(
  lessons: Lesson[],
  activeLessonId: string,
  learningSession: LearningSession | null,
): MenuLesson[] {
  return lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    subtitle: lessonSubtitle(lesson),
    group: lesson.curriculum_group || lesson.subject_title || lesson.module || "Lessons",
    progress:
      lesson.id === activeLessonId && learningSession
        ? (stageProgress[learningSession.stage] ?? 0)
        : 0,
  }));
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
  const errors = result.errors?.length ? result.errors.join("\n") : "";
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
  const [booting, setBooting] = useState(true);
  const [surfaceError, setSurfaceError] = useState("");
  const [liveViewers, setLiveViewers] = useState<LiveSessionViewer[]>([]);
  const [viewerClock, setViewerClock] = useState(() => Date.now());
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
  const menuLessons = useMemo(
    () => mapLessons(lessons, lessonId, learningSession),
    [lessons, lessonId, learningSession],
  );
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

  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
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
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  useEffect(() => {
    const id = window.setInterval(() => setViewerClock(Date.now()), 10_000);
    return () => window.clearInterval(id);
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
    try {
      const [lessonActivities, latest] = await Promise.all([
        fetchLessonActivities(nextLessonId),
        fetchLatestLearningSession(nextLessonId),
      ]);
      setActivities(lessonActivities);
      setLearningSession(latest);
      setSessionId(latest?.id || null);
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
      const message = (error as Error).message || "Could not load the live lesson.";
      setSurfaceError(message);
      setMsgs([{ id: uid(), role: "bot", text: message }]);
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
        const [liveLessons, liveAssignments, liveAssessments] = await Promise.all([
          fetchLessons(),
          fetchStudentAssignments(),
          fetchStudentAssessments(),
        ]);
        if (!alive) return;
        const selected =
          liveLessons.find((lesson) => lesson.id === store.getLessonId())?.id ||
          liveLessons[0]?.id ||
          "lesson1";
        const savedMentor = store.getMentor();
        const savedVoice = store.getVoice();
        setAccessToken(session.access_token);
        setEmail(session.user.email || "");
        setLessons(liveLessons);
        setAssignments(liveAssignments);
        setAssessments(liveAssessments);
        setLessonId(selected);
        setMentor(savedMentor);
        setVoice(savedVoice);
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
  }, [navigate]);

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
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const selectLesson = async (id: string) => {
    if (!accessToken) return;
    setLessonId(id);
    store.setLessonId(id);
    await loadLesson(id, accessToken, mentor);
  };

  const updateMentor = (next: MentorConfig) => {
    setMentor(next);
    store.setMentor(next);
  };

  const updateVoice = (next: VoiceSettings) => {
    setVoice(next);
    store.setVoice(next);
  };

  const addMsg = (m: Msg) => setMsgs((prev) => [...prev, m]);

  const replaceThinking = (thinkingId: string, message: Msg) => {
    setMsgs((previous) => previous.filter((m) => m.id !== thinkingId).concat(message));
  };

  const submitTextAnswer = async (
    text: string,
    options?: { inputModality?: ChatInputModality; transcriptConfidence?: number | null },
  ): Promise<TypedChatEnvelope | null> => {
    if (!accessToken) return null;
    addMsg({
      id: uid(),
      role: "user",
      text,
      inputModality: options?.inputModality,
      transcriptConfidence: options?.transcriptConfidence ?? null,
    });
    setSending(true);
    const thinkingId = uid();
    setMsgs((p) => [...p, { id: thinkingId, role: "thinking" }]);
    try {
      const envelope = await invokeTypedChat({
        accessToken,
        lessonId,
        sessionId,
        answer: {
          mode: "text",
          text,
          input_modality: options?.inputModality || "typed",
          transcript_confidence: options?.transcriptConfidence ?? null,
        },
        mentorPreferences: mentorToPreferences(mentor),
      });
      setSessionId(envelope.session_id);
      setLearningSession((previous) =>
        previous
          ? { ...previous, id: envelope.session_id || previous.id, stage: envelope.stage }
          : previous,
      );
      if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
      replaceThinking(thinkingId, envelopeMessage(envelope));
      return envelope;
    } catch (error) {
      replaceThinking(thinkingId, {
        id: uid(),
        role: "bot",
        text: (error as Error).message || "The mentor could not answer.",
      });
      return null;
    } finally {
      setSending(false);
    }
  };

  const sendUser = async (
    text: string,
    options?: { inputModality?: ChatInputModality; transcriptConfidence?: number | null },
  ) => {
    await submitTextAnswer(text, options);
  };

  const sendChoice = async (choice: ChatChoice) => {
    if (!accessToken) return;
    const selected = choiceLabel(choice);
    const selectedValue = choiceValue(choice);
    if (!selectedValue) return;
    addMsg({ id: uid(), role: "user", text: `Selected: ${selected}` });
    setSending(true);
    const thinkingId = uid();
    setMsgs((p) => [...p, { id: thinkingId, role: "thinking" }]);
    try {
      const envelope = await invokeTypedChat({
        accessToken,
        lessonId,
        sessionId,
        answer: { mode: "multiple_choice", choice_id: selectedValue },
        mentorPreferences: mentorToPreferences(mentor),
      });
      setSessionId(envelope.session_id);
      setLearningSession((previous) =>
        previous
          ? { ...previous, id: envelope.session_id || previous.id, stage: envelope.stage }
          : previous,
      );
      if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
      replaceThinking(thinkingId, envelopeMessage(envelope));
    } catch (error) {
      replaceThinking(thinkingId, {
        id: uid(),
        role: "bot",
        text: (error as Error).message || "The mentor could not check that answer.",
      });
    } finally {
      setSending(false);
    }
  };

  const runCode = async (code: string, lang: ComposerLanguage): Promise<RuntimeRunResult> => {
    if (lang === "python") return runPython(code);
    if (lang === "javascript") return runJavaScript(code);
    if (!accessToken) return { ok: false, output: "You need to sign in again." };
    const result = await invokeJargonRun({ accessToken, code, answers: [] });
    return {
      ok: result.status === "ok",
      output: formatRunOutput(result),
      raw: result,
    };
  };

  const sendCodeResult = async (code: string, lang: ComposerLanguage, result: RuntimeRunResult) => {
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
    if (!accessToken) return;
    setSending(true);
    const thinkingId = uid();
    setMsgs((p) => [...p, { id: thinkingId, role: "thinking" }]);
    try {
      const envelope = await invokeTypedChat({
        accessToken,
        lessonId,
        sessionId,
        answer: {
          mode: "code",
          code,
          run_result: result.raw || { ok: result.ok, output: result.output, language: lang },
        },
        mentorPreferences: mentorToPreferences(mentor),
      });
      setSessionId(envelope.session_id);
      setLearningSession((previous) =>
        previous
          ? { ...previous, id: envelope.session_id || previous.id, stage: envelope.stage }
          : previous,
      );
      if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
      replaceThinking(thinkingId, envelopeMessage(envelope));
    } catch (error) {
      replaceThinking(thinkingId, {
        id: uid(),
        role: "bot",
        text: (error as Error).message || "The mentor could not review that run.",
      });
    } finally {
      setSending(false);
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
        <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-[760px] flex-1 flex-col items-center justify-center px-5">
          <div className="text-[14px] text-muted-foreground">
            {surfaceError || "Opening Jargon\u2026"}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-screen min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.35} />

      <header
        className="z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1200px] items-center justify-between gap-2 px-3 sm:px-6">
            <div className="font-serif text-[22px] tracking-tight">Jargon</div>
            {/* On mobile, group the menu + settings on the right (logo left). `sm:contents`
                dissolves this wrapper on desktop so the nav keeps its centered position. */}
            <div className="flex items-center gap-1 sm:contents">
              <HeaderMenus
                activeLessonId={lessonId}
                lessons={menuLessons}
                onSelectLesson={selectLesson}
                mentor={mentor}
                onMentorChange={updateMentor}
              />
              <SettingsMenu email={email} voice={voice} onVoiceChange={updateVoice} />
            </div>
          </div>
        </div>
      </header>

      {lessonArc ? <LessonProgress arc={lessonArc} /> : null}

      <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-[760px] flex-1 flex-col px-5 pt-10">
        {activeLiveViewers.length ? (
          <div className="mb-3 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-info/40 bg-info/12 px-3 py-1.5 text-[12px] text-info">
              <span className="h-1.5 w-1.5 rounded-full bg-info" />
              Teacher viewing
              {activeLiveViewers.length > 1 ? ` · ${activeLiveViewers.length}` : ""}
            </div>
          </div>
        ) : null}
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pb-5">
          {msgs.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              onUseCode={useCodeInEditor}
              onChooseChoice={sendChoice}
              onResourceEvent={handleResourceEvent}
              voice={voice}
              accessToken={accessToken || ""}
              lessonId={lessonId}
              sessionId={sessionId}
              onVoiceEvent={handleVoiceEvent}
            />
          ))}
        </div>
        <div
          ref={composerWrapRef}
          className="relative z-30 shrink-0 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <AssignmentDock
            lessonId={lessonId}
            bundle={assignments}
            onSubmitAssignment={submitStudentAssignment}
          />
          <AssessmentDock lessonId={lessonId} bundle={assessments} />
          {/* Keep the Composer MOUNTED (hidden) during voice so its state — code edits,
              imperative handle for "Use this code" — survives entering/leaving voice mode. */}
          <div className={voiceMode ? "hidden" : undefined}>
            <Composer
              ref={composerRef}
              key={lessonId}
              initialCode={starterCode}
              initialLanguage="jargon"
              onSendText={sendUser}
              onRunCode={runCode}
              onSendCodeResult={sendCodeResult}
              voice={voice}
              onVoiceEvent={handleVoiceEvent}
              sending={sending}
              canStartVoice={voice.realtimeEnabled}
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
      </main>
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
  ) => Promise<TypedChatEnvelope | null>;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [message, setMessage] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const submittedCallIdsRef = useRef<Set<string>>(new Set());
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
    submittedCallIdsRef.current.add(callId);
    setLastTranscript(text);
    setMessage("Sending your spoken answer to Jargon...");
    void onVoiceEvent({
      event_type: "voice_turn_submitted",
      input_modality: "audio_session",
      transcript: text,
      transcript_confidence: confidence,
    });
    const envelope = await onSubmitVoiceTurn(text, confidence);
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
      assessment: envelope?.assessment || null,
    });
    setMessage("Live voice is listening.");
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

function AssessmentDock({
  lessonId,
  bundle,
}: {
  lessonId: string;
  bundle: StudentAssessmentBundle;
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
                      Latest score {formatChatScore(latestAttempt.final_score)}
                    </div>
                  ) : recipient?.status === "submitted" ? (
                    <div className="mt-1 text-[11.5px] text-warning">
                      Submitted · pending teacher review
                    </div>
                  ) : null}
                </div>
                <a
                  href={`/quiz/${assessment.id}`}
                  className="inline-flex shrink-0 items-center justify-center rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted"
                >
                  {recipient?.status === "complete" ? "View result" : "Open quiz"}
                </a>
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
                          : formatChatScore(latestSubmission.score)}
                      </div>
                      {submissionFiles.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {submissionFiles.map((file) => (
                            <span
                              key={file.id}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground"
                            >
                              <Paperclip className="h-3 w-3" strokeWidth={1.7} />
                              {file.original_filename}
                            </span>
                          ))}
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
                    <textarea
                      value={draft.code}
                      onChange={(event) => setDraft(assignment.id, { code: event.target.value })}
                      placeholder="Optional code..."
                      className="min-h-[88px] rounded-2xl border border-border bg-[var(--code-background)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--code-foreground)] outline-none placeholder:text-muted-foreground"
                      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                    />
                    <input
                      type="file"
                      multiple
                      onChange={(event) =>
                        setDraft(assignment.id, {
                          files: Array.from(event.target.files || []),
                        })
                      }
                      className="rounded-2xl border border-border bg-background/65 px-3 py-2 text-[12.5px] text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:text-foreground"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11.5px] text-muted-foreground">
                        {draft.files.length
                          ? `${draft.files.length} file${draft.files.length === 1 ? "" : "s"} ready`
                          : draft.message}
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
  onUseCode,
  onChooseChoice,
  onResourceEvent,
  voice,
  accessToken,
  lessonId,
  sessionId,
  onVoiceEvent,
}: {
  msg: Msg;
  onUseCode: (code: ChatCodeBlock) => void;
  onChooseChoice: (choice: ChatChoice) => void;
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
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
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
          <div className="whitespace-pre-wrap rounded-2xl border border-border/60 bg-foreground/5 px-4 py-2.5 text-[14.5px] leading-relaxed text-foreground/85">
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
          <div className="rounded-2xl border border-info/40 bg-info/12 px-4 py-3">
            <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-info">Teacher</div>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
              {msg.text}
            </p>
          </div>
          <CopyAction text={msg.text} />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex">
      <div className="w-full max-w-[92%] space-y-3">
        <MessageContent text={msg.text} onUseCode={onUseCode} />
        {msg.choices?.length ? (
          <div className="flex flex-wrap gap-2">
            {msg.choices.map((choice, index) => (
              <button
                key={`${choiceValue(choice)}-${index}`}
                type="button"
                onClick={() => onChooseChoice(choice)}
                className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-muted"
              >
                {choiceLabel(choice)}
              </button>
            ))}
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

function ReadAloudAction({
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

  if (!voice.readAloudEnabled || !text.trim()) return null;

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
    const utterance = new SpeechSynthesisUtterance(text);
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
        text,
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
        aria-label={speaking && !paused ? "Pause read aloud" : "Read mentor message aloud"}
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
        aria-label="Replay mentor message"
        title="Replay"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </span>
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
            {busy ? "Opening..." : shouldRenderInline(resource) ? "Open" : "Open"}
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

function formatChatScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "not graded";
  if (score <= 1) return `${Math.round(score * 100)}%`;
  return `${Math.round(score)}%`;
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
            className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
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
