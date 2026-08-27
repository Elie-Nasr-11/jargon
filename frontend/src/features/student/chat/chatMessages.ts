// The chat transcript's data model and its pure transforms (originally extracted from the
// retired routes/chat.tsx; today the v6 student surface — student/Transcript.tsx and
// student/useConversation.ts — is its consumer).
//
// Everything here is side-effect free and independently testable: the `Msg` union the transcript
// renders, the adapters that turn server shapes (LearningTurn, TypedChatEnvelope,
// TeacherLiveComment) into it, and the small formatting/parsing helpers. No React, no hooks, no
// component state — the route file keeps all of that.
//
// Extracted ahead of v5.0 P2's turn-mode work so the mode state machine lands in a file a human
// can still read. Pure move: no behavior change.
import type { ComposerLanguage } from "@/lib/composerLanguage";
import type { RunResult } from "@/lib/code-runner";
import type { JargonTokenKind } from "@/lib/jargon-syntax";
import type { MentorConfig } from "@/lib/jargon-store";
import type {
  ChatAttachment,
  ChatInputModality,
  FlowEvent,
  LessonFigure,
  JargonRunResponse,
  LearningTurn,
  LessonActivity,
  LessonArc,
  LessonChatResource,
  MentorPreferences,
  TeacherLiveComment,
  TypedChatAnswer,
  TypedChatControl,
  TypedChatEnvelope,
} from "@/lib/types";

export type RuntimeRunResult = RunResult & { raw?: JargonRunResponse };

export type ChatCodeBlock = { language: ComposerLanguage; source: string };
export type ChatChoice = { id?: string; label?: string; text?: string; value?: string };

// R32: a hand-off offer the mentor attached to a reply. It renders as an INLINE button in
// that message rather than as a floating row above the composer — see Transcript.
export type ModeOffer = { mode: "practice" | "discuss" | "lesson"; topic: string; label: string };

// R48: a lesson step that IS a real assignment/assessment. The mentor's reply carries the
// hand-off card the student opens the work surface from; the step holds until they submit.
export type WorkOffer = {
  kind: "assignment" | "assessment";
  id: string;
  title: string;
  status: string;
};

export type Msg =
  | {
      id: string;
      role: "user";
      text: string;
      code?: ChatCodeBlock;
      inputModality?: ChatInputModality;
      transcriptConfidence?: number | null;
      attachments?: ChatAttachment[];
      createdAt?: string;
      // v6: the TurnMode this message was sent in, so the transcript can group consecutive
      // messages into labelled mode sections. Kept as a plain string here to avoid coupling the
      // shared transcript model to the student surface's TurnMode union. Undefined = unknown
      // (any turn written before modes existed), which renders WITHOUT section chrome rather
      // than being relabelled as something we cannot actually verify.
      turnMode?: string;
      // Chat-flow Phase 1: the quiz choice this persisted answer carried (reload restoration).
      choiceId?: string;
    }
  | {
      id: string;
      role: "bot";
      text: string;
      code?: ChatCodeBlock;
      choices?: ChatChoice[];
      resources?: LessonChatResource[];
      // R30: figures this reply showed, resolved from the lesson's approved set.
      figures?: LessonFigure[];
      modeOffer?: ModeOffer;
      // P8: this message offered a live mentor-built activity. Live-turn only —
      // deliberately NOT replayed from history (artifact-live enforces once-per-step).
      artifactOffer?: { label: string; kind: "html_sim" | "deck"; activity_id: string };
      // R48: the work card for an assignment/assessment step. Replayed from history
      // (mode_offer pattern, NOT artifact_offer's live-only rule): the step stays held
      // until the submission lands, so losing the card on refresh would dead-end the
      // lesson. The transcript renders it only on the latest mentor message.
      workOffer?: WorkOffer;
      createdAt?: string;
      // Error bubbles must never become the "latest mentor message" — that would strip the
      // live quiz choices off the real question with no recovery path.
      isError?: boolean;
      // The failed turn's answer (and control, for navigate/resume/continue turns), so
      // the error bubble's Retry can re-send it faithfully.
      retryAnswer?: TypedChatAnswer;
      retryControl?: TypedChatControl;
      // The TurnMode the failed turn was sent in — Retry re-sends in THIS register, not
      // whatever the picker happens to show by the time the student taps it. Plain string
      // for the same decoupling reason as turnMode above.
      retryMode?: string;
      // True when this reply replaced a thinking placeholder the student already watched
      // stream in — the transcript skips the entrance animation on the settle swap.
      streamed?: boolean;
      // The choice the student picked on this (quiz) message — kept so history shows WHICH
      // option was selected after the live buttons retire.
      chosen?: string;
      // See the user variant: the mode this reply's exchange happened in.
      turnMode?: string;
      // The lesson arc as of this reply. Mentor turn payloads persist the whole envelope, so a
      // reloaded transcript can label each lesson section with the REAL step it happened on
      // (Step N/M · title) instead of guessing from the live cursor.
      lessonArc?: LessonArc | null;
      // Pillar 1 (flow rebuild): the server-written flow log for this turn. When present,
      // the transcript renders this message's section boundaries from the record instead
      // of inferring them (arc diffs, choices shape). Absent on pre-log turns.
      flow?: FlowEvent[];
    }
  | { id: string; role: "teacher"; text: string; createdAt?: string }
  | { id: string; role: "output"; ok: boolean; output: string; lang: ComposerLanguage }
  // Chat-flow Phase 2: `text` accumulates the mentor's streamed reply while the turn is
  // in flight — the placeholder paints prose live, then the real envelope message
  // replaces it. Absent until the first delta arrives ("Thinking…" renders meanwhile).
  | { id: string; role: "thinking"; text?: string };

