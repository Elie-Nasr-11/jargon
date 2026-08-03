import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ArrowRight, Check, Paperclip, RotateCcw, Sparkles } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import { tokenizeJargon } from "@/lib/jargon-syntax";
import { store } from "@/lib/jargon-store";
import { ReadAloudAction } from "@/components/ReadAloudAction";
import { ResourceCard } from "@/student/ResourceCard";
import { isTurnMode, modeAccentValue, turnModeSpec } from "@/student/turnModes";
import { useConversationChannel } from "@/student/useConversation";
import type { LessonArc, TypedChatAnswer, VocabEvent, VocabTerm } from "@/lib/types";
import {
  choiceLabel,
  choiceValue,
  jargonTokenClass,
  languageLabel,
  parseFencedBlocks,
  stepEyebrowLabel,
  type ChatCodeBlock,
  type Msg,
} from "@/features/student/chat/chatMessages";

// Renders the conversation as a sequence of MODE SECTIONS.
//
// The border and eyebrow pill belong to a stretch of conversation, not to the window: a student
// scrolling back can see at a glance that this part was Discuss and that part was Quiz. So
// consecutive messages sharing a TurnMode are boxed together and labelled once. Lesson sections
// carry the step eyebrow (Step N/M · title) read from the arc persisted on their mentor turns;
// Discuss/Open sections render slightly desaturated — off the lesson spine, and the chrome shows
// it (see modeAccentValue).
//
// A message whose mode is UNKNOWN (any turn written before modes were persisted) renders with no
// section chrome at all. Relabelling it as "Lesson" would be inventing history we cannot verify.
//
// Only user and mentor messages open a section. Thinking placeholders, code output, and teacher
// interjections continue whatever section is open — they are not the student choosing a mode.
//
// Fenced code blocks are parsed and highlighted — the mentor teaches with code, so a reply
// containing ``` must not render as flat text. parseFencedBlocks / jargonTokenClass /
// tokenizeJargon are the same helpers the previous surface used.
//
// MENTOR prose additionally gets the safe hand-rolled markdown subset ported from the old
// surface (P5c): inline `code`/**bold**/*italic*/https-only links, and — gated by a cheap
// block-syntax test (BLOCK_MD_RE) — ##/### headings, -/1. lists, and paragraphs. Everything
// renders as React nodes (text nodes ARE the sanitizer — no dangerouslySetInnerHTML anywhere,
// no markdown dependency); anything unmatched passes through as literal text, so a malformed
// reply can never drop content or inject markup. Student and teacher bubbles stay plain
// pre-wrap text.

function CodeBlock({ code }: { code: ChatCodeBlock }) {
  return (
    <figure
      className="my-2 overflow-hidden rounded-[14px] border border-border"
      style={{ boxShadow: "var(--inset-highlight)" }}
    >
      <figcaption className="border-b border-border bg-depth-sub px-3 py-1 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
        {languageLabel(code.language)}
      </figcaption>
      {/* Wide code scrolls inside its own box; the transcript column must never scroll sideways. */}
      <pre className="overflow-x-auto bg-code-background px-4 py-2.5 font-mono text-[11.5px] leading-[1.8] text-code-foreground">
        <code>
          {code.language === "jargon"
            ? tokenizeJargon(code.source).map((token, i) => (
                <span key={`${token.kind}-${i}`} className={jargonTokenClass[token.kind]}>
                  {token.text}
                </span>
              ))
            : code.source}
        </code>
      </pre>
    </figure>
  );
}

// ---- The safe markdown subset (ported from the old surface's P5c renderer) ----------------
//
// Minimal inline markdown for mentor prose: `code`, **bold**, *italic*, and https-only
// [text](url) links. Alternation order matters: code first (its content is verbatim), then
// bold before italic. The italic opener guard [^\s*] keeps "3 * 4 and 2 * 5" plain; the
// literal https:// in the link branch enforces the scheme lexically (no javascript:/data:
// vector exists).
const INLINE_MD_RE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^\s*][^*\n]*\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g;

