// The chat transcript's data model and its pure transforms, extracted from routes/chat.tsx.
//
// Everything here is side-effect free and independently testable: the `Msg` union the transcript
// renders, the adapters that turn server shapes (LearningTurn, TypedChatEnvelope,
// TeacherLiveComment) into it, and the small formatting/parsing helpers. No React, no hooks, no
// component state — the route file keeps all of that.
//
// Extracted ahead of v5.0 P2's turn-mode work so the mode state machine lands in a file a human
// can still read. Pure move: no behavior change.
import type { ComposerLanguage } from "@/components/Composer";
import type { RunResult } from "@/lib/code-runner";
import type { JargonTokenKind } from "@/lib/jargon-syntax";
import type { MentorConfig } from "@/lib/jargon-store";
import type {
  ChatAttachment,
  ChatInputModality,
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
    }
  | {
      id: string;
      role: "bot";
      text: string;
      code?: ChatCodeBlock;
      choices?: ChatChoice[];
      resources?: LessonChatResource[];
      // Flow v3: this message offered the Continue pill (content step awaiting an
      // explicit continue). Only the latest bot message's offer renders live.
      continueOffer?: { label: string };
      // P8: this message offered a live mentor-built activity. Live-turn only, like
      // continueOffer (never replayed from history).
      artifactOffer?: { label: string; kind: "html_sim" | "deck"; activity_id: string };
      createdAt?: string;
      // Error bubbles must never become the "latest mentor message" — that would strip the
      // live quiz choices off the real question with no recovery path.
      isError?: boolean;
      // The failed turn's answer (and control, for navigate/resume/continue turns), so
      // the error bubble's Retry can re-send it faithfully.
      retryAnswer?: TypedChatAnswer;
      retryControl?: TypedChatControl;
      // The choice the student picked on this (quiz) message — kept so history shows WHICH
      // option was selected after the live buttons retire.
      chosen?: string;
    }
  | { id: string; role: "teacher"; text: string; createdAt?: string }
  | { id: string; role: "output"; ok: boolean; output: string; lang: ComposerLanguage }
  | { id: string; role: "thinking" };

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

export function envelopeMessage(envelope: TypedChatEnvelope): Msg {
  return {
    id: uid(),
    role: "bot",
    text: envelope.reply || "I'm ready.",
    choices: envelope.choices?.length ? envelope.choices : undefined,
    resources: envelope.resources?.length ? envelope.resources : undefined,
    // Flow v3: the Continue pill rides the message that offered it, so (like retired
    // quiz choices) it stays anchored to its turn and only the LATEST offer is live.
    continueOffer: envelope.continue_offer ?? undefined,
    artifactOffer: envelope.artifact_offer ?? undefined,
    createdAt: new Date().toISOString(),
  };
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

export type MessageSegment = { kind: "text"; text: string } | { kind: "code"; code: ChatCodeBlock };

export function parseFencedBlocks(text: string): MessageSegment[] {
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
