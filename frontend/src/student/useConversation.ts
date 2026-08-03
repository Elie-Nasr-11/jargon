import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  fetchLatestLearningSession,
  fetchVocabTerms,
  fetchLearningTurns,
  fetchLessonActivities,
  fetchLiveSessionViewers,
  fetchSessionHold,
  fetchStudentCatalog,
  fetchTeacherLiveComments,
  generateLiveArtifact,
  getSession,
  invokeJargonRun,
  invokeTypedChat,
  onAuthStateChange,
  recordVoiceInteraction,
} from "@/lib/api";
import { runJavaScript, runPython } from "@/lib/code-runner";
import { store } from "@/lib/jargon-store";
import { supabase } from "@/lib/supabase";
import type {
  ChatAttachment,
  IdeaEvent,
  LinkEvent,
  VocabEvent,
  VocabTerm,
  ChatInputModality,
  Lesson,
  LessonActivity,
  LessonArc,
  LessonChatResource,
  LiveSessionViewer,
  SessionHold,
  TeacherLiveComment,
  TypedChatAnswer,
  TypedChatControl,
  TypedChatEnvelope,
  VoiceInteractionEvent,
} from "@/lib/types";
import type { ComposerLanguage } from "@/lib/composerLanguage";
import {
  deriveLessonArc,
  envelopeMessage,
  formatRunOutput,
  liveCommentToMessage,
  mentorToPreferences,
  sortTimedMessages,
  withRestoredQuizChoices,
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

// ---------------------------------------------------------------------------------------------
// The conversation channel.
//
// StudentApp (which calls useConversation and composes ChatWindow/Transcript) is owned by the
// shell agent and only forwards the original prop surface. The hold lock, teacher presence,
// lesson arc, control turns, and voice actions all belong to THIS slice's components — so the
// hook publishes them on a module-level snapshot (there is exactly one live conversation per
// app, same singleton reasoning as lib/jargon-store) and ChatWindow/Transcript subscribe via
// useConversationChannel(). When the shell later passes explicit props, they can supersede this.

export type ConversationChannel = {
  // Session-hold + live intervention (Phase 3 server halves).
  held: boolean;
  teacherViewers: number;
  // Lesson flow.
  lessonArc: LessonArc | null;
  // Non-null while the server has the session in a revisit frame (Flow v3 backtracking).
  revisitFrontier: string | null;
  // Context the transcript-level actions need (read-aloud, live voice).
  accessToken: string;
  lessonId: string | null;
  sessionId: string | null;
  sending: boolean;
  // Actions. Control turns are lesson-spine acts, so they are stamped mode "lesson" (the server
  // lets control turns bypass the mode ceiling regardless — see applyModeCeiling).
  sendContinue: () => void;
  sendResume: () => void;
  sendNavigate: (targetActivityId: string) => void;
  retryControlTurn: (answer: TypedChatAnswer, control: TypedChatControl) => void;
  sendVoiceTurn: (
    text: string,
    mode: TurnMode,
    confidence?: number | null,
  ) => Promise<TypedChatEnvelope | null | "busy">;
  voiceEvent: (event: VoiceInteractionEvent) => void;
  // P8: the student accepted the mentor's "build me a quick activity" offer (see buildArtifact).
  buildArtifact: (offer: ArtifactOffer) => void;
  // Learning framework (F2/F3): the published vocab set (for transcript highlighting),
  // the live toast queue (vocab dropdown / link / idea events, filled AFTER a turn's
  // stream settles), dismissal, and re-showing a definition from a tapped highlight.
  vocabTerms: VocabTerm[];
  knowledgeToasts: KnowledgeToast[];
  dismissToast: (id: string) => void;
  showVocabCard: (event: VocabEvent) => void;
};

// `fresh` marks envelope-driven events (a link/word actually just earned) — the center
// growth flash plays only for those; tapping a highlight to re-read a definition doesn't.
export type KnowledgeToast =
  | { id: string; kind: "vocab"; event: VocabEvent; fresh?: boolean }
  | { id: string; kind: "link"; event: LinkEvent; fresh?: boolean }
  | { id: string; kind: "idea"; event: IdeaEvent; fresh?: boolean };

export type ArtifactOffer = { label: string; kind: "html_sim" | "deck"; activity_id: string };

const EMPTY_CHANNEL: ConversationChannel = {
  held: false,
  teacherViewers: 0,
  lessonArc: null,
  revisitFrontier: null,
  accessToken: "",
  lessonId: null,
  sessionId: null,
  sending: false,
  sendContinue: () => {},
  sendResume: () => {},
  sendNavigate: () => {},
  retryControlTurn: () => {},
  sendVoiceTurn: async () => null,
  voiceEvent: () => {},
  buildArtifact: () => {},
  vocabTerms: [],
  knowledgeToasts: [],
  dismissToast: () => {},
  showVocabCard: () => {},
};

let channelSnapshot: ConversationChannel = EMPTY_CHANNEL;
const channelListeners = new Set<() => void>();

function publishChannel(next: ConversationChannel) {
  channelSnapshot = next;
  channelListeners.forEach((listener) => listener());
}

export function useConversationChannel(): ConversationChannel {
  return useSyncExternalStore(
    (listener) => {
      channelListeners.add(listener);
      return () => channelListeners.delete(listener);
    },
    () => channelSnapshot,
  );
}

// One-shot input-modality staging. The Chatbox knows HOW a message was produced (typed vs
// dictated) but its onSend prop is forwarded by the shell as (text, attachments) only — so it
// stages the metadata here synchronously before calling onSend, and sendText consumes it in the
// same call stack. Cleared on read; a typed send never inherits a stale dictation stamp.
type StagedInputMeta = { inputModality: ChatInputModality; transcriptConfidence: number | null };

let stagedInputMeta: StagedInputMeta | null = null;

export function stageInputMeta(meta: StagedInputMeta) {
  stagedInputMeta = meta;
}

function takeStagedInputMeta(): StagedInputMeta | null {
  const meta = stagedInputMeta;
  stagedInputMeta = null;
  return meta;
}

// A viewer row counts as "watching" only with a fresh heartbeat — the teacher side heartbeats
// every ~20s, so 45s of silence means they left without a clean stop.
const VIEWER_FRESH_MS = 45_000;

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
  // The lesson's authored steps, fetched at open (pre-turn). Feeds the blank-lesson welcome
  // surface (suggested prompts) and the client-derived arc.
  const [activities, setActivities] = useState<LessonActivity[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  // The lesson spine (Step N/M · title). Client-derived on load; every envelope that carries an
  // authoritative lesson_arc supersedes it.
  const [lessonArc, setLessonArc] = useState<LessonArc | null>(null);
  // Flow v3 backtracking: non-null while the server holds a revisit frame open. Drives the
  // "return to where you were" chip.
  const [revisitFrontier, setRevisitFrontier] = useState<string | null>(null);
  // Chat-flow Phase 3: the authoritative session snapshot — seeded from the resumed row,
  // kept current by every envelope. Drives local progress updates + the completion
  // hand-off without a refetch.
  const [sessionSnapshot, setSessionSnapshot] = useState<{
    status: string | null;
    current_activity_id: string | null;
    activities_complete: boolean;
  } | null>(null);
  // Learning framework: the published vocab set (one fetch per app life — it's shared
  // curriculum data) and the live toast queue.
  const [vocabTerms, setVocabTerms] = useState<VocabTerm[]>([]);
  const [knowledgeToasts, setKnowledgeToasts] = useState<KnowledgeToast[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchVocabTerms()
      .then((terms) => !cancelled && setVocabTerms(terms))
      .catch(() => {
        // No vocab = no highlighting; the conversation itself is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const dismissToast = useCallback((id: string) => {
    setKnowledgeToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const showVocabCard = useCallback((event: VocabEvent) => {
    const id = uid();
    setKnowledgeToasts((current) => [
      ...current.filter((toast) => !(toast.kind === "vocab" && toast.event.term === event.term)),
      { id, kind: "vocab", event },
    ]);
  }, []);
  // True while a teacher has this session paused (session_holds). Locks the composer and the
  // send path; the server enforces it regardless (held envelope) — this is UX, not security.
  const [held, setHeld] = useState(false);
  const [viewers, setViewers] = useState<LiveSessionViewer[]>([]);
  // Re-evaluated every 10s so a viewer whose heartbeat stopped ages out of the chip without a
  // realtime event.
  const [viewerClock, setViewerClock] = useState(() => Date.now());
  // Kept after boot so transcript-level actions (read-aloud TTS, live voice) can call the edge
  // functions without re-fetching the session per click.
  const [accessToken, setAccessToken] = useState("");

  // Ref twins so send() can read current values without being re-created on every state change
  // (a changing callback identity would re-run effects in the consumer).
  const sessionRef = useRef<string | null>(null);
  const lessonRef = useRef<Lesson | null>(null);
  const lessonsRef = useRef<Lesson[]>([]);
  const sendingRef = useRef(false);
  const heldRef = useRef(false);
  // Monotonic token identifying the most recent lesson switch (see openLesson).
  const switchTokenRef = useRef(0);
  // The promise of the turn currently in flight, so a caller told "busy" can wait the turn
  // out and retry instead of dropping its send (the artifact build's ready post needs this).
  const inFlightTurnRef = useRef<Promise<TypedChatEnvelope | null> | null>(null);
  // True while a live artifact build is running (30-90s, outside the turn loop).
  const buildingArtifactRef = useRef(false);

  const setSession = (id: string | null) => {
    sessionRef.current = id;
    setSessionId(id);
  };

  const setHeldState = useCallback((next: boolean) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  // Fold one envelope's session-level fields into state. Shared by every path that receives an
  // envelope so a field can never be honored on send but ignored on boot.
  const applyEnvelope = useCallback(
    (envelope: TypedChatEnvelope) => {
      if (envelope.session_id) setSession(envelope.session_id);
      // Chat-flow Phase 3: the envelope's authoritative session snapshot finally has a
      // consumer — progress and the completion hand-off update from IT, not a refetch.
      if (envelope.session) {
        setSessionSnapshot({
          status: envelope.session.status ?? null,
          current_activity_id: envelope.session.current_activity_id ?? null,
          activities_complete: envelope.session.activities_complete === true,
        });
      }
      setOffers(offersFromEnvelope(envelope));
      // Accumulate: a later turn attaching nothing must not clear what was already shown.
      if (envelope.resources?.length) {
        setResources((current) => {
          const known = new Set(current.map((r) => r.id));
          const added = envelope.resources!.filter((r) => !known.has(r.id));
          return added.length ? [...current, ...added] : current;
        });
      }
      if (envelope.lesson_arc) setLessonArc(envelope.lesson_arc);
      // `undefined` = an envelope that doesn't carry the field (held/legacy) — no change.
      if (envelope.navigation !== undefined) {
        setRevisitFrontier(
          envelope.navigation?.mode === "revisit"
            ? envelope.navigation.frontier_activity_id || null
            : null,
        );
      }
      // Server-authoritative hold: a turn submitted while paused comes back held → re-lock.
      if (envelope.held) setHeldState(true);
      // Learning framework: this turn's knowledge events become toasts. applyEnvelope
      // runs after the stream settles, so the timing decision (owner: notify after the
      // reply finishes) holds by construction. Queue capped so a backlog can't stack.
      const toasts: KnowledgeToast[] = [
        ...(envelope.idea_events ?? []).map(
          (event): KnowledgeToast => ({ id: uid(), kind: "idea", event, fresh: true }),
        ),
        ...(envelope.link_events ?? []).map(
          (event): KnowledgeToast => ({ id: uid(), kind: "link", event, fresh: true }),
        ),
        ...(envelope.vocab_events ?? []).map(
          (event): KnowledgeToast => ({ id: uid(), kind: "vocab", event, fresh: true }),
        ),
      ];
      if (toasts.length) {
        setKnowledgeToasts((current) => [...current, ...toasts].slice(-3));
      }
    },
    [setHeldState],
  );

  // Point the conversation at a lesson: resume its existing session or create one, then load
  // the transcript. Shared by boot and by switching lessons from the sidebar so the two paths
  // can never drift — a lesson opened from the tree behaves exactly like one opened on load.
  //
  // `isStale` lets the caller abandon a slow load (unmount, or a second lesson clicked before
  // the first finished) without writing state that no longer belongs to the visible lesson.
  const loadLesson = useCallback(
    async (target: Lesson, isStale: () => boolean) => {
      lessonRef.current = target;
      setLesson(target);
      setMessages([]);
      setActivities([]);
      setOffers(NO_OFFERS);
      setResources([]);
      setError("");
      setLessonArc(null); // clear immediately so no stale spine flashes during the fetch
      setRevisitFrontier(null);
      setSessionSnapshot(null);
      setHeldState(false);

      const session = await getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");
      setAccessToken(token);

      // RESUME BEFORE SEND. invokeTypedChat with no session_id creates a NEW session every
      // call, so opening a lesson without this lookup would fragment the student's history
      // into a fresh session every time.
      //
      // Activities ride the same round trip: the client-derived arc shows the step eyebrow
      // immediately on resume (envelopes supersede it with the authoritative arc). A failed
      // activities read costs only the eyebrow, never the lesson.
      const [existing, activities] = await Promise.all([
        fetchLatestLearningSession(target.id),
        fetchLessonActivities(target.id).catch(() => []),
      ]);
      if (isStale()) return;

      if (existing?.id) {
        setSession(existing.id);
        // The persisted row seeds the snapshot so a completed lesson still shows its
        // hand-off after a reload (envelopes then keep it current).
        setSessionSnapshot({
          status: existing.status ?? null,
          current_activity_id: existing.current_activity_id ?? null,
          activities_complete: existing.activities_complete === true,
        });
        setLessonArc(deriveLessonArc(activities, existing.current_activity_id ?? null));
        // A reload mid-revisit restores the Return chip from the persisted frame.
        setRevisitFrontier(
          existing.nav && typeof existing.nav.frontier_activity_id === "string"
            ? existing.nav.frontier_activity_id
            : null,
        );
        // Teacher live tips are part of the record the student saw — merge them back into the
        // reloaded transcript in timestamp order. Best-effort: a failed read never blocks the
        // lesson itself.
        const [turns, comments] = await Promise.all([
          fetchLearningTurns(existing.id),
          fetchTeacherLiveComments(existing.id).catch(() => [] as TeacherLiveComment[]),
        ]);
        if (isStale()) return;
        setMessages(
          withRestoredQuizChoices(
            sortTimedMessages([
              ...(turns.map(turnToMessage).filter(Boolean) as Msg[]),
              ...comments.map(liveCommentToMessage),
            ]),
          ),
        );
      } else {
        // No session yet: stay BLANK — no auto-generated opening turn (no pretext). The
        // welcome surface (LessonWelcome) shows the lesson's materials + suggested prompts;
        // the student's first act goes through sendText, and invokeTypedChat with no
        // session_id creates the session then. Server-side the first turn presents the step
        // (presentedBefore === false skips grading), so nothing is lost by deferring.
        setLessonArc(deriveLessonArc(activities, null));
        setMessages([]);
      }
      setActivities(activities);
    },
    [setHeldState],
  );

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

  // Keep the realtime connection authenticated for the page's lifetime — the handler in api.ts
  // re-sets realtime auth on every token refresh, so the live-intervention subscriptions
  // survive past the first token's expiry (~1h).
  useEffect(() => {
    const { data } = onAuthStateChange(() => {});
    return () => data.subscription.unsubscribe();
  }, []);

  // Age viewers out of the "Teacher viewing" chip when their heartbeat stops.
  useEffect(() => {
    const id = window.setInterval(() => setViewerClock(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // Live-intervention wiring (ported from the retired /chat surface): one realtime channel per
  // session carrying teacher presence, student-visible live tips, and the pause/resume hold.
  // The initial fetches cover state that existed before the subscription opened (a teacher
  // already watching, a hold placed while the student was away).
  useEffect(() => {
    if (!sessionId) {
      setViewers([]);
      setHeldState(false);
      return;
    }

    let active = true;
    void fetchLiveSessionViewers(sessionId)
      .then((rows) => {
        if (active) setViewers(rows);
      })
      .catch(() => {
        if (active) setViewers([]);
      });
    void fetchSessionHold(sessionId)
      .then((hold) => {
        if (active) setHeldState(hold?.active === true);
      })
      .catch(() => {
        if (active) setHeldState(false);
      });

    const upsertViewer = (viewer: LiveSessionViewer) => {
      setViewers((current) => {
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
          // Teacher-private notes must never render in the student transcript.
          if (!comment?.id || comment.visibility !== "student_visible") return;
          const next = liveCommentToMessage(comment);
          setMessages((current) =>
            current.some((message) => message.id === next.id) ? current : [...current, next],
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
          setHeldState(hold?.active === true);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, setHeldState]);

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
  //
  // Returns the envelope (voice needs the reply to speak), null on failure/hold, or "busy" when
  // a turn is already in flight — callers that can wait (the voice panel) retry; UI callers
  // treat it as a no-op exactly like the old guard.
  const sendAnswer = useCallback(
    async (
      answer: TypedChatAnswer,
      mode: TurnMode,
      echo?: string,
      options?: {
        control?: TypedChatControl;
        echoMeta?: {
          inputModality?: ChatInputModality;
          transcriptConfidence?: number | null;
        };
      },
    ): Promise<TypedChatEnvelope | null | "busy"> => {
      const activeLesson = lessonRef.current;
      if (!activeLesson) return null;
      if (heldRef.current) {
        // The composer is locked while held, but voice callbacks and stale closures can still
        // race a pause. isError keeps this notice from becoming the "latest mentor message" —
        // a live quiz's buttons must not retire for a turn that was never sent.
        setMessages((current) => [
          ...current,
          {
            id: uid(),
            role: "bot",
            isError: true,
            text: "Your teacher paused the session to step in — hang tight until they resume it.",
          },
        ]);
        return null;
      }
      if (sendingRef.current) return "busy";

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
                inputModality: options?.echoMeta?.inputModality,
                transcriptConfidence: options?.echoMeta?.transcriptConfidence ?? null,
                createdAt: new Date().toISOString(),
              },
            ]),
        { id: thinkingId, role: "thinking" as const },
      ]);

      // Chat-flow Phase 2: stream the mentor's reply into the thinking placeholder as it
      // arrives. Deltas are buffered and flushed at ~12fps — a setMessages per token would
      // re-render the whole transcript hundreds of times per turn for no visible gain.
      let streamedText = "";
      let flushTimer = 0;
      const flushStream = () => {
        flushTimer = 0;
        const snapshot = streamedText;
        setMessages((current) =>
          current.map((m) =>
            m.id === thinkingId && m.role === "thinking" ? { ...m, text: snapshot } : m,
          ),
        );
      };
      const onDelta = (text: string) => {
        streamedText += text;
        if (!flushTimer) flushTimer = window.setTimeout(flushStream, 80);
      };

      const work = (async (): Promise<TypedChatEnvelope | null> => {
        try {
          const session = await getSession();
          const token = session?.access_token;
          if (!token) throw new Error("You must be signed in.");

          const envelope = await invokeTypedChat({
            accessToken: token,
            lessonId: activeLesson.id,
            sessionId: sessionRef.current,
            answer,
            control: options?.control,
            mentorPreferences: mentorToPreferences(store.getMentor()),
            mode,
            onDelta,
          });
          applyEnvelope(envelope);
          setMessages((current) => [
            ...current.filter((m) => m.id !== thinkingId),
            envelopeMessage(envelope, mode),
          ]);
          return envelope;
        } catch (err) {
          const message = friendlyError(err, "That didn't send.");
          // The error bubble carries the failed answer (and control) so Retry can re-send it
          // faithfully — a failed navigate/resume must retry as navigation, not degrade into a
          // bare text turn — and is flagged isError so it never becomes the "latest mentor
          // message" (which would strip live quiz choices off the real question with no way back).
          setMessages((current) => [
            ...current.filter((m) => m.id !== thinkingId),
            {
              id: uid(),
              role: "bot",
              text: message,
              isError: true,
              retryAnswer: answer,
              retryControl: options?.control,
            },
          ]);
          setError(message);
          return null;
        } finally {
          window.clearTimeout(flushTimer);
          sendingRef.current = false;
          setSending(false);
        }
      })();
      // Registered so a "busy" caller (the artifact build's ready post) can await the turn out.
      inFlightTurnRef.current = work;
      return work;
    },
    [applyEnvelope],
  );

  // Running code IS the turn in this curriculum: the server's code gate only passes on a real
  // execution result, so there is no useful "submit without running". One action runs the code,
  // shows the output, and submits it — which also makes a stale run_result impossible.
  //
  // Two runners, two result shapes, deliberately not flattened: Jargon executes server-side and
  // its full response (status, truncated, errors) is what the gate inspects, so it is passed
  // through as run_result untouched. JavaScript and Python run sandboxed in the browser and only
  // produce {ok, output}.
  const sendCode = useCallback(
    async (code: string, language: ComposerLanguage, mode: TurnMode) => {
      const trimmed = code.trim();
      if (!trimmed || sendingRef.current) return;

      let outputText = "";
      let ok = false;
      let runResult: Record<string, unknown>;

      try {
        if (language === "jargon") {
          const session = await getSession();
          const token = session?.access_token;
          if (!token) throw new Error("You must be signed in.");
          const response = await invokeJargonRun({
            accessToken: token,
            code: trimmed,
            answers: [],
          });
          outputText = formatRunOutput(response);
          ok = response.status === "ok";
          runResult = response as unknown as Record<string, unknown>;
        } else {
          const result =
            language === "python" ? await runPython(trimmed) : await runJavaScript(trimmed);
          outputText = result.output || "(no output)";
          ok = result.ok;
          runResult = { ok: result.ok, output: result.output };
        }
      } catch (err) {
        // A runner failure is shown as output, not as a chat error: the student's code is fine to
        // discuss even when the runtime could not be reached.
        outputText = friendlyError(err, "Could not run your code.");
        ok = false;
        runResult = { ok: false, output: outputText };
      }

      // The output bubble lands before the turn so the student sees their result immediately,
      // rather than after the tutor has finished thinking about it.
      setMessages((current) => [
        ...current,
        { id: uid(), role: "output", ok, output: outputText, lang: language },
      ]);

      await sendAnswer(
        { mode: "code", code: trimmed, run_result: runResult, client_msg_id: uid() },
        mode,
        trimmed,
      );
    },
    [sendAnswer],
  );

  const sendText = useCallback(
    (text: string, mode: TurnMode, attachments?: ChatAttachment[]) => {
      // Dictation metadata staged by the Chatbox in this same call stack (see stageInputMeta).
      const meta = takeStagedInputMeta();
      return sendAnswer(
        {
          mode: "text",
          text,
          input_modality: meta?.inputModality ?? "typed",
          transcript_confidence: meta?.transcriptConfidence ?? null,
          // Omitted rather than sent empty: the edge function branches on presence.
          attachments: attachments?.length ? attachments : undefined,
          client_msg_id: uid(),
        },
        mode,
        text,
        meta
          ? {
              echoMeta: {
                inputModality: meta.inputModality,
                transcriptConfidence: meta.transcriptConfidence,
              },
            }
          : undefined,
      );
    },
    [sendAnswer],
  );

  const sendChoice = useCallback(
    (choiceId: string, label: string, mode: TurnMode) => {
      // Stamp the pick on the quiz message BEFORE sending, so when the live buttons retire the
      // history keeps showing WHICH option was chosen (check-marked in the transcript).
      setMessages((current) => {
        const lastBot = [...current].reverse().find((m) => m.role === "bot" && !m.isError);
        if (!lastBot || lastBot.role !== "bot" || !lastBot.choices?.length) return current;
        return current.map((m) => (m.id === lastBot.id ? { ...m, chosen: choiceId } : m));
      });
      return sendAnswer(
        { mode: "multiple_choice", choice_id: choiceId, client_msg_id: uid() },
        mode,
        label,
      );
    },
    [sendAnswer],
  );

  // Flow v3: the Continue pill on a content step. Posts a structured control turn (no answer
  // text) — the server acknowledges the step deterministically and advances. Control turns are
  // lesson-spine acts, hence the fixed "lesson" mode stamp.
  const sendContinue = useCallback(() => {
    void sendAnswer({ mode: "text", text: "", client_msg_id: uid() }, "lesson", "Continue", {
      control: { type: "continue" },
    });
  }, [sendAnswer]);

  // Return from a revisit to exactly where the lesson left off (the server restores the paused
  // step state and clears the frame).
  const sendResume = useCallback(() => {
    void sendAnswer(
      { mode: "text", text: "", client_msg_id: uid() },
      "lesson",
      "Return to where I was",
      { control: { type: "resume" } },
    );
  }, [sendAnswer]);

  // Flow v3 backtracking: revisit a completed step. The server validates the target against its
  // own completion history and opens a revisit frame.
  const sendNavigate = useCallback(
    (targetActivityId: string) => {
      const title = lessonArc
        ? [...lessonArc.completed, ...lessonArc.upcoming].find(
            (step) => step.activity_id === targetActivityId,
          )?.title
        : undefined;
      void sendAnswer(
        { mode: "text", text: "", client_msg_id: uid() },
        "lesson",
        `Revisit: ${title || "an earlier step"}`,
        { control: { type: "navigate", target_activity_id: targetActivityId } },
      );
    },
    [lessonArc, sendAnswer],
  );

  // Re-send a failed turn. The Msg union already carries retryAnswer for exactly this, so the
  // original answer goes back verbatim rather than being reconstructed from the rendered text.
  const retry = useCallback(
    (answer: TypedChatAnswer, mode: TurnMode) => sendAnswer(answer, mode),
    [sendAnswer],
  );

  // A failed CONTROL turn retried with its control intact (a failed navigate must retry as
  // navigation). Reached through the channel because the shell's onRetry prop forwards only the
  // answer.
  const retryControlTurn = useCallback(
    (answer: TypedChatAnswer, control: TypedChatControl) => {
      void sendAnswer(answer, "lesson", undefined, { control });
    },
    [sendAnswer],
  );

  // P8: the student accepted the mentor's build offer (the "Build me a quick activity" pill).
  // Generation is a LONG call by design (~30-90s: the model writes a whole interactive
  // document), so it runs OUTSIDE the turn loop behind a dedicated status bubble — which, as a
  // plain bot message, also becomes the latest bot message and naturally retires the offer pill
  // while building. On success an artifact_ready control turn makes the mentor present the card
  // (and persists it in the turn payload for replay); on failure the bubble turns into an error
  // (server-side caps bound the spend, and an explicit ask re-opens the offer).
  const buildArtifact = useCallback(
    async (offer: ArtifactOffer) => {
      const activeLesson = lessonRef.current;
      const activeSession = sessionRef.current;
      if (
        !activeLesson ||
        !activeSession ||
        buildingArtifactRef.current ||
        sendingRef.current ||
        heldRef.current
      ) {
        return;
      }
      buildingArtifactRef.current = true;
      // The tapped offer is consumed — clear it off its message (like a picked quiz choice) so
      // the retired pill can't flash back between bubbles.
      setMessages((current) =>
        current.map((m) =>
          m.role === "bot" && m.artifactOffer?.activity_id === offer.activity_id
            ? { ...m, artifactOffer: undefined }
            : m,
        ),
      );
      const builtForLesson = activeLesson.id;
      const statusId = uid();
      setMessages((current) => [
        ...current,
        {
          id: uid(),
          role: "user",
          text: "Yes — build me an activity",
          turnMode: "lesson",
          createdAt: new Date().toISOString(),
        },
        {
          id: statusId,
          role: "bot",
          text: "Building your activity — this can take a minute or two. You can keep chatting while I work.",
          turnMode: "lesson",
          createdAt: new Date().toISOString(),
        },
      ]);
      try {
        const session = await getSession();
        const token = session?.access_token;
        if (!token) throw new Error("You must be signed in.");
        const built = await generateLiveArtifact({
          accessToken: token,
          lessonId: builtForLesson,
          sessionId: activeSession,
          activityId: offer.activity_id,
          kind: offer.kind,
        });
        // Belt-and-braces on top of the switch guards: a build that resolves after the lesson
        // changed is dropped, never smeared into the new session (state closures go stale over
        // a 30-90s call — hence the ref reads).
        if (lessonRef.current?.id !== builtForLesson) return;
        setMessages((current) => current.filter((m) => m.id !== statusId));
        const sendReady = () =>
          sendAnswer({ mode: "text", text: "", client_msg_id: uid() }, "lesson", undefined, {
            control: { type: "artifact_ready", resource_id: built.resource_id },
          });
        // The status bubble invites chatting during the build, so a normal turn may be in
        // flight when generation resolves — sendAnswer then returns "busy" WITHOUT sending.
        // Wait the turn out and retry (the code-run review pattern) so a successful build is
        // never silently dropped.
        let outcome = await sendReady();
        for (let attempt = 0; attempt < 3 && outcome === "busy"; attempt++) {
          await inFlightTurnRef.current?.catch(() => {});
          outcome = await sendReady();
        }
        if (outcome === "busy") {
          // Practically unreachable (each retry waits the in-flight turn out first). The honest
          // recovery: an explicit ask re-opens the offer, and the server's duplicate-reuse
          // window returns this same build instantly.
          setMessages((current) => [
            ...current,
            {
              id: uid(),
              role: "bot",
              isError: true,
              text: 'Your activity is ready but the chat was busy — type "build me the activity" to get it.',
            },
          ]);
        }
      } catch (err) {
        if (lessonRef.current?.id !== builtForLesson) return;
        const message = friendlyError(err, "The mentor couldn't build that this time.");
        setMessages((current) =>
          current.map((m) =>
            m.id === statusId
              ? { id: statusId, role: "bot" as const, isError: true, text: message }
              : m,
          ),
        );
      } finally {
        buildingArtifactRef.current = false;
      }
    },
    [sendAnswer],
  );

  // A spoken answer from the live-voice panel. The transcript is the record; raw audio is never
  // stored (see OPEN_QUESTIONS voice policy).
  const sendVoiceTurn = useCallback(
    (text: string, mode: TurnMode, confidence?: number | null) =>
      sendAnswer(
        {
          mode: "text",
          text,
          input_modality: "audio_session",
          transcript_confidence: confidence ?? null,
          client_msg_id: uid(),
        },
        mode,
        text,
        {
          echoMeta: { inputModality: "audio_session", transcriptConfidence: confidence ?? null },
        },
      ),
    [sendAnswer],
  );

  // Voice telemetry (dictation, read-aloud, live sessions), stamped with the current lesson and
  // session. Fire-and-forget: telemetry must never block the conversation.
  const voiceEvent = useCallback((event: VoiceInteractionEvent) => {
    void recordVoiceInteraction({
      session_id: sessionRef.current,
      lesson_id: lessonRef.current?.id ?? null,
      ...event,
    }).catch(() => {});
  }, []);

  const teacherViewers = useMemo(
    () =>
      viewers.filter(
        (viewer) =>
          viewer.status === "active" &&
          typeof viewer.last_seen_at === "string" &&
          viewerClock - Date.parse(viewer.last_seen_at) < VIEWER_FRESH_MS,
      ).length,
    [viewers, viewerClock],
  );

  // Publish the channel snapshot for ChatWindow/Transcript (see the module comment).
  useEffect(() => {
    publishChannel({
      held,
      teacherViewers,
      lessonArc,
      revisitFrontier,
      accessToken,
      lessonId: lesson?.id ?? null,
      sessionId,
      sending,
      sendContinue,
      sendResume,
      sendNavigate,
      retryControlTurn,
      sendVoiceTurn,
      voiceEvent,
      buildArtifact,
      vocabTerms,
      knowledgeToasts,
      dismissToast,
      showVocabCard,
    });
  }, [
    held,
    teacherViewers,
    lessonArc,
    revisitFrontier,
    accessToken,
    lesson,
    sessionId,
    sending,
    sendContinue,
    sendResume,
    sendNavigate,
    retryControlTurn,
    sendVoiceTurn,
    voiceEvent,
    buildArtifact,
    vocabTerms,
    knowledgeToasts,
    dismissToast,
    showVocabCard,
  ]);

  // A stale snapshot must not outlive the conversation that published it.
  useEffect(() => () => publishChannel(EMPTY_CHANNEL), []);

  return {
    messages,
    offers,
    resources,
    lessons,
    lesson,
    activities,
    sessionId,
    sending,
    booting,
    error,
    held,
    lessonArc,
    revisitFrontier,
    sessionSnapshot,
    sendText,
    sendCode,
    sendChoice,
    sendContinue,
    sendResume,
    sendNavigate,
    openLesson,
    retry,
  };
}