// --- Learning framework (F2): vocab highlighting -------------------------------------
// One pass object per MENTOR message: a combined word-boundary regex over every published
// term + variant, a canonical lookup, and a per-message `seen` set so each term
// highlights once per message (owner decision). Tapping a mark re-shows its definition
// card through the same toast queue the first-encounter dropdown uses. Highlighting
// applies to FINAL text only — the streaming placeholder never gets a pass object.
export type VocabPass = {
  regexSource: string;
  byWord: Map<string, VocabTerm>;
  seen: Set<string>;
  show: (event: VocabEvent) => void;
};

const SUBJECT_HUES = [
  "--mode-lesson",
  "--mode-practice",
  "--mode-discuss",
  "--mode-open",
  "--mode-quiz",
  "--mode-assignment",
];
export function subjectHueVar(subject: string): string {
  let hash = 0;
  for (let i = 0; i < subject.length; i += 1) hash = (hash * 31 + subject.charCodeAt(i)) | 0;
  return SUBJECT_HUES[Math.abs(hash) % SUBJECT_HUES.length];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildVocabMatcher(
  terms: VocabTerm[],
  show: (event: VocabEvent) => void,
): {
  regexSource: string;
  byWord: Map<string, VocabTerm>;
  show: (event: VocabEvent) => void;
} | null {
  const byWord = new Map<string, VocabTerm>();
  const words: string[] = [];
  for (const term of terms) {
    for (const word of [term.term, ...(term.variants || [])]) {
      const lower = String(word || "").toLowerCase();
      if (!lower || byWord.has(lower)) continue;
      byWord.set(lower, term);
      words.push(escapeRegExp(lower));
    }
  }
  if (!words.length) return null;
  // Longest-first so "instructions" wins over "instruction" at the same position.
  words.sort((a, b) => b.length - a.length);
  return { regexSource: `\\b(?:${words.join("|")})\\b`, byWord, show };
}

function highlightRun(part: string, vocab: VocabPass, keyBase: string): ReactNode {
  const re = new RegExp(vocab.regexSource, "gi");
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(part))) {
    const word = match[0];
    const term = vocab.byWord.get(word.toLowerCase());
    if (!term || vocab.seen.has(term.term)) continue;
    vocab.seen.add(term.term);
    if (match.index > last) nodes.push(part.slice(last, match.index));
    const event: VocabEvent = {
      term: term.term,
      definition: term.definition,
      subject: term.subject,
    };
    nodes.push(
      <span
        key={`${keyBase}-${match.index}`}
        role="button"
        tabIndex={0}
        className="vocab-mark"
        style={{ ["--vocab-hue" as string]: `var(${subjectHueVar(term.subject)})` }}
        title={`${term.term} — tap for the definition`}
        onClick={() => vocab.show(event)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") vocab.show(event);
        }}
      >
        {word}
      </span>,
    );
    last = match.index + word.length;
  }
  if (!nodes.length) return part;
  if (last < part.length) nodes.push(part.slice(last));
  return nodes;
}

