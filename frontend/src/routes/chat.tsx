import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { HeaderMenus } from "@/components/HeaderMenus";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Composer, type ComposerLanguage } from "@/components/Composer";
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

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "bot"; text: string; code?: { language: ComposerLanguage; source: string } }
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
      text: `Ran ${languageLabel(lang)}:\n\n${code}`,
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
            <MessageRow key={m.id} msg={m} />
          ))}
        </div>
        <div
          ref={composerWrapRef}
          className="relative z-30 shrink-0 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <Composer
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

function MessageRow({ msg }: { msg: Msg }) {
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
    return (
      <div ref={ref} className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-foreground px-4 py-2.5 text-[14.5px] leading-relaxed text-background">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.role === "thinking") {
    return (
      <div ref={ref} className="flex">
        <div className="rounded-2xl bg-muted px-4 py-3">
          <span className="shimmer-dot" />
          <span className="shimmer-dot" />
          <span className="shimmer-dot" />
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
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex">
      <div className="w-full max-w-[92%] space-y-3">
        <div className="text-[15px] leading-relaxed text-foreground">{msg.text}</div>
        {msg.code && (
          <GradientCard>
            <div className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {languageLabel(msg.code.language)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  open the \u2039/\u203A editor below to run
                </span>
              </div>
              <pre
                className="overflow-x-auto px-4 py-3 text-[12.5px] leading-relaxed text-foreground"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              >
                {msg.code.source}
              </pre>
            </div>
          </GradientCard>
        )}
      </div>
    </div>
  );
}