export const uid = () => Math.random().toString(36).slice(2);

export function mentorToPreferences(mentor: MentorConfig): MentorPreferences {
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
export function deriveLessonArc(
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

export function turnToMessage(turn: LearningTurn): Msg | null {
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
      attachments: Array.isArray(turn.payload?.attachments)
        ? (turn.payload.attachments as ChatAttachment[])
        : undefined,
      // Chat-flow Phase 1: the persisted answer's choice_id, so a reloaded transcript can
      // re-stamp `chosen` on the quiz message this turn answered (withRestoredQuizChoices).
      choiceId: typeof turn.payload?.choice_id === "string" ? turn.payload.choice_id : undefined,
      turnMode: typeof turn.payload?.turn_mode === "string" ? turn.payload.turn_mode : undefined,
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
      // R33b: figures MUST be restored, not just resources. The persisted reply keeps its
      // [[figure:id]] marker (the server only strips markers that resolved to nothing), so
      // a reloaded transcript without figures fell through to the prose renderer and
      // printed the raw marker at the student — seen live 2026-08-13.
      figures: Array.isArray(payload.figures) ? (payload.figures as LessonFigure[]) : undefined,
      turnMode: typeof payload.turn_mode === "string" ? payload.turn_mode : undefined,
      // Pillar 5: continueOffer is no longer restored — the Continue button left in
      // R31b and the surface never rendered the offer again; typed readiness is the
      // advance verb now, so a reload cannot soft-lock. (Old payloads keep the key at
      // rest; it simply maps to nothing.) artifact_offer stays live-turn-only by
      // design (artifact-live enforces once-per-step).
      // R35 (visual pass): a pending mode hand-off pill MUST survive a reload. The
      // mentor's text points at it ("the pill carries that action" — R31e's one-tap
      // way out of Discuss), so losing it on refresh re-opened the exact dead-end the
      // pill was built to close. The transcript renders offers only on the latest
      // mentor message, so accepted/stale offers stay retired.
      modeOffer:
        // R67: an auto register shift supersedes the pill — the server keeps
        // attaching the way-back pill for OLDER clients, but a client that applied
        // the shift must not also render a button pointing at the register the
        // student is already in.
        !payload.register_shift &&
        payload.mode_offer &&
        typeof payload.mode_offer === "object" &&
        ["practice", "discuss", "lesson"].includes(
          String((payload.mode_offer as { mode?: unknown }).mode),
        ) &&
        typeof (payload.mode_offer as { label?: unknown }).label === "string"
          ? {
              mode: (payload.mode_offer as ModeOffer).mode,
              topic: String((payload.mode_offer as { topic?: unknown }).topic || ""),
              label: (payload.mode_offer as ModeOffer).label,
            }
          : undefined,
      // R48: the work card replays for the same reason as mode_offer — the mentor's text
      // points at it and the step is HELD until the submission lands, so a reload without
      // the card would strand the student. Latest-mentor-message rendering retires stale
      // ones once the lesson moves on.
      workOffer:
        payload.work_offer &&
        typeof payload.work_offer === "object" &&
        ["assignment", "assessment"].includes(
          String((payload.work_offer as { kind?: unknown }).kind),
        ) &&
        typeof (payload.work_offer as { id?: unknown }).id === "string"
          ? {
              kind: (payload.work_offer as WorkOffer).kind,
              id: (payload.work_offer as WorkOffer).id,
              title: String((payload.work_offer as { title?: unknown }).title || ""),
              status: String((payload.work_offer as { status?: unknown }).status || ""),
            }
          : undefined,
      // Persisted envelope payloads carry the arc; older turns simply don't have one.
      lessonArc:
        payload.lesson_arc && typeof payload.lesson_arc === "object"
          ? (payload.lesson_arc as LessonArc)
          : undefined,
      // Pillar 1: restore the flow log so a reloaded transcript draws the SAME section
      // boundaries the live turn did — the record, not a re-derivation.
      flow: Array.isArray(payload.flow) ? (payload.flow as FlowEvent[]) : undefined,
      createdAt: turn.created_at,
    };
  }
  return null;
}

