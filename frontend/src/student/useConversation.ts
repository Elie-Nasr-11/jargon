import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLatestLearningSession,
  fetchLearningTurns,
  fetchStudentCatalog,
  getSession,
  invokeTypedChat,
} from "@/lib/api";
import { DEFAULT_MENTOR } from "@/lib/jargon-store";
import type { Lesson, LessonChatResource, TypedChatAnswer, TypedChatEnvelope } from "@/lib/types";
import {
  envelopeMessage,
  mentorToPreferences,
  sortTimedMessages,
  turnToMessage,
  uid,
  type Msg,
} from "@/features/student/chat/chatMessages";
import { NO_OFFERS, type LessonOffers, type TurnMode } from "@/student/turnModes";

// The turn loop for the v6 student surface: resolve a lesson, resume (or create) its session,
// load the transcript, and send turns carrying the student's declared TurnMode.
//
// The transcript model is imported from features/student/chat/chatMessages.ts rather than
// redeclared — one Msg union for the whole app. A second copy is exactly the duplication that
// made the previous surface hard to reason about.

export type ConversationState = {
  messages: Msg[];
  lesson: Lesson | null;
  sending: boolean;
  booting: boolean;
  error: string;
};

// Network and auth failures surface to a student, not a developer. "TypeError: Failed to fetch"
// is what the browser throws when a request never lands, and showing it verbatim reads as a
// crash — so the small set of failures we can recognise get plain-English copy, and anything
// unrecognised falls back to a neutral sentence rather than the raw message.
function friendlyError(err: unknown, fallback: string): string {
  // supabase-js rejects with PLAIN OBJECTS carrying a message, not Error instances, so an
  // `instanceof Error` check alone falls through to String(err) and renders "[object Object]"
  // to the student. Verified live — read the message off any shape that has one.
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err &&
            typeof err === "object" &&
            typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "";

  if (!raw) return fallback;
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/signed in/i.test(raw)) return raw;
  // Anything still shaped like a developer exception gets the neutral fallback rather than
  // being shown verbatim.
  return /^(TypeError|ReferenceError|SyntaxError)\b/i.test(raw) ? fallback : raw;
}

// What the lesson offers, read off a turn envelope. Prefers the server's `available` block; falls
// back to signals already present in the envelope so quiz and resources work before that field
// ships. Homework has no client-side proxy — a pill that guessed wrong would send a student to
// work that does not exist — so it stays false until the server says otherwise.
function offersFromEnvelope(envelope: TypedChatEnvelope): LessonOffers {
  const sent = envelope.available;
  return {
    quiz: sent?.quiz ?? (Boolean(envelope.choices?.length) || envelope.next_action === "choose"),
    homework: sent?.homework ?? false,
    resources: sent?.resources ?? Boolean(envelope.resources?.length),
  };
}

