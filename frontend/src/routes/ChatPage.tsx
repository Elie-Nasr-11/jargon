import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { Composer, type ComposerLanguage } from "@/components/Composer";
import { GradientCard } from "@/components/GradientCard";
import { HeaderMenus } from "@/components/HeaderMenus";
import {
  fetchLearningSession,
  fetchLearningTurns,
  fetchLatestLearningSession,
  fetchLessonActivities,
  fetchLessonAttempts,
  fetchLessons,
  fetchProfile,
  getSession,
  invokeJargonRun,
  invokeTypedChat,
  onAuthStateChange,
  signOut,
  upsertProfile,
} from "@/lib/api";
import {
  DEFAULT_MENTOR_PREFERENCES,
  loadMentorPreferences,
  saveMentorPreferences,
} from "@/lib/mentor-preferences";
import type {
  JargonRunResponse,
  LearningSession,
  LearningTurn,
  Lesson,
  LessonActivity,
  LessonAttempt,
  MentorPreferences,
  Profile,
  TypedChatAnswer,
  TypedChatEnvelope,
} from "@/lib/types";

const LESSON_KEY = "jargon_active_lesson_id";

type PanelKey = "lessons" | "progress" | "mentor" | null;

function extractLatestEnvelope(turns: LearningTurn[]) {
  const mentorTurn = [...turns].reverse().find((turn) => turn.role === "mentor");
  if (!mentorTurn || !mentorTurn.payload || typeof mentorTurn.payload !== "object") return null;
  return mentorTurn.payload as unknown as TypedChatEnvelope;
}

function extractStudentLabel(profile: Profile | null, fallbackEmail: string) {
  if (profile?.name) return profile.name;
  return fallbackEmail;
}

function extractCurrentActivity(
  activities: LessonActivity[],
  session: LearningSession | null,
  envelope: TypedChatEnvelope | null,
) {
  if (session?.current_activity_id) {
    const match = activities.find((activity) => activity.id === session.current_activity_id);
    if (match) return match;
  }
  if (envelope?.stage) {
    const stageMatch = activities.find((activity) => activity.stage === envelope.stage);
    if (stageMatch) return stageMatch;
  }
  return activities[0] || null;
}

function initialLanguageForLesson(lesson: Lesson | null): ComposerLanguage {
  if (!lesson) return "jargon";
  if (lesson.module === "Coding" && /python/i.test(lesson.title)) return "python";
  return "jargon";
}

async function hydrateLessonState(lessonId: string, sessionId?: string | null) {
  const activities = await fetchLessonActivities(lessonId);
  const session = sessionId
    ? await fetchLearningSession(sessionId)
    : await fetchLatestLearningSession(lessonId);

  if (!session) {
    return {
      activities,
      learningSession: null,
      turns: [] as LearningTurn[],
      attempts: [] as LessonAttempt[],
      envelope: null as TypedChatEnvelope | null,
    };
  }

  const [turns, attempts] = await Promise.all([
    fetchLearningTurns(session.id),
    fetchLessonAttempts(session.id),
  ]);

  return {
    activities,
    learningSession: session,
    turns,
    attempts,
    envelope: extractLatestEnvelope(turns),
  };
}

