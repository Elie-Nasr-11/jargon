import type { Session, User } from "@supabase/supabase-js";
import { functionUrl, supabase, supabaseAnonKey } from "@/lib/supabase";
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

function authHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
  grade?: string;
}) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        name: input.name || "",
        grade: input.grade || "",
      },
    },
  });
  if (error) throw error;
  if (data.user && data.session) {
    await upsertProfile(data.user, input.name || "", input.grade || "");
  }
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) || null;
}

export async function upsertProfile(user: User, name: string, grade: string) {
  const payload = {
    id: user.id,
    name: name || (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null),
    grade:
      grade || (typeof user.user_metadata?.grade === "string" ? user.user_metadata.grade : null),
  };
  const { error } = await supabase.from("profiles").upsert(payload);
  if (error) throw error;
}

export async function fetchLessons() {
  const { data, error } = await supabase
    .from("lessons")
    .select("*")
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []) as Lesson[];
}

export async function fetchLessonActivities(lessonId: string) {
  const { data, error } = await supabase
    .from("lesson_activities")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []) as LessonActivity[];
}

export async function fetchLatestLearningSession(lessonId: string) {
  const { data, error } = await supabase
    .from("learning_sessions")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data || [])[0] as LearningSession | undefined) || null;
}

export async function fetchLearningSession(sessionId: string) {
  const { data, error } = await supabase
    .from("learning_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as LearningSession | null) || null;
}

export async function fetchLearningTurns(sessionId: string) {
  const { data, error } = await supabase
    .from("learning_turns")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as LearningTurn[];
}

export async function fetchLessonAttempts(sessionId: string) {
  const { data, error } = await supabase
    .from("lesson_attempts")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as LessonAttempt[];
}

export async function invokeTypedChat(input: {
  accessToken: string;
  lessonId: string;
  sessionId?: string | null;
  answer?: TypedChatAnswer;
  mentorPreferences: MentorPreferences;
}) {
  const response = await fetch(functionUrl("chat"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      lesson_id: input.lessonId,
      session_id: input.sessionId || undefined,
      answer: input.answer,
      mentor_preferences: input.mentorPreferences,
    }),
  });
  const data = (await response.json()) as TypedChatEnvelope;
  if (!response.ok || data.status === "error") {
    throw new Error(data.reply || "Chat request failed.");
  }
  return data;
}

export async function invokeJargonRun(input: {
  accessToken: string;
  code: string;
  answers: string[];
}) {
  const response = await fetch(functionUrl("run"), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      code: input.code,
      answers: input.answers,
    }),
  });
  const data = (await response.json()) as JargonRunResponse;
  if (!response.ok) {
    throw new Error((data.errors && data.errors[0]) || "Jargon run failed.");
  }
  return data;
}
