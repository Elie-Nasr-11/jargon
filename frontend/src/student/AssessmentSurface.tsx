import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { CheckCircle2, ClipboardCheck, Clock, Loader2, Lock } from "lucide-react";
import { startAssessment, submitAssessment } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentItem,
  CurriculumQuizItem,
  StudentAssessmentBundle,
} from "@/lib/types";

// The formal assessment surface: teacher-assigned checkpoints taken start → answer → submit →
// result over the existing attempt API (startAssessment / submitAssessment — the service-role
// assessment-admin function grades MC items and routes open items to teacher review).
//
// This replaces the deleted QuizPanel with the v6 posture (DESIGN_V6 §6 "/quiz + focus
// surfaces"): a full-screen focused overlay that SCALES IN from 0.985, and a simple focus
// lock — while an attempt is open there is no backdrop dismiss, no Escape, and Leave takes a
// two-step confirm, so a stray click can never dump a student out of a live test. The lock is
// honest about what leaving means: the attempt stays open server-side, but typed answers are
// only saved on submit.
//
// Grading honesty: the result screen shows exactly what the server released — a returned
// attempt's final score and per-item feedback, or "waiting for review" when open-ended items
// are pending. It never predicts a score the teacher hasn't released.

type Phase = "intro" | "starting" | "answering" | "submitting" | "result";

type AnswerDraft = { choiceId?: string; answerText?: string; answerCode?: string };

export type AssessmentSurfaceProps = {
  assessmentId: string;
  // The already-fetched student bundle — the surface never refetches what Home/Checkpoints
  // just loaded. Null while the parent is still loading it.
  bundle: StudentAssessmentBundle | null;
  onClose: () => void;
  // Fired after a submit lands so the parent can refresh counts/strips.
  onFinished?: () => void;
};

function questionTypeOf(quiz: CurriculumQuizItem): "multiple_choice" | "text" | "code" {
  return quiz.question_type === "code" || quiz.question_type === "text"
    ? quiz.question_type
    : "multiple_choice";
}

