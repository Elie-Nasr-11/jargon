import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import {
  AlertCircle,
  Check,
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
  fetchLearningTurns,
  fetchStudentAssignments,
  fetchLatestLearningSession,
  fetchLessonActivities,
  fetchLessons,
  getLessonResourceSignedUrl,
  getSession,
  invokeJargonRun,
  invokeTypedChat,
  recordResourceInteraction,
  recordVoiceInteraction,
  submitAssignment,
} from "@/lib/api";
import { runJavaScript, runPython, type RunResult } from "@/lib/code-runner";
import { tokenizeJargon, type JargonTokenKind } from "@/lib/jargon-syntax";
import type {
  JargonRunResponse,
  ChatInputModality,
  LearningSession,
  LearningTurn,
  Lesson,
  LessonActivity,
  LessonChatResource,
  MentorPreferences,
  StudentAssignmentBundle,
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
    }
  | {
      id: string;
      role: "bot";
      text: string;
      code?: ChatCodeBlock;
      choices?: ChatChoice[];
      resources?: LessonChatResource[];
    }
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
  };
}

function lessonSubtitle(lesson: Lesson) {
  return [lesson.module, lesson.level].filter(Boolean).join(" · ") || lesson.tutor_prompt || "";
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
    group: lesson.module || "Lessons",
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
    };
  }
  if (turn.role === "mentor" || turn.role === "system") {
    const payload = turn.payload || {};
    const choices = Array.isArray(payload.choices) ? (payload.choices as ChatChoice[]) : undefined;
    const resources = Array.isArray(payload.resources)
      ? (payload.resources as LessonChatResource[])
      : undefined;
    return { id: turn.id, role: "bot", text: turn.content, choices, resources };
  }
  return null;
}

function envelopeMessage(envelope: TypedChatEnvelope): Msg {
  return {
    id: uid(),
    role: "bot",
    text: envelope.reply || "I'm ready.",
    choices: envelope.choices?.length ? envelope.choices : undefined,
    resources: envelope.resources?.length ? envelope.resources : undefined,
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
  const [lessonId, setLessonId] = useState<string>("lesson1");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mentor, setMentor] = useState<MentorConfig>(DEFAULT_MENTOR);
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [surfaceError, setSurfaceError] = useState("");
  const [assignments, setAssignments] = useState<StudentAssignmentBundle>({
    assignments: [],
    recipients: [],
    submissions: [],
    files: [],
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

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

  const loadLesson = async (
    nextLessonId: string,
    token: string,
    nextMentor: MentorConfig,
    seedFromChat = true,
  ) => {
    setSurfaceError("");
    setSending(true);
    try {
      const [lessonActivities, latest] = await Promise.all([
        fetchLessonActivities(nextLessonId),
        fetchLatestLearningSession(nextLessonId),
      ]);
      setActivities(lessonActivities);
      setLearningSession(latest);
      setSessionId(latest?.id || null);

      if (latest) {
        const turns = await fetchLearningTurns(latest.id);
        const mapped = turns.map(turnToMessage).filter(Boolean) as Msg[];
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
        const [liveLessons, liveAssignments] = await Promise.all([
          fetchLessons(),
          fetchStudentAssignments(),
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

  const sendUser = async (
    text: string,
    options?: { inputModality?: ChatInputModality; transcriptConfidence?: number | null },
  ) => {
    if (!accessToken) return;
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
      replaceThinking(thinkingId, envelopeMessage(envelope));
    } catch (error) {
      replaceThinking(thinkingId, {
        id: uid(),
        role: "bot",
        text: (error as Error).message || "The mentor could not answer.",
      });
    } finally {
      setSending(false);
    }
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
        className="relative flex h-screen min-h-0 flex-col overflow-hidden"
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
      </header>

      <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-[760px] flex-1 flex-col px-5 pt-10">
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pb-5">
          {msgs.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              onUseCode={useCodeInEditor}
              onChooseChoice={sendChoice}
              onResourceEvent={handleResourceEvent}
              voice={voice}
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
          />
        </div>
      </main>
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
          {msg.inputModality === "dictated" ? (
            <span className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Dictated
            </span>
          ) : null}
          {code && (
            <div className="w-full min-w-[min(420px,85vw)]">
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
          <ReadAloudAction text={msg.text} voice={voice} onVoiceEvent={onVoiceEvent} />
        </div>
        {msg.code && <HistoryCodePanel code={msg.code} onUseCode={onUseCode} />}
      </div>
    </div>
  );
}

function ReadAloudAction({
  text,
  voice,
  onVoiceEvent,
}: {
  text: string;
  voice: VoiceSettings;
  onVoiceEvent: (event: VoiceInteractionEvent) => void | Promise<void>;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    return () => {
      if (utteranceRef.current && supported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [supported]);

  if (!voice.readAloudEnabled || !supported || !text.trim()) return null;

  const finish = () => {
    setSpeaking(false);
    setPaused(false);
    void onVoiceEvent({
      event_type: "read_aloud_finished",
      duration_seconds: startedAtRef.current
        ? Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000))
        : null,
    });
    utteranceRef.current = null;
    startedAtRef.current = null;
  };

  const play = () => {
    if (speaking && paused) {
      window.speechSynthesis.resume();
      setPaused(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voice.readAloudRate;
    utterance.onend = finish;
    utterance.onerror = finish;
    utteranceRef.current = utterance;
    startedAtRef.current = Date.now();
    setSpeaking(true);
    setPaused(false);
    void onVoiceEvent({ event_type: "read_aloud_started" });
    window.speechSynthesis.speak(utterance);
  };

  const pause = () => {
    window.speechSynthesis.pause();
    setPaused(true);
  };

  const replay = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
    requestAnimationFrame(play);
  };

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-1">
      <button
        type="button"
        onClick={speaking && !paused ? pause : play}
        aria-label={speaking && !paused ? "Pause read aloud" : "Read mentor message aloud"}
        title={speaking && !paused ? "Pause" : "Read aloud"}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {speaking && !paused ? (
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void onResourceEvent(resource, "shown");
  }, [onResourceEvent, resource]);

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

function MessageContent({
  text,
  onUseCode,
}: {
  text: string;
  onUseCode: (code: ChatCodeBlock) => void;
}) {
  const segments = parseFencedBlocks(text);

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
        return (
          <div
            key={`${segment.kind}-${index}`}
            className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
          >
            {segment.text}
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
