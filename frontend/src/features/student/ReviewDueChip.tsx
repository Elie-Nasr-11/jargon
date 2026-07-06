import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send } from "lucide-react";

import { completeReviewSession, fetchReviewDue, invokeReview } from "@/lib/api";
import { humanizeSkillKey, practicedAgo } from "@/lib/review";
import type { MentorPreferences, ReviewDueSkill } from "@/lib/types";

const TIER_LABEL: Record<string, string> = {
  emerging: "Emerging",
  developing: "Developing",
  secure: "Secure",
};

type ReviewLine = { role: "mentor" | "you"; text: string };

// Post-v4.0 Phase 4 + 4b: a self-contained header chip surfacing skills due for spaced review, and a
// one-tap guided review that runs retrieval practice on a skill and refreshes its spacing clock
// (via the chat fn's isolated review handler). Renders nothing when nothing is due.
export function ReviewDueChip({
  accessToken,
  mentorPreferences,
}: {
  accessToken: string | null;
  mentorPreferences: MentorPreferences;
}) {
  const [due, setDue] = useState<ReviewDueSkill[]>([]);
  const [open, setOpen] = useState(false);
  const [reviewSkill, setReviewSkill] = useState<string | null>(null);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const loadDue = () => {
    void fetchReviewDue()
      .then(setDue)
      .catch(() => setDue([]));
  };

  useEffect(() => {
    let active = true;
    void fetchReviewDue()
      .then((rows) => {
        if (active) setDue(rows);
      })
      .catch(() => {
        if (active) setDue([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const startReview = async (skillKey: string) => {
    if (!accessToken || sending) return;
    setReviewSkill(skillKey);
    setReviewSessionId(null);
    setLines([]);
    setInput("");
    setReviewError(null);
    setSending(true);
    try {
      const envelope = await invokeReview({ accessToken, skillKey, mentorPreferences });
      setReviewSessionId(envelope.review_session_id ?? null);
      setLines([{ role: "mentor", text: envelope.reply }]);
    } catch (error) {
      setReviewError((error as Error).message || "Could not start review.");
    } finally {
      setSending(false);
    }
  };

  const sendReview = async () => {
    const text = input.trim();
    if (!accessToken || !reviewSkill || !text || sending) return;
    setLines((current) => [...current, { role: "you", text }]);
    setInput("");
    setSending(true);
    setReviewError(null);
    try {
      const envelope = await invokeReview({
        accessToken,
        skillKey: reviewSkill,
        answer: { mode: "text", text },
        mentorPreferences,
        reviewSessionId,
      });
      if (envelope.review_session_id) setReviewSessionId(envelope.review_session_id);
      setLines((current) => [...current, { role: "mentor", text: envelope.reply }]);
    } catch (error) {
      setReviewError((error as Error).message || "Could not send your answer.");
    } finally {
      setSending(false);
    }
  };

  const endReview = () => {
    // Finalize the tracked review_sessions row (best-effort; server-tracked counts already landed).
    if (accessToken && reviewSkill && reviewSessionId) {
      void completeReviewSession({ accessToken, skillKey: reviewSkill, reviewSessionId });
    }
    setReviewSkill(null);
    setReviewSessionId(null);
    setLines([]);
    setInput("");
    setReviewError(null);
    // A reviewed skill's spacing clock was refreshed server-side — refresh the queue.
    loadDue();
  };

  if (due.length === 0 && !reviewSkill) return null;

  const shown = due.slice(0, 8);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${due.length} skills due for review`}
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/12 px-3 py-1.5 text-[12.5px] text-warning transition-colors hover:bg-warning/20"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
        Review · {due.length}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-border bg-background p-3 shadow-lg">
          {reviewSkill ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-medium text-foreground">
                  Reviewing · {humanizeSkillKey(reviewSkill)}
                </p>
                <button
                  type="button"
                  onClick={endReview}
                  disabled={sending}
                  className="shrink-0 text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-40"
                >
                  Done
                </button>
              </div>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className={
                      line.role === "mentor"
                        ? "rounded-2xl bg-muted px-3 py-2 text-[12.5px] leading-snug text-foreground"
                        : "ml-6 rounded-2xl bg-foreground px-3 py-2 text-[12.5px] leading-snug text-background"
                    }
                  >
                    {line.text}
                  </div>
                ))}
                {sending ? <p className="text-[11.5px] text-muted-foreground">Thinking…</p> : null}
              </div>
              {reviewError ? <p className="mt-1 text-[11.5px] text-danger">{reviewError}</p> : null}
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendReview();
                    }
                  }}
                  placeholder="Type what you remember…"
                  className="min-w-0 flex-1 rounded-full border border-border bg-background/65 px-3 py-1.5 text-[12.5px] text-foreground"
                />
                <button
                  type="button"
                  onClick={() => void sendReview()}
                  disabled={sending || !input.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
                  aria-label="Send answer"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[13px] font-medium text-foreground">Due for review</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Quick retrieval practice keeps these sharp.
              </p>
              <ul className="mt-2 space-y-1">
                {shown.map((skill) => (
                  <li key={skill.skill_key} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-foreground">
                        {humanizeSkillKey(skill.skill_key)}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground">
                        {TIER_LABEL[skill.level] ?? skill.level} ·{" "}
                        {practicedAgo(skill.last_practiced_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void startReview(skill.skill_key)}
                      disabled={!accessToken || sending}
                      className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                    >
                      Review
                    </button>
                  </li>
                ))}
              </ul>
              {due.length > shown.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  +{due.length - shown.length} more
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
