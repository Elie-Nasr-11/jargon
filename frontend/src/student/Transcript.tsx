import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { Check, Paperclip, RotateCcw, Sparkles } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import { splitSentences } from "@/lib/sentences";
import { tokenizeJargon } from "@/lib/jargon-syntax";
import { store } from "@/lib/jargon-store";
import { renderWithMath } from "@/lib/mathText";
import { ReadAloudAction } from "@/components/ReadAloudAction";
import { ResourceCard } from "@/student/ResourceCard";
import { GraphBlock, type GraphSpec } from "@/student/GraphBlock";
import { GeometryBlock, type GeometrySpec } from "@/student/GeometryBlock";
import {
  CHECKPOINT_SPEC,
  modeAccentValue,
  modeInkValue,
  renderModeSpec,
  turnModeSpec,
} from "@/student/turnModes";
import { useConversationChannel } from "@/student/useConversation";
import type { LessonArc, LessonFigure, TypedChatAnswer, VocabEvent, VocabTerm } from "@/lib/types";
import {
  choiceLabel,
  choiceValue,
  jargonTokenClass,
  languageLabel,
  parseFencedBlocks,
  stepEyebrowLabel,
  type ChatCodeBlock,
  type ChatFigureBlock,
  type ModeOffer,
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

// R29: the two diagram fences render as figures. One component so every call site
// (transcript, streaming body) draws them identically.
function FigureBlock({ figure }: { figure: ChatFigureBlock }) {
  return figure.kind === "graph" ? (
    <GraphBlock spec={figure.spec as GraphSpec} />
  ) : (
    <GeometryBlock spec={figure.spec as GeometrySpec} />
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

// R29: MATH IS VERBATIM, so it is split off BEFORE the markdown pass — otherwise `2*x*y`
// inside a formula would be read as italics and `_` as emphasis. renderInline is now the
// math-aware entry point; renderInlineMd is the original markdown pass, unchanged, applied
// only to the prose between formulas.
function renderInline(text: string, vocab?: VocabPass): ReactNode[] {
  return renderWithMath(text, (part, key) => (
    <Fragment key={key}>{renderInlineMd(part, vocab)}</Fragment>
  ));
}

function renderInlineMd(text: string, vocab?: VocabPass): ReactNode[] {
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
      // Owner (R22d): no bullet dots — the indented divider rule alone marks the list;
      // ordered lists keep their numbers (they carry meaning).
      ordered ? (
        <ol
          key={nodes.length}
          className="ml-4 list-decimal space-y-1.5 border-l-2 border-border pl-6"
        >
          {rows}
        </ol>
      ) : (
        <ul key={nodes.length} className="ml-4 list-none space-y-1.5 border-l-2 border-border pl-6">
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

// The live streaming body: fenced code renders as real code blocks AS IT ARRIVES.
//
// R32 (owner: "remove the blur stuff... just have words load like any normal AI does").
// Text now arrives the plain way: every word in the normal foreground colour, each one
// fading in over ~0.18s as it lands. The old sentence-focus pass (newest sentence white,
// everything earlier grayed, forming words blurred in) is gone — it recoloured the reply
// underneath a student who was still reading it, which is the opposite of smooth.
//
// Completed sentences and the forming tail now render identically; the split survives only
// because a QUESTION sentence still earns its accent colour, and because animating whole
// settled sentences again on every token would re-fire the fade across the whole reply.
function StreamingBody({ text }: { text: string }) {
  const segments = parseFencedBlocks(text);
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "code") return <CodeBlock key={i} code={segment.code} />;
        // A figure only renders once its JSON body has fully arrived (parseFencedBlocks
        // needs the closing fence), so mid-stream it simply isn't a figure segment yet.
        if (segment.kind === "figure") return <FigureBlock key={i} figure={segment.figure} />;
        const raw = segment.text.replace(/^\n+/, "");
        if (!raw.trim()) return null;
        const { done, tail } = splitSentences(raw);
        return (
          <span key={i} className="whitespace-pre-wrap">
            {done.map((sentence, j) => (
              <span key={j} className={isQuestionSentence(sentence) ? "prose-question" : undefined}>
                {renderInline(sentence)}{" "}
              </span>
            ))}
            {tail
              ? tail.split(/(\s+)/).map((part, k) =>
                  part.trim() ? (
                    <span key={k} className="stream-word">
                      {renderInline(part)}
                    </span>
                  ) : (
                    part
                  ),
                )
              : null}
          </span>
        );
      })}
    </>
  );
}

