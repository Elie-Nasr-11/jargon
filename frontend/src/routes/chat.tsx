import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { AlertCircle, Check, Code2, Copy } from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { HeaderMenus } from "@/components/HeaderMenus";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Composer, type ComposerHandle, type ComposerLanguage } from "@/components/Composer";
import { GradientCard } from "@/components/GradientCard";
import {
  DEFAULT_MENTOR,
  store,
  type Lesson as MenuLesson,
  type MentorConfig,
} from "@/lib/jargon-store";
import {
  fetchLearningTurns,
  fetchLatestLearningSession,
  fetchLessonActivities,
  fetchLessons,
  getSession,
  invokeJargonRun,
  invokeTypedChat,
} from "@/lib/api";
import { runJavaScript, runPython, type RunResult } from "@/lib/code-runner";
import type {
  JargonRunResponse,
  LearningSession,
  LearningTurn,
  Lesson,
  LessonActivity,
  MentorPreferences,
  TypedChatEnvelope,
} from "@/lib/types";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [{ title: "Jargon" }, { name: "description", content: "Your conversation with Jargon." }],
  }),
  component: ChatPage,
});

type RuntimeRunResult = RunResult & { raw?: JargonRunResponse };

type ChatCodeBlock = { language: ComposerLanguage; source: string };

type Msg =
  | { id: string; role: "user"; text: string; code?: ChatCodeBlock }
  | { id: string; role: "bot"; text: string; code?: ChatCodeBlock }
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
    progress:
      lesson.id === activeLessonId && learningSession
        ? (stageProgress[learningSession.stage] ?? 0)
        : 0,
  }));
}

function turnToMessage(turn: LearningTurn): Msg | null {
  if (turn.role === "student") {
    return { id: turn.id, role: "user", text: turn.content };
  }
  if (turn.role === "mentor" || turn.role === "system") {
    return { id: turn.id, role: "bot", text: turn.content };
  }
  return null;
}

function envelopeMessage(envelope: TypedChatEnvelope): Msg {
  return { id: uid(), role: "bot", text: envelope.reply || "I'm ready." };
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
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [surfaceError, setSurfaceError] = useState("");
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
        const [liveLessons] = await Promise.all([fetchLessons()]);
        if (!alive) return;
        const selected =
          liveLessons.find((lesson) => lesson.id === store.getLessonId())?.id ||
          liveLessons[0]?.id ||
          "lesson1";
        const savedMentor = store.getMentor();
        setAccessToken(session.access_token);
        setEmail(session.user.email || "");
        setLessons(liveLessons);
        setLessonId(selected);
        setMentor(savedMentor);
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

  const addMsg = (m: Msg) => setMsgs((prev) => [...prev, m]);

  const replaceThinking = (thinkingId: string, message: Msg) => {
    setMsgs((previous) => previous.filter((m) => m.id !== thinkingId).concat(message));
  };

  const sendUser = async (text: string) => {
    if (!accessToken) return;
    addMsg({ id: uid(), role: "user", text });
    setSending(true);
    const thinkingId = uid();
    setMsgs((p) => [...p, { id: thinkingId, role: "thinking" }]);
    try {
      const envelope = await invokeTypedChat({
        accessToken,
        lessonId,
        sessionId,
        answer: { mode: "text", text },
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

  const useCodeInEditor = (code: ChatCodeBlock) => {
    composerRef.current?.loadCode({ code: code.source, language: code.language });
    requestAnimationFrame(() => {
      composerWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  };

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
            <SettingsMenu email={email} />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full min-h-0 max-w-[760px] flex-1 flex-col px-5 pt-10">
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pb-5">
          {msgs.map((m) => (
            <MessageRow key={m.id} msg={m} onUseCode={useCodeInEditor} />
          ))}
        </div>
        <div
          ref={composerWrapRef}
          className="relative z-30 shrink-0 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <Composer
            ref={composerRef}
            key={lessonId}
            initialCode={starterCode}
            initialLanguage="jargon"
            onSendText={sendUser}
            onRunCode={runCode}
            onSendCodeResult={sendCodeResult}
            sending={sending}
          />
        </div>
      </main>
    </div>
  );
}

function MessageRow({ msg, onUseCode }: { msg: Msg; onUseCode: (code: ChatCodeBlock) => void }) {
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
          <div className="whitespace-pre-wrap rounded-2xl bg-foreground px-4 py-2.5 text-[14.5px] leading-relaxed text-background">
            {text}
          </div>
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
            className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/60 px-4 py-3 text-[12.5px] leading-relaxed text-foreground"
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
        <CopyAction text={msg.text} />
        {msg.code && <HistoryCodePanel code={msg.code} onUseCode={onUseCode} />}
      </div>
    </div>
  );
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
    <GradientCard>
      <div className="overflow-hidden">
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
          className="max-h-[320px] overflow-auto whitespace-pre-wrap px-4 py-3 text-[12.5px] leading-relaxed text-foreground"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {code.source}
        </pre>
      </div>
    </GradientCard>
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
