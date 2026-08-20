import { useMemo, useState } from "react";
import { Archive, Check } from "lucide-react";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentItem,
  AssessmentItemAttempt,
  AssessmentRecipient,
  AssessmentStatus,
  CurriculumQuizItem,
  Lesson,
  Profile,
} from "@/lib/types";
import { OverflowMenu } from "@/components/OverflowMenu";
import {
  AssessmentRecipientChip,
  AssessmentStatusChip,
  displayName,
  formatDateTime,
  formatScore,
  lessonTitle,
} from "@/features/teacher/classShared";

// R47: ONE quiz's whole surface — the "student work" page for an assessment. Opened from
// the Classwork list (?tab=classwork&assessment=<id>); status controls up top, then the
// roster strip, then attempts with per-question review and the final Return result.
export function AssessmentWorkView({
  assessment,
  items,
  recipients,
  attempts,
  itemAttempts,
  quizItems,
  profilesById,
  lessons,
  onReviewAssessmentItem,
  onReturnAssessment,
  onSetStatus,
  onBack,
}: {
  assessment: Assessment;
  items: AssessmentItem[];
  recipients: AssessmentRecipient[];
  attempts: AssessmentAttempt[];
  itemAttempts: AssessmentItemAttempt[];
  quizItems: CurriculumQuizItem[];
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  onReviewAssessmentItem: (input: {
    itemAttemptId: string;
    scorePercent: number;
    feedback: string;
  }) => Promise<void>;
  onReturnAssessment: (input: { attemptId: string; feedback: string }) => Promise<void>;
  onSetStatus: (status: AssessmentStatus) => void;
  onBack: () => void;
}) {
  const [message, setMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; feedback: string; saving: boolean }>
  >({});
  const quizItemsById = useMemo(
    () => new Map(quizItems.map((quiz) => [quiz.id, quiz])),
    [quizItems],
  );

  const updateReviewDraft = (
    itemAttemptId: string,
    patch: Partial<{ score: string; feedback: string; saving: boolean }>,
  ) => {
    setReviewDrafts((current) => ({
      ...current,
      [itemAttemptId]: {
        score: current[itemAttemptId]?.score || "",
        feedback: current[itemAttemptId]?.feedback || "",
        saving: current[itemAttemptId]?.saving || false,
        ...patch,
      },
    }));
  };

  const reviewItem = async (itemAttempt: AssessmentItemAttempt) => {
    const draft = reviewDrafts[itemAttempt.id] || { score: "", feedback: "", saving: false };
    const score = Number(draft.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setMessage("Enter a score from 0 to 100 before reviewing the question.");
      return;
    }
    updateReviewDraft(itemAttempt.id, { saving: true });
    try {
      await onReviewAssessmentItem({
        itemAttemptId: itemAttempt.id,
        scorePercent: score,
        feedback: draft.feedback.trim(),
      });
      setMessage("Question reviewed.");
    } catch (error) {
      setMessage((error as Error).message || "Could not review question.");
    } finally {
      updateReviewDraft(itemAttempt.id, { saving: false });
    }
  };

  // R48 (R47 debt): final feedback is an inline per-attempt field, not a browser prompt —
  // the prompt dialog clipped long feedback, couldn't be reviewed before sending, and
  // looked nothing like the rest of the console. Absent draft falls back to the feedback
  // already on the attempt, so Return without typing keeps prior feedback intact.
  const [returnDrafts, setReturnDrafts] = useState<
    Record<string, { feedback: string; saving: boolean }>
  >({});
  const updateReturnDraft = (
    attemptId: string,
    patch: Partial<{ feedback: string; saving: boolean }>,
  ) => {
    setReturnDrafts((current) => ({
      ...current,
      [attemptId]: {
        feedback: current[attemptId]?.feedback ?? "",
        saving: current[attemptId]?.saving || false,
        ...patch,
      },
    }));
  };

  const returnAttempt = async (attempt: AssessmentAttempt) => {
    const draft = returnDrafts[attempt.id];
    const feedback = (draft?.feedback ?? attempt.feedback ?? "").trim();
    updateReturnDraft(attempt.id, { saving: true });
    try {
      await onReturnAssessment({ attemptId: attempt.id, feedback });
      setMessage("Quiz result returned.");
    } catch (error) {
      setMessage((error as Error).message || "Could not return quiz result.");
    } finally {
      updateReturnDraft(attempt.id, { saving: false });
    }
  };

  // What needs the teacher first: submitted attempts, then everything else, newest first.
  const orderedAttempts = [...attempts].sort(
    (a, b) =>
      (a.status === "submitted" ? 0 : 1) - (b.status === "submitted" ? 0 : 1) ||
      b.updated_at.localeCompare(a.updated_at),
  );

  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card sm:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-title font-medium text-foreground">{assessment.title}</h3>
          <AssessmentStatusChip status={assessment.status} />
        </div>
        <button type="button" onClick={onBack} className="btn btn-secondary btn-sm">
          ← Classwork
        </button>
      </div>
      <div className="text-meta text-muted-foreground">
        quiz · {lessonTitle(lessons, assessment.lesson_id)} · {items.length} question
        {items.length === 1 ? "" : "s"} · {attempts.length} attempt
        {attempts.length === 1 ? "" : "s"}
        {assessment.due_at ? <> · due {formatDateTime(assessment.due_at)}</> : null}
      </div>
      {assessment.instructions ? (
        <p className="mt-2 whitespace-pre-wrap text-meta leading-relaxed text-muted-foreground">
          {assessment.instructions}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSetStatus("published")}
          disabled={assessment.status === "published"}
          className="inline-flex items-center gap-1.5 rounded-full border border-success/35 px-3 py-1.5 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-45"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
          Publish
        </button>
        <OverflowMenu
          actions={[
            {
              label: "Set to draft",
              onClick: () => onSetStatus("draft"),
              disabled: assessment.status === "draft",
            },
            {
              label: "Archive",
              icon: Archive,
              onClick: () => onSetStatus("archived"),
              disabled: assessment.status === "archived",
            },
          ]}
        />
      </div>
      {message ? (
        <div role="status" className="mt-3 text-meta leading-relaxed text-muted-foreground">
          {message}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        {recipients.map((recipient) => {
          const profile = profilesById.get(recipient.user_id) || null;
          return (
            <div
              key={recipient.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-depth-field px-3 py-2"
            >
              <div className="text-meta text-foreground">
                {displayName(profile, recipient.user_id)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AssessmentRecipientChip status={recipient.status} />
                <span className="text-meta text-muted-foreground">
                  {recipient.final_score === null ? "ungraded" : formatScore(recipient.final_score)}
                </span>
              </div>
            </div>
          );
        })}
        {recipients.length === 0 ? (
          <p className="text-meta text-muted-foreground">No students assigned yet.</p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        {orderedAttempts.map((attempt) => {
          const profile = profilesById.get(attempt.user_id) || null;
          const attemptItems = itemAttempts.filter(
            (item) => item.assessment_attempt_id === attempt.id,
          );
          const pending = attemptItems.some((item) => item.review_state === "pending_review");
          return (
            <div key={attempt.id} className="rounded-card border border-border bg-depth-sub p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-meta font-medium text-foreground">
                    {displayName(profile, attempt.user_id)}
                  </div>
                  <div className="mt-0.5 text-meta text-muted-foreground">
                    {attempt.status} · {formatDateTime(attempt.created_at)}
                  </div>
                </div>
                <span className="text-meta text-muted-foreground">
                  {attempt.final_score === null ? "pending" : formatScore(attempt.final_score)}
                </span>
              </div>
              <div className="grid gap-2">
                {attemptItems.map((itemAttempt) => {
                  const quiz = quizItemsById.get(itemAttempt.quiz_item_id);
                  const draft = reviewDrafts[itemAttempt.id] || {
                    score:
                      itemAttempt.score === null || itemAttempt.score === undefined
                        ? ""
                        : String(
                            Math.round(
                              (Number(itemAttempt.score || 0) /
                                Number(itemAttempt.max_score || 1)) *
                                100,
                            ),
                          ),
                    feedback: itemAttempt.feedback || "",
                    saving: false,
                  };
                  return (
                    <div
                      key={itemAttempt.id}
                      className="rounded-card border border-border bg-depth-sub p-3"
                    >
                      <div className="text-meta font-medium text-foreground">
                        {quiz?.prompt || "Question"}
                      </div>
                      <div className="mt-1 text-meta text-muted-foreground">
                        {itemAttempt.review_state.replace("_", " ")} · score{" "}
                        {itemAttempt.score === null
                          ? "pending"
                          : `${itemAttempt.score}/${itemAttempt.max_score}`}
                      </div>
                      {itemAttempt.answer_text ? (
                        <p className="mt-2 whitespace-pre-wrap text-meta leading-relaxed text-muted-foreground">
                          {itemAttempt.answer_text}
                        </p>
                      ) : null}
                      {itemAttempt.answer_code ? (
                        <pre
                          className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap rounded-card border border-border bg-[var(--code-background)] p-3 text-meta leading-relaxed text-[var(--code-foreground)]"
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          {itemAttempt.answer_code}
                        </pre>
                      ) : null}
                      {itemAttempt.review_state === "pending_review" ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_auto]">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={draft.score}
                            onChange={(event) =>
                              updateReviewDraft(itemAttempt.id, {
                                score: event.target.value,
                              })
                            }
                            placeholder="Score"
                            aria-label="Score (0–100)"
                            className="jargon-input"
                          />
                          <input
                            value={draft.feedback}
                            onChange={(event) =>
                              updateReviewDraft(itemAttempt.id, {
                                feedback: event.target.value,
                              })
                            }
                            placeholder="Feedback"
                            aria-label="Feedback for the student"
                            className="jargon-input"
                          />
                          <button
                            type="button"
                            onClick={() => void reviewItem(itemAttempt)}
                            disabled={draft.saving}
                            className="btn btn-secondary btn-sm"
                          >
                            Review
                          </button>
                        </div>
                      ) : itemAttempt.feedback ? (
                        <p className="mt-2 text-meta text-muted-foreground">
                          {itemAttempt.feedback}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {attempt.status !== "returned" ? (
                  <input
                    value={returnDrafts[attempt.id]?.feedback ?? attempt.feedback ?? ""}
                    onChange={(event) =>
                      updateReturnDraft(attempt.id, { feedback: event.target.value })
                    }
                    placeholder="Final feedback for the student"
                    aria-label="Final feedback for the student"
                    className="jargon-input min-w-0 flex-1"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => void returnAttempt(attempt)}
                  disabled={
                    pending || attempt.status === "returned" || returnDrafts[attempt.id]?.saving
                  }
                  className="shrink-0 rounded-full border border-success/35 px-3 py-1.5 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                >
                  Return result
                </button>
              </div>
            </div>
          );
        })}
        {orderedAttempts.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            No attempts yet — student attempts will appear here.
          </p>
        ) : null}
      </div>
    </section>
  );
}
