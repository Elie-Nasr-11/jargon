import type { ReactNode } from "react";
import { MessageSquare, RotateCcw } from "lucide-react";
import { tokenizeJargon } from "@/lib/jargon-syntax";
import { isTurnMode, turnModeSpec } from "@/student/turnModes";
import type { TypedChatAnswer } from "@/lib/types";
import {
  choiceLabel,
  choiceValue,
  jargonTokenClass,
  languageLabel,
  parseFencedBlocks,
  type ChatCodeBlock,
  type Msg,
} from "@/features/student/chat/chatMessages";

// Renders the conversation as a sequence of MODE SECTIONS.
//
// The border and eyebrow pill belong to a stretch of conversation, not to the window: a student
// scrolling back can see at a glance that this part was Discuss and that part was Quiz. So
// consecutive messages sharing a TurnMode are boxed together and labelled once.
//
// A message whose mode is UNKNOWN (any turn written before modes were persisted) renders with no
// section chrome at all. Relabelling it as "Lesson" would be inventing history we cannot verify.
//
// Only user and mentor messages open a section. Thinking placeholders, code output, and teacher
// interjections continue whatever section is open — they are not the student choosing a mode.
//
// Fenced code blocks are parsed and highlighted — the mentor teaches with code, so a reply
// containing ``` must not render as flat text. parseFencedBlocks / jargonTokenClass /
// tokenizeJargon are the same helpers the previous surface used; there is no general Markdown
// pipeline in this codebase and this slice does not add one.

function CodeBlock({ code }: { code: ChatCodeBlock }) {
  return (
    <figure className="my-2 overflow-hidden rounded-control border border-border">
      <figcaption className="border-b border-border bg-depth-sub px-2.5 py-1 text-overline uppercase tracking-[0.08em] text-muted-foreground">
        {languageLabel(code.language)}
      </figcaption>
      {/* Wide code scrolls inside its own box; the transcript column must never scroll sideways. */}
      <pre className="overflow-x-auto bg-code-background px-2.5 py-2 text-[12.5px] leading-relaxed text-code-foreground">
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

// Text with its fenced blocks lifted out. Plain segments keep whitespace; code gets the block.
function MessageBody({ text }: { text: string }) {
  const segments = parseFencedBlocks(text);
  if (segments.length === 1 && segments[0].kind === "text") {
    return <span className="whitespace-pre-wrap">{segments[0].text}</span>;
  }
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === "code" ? (
          <CodeBlock key={i} code={segment.code} />
        ) : segment.text.trim() ? (
          <span key={i} className="whitespace-pre-wrap">
            {segment.text.replace(/^\n+|\n+$/g, "")}
          </span>
        ) : null,
      )}
    </>
  );
}

function Bubble({
  align,
  tone,
  children,
}: {
  align: "start" | "end";
  tone: "user" | "mentor" | "teacher" | "error" | "output";
  children: ReactNode;
}) {
  const toneClass =
    tone === "user"
      ? "bg-foreground text-background"
      : tone === "error"
        ? "border border-danger/40 bg-depth-sub text-danger"
        : tone === "teacher"
          ? "border border-info/40 bg-depth-sub text-foreground"
          : tone === "output"
            ? "border border-border bg-code-background font-mono text-code-foreground"
            : "bg-depth-sub text-foreground";
  return (
    <div className={`flex ${align === "end" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[min(46rem,85%)] rounded-card px-3.5 py-2.5 text-body ${toneClass}`}>
        {children}
      </div>
    </div>
  );
}

// A run of consecutive messages that happened in one mode.
type Section = { mode?: string; items: Msg[] };

function groupIntoSections(messages: Msg[]): Section[] {
  const sections: Section[] = [];
  for (const message of messages) {
    const opensSection = message.role === "user" || message.role === "bot";
    const mode = opensSection ? message.turnMode : undefined;
    const current = sections[sections.length - 1];
    // Non-opening messages (thinking, output, teacher) always continue the open section so a
    // reply and its "Thinking…" placeholder never get split across two boxes.
    if (current && (!opensSection || mode === current.mode)) {
      current.items.push(message);
    } else {
      sections.push({ mode, items: [message] });
    }
  }
  return sections;
}