export function ChatPage() {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [booting, setBooting] = useState(true);
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activeLessonId, setActiveLessonId] = useState("");
  const [activities, setActivities] = useState<LessonActivity[]>([]);
  const [learningSession, setLearningSession] = useState<LearningSession | null>(null);
  const [turns, setTurns] = useState<LearningTurn[]>([]);
  const [attempts, setAttempts] = useState<LessonAttempt[]>([]);
  const [envelope, setEnvelope] = useState<TypedChatEnvelope | null>(null);
  const [mentorPreferences, setMentorPreferences] = useState<MentorPreferences>(
    loadMentorPreferences(),
  );
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [surfaceMessage, setSurfaceMessage] = useState("");

  const currentLesson = useMemo(
    () => lessons.find((lesson) => lesson.id === activeLessonId) || null,
    [activeLessonId, lessons],
  );
  const currentActivity = useMemo(
    () => extractCurrentActivity(activities, learningSession, envelope),
    [activities, envelope, learningSession],
  );
  const latestAttempt = attempts[attempts.length - 1] || null;
  const transcript = useMemo(
    () =>
      turns.filter((turn) => turn.role === "student" || turn.role === "mentor" || turn.role === "system"),
    [turns],
  );
  const responseMode =
    envelope?.response_mode || currentActivity?.response_mode || "text";
  const starterCode = currentActivity?.starter_code || currentLesson?.sample_code || "";
  const starterLanguage = initialLanguageForLesson(currentLesson);

  useEffect(() => {
    saveMentorPreferences(mentorPreferences);
  }, [mentorPreferences]);

  useEffect(() => {
    const target = stageRef.current;
    if (!target) return;
    const context = gsap.context(() => {
      gsap.from("[data-chat='header']", {
        opacity: 0,
        y: -16,
        duration: 0.72,
        ease: "power3.out",
      });
      gsap.from("[data-chat='hero']", {
        opacity: 0,
        y: 20,
        duration: 0.84,
        ease: "power3.out",
        delay: 0.12,
      });
    }, target);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length]);

  const refreshLessonState = useCallback(
    async (lessonId: string, sessionId?: string | null) => {
      setLoadingLesson(true);
      try {
        const state = await hydrateLessonState(lessonId, sessionId);
        setActivities(state.activities);
        setLearningSession(state.learningSession);
        setTurns(state.turns);
        setAttempts(state.attempts);
        setEnvelope(state.envelope);
        setSurfaceMessage("");

        if (!state.learningSession || state.turns.length === 0) {
          if (!sessionToken) return;
          const freshEnvelope = await invokeTypedChat({
            accessToken: sessionToken,
            lessonId,
            mentorPreferences,
          });
          const freshState = await hydrateLessonState(lessonId, freshEnvelope.session_id);
          setActivities(freshState.activities);
          setLearningSession(freshState.learningSession);
          setTurns(freshState.turns);
          setAttempts(freshState.attempts);
          setEnvelope(freshState.envelope || freshEnvelope);
        }
      } catch (error) {
        setSurfaceMessage((error as Error).message || "Could not load lesson state.");
      } finally {
        setLoadingLesson(false);
      }
    },
    [mentorPreferences, sessionToken],
  );

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      try {
        const authSession = await getSession();
        if (!authSession) {
          navigate({ to: "/login", replace: true });
          return;
        }

        const [profileData, lessonsData] = await Promise.all([
          fetchProfile(authSession.user.id),
          fetchLessons(),
        ]);
        let resolvedProfile = profileData;
        if (!resolvedProfile) {
          await upsertProfile(
            authSession.user,
            typeof authSession.user.user_metadata?.name === "string"
              ? authSession.user.user_metadata.name
              : "",
            typeof authSession.user.user_metadata?.grade === "string"
              ? authSession.user.user_metadata.grade
              : "",
          );
          resolvedProfile = await fetchProfile(authSession.user.id);
        }

        if (!alive) return;

        setSessionToken(authSession.access_token);
        setEmail(authSession.user.email || "");
        setProfile(resolvedProfile);
        setLessons(lessonsData);

        const stored = window.localStorage.getItem(LESSON_KEY);
        const selected =
          (stored && lessonsData.find((lesson) => lesson.id === stored)?.id) ||
          lessonsData[0]?.id ||
          "";
        setActiveLessonId(selected);
        setBooting(false);
      } catch (error) {
        setSurfaceMessage((error as Error).message || "Could not bootstrap the app.");
        setBooting(false);
      }
    };

    void bootstrap();

    const subscription = onAuthStateChange((nextSession) => {
      if (!nextSession) {
        navigate({ to: "/login", replace: true });
        return;
      }
      setSessionToken(nextSession.access_token);
      setEmail(nextSession.user.email || "");
    });

    return () => {
      alive = false;
      subscription.data.subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    if (!sessionToken || !activeLessonId) return;
    window.localStorage.setItem(LESSON_KEY, activeLessonId);
    void refreshLessonState(activeLessonId);
  }, [activeLessonId, refreshLessonState, sessionToken]);

  const sendTextAnswer = async (text: string) => {
    if (!sessionToken || !activeLessonId) return;
    setSending(true);
    setSurfaceMessage("");
    try {
      const reply = await invokeTypedChat({
        accessToken: sessionToken,
        lessonId: activeLessonId,
        sessionId: learningSession?.id,
        mentorPreferences,
        answer: {
          mode: "text",
          text,
        },
      });
      await refreshLessonState(activeLessonId, reply.session_id);
    } catch (error) {
      setSurfaceMessage((error as Error).message || "Message failed.");
    } finally {
      setSending(false);
    }
  };

  const sendChoiceAnswer = async (choiceId: string, label: string) => {
    if (!sessionToken || !activeLessonId) return;
    setSending(true);
    setSurfaceMessage("");
    try {
      const reply = await invokeTypedChat({
        accessToken: sessionToken,
        lessonId: activeLessonId,
        sessionId: learningSession?.id,
        mentorPreferences,
        answer: {
          mode: "multiple_choice",
          text: label,
          choice_id: choiceId,
        },
      });
      await refreshLessonState(activeLessonId, reply.session_id);
    } catch (error) {
      setSurfaceMessage((error as Error).message || "Choice submission failed.");
    } finally {
      setSending(false);
    }
  };

  const submitCodeAnswer = async (answer: TypedChatAnswer) => {
    if (!sessionToken || !activeLessonId) return;
    setSending(true);
    setSurfaceMessage("");
    try {
      const reply = await invokeTypedChat({
        accessToken: sessionToken,
        lessonId: activeLessonId,
        sessionId: learningSession?.id,
        mentorPreferences,
        answer,
      });
      await refreshLessonState(activeLessonId, reply.session_id);
    } catch (error) {
      setSurfaceMessage((error as Error).message || "Code submission failed.");
    } finally {
      setSending(false);
    }
  };

  const runJargon = async (code: string, answers: string[]) => {
    if (!sessionToken) throw new Error("You are not signed in.");
    return await invokeJargonRun({
      accessToken: sessionToken,
      code,
      answers,
    });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", replace: true });
  };

  if (booting) {
    return (
      <div className="app-shell">
        <AmbientCanvas intensity={0.35} />
        <div className="loading-screen">Loading your lesson studio…</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AmbientCanvas intensity={0.36} />
      <div className="page-layer">
        <div className="stage-frame" ref={stageRef}>
          <div className="page-grid">
            <div data-chat="header">
              <HeaderMenus
                lessonLabel={
                  currentLesson
                    ? `${currentLesson.module} • ${currentLesson.level}`
                    : "Live tutor workspace"
                }
                userLabel={extractStudentLabel(profile, email)}
                onLessons={() => setPanel("lessons")}
                onProgress={() => setPanel("progress")}
                onMentor={() => setPanel("mentor")}
                onSignOut={() => void handleSignOut()}
              />
            </div>

            <main className="workspace">
              <section data-chat="hero">
                <div className="lesson-ribbon">
                  {currentLesson && (
                    <>
                      <div className="lesson-chip">{currentLesson.module}</div>
                      <div className="lesson-chip">{currentLesson.level}</div>
                      {learningSession && (
                        <div className="lesson-chip">
                          Stage • {learningSession.stage}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="lesson-title">
                  {currentLesson?.title || "Choose a lesson to begin"}
                </div>
                <div className="lesson-prompt">
                  {currentActivity?.prompt ||
                    currentLesson?.tutor_prompt ||
                    "Your live Jargon lesson thread will appear here."}
                </div>
                {surfaceMessage && (
                  <div className="utility-note" style={{ color: "var(--danger)" }}>
                    {surfaceMessage}
                  </div>
                )}
              </section>

              <div className="transcript-wrap">
                <div className="transcript" ref={transcriptRef}>
                  {loadingLesson && !turns.length && (
                    <div className="message-empty">Loading lesson session…</div>
                  )}
                  {!loadingLesson && !transcript.length && (
                    <div className="message-empty">
                      The mentor will start the session here once the lesson initializes.
                    </div>
                  )}
                  {transcript.map((turn) => (
                    <TranscriptRow key={turn.id} turn={turn} />
                  ))}
                </div>
              </div>

              <Composer
                responseMode={responseMode}
                starterCode={starterCode}
                starterLanguage={starterLanguage}
                prompt={currentActivity?.prompt || envelope?.reply || currentLesson?.tutor_prompt}
                choices={envelope?.choices || currentActivity?.choices || []}
                sending={sending}
                onSendText={sendTextAnswer}
                onSendChoice={sendChoiceAnswer}
                onSubmitCode={submitCodeAnswer}
                onRunJargon={runJargon}
              />
            </main>
          </div>
        </div>
      </div>

      {panel && (
        <>
          <div className="overlay-backdrop" onClick={() => setPanel(null)} />
          <GradientCard className="overlay-panel">
            <div className="panel-head">
              <div>
                <h2>
                  {panel === "lessons"
                    ? "Lessons"
                    : panel === "progress"
                      ? "Progress"
                      : "Mentor"}
                </h2>
                <div className="panel-subtitle">
                  {panel === "lessons"
                    ? "Choose the live lesson thread."
                    : panel === "progress"
                      ? "Current session state, score, and latest feedback."
                      : "Shape how the mentor responds to the learner."}
                </div>
              </div>
              <button type="button" className="ghost-button" onClick={() => setPanel(null)}>
                Done
              </button>
            </div>

            <div className="panel-scroll">
              {panel === "lessons" && (
                <>
                  {currentLesson && (
                    <div className="detail-block">
                      <div className="detail-kicker">Current lesson</div>
                      <div className="detail-value">
                        {currentLesson.title} • {currentLesson.module} • {currentLesson.level}
                      </div>
                    </div>
                  )}
                  <div className="lesson-list">
                    {lessons.map((lesson) => (
                      <button
                        key={lesson.id}
                        type="button"
                        className={`lesson-button ${lesson.id === activeLessonId ? "active" : ""}`}
                        onClick={() => {
                          setActiveLessonId(lesson.id);
                          setPanel(null);
                        }}
                      >
                        <div className="lesson-button-title">{lesson.title}</div>
                        <div className="lesson-button-subtitle">
                          {lesson.module} • {lesson.level}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {panel === "progress" && (
                <>
                  <div className="detail-grid">
                    <div className="detail-block">
                      <div className="detail-kicker">Lesson</div>
                      <div className="detail-value">{currentLesson?.title || "-"}</div>
                    </div>
                    <div className="detail-block">
                      <div className="detail-kicker">Stage</div>
                      <div className="detail-value">{learningSession?.stage || envelope?.stage || "-"}</div>
                    </div>
                    <div className="detail-block">
                      <div className="detail-kicker">Activity</div>
                      <div className="detail-value">{currentActivity?.title || "-"}</div>
                    </div>
                    <div className="detail-block">
                      <div className="detail-kicker">Score</div>
                      <div className="detail-value">
                        {latestAttempt?.score ?? learningSession?.score ?? "-"}
                      </div>
                    </div>
                    <div className="detail-block">
                      <div className="detail-kicker">Mode</div>
                      <div className="detail-value">{responseMode}</div>
                    </div>
                    <div className="detail-block">
                      <div className="detail-kicker">Status</div>
                      <div className="detail-value">{learningSession?.status || "active"}</div>
                    </div>
                  </div>
                  <div className="detail-block" style={{ marginTop: "14px" }}>
                    <div className="detail-kicker">Latest feedback</div>
                    <div className="detail-value">
                      {latestAttempt?.feedback || envelope?.reply || "No feedback recorded yet."}
                    </div>
                  </div>
                </>
              )}

              {panel === "mentor" && (
                <div className="mentor-grid">
                  <div className="mentor-field">
                    <label htmlFor="mentor-pace">Pace</label>
                    <select
                      id="mentor-pace"
                      className="mentor-select"
                      value={mentorPreferences.pace}
                      onChange={(event) =>
                        setMentorPreferences((current) => ({
                          ...current,
                          pace: event.target.value as MentorPreferences["pace"],
                        }))
                      }
                    >
                      <option value="brief">brief</option>
                      <option value="balanced">balanced</option>
                      <option value="guided">guided</option>
                    </select>
                  </div>

                  <div className="mentor-field">
                    <label htmlFor="mentor-tone">Tone</label>
                    <select
                      id="mentor-tone"
                      className="mentor-select"
                      value={mentorPreferences.tone}
                      onChange={(event) =>
                        setMentorPreferences((current) => ({
                          ...current,
                          tone: event.target.value as MentorPreferences["tone"],
                        }))
                      }
                    >
                      <option value="neutral">neutral</option>
                      <option value="encouraging">encouraging</option>
                    </select>
                  </div>

                  <div className="mentor-field">
                    <label htmlFor="mentor-hint">Hint level</label>
                    <select
                      id="mentor-hint"
                      className="mentor-select"
                      value={mentorPreferences.hint_level}
                      onChange={(event) =>
                        setMentorPreferences((current) => ({
                          ...current,
                          hint_level: event.target.value as MentorPreferences["hint_level"],
                        }))
                      }
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </div>

                  <div className="detail-block">
                    <div className="detail-kicker">Live behavior</div>
                    <div className="detail-value">
                      These preferences persist in the browser and are sent on the next typed chat turn.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </GradientCard>
        </>
      )}
    </div>
  );
}

function TranscriptRow({ turn }: { turn: LearningTurn }) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rowRef.current) return;
    gsap.fromTo(
      rowRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" },
    );
  }, []);

  const roleClass =
    turn.role === "student" ? "student" : turn.role === "mentor" ? "mentor" : "system";

  return (
    <div className={`message-row ${roleClass}`} ref={rowRef}>
      <div className="message-card">
        <div className="message-meta">
          {turn.role === "student" ? "Student" : turn.role === "mentor" ? "Mentor" : "System"} •{" "}
          {turn.stage}
        </div>
        {turn.content}
      </div>
    </div>
  );
}