// Chat-flow Phase 1: after a reload, re-stamp `chosen` on quiz messages from the persisted
// student answers that followed them — otherwise the latest bot message re-renders LIVE
// choice buttons for a question that was already answered, and tapping one sends a stale
// phantom answer. Walks in timestamp order; each choice-carrying student turn retires the
// nearest preceding unanswered quiz message.
export function withRestoredQuizChoices(messages: Msg[]): Msg[] {
  const result = [...messages];
  for (let i = 0; i < result.length; i += 1) {
    const message = result[i];
    if (message.role !== "user" || !message.choiceId) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      const candidate = result[j];
      if (candidate.role === "bot" && candidate.choices?.length && !candidate.chosen) {
        result[j] = { ...candidate, chosen: message.choiceId };
        break;
      }
    }
  }
  return result;
}

export function liveCommentToMessage(comment: TeacherLiveComment): Msg {
  return {
    id: `teacher-live-${comment.id}`,
    role: "teacher",
    text: comment.content,
    createdAt: comment.created_at,
  };
}

export function sortTimedMessages(messages: Msg[]) {
  return [...messages].sort((a, b) => {
    const aTime = "createdAt" in a && a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = "createdAt" in b && b.createdAt ? Date.parse(b.createdAt) : 0;
    return aTime - bTime;
  });
}

export function envelopeMessage(envelope: TypedChatEnvelope, turnMode?: string): Msg {
  return {
    id: uid(),
    role: "bot",
    text: envelope.reply || "I'm ready.",
    choices: envelope.choices?.length ? envelope.choices : undefined,
    resources: envelope.resources?.length ? envelope.resources : undefined,
    // R30: figures this reply showed, rendered inline where its [[figure:id]] marker sits.
    figures: envelope.figures?.length ? envelope.figures : undefined,
    // R67: an applied register shift supersedes the way-back pill (same rule as the
    // replay path below — the picker already moved, so the button would point at
    // the register the student is now in).
    modeOffer: envelope.register_shift ? undefined : (envelope.mode_offer ?? undefined),
    artifactOffer: envelope.artifact_offer ?? undefined,
    workOffer: envelope.work_offer ?? undefined,
    turnMode,
    lessonArc: envelope.lesson_arc ?? undefined,
    // Pillar 1: the live message carries the same flow log the persisted turn keeps,
    // so live and reloaded transcripts draw identical section boundaries.
    flow: envelope.flow?.length ? envelope.flow : undefined,
    createdAt: new Date().toISOString(),
  };
}

