import { choiceLabel, choiceValue, type Msg } from "@/features/student/chat/chatMessages";

// Renders the conversation. Deliberately plain in this slice — no markdown pipeline, no code
// blocks, no resource cards. Those exist on the old surface and come across in later slices;
// shipping a half-wired version of each would repeat the pattern this rebuild is correcting.

function Bubble({
  align,
  tone,
  children,
}: {
  align: "start" | "end";
  tone: "user" | "mentor" | "teacher" | "error" | "output";
  children: React.ReactNode;
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
      <div
        className={`max-w-[min(46rem,85%)] whitespace-pre-wrap rounded-card px-3.5 py-2.5 text-body ${toneClass}`}
      >
        {children}
      </div>
    </div>
  );
}

export type TranscriptProps = {
  messages: Msg[];
  // Choices are live only on the LATEST mentor message — an older question's buttons must not
  // stay clickable once the conversation has moved on.
  onChoose?: (choiceId: string, label: string) => void;
  disabled?: boolean;
};

export function Transcript({ messages, onChoose, disabled }: TranscriptProps) {
  const lastBotId = [...messages].reverse().find((m) => m.role === "bot" && !m.isError)?.id;

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => {
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
              {message.text}
            </Bubble>
          );
        }
        if (message.role === "teacher") {
          return (
            <Bubble key={message.id} align="start" tone="teacher">
              <span className="mb-1 block text-overline uppercase tracking-[0.08em] opacity-70">
                Your teacher
              </span>
              {message.text}
            </Bubble>
          );
        }
        if (message.role === "output") {
          return (
            <Bubble key={message.id} align="start" tone="output">
              {message.output}
            </Bubble>
          );
        }

        const live = message.id === lastBotId && message.choices?.length;
        return (
          <div key={message.id} className="flex flex-col gap-2">
            <Bubble align="start" tone={message.isError ? "error" : "mentor"}>
              {message.text}
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
    </div>
  );
}