function ModeSection({ mode, children }: { mode?: string; children: ReactNode }) {
  // Unknown mode: no box, no label. Never claim a mode we did not record.
  if (!mode || !isTurnMode(mode)) return <div className="flex flex-col gap-3">{children}</div>;
  const spec = turnModeSpec(mode);
  return (
    <section
      aria-label={`${spec.label} section`}
      className="mode-surface relative mt-3 flex flex-col gap-3 rounded-card border px-3 pb-3 pt-5 first:mt-1"
      style={{ ["--mode-accent" as string]: `var(${spec.accentVar})` }}
    >
      {/* Centered on the top border — the fieldset-legend treatment, so the label reads as
          belonging to this stretch of conversation rather than floating inside it. */}
      <span
        aria-hidden
        className="mode-eyebrow absolute -top-[10px] left-1/2 -translate-x-1/2 rounded-pill border px-2.5 py-0.5 text-overline font-medium uppercase tracking-[0.09em]"
      >
        {spec.label}
      </span>
      {children}
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
  if (!messages.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <MessageSquare className="h-6 w-6 text-muted-foreground/50" strokeWidth={1.5} />
        <p className="text-body text-muted-foreground">
          Your tutor will open the lesson here. Say hello, or ask about anything you&rsquo;re stuck
          on.
        </p>
      </div>
    );
  }

  const lastBotId = [...messages].reverse().find((m) => m.role === "bot" && !m.isError)?.id;
  const sections = groupIntoSections(messages);

  return (
    <div className="flex flex-col">
      {sections.map((section, sectionIndex) => (
        <ModeSection key={`${section.mode ?? "unknown"}-${sectionIndex}`} mode={section.mode}>
          {section.items.map((message) => {
            if (message.role === "thinking") {
              return (
                <Bubble key={message.id} align="start" tone="mentor">
                  <span className="text-muted-foreground">Thinking…</span>
                </Bubble>
              );
            }
            if (message.role === "user") {
              return (
                <Bubble key={message.id} align="end" tone="user">
                  <MessageBody text={message.text} />
                </Bubble>
              );
            }
            if (message.role === "teacher") {
              return (
                <Bubble key={message.id} align="start" tone="teacher">
                  <span className="mb-1 block text-overline uppercase tracking-[0.08em] opacity-70">
                    Your teacher
                  </span>
                  <MessageBody text={message.text} />
                </Bubble>
              );
            }
            if (message.role === "output") {
              return (
                <Bubble key={message.id} align="start" tone="output">
                  <span className="whitespace-pre-wrap">{message.output}</span>
                </Bubble>
              );
            }

            const live = message.id === lastBotId && message.choices?.length;
            return (
              <div key={message.id} className="flex flex-col gap-2">
                <Bubble align="start" tone={message.isError ? "error" : "mentor"}>
                  <MessageBody text={message.text} />
                  {/* An error bubble carries the answer that failed, so Retry re-sends it verbatim
                  rather than asking the student to retype. */}
                  {message.isError && message.retryAnswer && onRetry ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRetry(message.retryAnswer!)}
                      className="mt-2 flex items-center gap-1.5 rounded-control border border-danger/40 px-2 py-1 text-meta text-danger transition-colors duration-(--dur-fast) hover:bg-danger/10 disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} /> Try again
                    </button>
                  ) : null}
                </Bubble>
                {live ? (
                  <div className="flex flex-wrap gap-2 pl-1">
                    {message.choices?.map((choice) => {
                      const value = choiceValue(choice);
                      const label = choiceLabel(choice);
                      return (
                        <button
                          key={value || label}
                          type="button"
                          disabled={disabled}
                          onClick={() => onChoose?.(value, label)}
                          className="rounded-pill border border-border bg-depth-card px-3 py-1.5 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-40"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </ModeSection>
      ))}
    </div>
  );
}