// R30 (tester feedback #4): a figure lifted from the teacher's own material, shown at the
// point in the reply where the mentor placed its [[figure:id]] marker. Only figures the
// server resolved from the lesson's APPROVED set arrive here, so an unreviewed crop can
// never render. Clicking opens the full-size image in a new tab.
function SourceFigure({ figure }: { figure: LessonFigure }) {
  return (
    <figure className="my-3 overflow-hidden rounded-card border border-border bg-depth-sub">
      <a href={figure.image_url} target="_blank" rel="noopener noreferrer" title="Open full size">
        <img
          src={figure.image_url}
          alt={figure.alt_text || figure.title}
          loading="lazy"
          // The scans are grayscale line art: a white plate keeps them legible in dark mode.
          className="max-h-[420px] w-full bg-white object-contain"
        />
      </a>
      {figure.title || figure.caption ? (
        <figcaption className="border-t border-border px-3 py-2 text-meta text-muted-foreground">
          {figure.title ? <span className="text-foreground">{figure.title}</span> : null}
          {figure.title && figure.caption ? " — " : null}
          {figure.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

// Split a reply on its figure markers so the image lands exactly where the mentor put it.
const FIGURE_MARKER_RE = /\[\[figure:([^\]\s]+)\]\]/g;

// R31f: [[material:id]] marks where the mentor handed a reading over. It renders INLINE,
// exactly like a figure — the card lands at the point in the sentence where it was
// offered ("here it is:"), not in a tray under a wall of text the student has to hunt
// through. renderMaterial resolves an id to its card; anything it declines (an unknown id,
// or a message whose resources have not landed yet MID-STREAM) is dropped, so a raw
// marker never reaches a student.
const MATERIAL_MARKER_RE = /\[\[material:([^\]\s]+)\]\]/g;

// R32 (owner: "make it absolutely inline, like part of the text"). A hand-off used to be a
// button UNDER the reply; now the mentor writes it INTO the sentence — "we can
// [[action:practice|drill these until they stick]]" — and it renders as clickable text
// right there, coloured by the mode it points AT (see .prose-action). Split so the label
// may contain spaces; the mode is validated against the picker before anything renders,
// so an invented register is dropped rather than shown as a dead link.
const ACTION_MARKER_RE = /\[\[action:(lesson|practice|discuss)\|([^\]]{1,60})\]\]/g;

function MessageBody({
  text,
  markdown,
  vocab,
  figures,
  renderMaterial,
  renderAction,
}: {
  text: string;
  markdown?: boolean;
  vocab?: VocabPass;
  figures?: LessonFigure[];
  renderMaterial?: (id: string) => ReactNode;
  renderAction?: (mode: string, label: string) => ReactNode;
}) {
  // Actions split FIRST and recurse: an action lives mid-sentence, so the text either
  // side must keep flowing as prose (same paragraph, same line) rather than becoming
  // blocks. Anything renderAction declines — an older message, a disabled turn — falls
  // back to the plain label, so the sentence still reads as a sentence.
  if (ACTION_MARKER_RE.test(text)) {
    ACTION_MARKER_RE.lastIndex = 0;
    const parts = text.split(ACTION_MARKER_RE);
    return (
      <>
        {parts.map((part, i) => {
          // split() with two capture groups yields [prose, mode, label, prose, ...].
          const slot = i % 3;
          if (slot === 1) return null; // the mode, consumed with its label below
          if (slot === 2) {
            const mode = parts[i - 1];
            return <Fragment key={`act-${i}`}>{renderAction?.(mode, part) ?? part}</Fragment>;
          }
          return part ? (
            <MessageBody
              key={`txt-${i}`}
              text={part}
              markdown={markdown}
              vocab={vocab}
              figures={figures}
              renderMaterial={renderMaterial}
            />
          ) : null;
        })}
      </>
    );
  }
  // Materials first: they are the coarsest split, and a handed-over reading is its own
  // beat in the reply. The prose on either side recurses through the normal path.
  if (MATERIAL_MARKER_RE.test(text)) {
    MATERIAL_MARKER_RE.lastIndex = 0;
    const parts = text.split(MATERIAL_MARKER_RE);
    return (
      <>
        {parts.map((part, i) => {
          // Odd indices are the captured ids; even indices are prose.
          if (i % 2 === 1) {
            const card = renderMaterial?.(part);
            return card ? <Fragment key={`mat-${i}`}>{card}</Fragment> : null;
          }
          return part.trim() ? (
            <MessageBody
              key={`txt-${i}`}
              text={part.trim()}
              markdown={markdown}
              vocab={vocab}
              figures={figures}
            />
          ) : null;
        })}
      </>
    );
  }
  // Figures next: each marker becomes a real block, the prose around it renders as usual.
  if (figures?.length && FIGURE_MARKER_RE.test(text)) {
    FIGURE_MARKER_RE.lastIndex = 0;
    const byId = new Map(figures.map((figure) => [figure.id, figure]));
    const parts = text.split(FIGURE_MARKER_RE);
    return (
      <>
        {parts.map((part, i) => {
          // Odd indices are the captured ids; even indices are prose.
          if (i % 2 === 1) {
            const figure = byId.get(part);
            return figure ? <SourceFigure key={`fig-${i}`} figure={figure} /> : null;
          }
          return part.trim() ? (
            <MessageBody key={`txt-${i}`} text={part.trim()} markdown={markdown} vocab={vocab} />
          ) : null;
        })}
      </>
    );
  }
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
        ) : segment.kind === "figure" ? (
          <FigureBlock key={i} figure={segment.figure} />
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
// Round 22e: `soft` marks a step divider INSIDE one mode block (step-to-step within
// Lesson) — it renders dimmed, while a real mode change keeps full opacity.
type Section = {
  mode?: string;
  items: Msg[];
  arc: LessonArc | null;
  checkpoint?: boolean;
  soft?: boolean;
};

function groupIntoSections(messages: Msg[]): Section[] {
  const sections: Section[] = [];
  // Round 22e: set by a transition turn (step just wrapped); the NEXT opening message —
  // usually the student's reply — starts the new step's section under a soft divider
  // that already knows the step eyebrow (the transition arc points at the next step).
  let pendingArc: LessonArc | null = null;
  for (const message of messages) {
    const opensSection = message.role === "user" || message.role === "bot";
    const mode = opensSection ? message.turnMode : undefined;
    const current = sections[sections.length - 1];
    // Non-opening messages (thinking, output, teacher) always continue the open section so a
    // reply and its "Thinking…" placeholder never get split across two boxes.
    // Transcript smoothing (round 19): a lesson-mode run that spans several steps must
    // not wear one step label — a mentor reply arriving with a DIFFERENT arc step starts
    // a fresh section, so each stretch is labelled with the step it actually happened on.
    // Round 22: EXCEPT the advancing turn itself (arc.transition) — its arc already
    // points at the next step but its content wraps the one that just finished.
    const messageArc = message.role === "bot" ? (message.lessonArc ?? null) : null;
    const arcStep = messageArc ? messageArc.step : null;
    const stepChanged =
      arcStep !== null &&
      current?.arc != null &&
      current.arc.step !== arcStep &&
      !messageArc?.transition;
    // Round 20: every CHECKPOINT gets its own section marker — a mentor message that
    // presents quiz choices opens a fresh, checkpoint-flagged section even mid-mode.
    const opensCheckpoint =
      message.role === "bot" && !!message.choices?.length && !current?.checkpoint;
    const startsNextStep = opensSection && pendingArc != null;
    if (
      current &&
      (!opensSection || mode === current.mode) &&
      !stepChanged &&
      !opensCheckpoint &&
      !startsNextStep
    ) {
      current.items.push(message);
    } else {
      const sameMode = current != null && (mode ?? current.mode) === current.mode;
      sections.push({
        mode: mode ?? current?.mode,
        items: [message],
        // A section opened off a transition already knows its step eyebrow.
        arc: startsNextStep ? pendingArc : null,
        checkpoint: opensCheckpoint || undefined,
        // Step-to-step inside the same mode block: dimmed divider, not a full rule.
        soft: ((startsNextStep || stepChanged) && sameMode && !opensCheckpoint) || undefined,
      });
    }
    if (opensSection) pendingArc = null;
    if (messageArc?.transition) pendingArc = messageArc;
    const open = sections[sections.length - 1];
    // A transition arc never becomes the section's eyebrow — it names the NEXT step while
    // the section's content belongs to the finished one (round 22 off-by-one fix).
    if (messageArc && !messageArc.transition) open.arc = messageArc;
  }
  return sections;
}

// The full-width mode rule: a hairline spanning the whole conversation window with the mode
// pill sitting on it. It animates in once, the first time it is actually seen — a new section
// appended at the bottom (the student just switched modes) is in view immediately, and an old
// section scrolled back into view plays the same entrance. IntersectionObserver drives both
// cases with one mechanism; reduced motion renders the final state straight away.
function ModeRule({ label, soft }: { label: string; soft?: boolean }) {
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
      className={`mode-divider flex items-center gap-3 px-4 ${soft ? "opacity-55" : ""} ${inView ? "in-view" : ""}`}
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
  soft,
  children,
}: {
  mode?: string;
  arc: LessonArc | null;
  checkpoint?: boolean;
  soft?: boolean;
  children: ReactNode;
}) {
  // Round 20: checkpoints wear their own marker regardless of the surrounding mode —
  // the moment of being tested deserves a visible line in the record.
  if (checkpoint) {
    const spec = CHECKPOINT_SPEC;
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
  // Unknown mode: no rule, no label. Never claim a mode we did not record. Legacy ids
  // (open/quiz/assignment, from before Phase A) still resolve — history keeps its labels.
  const spec = renderModeSpec(mode);
  if (!spec)
    return (
      <div className="mx-auto mt-3 flex w-full max-w-3xl flex-col gap-3 px-4 first:mt-1">
        {children}
      </div>
    );
  // Lesson sections carry the step eyebrow; every other mode labels itself.
  const eyebrow = (mode === "lesson" && stepEyebrowLabel(arc)) || spec.label;
  return (
    <section
      aria-label={`${spec.label} section`}
      className="mt-5 first:mt-1"
      style={{ ["--mode-accent" as string]: modeAccentValue(spec) }}
    >
      {/* The rule spans the window; the messages stay in the centered reading column.
          Step-to-step dividers inside one mode block render dimmed (round 22e). */}
      <ModeRule label={eyebrow} soft={soft} />
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
  // R32: accepting an inline hand-off offer ([Talk it through], [Back to the lesson]).
  // The shell owns it because accepting also moves the composer's mode picker.
  onAcceptOffer?: (offer: ModeOffer) => void;
  disabled?: boolean;
};

export function Transcript({
  messages,
  onChoose,
  onRetry,
  onAcceptOffer,
  disabled,
}: TranscriptProps) {
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
  // Round 22e: the conversation currently ENDS on a transition turn (a step just wrapped,
  // no reply yet) — surface the next step's dimmed divider immediately.
  const lastMessage = messages[messages.length - 1];
  const pendingArcDivider =
    lastMessage?.role === "bot" && lastMessage.lessonArc?.transition ? lastMessage.lessonArc : null;
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
          soft={section.soft}
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
            // R31f: a material the mentor handed over mid-sentence renders THERE. Ids
            // consumed inline are recorded so the tray below does not show the same card
            // twice; anything the mentor did not place inline still lands in the tray, so
            // step-bound materials are unaffected.
            const inlinedMaterials = new Set<string>();
            const renderMaterial = (id: string) => {
              const resource = message.resources?.find((row) => String(row.id) === id);
              if (!resource) return null;
              inlinedMaterials.add(String(resource.id));
              return (
                <ResourceCard
                  resource={resource}
                  lessonId={channel.lessonId}
                  sessionId={channel.sessionId}
                />
              );
            };
            const trayResources = (message.resources ?? []).filter(
              (resource) => !inlinedMaterials.has(String(resource.id)),
            );
            // An inline action is live only on the LATEST mentor turn, like every other
            // control here; on older messages the label still reads as plain prose so the
            // sentence keeps its meaning when scrolled back to.
            const hasInlineAction = ACTION_MARKER_RE.test(message.text);
            ACTION_MARKER_RE.lastIndex = 0;
            const renderAction =
              isLatestBot && onAcceptOffer
                ? (mode: string, label: string) => {
                    const spec = turnModeSpec(mode as ModeOffer["mode"]);
                    return (
                      <button
                        type="button"
                        disabled={inert}
                        onClick={() =>
                          onAcceptOffer({
                            mode: mode as ModeOffer["mode"],
                            topic: message.modeOffer?.topic ?? label,
                            label,
                          })
                        }
                        className="prose-action"
                        style={{ ["--action-accent" as string]: modeAccentValue(spec) }}
                      >
                        {label}
                      </button>
                    );
                  }
                : undefined;
            return (
              <MentorRise key={message.id} animate={isNew}>
                <div className="hvp flex flex-col gap-2">
                  <Bubble align="start" tone={message.isError ? "error" : "mentor"}>
                    <MessageBody
                      text={message.text}
                      markdown={!message.isError}
                      figures={message.figures}
                      renderMaterial={renderMaterial}
                      renderAction={renderAction}
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
                  {trayResources.length ? (
                    <div className="flex flex-col gap-2 pl-1">
                      {trayResources.map((resource) => (
                        <ResourceCard
                          key={resource.id}
                          resource={resource}
                          lessonId={channel.lessonId}
                          sessionId={channel.sessionId}
                        />
                      ))}
                    </div>
                  ) : null}
                  {/* R32b (owner: "the inline buttons didn't work — make it absolutely
                      inline, like part of the text"). The hand-off is no longer a control
                      BESIDE the reply at all: the mentor writes it into its own sentence
                      as [[action:mode|label]] and it renders as clickable text right
                      there, in the hue of the mode it points at. The fallback chip below
                      covers a turn where the server attached an offer but the mentor did
                      not word it inline — without it, a server-set hand-off would have no
                      way to be taken. Both retire the moment anything follows this
                      message, since `isLatestBot` gates them. */}
                  {isLatestBot && message.modeOffer && onAcceptOffer && !hasInlineAction ? (
                    <div className="flex flex-wrap gap-2 pl-1">
                      <button
                        type="button"
                        disabled={inert}
                        onClick={() => onAcceptOffer(message.modeOffer!)}
                        className="ds-tag gap-1.5 rounded-pill px-3.5 py-1 text-meta font-bold transition-transform duration-(--dur-fast) hover:scale-[1.02] disabled:opacity-40"
                        style={{
                          ["--tag-bg" as string]: modeAccentValue(
                            turnModeSpec(message.modeOffer.mode),
                          ),
                          ["--tag-ink" as string]: modeInkValue(
                            turnModeSpec(message.modeOffer.mode),
                          ),
                        }}
                      >
                        {message.modeOffer.label}
                      </button>
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
                  {/* R31b (owner): the Continue BUTTON IS GONE. Advancing is always a
                      conversational beat now — the mentor ends a step by asking something
                      worth answering, and the student's reply moves the lesson on (a typed
                      yes/ok/sure/next is recognised server-side by CONTINUE_SIGNAL_RE, and a
                      real answer satisfies the step's gate). envelope.continue_offer is still
                      sent and still persisted, so nothing in the turn loop changed shape and
                      an older transcript replays fine; the surface simply never renders a
                      button for it. */}
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
      {/* Round 22e: a step just wrapped and the student hasn't replied yet — show the next
          step's divider right away (dimmed) so the change is signified without any
          "that completes step N" prose. Their reply opens the real section under the
          same eyebrow, so this hands off seamlessly. */}
      {pendingArcDivider ? (
        <section
          aria-hidden
          className="mt-5"
          style={{ ["--mode-accent" as string]: modeAccentValue(turnModeSpec("lesson")) }}
        >
          <ModeRule label={stepEyebrowLabel(pendingArcDivider) || "Next"} soft />
        </section>
      ) : null}
    </div>
  );
}
