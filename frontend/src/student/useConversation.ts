import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLatestLearningSession,
  fetchLearningTurns,
  fetchStudentCatalog,
  getSession,
  invokeTypedChat,
} from "@/lib/api";
import { DEFAULT_MENTOR } from "@/lib/jargon-store";
import type { Lesson, TypedChatAnswer } from "@/lib/types";
import {
  envelopeMessage,
  mentorToPreferences,
  sortTimedMessages,
  turnToMessage,
  uid,
  type Msg,
} from "@/features/student/chat/chatMessages";
import type { TurnMode } from "@/student/turnModes";

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

export function useConversation() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");

  // Ref twins so send() can read current values without being re-created on every state change
  // (a changing callback identity would re-run effects in the consumer).
  const sessionRef = useRef<string | null>(null);
  const lessonRef = useRef<Lesson | null>(null);
  const sendingRef = useRef(false);

  const setSession = (id: string | null) => {
    sessionRef.current = id;
    setSessionId(id);
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const session = await getSession();
        const token = session?.access_token;
        if (!token) throw new Error("You must be signed in.");

        const catalog = await fetchStudentCatalog();
        const first = catalog[0] ?? null;
        if (!first) {
          if (!cancelled) {
            setError("No lessons are published for you yet.");
            setBooting(false);
          }
          return;
        }
        if (cancelled) return;
        lessonRef.current = first;
        setLesson(first);

        // RESUME BEFORE SEND. invokeTypedChat with no session_id creates a NEW session every
        // call, so opening the app without this lookup would fragment the student's history
        // into a fresh session on every mount.
        const existing = await fetchLatestLearningSession(first.id);
        if (cancelled) return;

        if (existing?.id) {
          setSession(existing.id);
          const turns = await fetchLearningTurns(existing.id);
          if (cancelled) return;
          setMessages(sortTimedMessages(turns.map(turnToMessage).filter(Boolean) as Msg[]));
        } else {
          // No session yet: the opening call creates one and returns the mentor's first turn.
          const envelope = await invokeTypedChat({
            accessToken: token,
            lessonId: first.id,
            mentorPreferences: mentorToPreferences(DEFAULT_MENTOR),
          });
          if (cancelled) return;
          setSession(envelope.session_id ?? null);
          setMessages([envelopeMessage(envelope)]);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Could not open the conversation.");
      } finally {
        if (!cancelled) setBooting(false);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const sendAnswer = useCallback(async (answer: TypedChatAnswer, mode: TurnMode, echo: string) => {
    const activeLesson = lessonRef.current;
    if (!activeLesson || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setError("");

    const thinkingId = uid();
    setMessages((current) => [
      ...current,
      { id: uid(), role: "user", text: echo, createdAt: new Date().toISOString() },
      { id: thinkingId, role: "thinking" },
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
      setMessages((current) => [
        ...current.filter((m) => m.id !== thinkingId),
        envelopeMessage(envelope),
      ]);
    } catch (err) {
      const message = (err as Error).message || "That didn't send.";
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

  return { messages, lesson, sessionId, sending, booting, error, sendText, sendChoice };
}
