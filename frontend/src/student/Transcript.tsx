import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ArrowRight, Check, MessageSquare, Paperclip, RotateCcw } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import { tokenizeJargon } from "@/lib/jargon-syntax";
import { store } from "@/lib/jargon-store";
import { ReadAloudAction } from "@/components/ReadAloudAction";
import { ResourceCard } from "@/student/ResourceCard";
import { isTurnMode, modeAccentValue, turnModeSpec } from "@/student/turnModes";
import { useConversationChannel } from "@/student/useConversation";
import type { LessonArc, TypedChatAnswer } from "@/lib/types";
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
type Section = { mode?: string; items: Msg[]; arc: LessonArc | null };

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
      sections.push({ mode, items: [message], arc: null });
    }
    const open = sections[sections.length - 1];
    if (message.role === "bot" && message.lessonArc) open.arc = message.lessonArc;
  }
  return sections;
}

function ModeSection({
  mode,
  arc,
  children,
}: {
  mode?: string;
  arc: LessonArc | null;
  children: ReactNode;
}) {
  // Unknown mode: no box, no label. Never claim a mode we did not record.
  if (!mode || !isTurnMode(mode)) return <div className="flex flex-col gap-3">{children}</div>;
  const spec = turnModeSpec(mode);
  // Lesson sections carry the step eyebrow; every other mode labels itself.
  const eyebrow = (mode === "lesson" && stepEyebrowLabel(arc)) || spec.label;
  return (
    <section
      aria-label={`${spec.label} section`}
      className="mode-surface relative mt-3 flex flex-col gap-3 rounded-card border px-3 pb-3 pt-5 transition-[background-color,border-color] duration-[400ms] first:mt-1"
      style={{ ["--mode-accent" as string]: modeAccentValue(spec) }}
    >
      {/* Centered on the top border — the fieldset-legend treatment, so the label reads as
          belonging to this stretch of conversation rather than floating inside it. */}
      <span
        aria-hidden
        className="mode-eyebrow absolute -top-[10px] left-1/2 max-w-[85%] -translate-x-1/2 truncate rounded-pill border px-2.5 py-0.5 text-overline font-medium uppercase tracking-[0.09em] transition-[background-color,border-color,color] duration-[400ms]"
      >
        {eyebrow}
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
  // Live-conversation context the shell does not thread as props: the hold lock (which also
  // freezes live pills), the continue/retry control senders, and the read-aloud call context.
  const channel = useConversationChannel();
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
        >
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
                  {/* What the student attached, so the transcript still shows it on reload —
                      the filename is the only part they will recognise later. */}
                  {message.attachments?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {message.attachments.map((attachment) => (
                        <span
                          key={attachment.upload_id}
                          className="flex items-center gap-1 rounded-pill bg-background/20 px-2 py-0.5 text-meta"
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
                <div key={message.id} className="flex flex-col gap-1">
                  <Bubble align="start" tone="teacher">
                    <span className="mb-1 block text-overline uppercase tracking-[0.08em] opacity-70">
                      Your teacher
                    </span>
                    <MessageBody text={message.text} />
                  </Bubble>
                  {canReadAloud ? (
                    <div className="pl-1">
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
                <div className="flex flex-col gap-2">
                  <Bubble align="start" tone={message.isError ? "error" : "mentor"}>
                    <MessageBody text={message.text} />
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
                    <div className="pl-1">
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
                        <ResourceCard key={resource.id} resource={resource} />
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
                      <button
                        type="button"
                        disabled={inert}
                        onClick={channel.sendContinue}
                        className="inline-flex items-center gap-1.5 rounded-pill border border-foreground/30 bg-foreground/5 px-4 py-1.5 text-body font-medium text-foreground transition-colors duration-(--dur-fast) hover:bg-foreground/10 disabled:opacity-40"
                      >
                        {message.continueOffer.label || "Continue"}
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
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