// The step eyebrow for a lesson section (DESIGN_V6 §4): "Step N/M · title". Null when the arc
// can't honestly label the section (single-step lessons carry no arc at all).
export function stepEyebrowLabel(arc: LessonArc | null | undefined): string | null {
  if (!arc || !arc.total || arc.total <= 1) return null;
  const title = arc.current?.title?.trim();
  return title ? `Step ${arc.step}/${arc.total} · ${title}` : `Step ${arc.step}/${arc.total}`;
}

export function formatRunOutput(result: JargonRunResponse) {
  const output = result.output?.length ? result.output.join("\n") : "";
  // The run fn's error shape mirrors each error into output as "[ERROR] …" — skip
  // errors already present so the student doesn't read the same message twice.
  const errors = (result.errors || [])
    .filter((entry) => entry && !output.includes(entry))
    .join("\n");
  return [output, errors].filter(Boolean).join("\n") || "(no output)";
}

export function languageLabel(lang: ComposerLanguage) {
  if (lang === "jargon") return "Jargon";
  return lang === "python" ? "Python" : "JavaScript";
}

export function choiceLabel(choice: ChatChoice) {
  return choice.text || choice.label || choice.value || choice.id || "Choice";
}

export function choiceValue(choice: ChatChoice) {
  return choice.id || choice.value || choice.label || choice.text || "";
}

export function normalizeLanguage(language: string | undefined): ComposerLanguage {
  const value = (language || "").trim().toLowerCase();
  if (value === "python" || value === "py") return "python";
  if (value === "javascript" || value === "js" || value === "typescript" || value === "ts") {
    return "javascript";
  }
  return "jargon";
}

// R29: two fence languages are DIAGRAMS, not code — ```graph plots functions and
// ```geometry draws figures, both from a JSON body. They are parsed here (one seam for
// every surface that renders messages) and carry the parsed spec plus the raw source, so a
// malformed body can fall back to showing what the author actually wrote.
export type ChatFigureBlock = { kind: "graph" | "geometry"; spec: unknown; source: string };

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; code: ChatCodeBlock }
  | { kind: "figure"; figure: ChatFigureBlock };

export function parseFencedBlocks(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text))) {
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    const fenceLang = (match[1] || "").trim().toLowerCase();
    const body = match[2].replace(/\n$/, "");
    if (fenceLang === "graph" || fenceLang === "geometry") {
      let spec: unknown = null;
      try {
        spec = JSON.parse(body);
      } catch {
        spec = null;
      }
      // Unparseable JSON degrades to a code block showing the source — never a blank hole
      // in the lesson, and the teacher can see what to fix.
      segments.push(
        spec && typeof spec === "object"
          ? { kind: "figure", figure: { kind: fenceLang, spec, source: body } }
          : { kind: "code", code: { language: "jargon", source: body } },
      );
      cursor = match.index + match[0].length;
      continue;
    }
    segments.push({
      kind: "code",
      code: {
        language: normalizeLanguage(match[1]),
        source: body,
      },
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments.length ? segments : [{ kind: "text", text }];
}

export function parseRunMessage(text: string): { text: string; code: ChatCodeBlock } | null {
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

export const jargonTokenClass: Record<JargonTokenKind, string> = {
  plain: "",
  command: "font-semibold text-[var(--jargon-syntax-command)]",
  condition: "font-semibold text-[var(--jargon-syntax-condition)]",
  comment: "italic text-[var(--jargon-syntax-comment)]",
  string: "text-[var(--jargon-syntax-string)]",
  number: "text-[var(--jargon-syntax-number)]",
  bracket: "text-[var(--jargon-syntax-bracket)]",
};

export async function copyToClipboard(text: string) {
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