export function useConversation() {
  const [offers, setOffers] = useState<LessonOffers>(NO_OFFERS);
  // The materials the mentor has attached this session — what the Resources pill opens.
  const [resources, setResources] = useState<LessonChatResource[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");

  // Ref twins so send() can read current values without being re-created on every state change
  // (a changing callback identity would re-run effects in the consumer).
  const sessionRef = useRef<string | null>(null);
  const lessonRef = useRef<Lesson | null>(null);
  const lessonsRef = useRef<Lesson[]>([]);
  const sendingRef = useRef(false);
  // Monotonic token identifying the most recent lesson switch (see openLesson).
  const switchTokenRef = useRef(0);

  const setSession = (id: string | null) => {
    sessionRef.current = id;
    setSessionId(id);
  };

  // Point the conversation at a lesson: resume its existing session or create one, then load
  // the transcript. Shared by boot and by switching lessons from the sidebar so the two paths
  // can never drift — a lesson opened from the tree behaves exactly like one opened on load.
  //
  // `isStale` lets the caller abandon a slow load (unmount, or a second lesson clicked before
  // the first finished) without writing state that no longer belongs to the visible lesson.
  const loadLesson = useCallback(async (target: Lesson, isStale: () => boolean) => {
    lessonRef.current = target;
    setLesson(target);
    setMessages([]);
    setOffers(NO_OFFERS);
    setResources([]);
    setError("");

    const session = await getSession();
    const token = session?.access_token;
    if (!token) throw new Error("You must be signed in.");

    // RESUME BEFORE SEND. invokeTypedChat with no session_id creates a NEW session every
    // call, so opening a lesson without this lookup would fragment the student's history
    // into a fresh session every time.
    const existing = await fetchLatestLearningSession(target.id);
    if (isStale()) return;

    if (existing?.id) {
      setSession(existing.id);
      const turns = await fetchLearningTurns(existing.id);
      if (isStale()) return;
      setMessages(sortTimedMessages(turns.map(turnToMessage).filter(Boolean) as Msg[]));
    } else {
      // No session yet: the opening call creates one and returns the mentor's first turn.
      const envelope = await invokeTypedChat({
        accessToken: token,
        lessonId: target.id,
        mentorPreferences: mentorToPreferences(DEFAULT_MENTOR),
      });
      if (isStale()) return;
      setSession(envelope.session_id ?? null);
      setOffers(offersFromEnvelope(envelope));
      if (envelope.resources?.length) setResources(envelope.resources);
      setMessages([envelopeMessage(envelope)]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stale = () => cancelled;

    const boot = async () => {
      try {
        const catalog = await fetchStudentCatalog();
        if (cancelled) return;
        lessonsRef.current = catalog;
        setLessons(catalog);

        const first = catalog[0];
        if (!first) {
          setError("No lessons are published for you yet.");
          return;
        }
        await loadLesson(first, stale);
      } catch (err) {
        if (!cancelled) setError(friendlyError(err, "Could not open the conversation."));
      } finally {
        if (!cancelled) setBooting(false);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadLesson]);

  // Switching lesson from the sidebar. Refused mid-turn so a reply can never land in the wrong
  // lesson's transcript.
  const openLesson = useCallback(
    async (lessonId: string) => {
      if (sendingRef.current) return;
      const target = lessonsRef.current.find((l) => l.id === lessonId);
      if (!target || target.id === lessonRef.current?.id) return;

      setBooting(true);
      // Each switch owns a token; a later switch invalidates an earlier in-flight one so a slow
      // first load can't overwrite the lesson the student actually landed on.
      const token = ++switchTokenRef.current;
      try {
        await loadLesson(target, () => token !== switchTokenRef.current);
      } catch (err) {
        setError(friendlyError(err, "Could not open that lesson."));
      } finally {
        if (token === switchTokenRef.current) setBooting(false);
      }
    },
    [loadLesson],
  );

  // `echo` is the student's own message to show immediately. It is OPTIONAL because a retry
  // re-sends an answer whose user bubble is already in the transcript — echoing again would
  // duplicate it.
  const sendAnswer = useCallback(async (answer: TypedChatAnswer, mode: TurnMode, echo?: string) => {
    const activeLesson = lessonRef.current;
    if (!activeLesson || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError("");

    const thinkingId = uid();
    setMessages((current) => [
      // Drop any trailing error bubble: the turn it reported is being attempted again, and
      // leaving it would show a failure above its own successful retry.
      ...current.filter((m) => !(m.role === "bot" && m.isError)),
      ...(echo === undefined
        ? []
        : [
            {
              id: uid(),
              role: "user" as const,
              text: echo,
              turnMode: mode,
              createdAt: new Date().toISOString(),
            },
          ]),
      { id: thinkingId, role: "thinking" as const },
    ]);

    try {
      const session = await getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const envelope = await invokeTypedChat({
        accessToken: token,
        lessonId: activeLesson.id,
        sessionId: sessionRef.current,
        answer,
        mentorPreferences: mentorToPreferences(DEFAULT_MENTOR),
        mode,
      });
      if (envelope.session_id) setSession(envelope.session_id);
      setOffers(offersFromEnvelope(envelope));
      // Accumulate: a later turn attaching nothing must not clear what was already shown.
      if (envelope.resources?.length) setResources(envelope.resources);
      setMessages((current) => [
        ...current.filter((m) => m.id !== thinkingId),
        envelopeMessage(envelope, mode),
      ]);
    } catch (err) {
      const message = friendlyError(err, "That didn't send.");
      // The error bubble carries the failed answer so Retry can re-send it faithfully, and is
      // flagged isError so it never becomes the "latest mentor message" (which would strip live
      // quiz choices off the real question with no way back).
      setMessages((current) => [
        ...current.filter((m) => m.id !== thinkingId),
        { id: uid(), role: "bot", text: message, isError: true, retryAnswer: answer },
      ]);
      setError(message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  const sendText = useCallback(
    (text: string, mode: TurnMode) =>
      sendAnswer({ mode: "text", text, client_msg_id: uid() }, mode, text),
    [sendAnswer],
  );

  const sendChoice = useCallback(
    (choiceId: string, label: string, mode: TurnMode) =>
      sendAnswer(
        { mode: "multiple_choice", choice_id: choiceId, client_msg_id: uid() },
        mode,
        label,
      ),
    [sendAnswer],
  );

  // Re-send a failed turn. The Msg union already carries retryAnswer for exactly this, so the
  // original answer goes back verbatim rather than being reconstructed from the rendered text.
  const retry = useCallback(
    (answer: TypedChatAnswer, mode: TurnMode) => sendAnswer(answer, mode),
    [sendAnswer],
  );

  return {
    messages,
    offers,
    resources,
    lessons,
    lesson,
    sessionId,
    sending,
    booting,
    error,
    sendText,
    sendChoice,
    openLesson,
    retry,
  };
}