function renderInline(text: string, vocab?: VocabPass): ReactNode[] {
  return text.split(INLINE_MD_RE).map((part, i) => {
    const code = part.match(/^`([^`\n]+)`$/);
    if (code) {
      return (
        <code
          key={i}
          className="inline-code-hue rounded-md bg-code-background px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {code[1]}
        </code>
      );
    }
    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) {
      return (
        <b key={i} className="font-semibold">
          {bold[1]}
        </b>
      );
    }
    const italic = part.match(/^\*([^\s*][^*\n]*)\*$/);
    if (italic) {
      return <i key={i}>{italic[1]}</i>;
    }
    const link = part.match(/^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 decoration-foreground/40 transition-colors hover:decoration-foreground"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{vocab ? highlightRun(part, vocab, String(i)) : part}</Fragment>;
  });
}

// Structured replies only: a cheap block-syntax test gates the block renderer so plain replies
// (the overwhelming majority) keep rendering through the untouched pre-wrap path bit-identically.
const BLOCK_MD_RE = /^\s{0,3}(#{2,3}\s+\S|-\s+\S|\d{1,3}\.\s+\S)/m;

// Line-based block pass: ##/### headings, consecutive -/1. lists, blank-line-separated
// paragraphs. Unsupported syntax (# h1, > quotes, tables) stays literal paragraph text.
function renderBlocks(text: string, vocab?: VocabPass): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    const joined = paragraph.join("\n");
    paragraph = [];
    if (!joined.trim()) return;
    nodes.push(
      <p key={nodes.length} className="whitespace-pre-wrap">
        {renderProse(joined, vocab, `b${nodes.length}`)}
      </p>,
    );
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    list = null;
    const rows = items.map((item, i) => <li key={i}>{renderInline(item, vocab)}</li>);
    nodes.push(
      // Round 21: lists step out of the prose — indented behind a hairline divider rule.
      ordered ? (
        <ol
          key={nodes.length}
          className="ml-1 list-decimal space-y-1.5 border-l-2 border-border pl-6"
        >
          {rows}
        </ol>
      ) : (
        <ul key={nodes.length} className="ml-1 list-disc space-y-1.5 border-l-2 border-border pl-6">
          {rows}
        </ul>
      ),
    );
  };

  for (const line of lines) {
    const h3 = line.match(/^\s{0,3}###\s+(.+)$/);
    const h2 = h3 ? null : line.match(/^\s{0,3}##\s+(.+)$/);
    if (h3 || h2) {
      flushParagraph();
      flushList();
      nodes.push(
        h3 ? (
          <div key={nodes.length} className="pt-1 text-[15px] font-semibold">
            {renderInline(h3[1])}
          </div>
        ) : (
          <div key={nodes.length} className="pt-1 font-serif text-title">
            {renderInline(h2![1])}
          </div>
        ),
      );
      continue;
    }
    const ol = line.match(/^\s{0,3}\d{1,3}\.\s+(.+)$/);
    const ul = ol ? null : line.match(/^\s{0,3}-\s+(.+)$/);
    if (ol || ul) {
      flushParagraph();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ol ?? ul)![1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return nodes;
}

// Text with its fenced blocks lifted out. Code gets the highlighted block; prose segments keep
// whitespace. `markdown` (mentor bubbles only) turns on the safe subset above — student and
// teacher text stays literal.
// --- Round 21: sentence-aware prose ------------------------------------------------
// A completed sentence is one followed by more text; the trailing fragment is the TAIL.
// Streaming renders the tail as soft blurred GRAY (still forming) and each sentence, the
// moment it completes, sharpens and whitens (stream-whiten). Questions — sentences that
// end in "?" — wear the accent in both live and settled prose, so "something to act on"
// never reads as flat text.
function splitSentences(text: string): { done: string[]; tail: string } {
  const parts = text.split(/(?<=[.!?…]["')\]]?)\s+/);
  if (parts.length <= 1) return { done: [], tail: text };
  return { done: parts.slice(0, -1), tail: parts[parts.length - 1] };
}

function isQuestionSentence(sentence: string): boolean {
  return /[?]["')\]]?\s*$/.test(sentence.trim());
}

// Settled prose, sentence-decorated: questions get the accent treatment; everything else
// renders as before. Used by MessageBody's plain path so final messages match the live one.
function renderProse(raw: string, vocab?: VocabPass, keyBase = "s"): ReactNode[] {
  const { done, tail } = splitSentences(raw);
  const sentences = tail ? [...done, tail] : done;
  return sentences.map((sentence, i) => (
    <span
      key={`${keyBase}-${i}`}
      className={isQuestionSentence(sentence) ? "prose-question" : undefined}
    >
      {renderInline(sentence, vocab)}
      {i < sentences.length - 1 ? " " : null}
    </span>
  ));
}

// The live streaming body: fenced code renders as real code blocks AS IT ARRIVES; prose
// splits into whitened sentences + the blurred gray tail. Inline markdown applies live —
// bold streams in bold the moment its pair closes. (Block lists settle into full list
// styling when the final message replaces this; mid-stream they read as plain lines.)
function StreamingBody({ text }: { text: string }) {
  const segments = parseFencedBlocks(text);
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "code") return <CodeBlock key={i} code={segment.code} />;
        const raw = segment.text.replace(/^\n+/, "");
        if (!raw.trim()) return null;
        const { done, tail } = splitSentences(raw);
        return (
          <span key={i} className="whitespace-pre-wrap">
            {done.map((sentence, j) => (
              <span
                key={j}
                className={`stream-done${isQuestionSentence(sentence) ? " prose-question" : ""}`}
              >
                {renderInline(sentence)}{" "}
              </span>
            ))}
            {tail ? <span className="stream-tail">{renderInline(tail)}</span> : null}
          </span>
        );
      })}
    </>
  );
}

function MessageBody({
  text,
  markdown,
  vocab,
}: {
  text: string;
  markdown?: boolean;
  vocab?: VocabPass;
}) {
  const segments = parseFencedBlocks(text);
  const renderText = (raw: string, key?: number) => {
    if (markdown && BLOCK_MD_RE.test(raw)) {
      return (
        <div key={key} className="space-y-2">
          {renderBlocks(raw, vocab)}
        </div>
      );
    }
    return (
      <span key={key} className="whitespace-pre-wrap">
        {markdown ? renderProse(raw, vocab, String(key ?? "p")) : raw}
      </span>
    );
  };
  if (segments.length === 1 && segments[0].kind === "text") {
    return renderText(segments[0].text);
  }
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === "code" ? (
          <CodeBlock key={i} code={segment.code} />
        ) : segment.text.trim() ? (
          renderText(segment.text.replace(/^\n+|\n+$/g, ""), i)
        ) : null,
      )}
    </>
  );
}

// Design system (board 5b): MENTOR text sits directly on the page — no bubble; the student's
// reply gets the soft pill (nested surface, hairline, 14/14/4/14 corners); teacher, error, and
// code output keep quiet bordered blocks. Send-side chrome inverts per theme elsewhere.
function Bubble({
  align,
  tone,
  children,
}: {
  align: "start" | "end";
  tone: "user" | "mentor" | "teacher" | "error" | "output";
  children: ReactNode;
}) {
  if (tone === "mentor") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[min(46rem,92%)] text-body text-foreground">{children}</div>
      </div>
    );
  }
  const toneClass =
    tone === "user"
      ? "rounded-[14px] rounded-br-[4px] border border-border bg-depth-sub text-foreground"
      : tone === "error"
        ? "rounded-card border border-danger/40 bg-depth-sub text-danger"
        : tone === "teacher"
          ? "rounded-card border border-info/40 bg-depth-sub text-foreground"
          : "rounded-card border border-border bg-code-background font-mono text-code-foreground";
  return (
    <div className={`flex ${align === "end" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(46rem,85%)] px-3.5 py-2.5 text-body ${toneClass}`}
        style={{ boxShadow: "var(--inset-highlight)" }}
      >
        {children}
      </div>
    </div>
  );
}

// DESIGN_V6 §3: mentor replies rise 12px and fade in over 280ms (power3.out). Student sends stay
// instant — the student did it, and latency there reads as lag. Reduced motion renders the final
// state with no tween (the element's default styles ARE the final state).
function MentorRise({ animate, children }: { animate: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!animate || !ref.current || prefersReducedMotion()) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.28, ease: "power3.out" },
    );
  }, [animate]);
  return <div ref={ref}>{children}</div>;
}

// A run of consecutive messages that happened in one mode. `arc` is the lesson arc as of the
// LAST mentor turn in the run — what the section's step eyebrow reports.
type Section = { mode?: string; items: Msg[]; arc: LessonArc | null; checkpoint?: boolean };

function groupIntoSections(messages: Msg[]): Section[] {
  const sections: Section[] = [];
  for (const message of messages) {
    const opensSection = message.role === "user" || message.role === "bot";
    const mode = opensSection ? message.turnMode : undefined;
    const current = sections[sections.length - 1];
    // Non-opening messages (thinking, output, teacher) always continue the open section so a
    // reply and its "Thinking…" placeholder never get split across two boxes.
    // Transcript smoothing (round 19): a lesson-mode run that spans several steps must
    // not wear one step label — a mentor reply arriving with a DIFFERENT arc step starts
    // a fresh section, so each stretch is labelled with the step it actually happened on.
    const arcStep = message.role === "bot" && message.lessonArc ? message.lessonArc.step : null;
    const stepChanged = arcStep !== null && current?.arc != null && current.arc.step !== arcStep;
    // Round 20: every CHECKPOINT gets its own section marker — a mentor message that
    // presents quiz choices opens a fresh, checkpoint-flagged section even mid-mode.
    const opensCheckpoint =
      message.role === "bot" && !!message.choices?.length && !current?.checkpoint;
    if (current && (!opensSection || mode === current.mode) && !stepChanged && !opensCheckpoint) {
      current.items.push(message);
    } else {
      sections.push({
        mode: mode ?? current?.mode,
        items: [message],
        arc: null,
        checkpoint: opensCheckpoint || undefined,
      });
    }
    const open = sections[sections.length - 1];
    if (message.role === "bot" && message.lessonArc) open.arc = message.lessonArc;
  }
  return sections;
}

// The full-width mode rule: a hairline spanning the whole conversation window with the mode
// pill sitting on it. It animates in once, the first time it is actually seen — a new section
// appended at the bottom (the student just switched modes) is in view immediately, and an old
// section scrolled back into view plays the same entrance. IntersectionObserver drives both
// cases with one mechanism; reduced motion renders the final state straight away.
function ModeRule({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className={`mode-divider flex items-center gap-3 px-4 ${inView ? "in-view" : ""}`}
    >
      <span className="mode-rule mode-rule-l" />
      {/* The board's divider label: mono micro-label in the section's hue, sitting directly
          on the rule — no pill box. */}
      <span className="mode-eyebrow mode-pill max-w-[70%] shrink-0 truncate px-1 text-overline font-semibold uppercase tracking-[0.16em]">
        {label}
      </span>
      <span className="mode-rule mode-rule-r" />
    </div>
  );
}

function ModeSection({
  mode,
  arc,
  checkpoint,
  children,
}: {
  mode?: string;
  arc: LessonArc | null;
  checkpoint?: boolean;
  children: ReactNode;
}) {
  // Round 20: checkpoints wear their own marker regardless of the surrounding mode —
  // the moment of being tested deserves a visible line in the record.
  if (checkpoint) {
    const spec = turnModeSpec("quiz");
    return (
      <section
        aria-label="Checkpoint section"
        className="mt-5 first:mt-1"
        style={{ ["--mode-accent" as string]: modeAccentValue(spec) }}
      >
        <ModeRule label="Checkpoint" />
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-3">{children}</div>
      </section>
    );
  }
  // Unknown mode: no rule, no label. Never claim a mode we did not record.
  if (!mode || !isTurnMode(mode))
    return (
      <div className="mx-auto mt-3 flex w-full max-w-3xl flex-col gap-3 px-4 first:mt-1">
        {children}
      </div>
    );
  const spec = turnModeSpec(mode);
  // Lesson sections carry the step eyebrow; every other mode labels itself.
  const eyebrow = (mode === "lesson" && stepEyebrowLabel(arc)) || spec.label;
  return (
    <section
      aria-label={`${spec.label} section`}
      className="mt-5 first:mt-1"
      style={{ ["--mode-accent" as string]: modeAccentValue(spec) }}
    >
      {/* The rule spans the window; the messages stay in the centered reading column. */}
      <ModeRule label={eyebrow} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-3">{children}</div>
    </section>
  );
}

export type TranscriptProps = {
  messages: Msg[];
  // Choices are live only on the LATEST mentor message — an older question's buttons must not
  // stay clickable once the conversation has moved on.
  onChoose?: (choiceId: string, label: string) => void;
  onRetry?: (answer: TypedChatAnswer) => void;
  disabled?: boolean;
};

export function Transcript({ messages, onChoose, onRetry, disabled }: TranscriptProps) {
  // Live-conversation context the shell does not thread as props: the hold lock (which also
  // freezes live pills), the continue/retry control senders, and the read-aloud call context.
  const channel = useConversationChannel();
  // Learning framework (F2): one compiled vocab matcher for the whole transcript; each
  // mentor message gets a FRESH `seen` set so terms highlight once per message.
  const vocabMatcher = useMemo(
    () => buildVocabMatcher(channel.vocabTerms, channel.showVocabCard),
    [channel.vocabTerms, channel.showVocabCard],
  );
  const voice = store.getVoice();
  const inert = disabled || channel.held;

  // New-message tracking so ONLY newly-arrived mentor replies animate. Null until the first
  // non-empty render: everything present then (a reloaded transcript, a lesson switch) counts
  // as history and renders instantly.
  const seenRef = useRef<Set<string> | null>(null);
  const seen = seenRef.current;
  useEffect(() => {
    if (!messages.length) {
      seenRef.current = null; // lesson switch: the next transcript starts as history again
      return;
    }
    if (seenRef.current === null) seenRef.current = new Set();
    for (const message of messages) seenRef.current.add(message.id);
  }, [messages]);

  // The empty case belongs to LessonWelcome now (the blank lesson-open surface) — the
  // transcript renders nothing rather than competing with it.
  if (!messages.length) return null;

  const lastBotId = [...messages].reverse().find((m) => m.role === "bot" && !m.isError)?.id;
  const sections = groupIntoSections(messages);
  // Mounted only when the conversation context is live — a ReadAloud button that cannot reach
  // the TTS endpoint would fall straight to browser speech and misreport telemetry.
  const canReadAloud = Boolean(channel.accessToken && channel.lessonId);

  return (
    <div className="flex flex-col">
      {sections.map((section, sectionIndex) => (
        <ModeSection
          key={`${section.mode ?? "unknown"}-${sectionIndex}`}
          mode={section.mode}
          arc={section.arc}
          checkpoint={section.checkpoint}
        >
          {section.items.map((message) => {
            if (message.role === "thinking") {
              // Chat-flow Phase 2: once deltas arrive, the placeholder paints the reply
              // live; before the first delta it stays the quiet "Thinking…" line.
              return (
                <Bubble key={message.id} align="start" tone="mentor">
                  {message.text ? (
                    <StreamingBody text={message.text} />
                  ) : (
                    <span className="text-muted-foreground">Thinking…</span>
                  )}
                </Bubble>
              );
            }
            if (message.role === "user") {
              return (
                <Bubble key={message.id} align="end" tone="user">
                  <MessageBody text={message.text} />
                  {/* What the student attached, so the transcript still shows it on reload —
                      the filename is the only part they will recognise later. */}
                  {message.attachments?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {message.attachments.map((attachment) => (
                        <span
                          key={attachment.upload_id}
                          className="flex items-center gap-1 rounded-pill border border-border bg-background px-2 py-0.5 text-meta"
                        >
                          <Paperclip className="h-3 w-3" strokeWidth={1.8} />
                          <span className="max-w-[12rem] truncate">{attachment.filename}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {/* Spoken turns are labelled: the transcript is the grading artifact, and how
                      it was produced is part of the record (dictation can mishear). */}
                  {message.inputModality === "dictated" ||
                  message.inputModality === "audio_session" ? (
                    <span className="mt-1.5 block text-right text-overline uppercase tracking-[0.08em] opacity-60">
                      {message.inputModality === "audio_session" ? "Voice" : "Dictated"}
                    </span>
                  ) : null}
                </Bubble>
              );
            }
            if (message.role === "teacher") {
              return (
                <div key={message.id} className="hvp flex flex-col gap-1">
                  <Bubble align="start" tone="teacher">
                    <span className="mb-1 block text-overline uppercase tracking-[0.08em] opacity-70">
                      Your teacher
                    </span>
                    <MessageBody text={message.text} />
                  </Bubble>
                  {canReadAloud ? (
                    <div className="hvr pl-1">
                      <ReadAloudAction
                        text={message.text}
                        voice={voice}
                        accessToken={channel.accessToken}
                        lessonId={channel.lessonId!}
                        sessionId={channel.sessionId}
                        onVoiceEvent={channel.voiceEvent}
                      />
                    </div>
                  ) : null}
                </div>
              );
            }
            if (message.role === "output") {
              return (
                <Bubble key={message.id} align="start" tone="output">
                  <span className="whitespace-pre-wrap">{message.output}</span>
                </Bubble>
              );
            }

            const isLatestBot = message.id === lastBotId;
            const liveChoices = isLatestBot && message.choices?.length && !message.chosen;
            const isNew = seen !== null && !seen.has(message.id);
            return (
              <MentorRise key={message.id} animate={isNew}>
                <div className="hvp flex flex-col gap-2">
                  <Bubble align="start" tone={message.isError ? "error" : "mentor"}>
                    <MessageBody
                      text={message.text}
                      markdown={!message.isError}
                      vocab={
                        vocabMatcher && !message.isError
                          ? { ...vocabMatcher, seen: new Set<string>() }
                          : undefined
                      }
                    />
                    {/* An error bubble carries the answer that failed, so Retry re-sends it
                        verbatim rather than asking the student to retype. A failed CONTROL turn
                        retries through the channel so its control rides along — a failed
                        navigate must retry as navigation, not as an empty text turn. */}
                    {message.isError && message.retryAnswer ? (
                      <button
                        type="button"
                        disabled={inert}
                        onClick={() =>
                          message.retryControl
                            ? channel.retryControlTurn(message.retryAnswer!, message.retryControl)
                            : onRetry?.(message.retryAnswer!)
                        }
                        className="mt-2 flex items-center gap-1.5 rounded-control border border-danger/40 px-2 py-1 text-meta text-danger transition-colors duration-(--dur-fast) hover:bg-danger/10 disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} /> Try again
                      </button>
                    ) : null}
                  </Bubble>
                  {!message.isError && canReadAloud ? (
                    <div className="hvr pl-1">
                      <ReadAloudAction
                        text={message.text}
                        voice={voice}
                        accessToken={channel.accessToken}
                        lessonId={channel.lessonId!}
                        sessionId={channel.sessionId}
                        onVoiceEvent={channel.voiceEvent}
                      />
                    </div>
                  ) : null}
                  {/* Materials the mentor attached to THIS reply, so "have a look at this" points
                      at something. Unlike quiz choices these stay rendered on older messages — a
                      resource does not expire the way a live question does. */}
                  {message.resources?.length ? (
                    <div className="flex flex-col gap-2 pl-1">
                      {message.resources.map((resource) => (
                        <ResourceCard
                          key={resource.id}
                          resource={resource}
                          lessonId={channel.lessonId}
                          sessionId={channel.sessionId}
                        />
                      ))}
                    </div>
                  ) : null}
                  {liveChoices ? (
                    <div className="flex flex-wrap gap-2 pl-1">
                      {message.choices?.map((choice) => {
                        const value = choiceValue(choice);
                        const label = choiceLabel(choice);
                        return (
                          <button
                            key={value || label}
                            type="button"
                            disabled={inert}
                            onClick={() => onChoose?.(value, label)}
                            className="rounded-pill border border-border bg-depth-card px-3 py-1.5 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : message.choices?.length && message.chosen ? (
                    // A retired quiz keeps its options visible with the student's pick
                    // check-marked; the rest dim. History shows WHICH option was chosen.
                    <div className="flex flex-wrap gap-2 pl-1" aria-label="Your answer">
                      {message.choices.map((choice) => {
                        const value = choiceValue(choice);
                        const picked = value === message.chosen;
                        return (
                          <span
                            key={value || choiceLabel(choice)}
                            className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-body ${
                              picked
                                ? "border-foreground/50 bg-foreground/10 font-medium text-foreground"
                                : "border-border/60 text-muted-foreground opacity-70"
                            }`}
                          >
                            {picked ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> : null}
                            {choiceLabel(choice)}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                  {/* Flow v3: the Continue pill rides the message that offered it and is live
                      only while that message is the latest — like quiz choices, an old offer
                      must not stay pressable. */}
                  {message.continueOffer && isLatestBot && !message.isError ? (
                    <div className="flex pl-1">
                      {/* The primary pill (board: "Continue lesson") — inverts per theme. */}
                      <button
                        type="button"
                        disabled={inert}
                        onClick={channel.sendContinue}
                        className="inline-flex items-center gap-1.5 rounded-pill bg-primary px-4 py-1.5 text-body font-bold text-background shadow-card transition-transform duration-(--dur-fast) hover:scale-[1.02] disabled:opacity-40"
                      >
                        {message.continueOffer.label || "Continue"}
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ) : null}
                  {/* P8: the consent-first live-artifact offer rides the message that made it,
                      live only while that message is the latest (like the Continue pill). The
                      tap starts a 30-90s build OUTSIDE the turn loop — see buildArtifact. */}
                  {message.artifactOffer && isLatestBot && !message.isError ? (
                    <div className="flex pl-1">
                      <button
                        type="button"
                        disabled={inert}
                        onClick={() => channel.buildArtifact(message.artifactOffer!)}
                        className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-depth-card px-4 py-1.5 text-body font-semibold text-foreground transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
                        style={{ boxShadow: "var(--inset-highlight)" }}
                      >
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                        {message.artifactOffer.label || "Build me a quick activity"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </MentorRise>
            );
          })}
        </ModeSection>
      ))}
    </div>
  );
}