export function AssessmentSurface({
  assessmentId,
  bundle,
  onClose,
  onFinished,
}: AssessmentSurfaceProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [error, setError] = useState("");
  // Populated by startAssessment (the server's authoritative load); the bundle only feeds the
  // intro + result-of-past-attempt views.
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [liveItems, setLiveItems] = useState<AssessmentItem[] | null>(null);
  const [liveQuizzes, setLiveQuizzes] = useState<CurriculumQuizItem[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [result, setResult] = useState<AssessmentAttempt | null>(null);

  const assessment: Assessment | null = useMemo(
    () => bundle?.assessments.find((a) => a.id === assessmentId) ?? null,
    [bundle, assessmentId],
  );
  const pastAttempts = useMemo(
    () =>
      (bundle?.attempts ?? [])
        .filter((a) => a.assessment_id === assessmentId)
        .sort((a, b) => b.attempt_number - a.attempt_number),
    [bundle, assessmentId],
  );
  const quizById = useMemo(() => {
    const quizzes = liveQuizzes ?? bundle?.quizzes ?? [];
    return new Map(quizzes.map((q) => [q.id, q]));
  }, [liveQuizzes, bundle]);
  const orderedItems = useMemo(() => {
    const items = liveItems ?? bundle?.items.filter((i) => i.assessment_id === assessmentId) ?? [];
    return [...items].sort((a, b) => a.position - b.position);
  }, [liveItems, bundle, assessmentId]);

  const latestPast = pastAttempts[0] ?? null;
  const attemptLimit = Math.max(1, assessment?.attempt_limit ?? 1);
  const attemptsUsed = pastAttempts.filter((a) => a.status !== "in_progress").length;
  const attemptsLeft = Math.max(0, attemptLimit - attemptsUsed);
  const hasOpenAttempt = pastAttempts.some((a) => a.status === "in_progress");

  // §3: FocusLock surfaces scale from 0.985. Reduced motion snaps.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || prefersReducedMotion()) return;
    gsap.fromTo(
      el,
      { scale: 0.985, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.22, ease: "power3.out" },
    );
  }, []);

  const locked = phase === "answering" || phase === "submitting" || phase === "starting";

  const begin = async () => {
    setPhase("starting");
    setError("");
    try {
      const data = await startAssessment(assessmentId);
      if (data?.attempt) setAttempt(data.attempt);
      if (data?.items) setLiveItems(data.items);
      if (data?.quizzes) setLiveQuizzes(data.quizzes);
      setPhase("answering");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start this assessment.");
      setPhase("intro");
    }
  };

  const submit = async () => {
    if (!attempt) return;
    setPhase("submitting");
    setError("");
    try {
      const payload = orderedItems.map((item) => {
        const quiz = quizById.get(item.quiz_item_id);
        const draft = answers[item.id] ?? {};
        const type = quiz ? questionTypeOf(quiz) : "text";
        return {
          assessmentItemId: item.id,
          answerMode: type,
          answerText: type === "text" ? draft.answerText : undefined,
          answerCode: type === "code" ? draft.answerCode : undefined,
          choiceId: type === "multiple_choice" ? draft.choiceId : undefined,
        };
      });
      const data = await submitAssessment({ attemptId: attempt.id, answers: payload });
      setResult(data?.attempt ?? null);
      setPhase("result");
      onFinished?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't submit. Your answers are still here — try again.",
      );
      setPhase("answering");
    }
  };

  const answeredCount = orderedItems.filter((item) => {
    const quiz = quizById.get(item.quiz_item_id);
    const draft = answers[item.id] ?? {};
    if (!quiz) return false;
    const type = questionTypeOf(quiz);
    if (type === "multiple_choice") return Boolean(draft.choiceId);
    if (type === "code") return Boolean(draft.answerCode?.trim());
    return Boolean(draft.answerText?.trim());
  }).length;

  const requestClose = () => {
    if (!locked) {
      onClose();
      return;
    }
    // The lock: leaving a live attempt is a deliberate two-step act, never a stray click.
    setConfirmLeave(true);
  };

  const fieldClass =
    "w-full rounded-control border border-border bg-depth-sub p-2.5 text-body text-foreground outline-none focus:border-foreground/40";

  return (
    // Plain overlay by design: no Radix Dialog, so there is no Escape-to-close or
    // backdrop-click dismissal to suppress — the ONLY exits are the buttons below.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={assessment?.title || "Assessment"}
      className="fixed inset-0 z-[var(--z-header)] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    >
      <div
        ref={cardRef}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-card border border-border bg-depth-card shadow-raised"
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-5 py-3.5">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body font-medium text-foreground">
              {assessment?.title || "Assessment"}
            </h2>
          </div>
          {locked ? (
            <span className="flex items-center gap-1 text-overline uppercase tracking-[0.08em] text-muted-foreground">
              <Lock className="h-3 w-3" strokeWidth={1.8} /> In progress
            </span>
          ) : null}
          <button
            type="button"
            onClick={requestClose}
            className="rounded-control px-2 py-1 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
          >
            {locked ? "Leave" : "Close"}
          </button>
        </header>

        {confirmLeave ? (
          <div className="border-b border-border/60 bg-depth-sub px-5 py-3">
            <p className="text-meta text-foreground">
              Leave this assessment? Your attempt stays open, but answers typed here are only saved
              when you submit.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-control border border-border px-2.5 py-1 text-meta text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
              >
                Leave anyway
              </button>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="rounded-control bg-primary px-2.5 py-1 text-meta font-medium text-primary-foreground"
              >
                Keep going
              </button>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? <p className="mb-3 text-meta text-danger">{error}</p> : null}

          {bundle === null ? (
            <p className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : !assessment ? (
            <p className="text-body text-muted-foreground">
              This assessment isn't available any more.
            </p>
          ) : phase === "intro" || phase === "starting" ? (
            <div>
              {assessment.instructions ? (
                <p className="text-body text-foreground">{assessment.instructions}</p>
              ) : null}
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
                <li>
                  {orderedItems.length} question{orderedItems.length === 1 ? "" : "s"}
                </li>
                {assessment.due_at ? (
                  <li className="flex items-center gap-1">
                    <Clock className="h-3 w-3" strokeWidth={1.8} /> Due{" "}
                    {formatDate(assessment.due_at)}
                  </li>
                ) : null}
                <li>
                  {attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} left
                </li>
              </ul>

              {latestPast && latestPast.status !== "in_progress" ? (
                <div className="mt-4 rounded-card border border-border bg-depth-sub p-3">
                  <p className="text-meta text-muted-foreground">
                    Last attempt:{" "}
                    {latestPast.status === "returned" || latestPast.status === "graded"
                      ? `scored ${formatScore(latestPast.final_score)}`
                      : "submitted — waiting for your teacher's review"}
                  </p>
                  {latestPast.feedback ? (
                    <p className="mt-1 text-meta text-foreground">{latestPast.feedback}</p>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void begin()}
                disabled={phase === "starting" || (!hasOpenAttempt && attemptsLeft === 0)}
                className="mt-5 inline-flex items-center gap-2 rounded-control bg-primary px-3.5 py-2 text-body font-medium text-primary-foreground transition-opacity duration-(--dur-fast) disabled:opacity-40"
              >
                {phase === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {hasOpenAttempt ? "Continue attempt" : attemptsUsed ? "Start new attempt" : "Begin"}
              </button>
              {!hasOpenAttempt && attemptsLeft === 0 ? (
                <p className="mt-2 text-meta text-muted-foreground">No attempts remain.</p>
              ) : null}
            </div>
          ) : phase === "answering" || phase === "submitting" ? (
            <div className="flex flex-col gap-5">
              {orderedItems.map((item, index) => {
                const quiz = quizById.get(item.quiz_item_id);
                if (!quiz) return null;
                const type = questionTypeOf(quiz);
                const draft = answers[item.id] ?? {};
                const set = (patch: AnswerDraft) =>
                  setAnswers((s) => ({ ...s, [item.id]: { ...s[item.id], ...patch } }));
                return (
                  <section key={item.id}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                        Question {index + 1}/{orderedItems.length}
                      </span>
                      <span className="text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        {item.points} pt{item.points === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="text-body text-foreground">{quiz.prompt}</p>
                    {type === "multiple_choice" ? (
                      <div
                        role="radiogroup"
                        aria-label={`Question ${index + 1} choices`}
                        className="mt-2 flex flex-col gap-1.5"
                      >
                        {quiz.choices.map((choice) => {
                          const selected = draft.choiceId === choice.id;
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => set({ choiceId: choice.id })}
                              className={`rounded-control border px-3 py-2 text-left text-body transition-colors duration-(--dur-fast) ${
                                selected
                                  ? "border-foreground/50 bg-muted font-medium text-foreground"
                                  : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                              }`}
                            >
                              {choice.text}
                            </button>
                          );
                        })}
                      </div>
                    ) : type === "code" ? (
                      <textarea
                        value={draft.answerCode ?? ""}
                        onChange={(e) => set({ answerCode: e.target.value })}
                        rows={6}
                        spellCheck={false}
                        aria-label={`Question ${index + 1} code answer`}
                        className={`${fieldClass} mt-2 font-mono text-[13px]`}
                        placeholder="Write your code here"
                      />
                    ) : (
                      <textarea
                        value={draft.answerText ?? ""}
                        onChange={(e) => set({ answerText: e.target.value })}
                        rows={4}
                        aria-label={`Question ${index + 1} answer`}
                        className={`${fieldClass} mt-2`}
                        placeholder="Write your answer here"
                      />
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div>
              {result?.status === "returned" || result?.status === "graded" ? (
                <>
                  <p className="flex items-center gap-2 text-body font-medium text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.8} />
                    Scored {formatScore(result?.final_score)}
                  </p>
                  {result?.feedback ? (
                    <p className="mt-2 text-body text-muted-foreground">{result.feedback}</p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-body font-medium text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.8} />
                    Submitted
                  </p>
                  <p className="mt-2 text-body text-muted-foreground">
                    Some answers need your teacher's review — your result appears in Reports once
                    it's returned.
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="mt-5 rounded-control bg-primary px-3.5 py-2 text-body font-medium text-primary-foreground"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {phase === "answering" || phase === "submitting" ? (
          <footer className="flex shrink-0 items-center gap-3 border-t border-border/60 px-5 py-3">
            <span className="text-meta tabular-nums text-muted-foreground">
              {answeredCount}/{orderedItems.length} answered
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={phase === "submitting"}
              className="inline-flex items-center gap-2 rounded-control bg-primary px-3.5 py-2 text-body font-medium text-primary-foreground transition-opacity duration-(--dur-fast) disabled:opacity-40"
            >
              {phase === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Submit
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
