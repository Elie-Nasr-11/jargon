import { useCallback, useRef, useState } from "react";
import { History } from "lucide-react";
import { completeReviewSession, invokeReview } from "@/lib/api";
import type { MentorPreferences } from "@/lib/types";

// Practice-mode entry + lifecycle (MVP §8 "practice"): this file owns the guided spaced-review
// wiring end to end — the header chip that surfaces the SM-2-lite due queue, and the
// useGuidedReview hook that runs one review session against the chat fn's isolated review path
// (invokeReview start → answer turns continued via reviewSessionId → completeReviewSession).
// The chat surface's Practice pane renders the hook's turns in the transcript style.

// One rendered line of a guided review (mentor question or student recall attempt).
export type GuidedReviewTurn = {
  id: string;
  role: "mentor" | "student";
  text: string;
  isError?: boolean;
};

const turnId = () => Math.random().toString(36).slice(2);

// The hook lives WITH the chip on purpose: this file is the practice-mode wiring boundary
// (tests/test_review_sessions.py pins the review lifecycle here), at the cost of fast refresh.
// eslint-disable-next-line react-refresh/only-export-components
export function useGuidedReview(input: {
  accessToken: string | null;
  mentorPreferences: MentorPreferences;
}) {
  const { accessToken, mentorPreferences } = input;
  // The skill under review; null = no review in flight (the due list shows instead).
  const [skillKey, setSkillKey] = useState<string | null>(null);
  // The backing review_sessions row id, returned by the first turn and threaded through every
  // continuation so the server tracks question_count/score on ONE row.
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<GuidedReviewTurn[]>([]);
  const [busy, setBusy] = useState(false);
  // Ref twin of `busy` so rapid double-submits can't race the state update.
  const busyRef = useRef(false);
  // Ref twins for finish(): completion must use the LIVE ids even from a stale closure.
  const skillRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setSkillKey(null);
    setReviewSessionId(null);
    setTurns([]);
    skillRef.current = null;
    sessionRef.current = null;
  }, []);

  // Start reviewing one due skill: the first invokeReview turn (no answer) asks the opening
  // recall question and opens the tracked review_sessions row.
  const start = useCallback(
    async (nextSkillKey: string) => {
      if (!accessToken || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setSkillKey(nextSkillKey);
      skillRef.current = nextSkillKey;
      setReviewSessionId(null);
      sessionRef.current = null;
      setTurns([]);
      try {
        const envelope = await invokeReview({
          accessToken,
          skillKey: nextSkillKey,
          mentorPreferences,
        });
        const sessionId = envelope.review_session_id ?? null;
        setReviewSessionId(sessionId);
        sessionRef.current = sessionId;
        setTurns([{ id: turnId(), role: "mentor", text: envelope.reply || "Let's review." }]);
      } catch (error) {
        setTurns([
          {
            id: turnId(),
            role: "mentor",
            isError: true,
            text: (error as Error).message || "The mentor could not start that review.",
          },
        ]);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [accessToken, mentorPreferences],
  );

  // One recall attempt: the server grades it, refreshes the skill's spacing clock, and asks the
  // next question — continued on the same reviewSessionId.
  const answer = useCallback(
    async (text: string) => {
      const activeSkill = skillRef.current;
      if (!accessToken || !activeSkill || busyRef.current || !text.trim()) return;
      busyRef.current = true;
      setBusy(true);
      const spoken = text.trim();
      setTurns((prev) => [...prev, { id: turnId(), role: "student", text: spoken }]);
      try {
        const envelope = await invokeReview({
          accessToken,
          skillKey: activeSkill,
          answer: { mode: "text", text: spoken },
          mentorPreferences,
          reviewSessionId: sessionRef.current,
        });
        const sessionId = envelope.review_session_id ?? sessionRef.current;
        setReviewSessionId(sessionId);
        sessionRef.current = sessionId;
        setTurns((prev) => [
          ...prev,
          { id: turnId(), role: "mentor", text: envelope.reply || "Keep going." },
        ]);
      } catch (error) {
        setTurns((prev) => [
          ...prev,
          {
            id: turnId(),
            role: "mentor",
            isError: true,
            text: (error as Error).message || "The mentor could not check that — try again.",
          },
        ]);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [accessToken, mentorPreferences],
  );

  // Wrap up: flips the review_sessions row to 'complete' (best-effort server-side; never throws)
  // and clears the local review so the due list shows again.
  const finish = useCallback(async () => {
    const activeSkill = skillRef.current;
    const activeSession = sessionRef.current;
    if (accessToken && activeSkill && activeSession) {
      await completeReviewSession({
        accessToken,
        skillKey: activeSkill,
        reviewSessionId: activeSession,
      });
    }
    reset();
  }, [accessToken, reset]);

  return { skillKey, reviewSessionId, turns, busy, start, answer, finish, reset };
}

// The header chip: "Review due · N" when the SM-2-lite queue has due skills. Tapping it jumps
// into Practice mode. Renders nothing when nothing is due.
export function ReviewDueChip({
  count,
  active = false,
  disabled = false,
  onOpenPractice,
}: {
  count: number;
  // Practice mode is already open — the chip stays visible as a lit indicator.
  active?: boolean;
  disabled?: boolean;
  onOpenPractice: () => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpenPractice}
      disabled={disabled}
      aria-pressed={active}
      title={`${count} skill${count === 1 ? "" : "s"} due for spaced review — open Practice`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12px] font-medium transition-colors duration-(--dur-fast) disabled:opacity-50 ${
        active
          ? "border-info bg-info/20 text-info"
          : "border-info/40 bg-info/12 text-info hover:bg-info/20"
      }`}
    >
      <History className="h-3.5 w-3.5" strokeWidth={1.8} />
      Review due · {count}
    </button>
  );
}
