import { useMemo, useState } from "react";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentItem,
  AssessmentItemAttempt,
  AssessmentRecipient,
  CurriculumQuizItem,
  Lesson,
  Profile,
} from "@/lib/types";
import {
  AssessmentRecipientChip,
  AssessmentStatusChip,
  displayName,
  formatDateTime,
  formatScore,
  lessonTitle,
} from "@/features/teacher/classShared";

// The review half split out of AssessmentManager: quiz attempts queued for teacher
// review/return. The builder half (create/publish/status) stays with the class Structure
// section. Mount with a per-class key so drafts/messages reset on class switch.
export function AssessmentGrading({
  assessments,
  assessmentItems,
  assessmentRecipients,
  assessmentAttempts,
  assessmentItemAttempts,
  quizItems,
  profilesById,
  lessons,
  onReviewAssessmentItem,
  onReturnAssessment,
}: {
  assessments: Assessment[];
  assessmentItems: AssessmentItem[];
  assessmentRecipients: AssessmentRecipient[];
  assessmentAttempts: AssessmentAttempt[];
  assessmentItemAttempts: AssessmentItemAttempt[];
  quizItems: CurriculumQuizItem[];
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  onReviewAssessmentItem: (input: {
    itemAttemptId: string;
    scorePercent: number;
    feedback: string;
  }) => Promise<void>;
  onReturnAssessment: (input: { attemptId: string; feedback: string }) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; feedback: string; saving: boolean }>
  >({});
  const quizItemsById = useMemo(
    () => new Map(quizItems.map((quiz) => [quiz.id, quiz])),
    [quizItems],
  );

  const reviewable = assessments.filter(
    (assessment) =>
      assessment.status !== "archived" &&
      assessmentAttempts.some((attempt) => attempt.assessment_id === assessment.id),
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

  const returnAttempt = async (attempt: AssessmentAttempt) => {
    const feedback = window.prompt("Final feedback for the student", attempt.feedback || "") || "";
    try {
      await onReturnAssessment({ attemptId: attempt.id, feedback });
      setMessage("Quiz result returned.");
    } catch (error) {
      setMessage((error as Error).message || "Could not return quiz result.");
    }
  };

  // Quiet day: collapse the whole queue to one slim line instead of a full card of nothing.
  if (!reviewable.length) {
    return (
      <div className="rounded-3xl border border-border bg-depth-card px-4 py-3 text-[12.5px] text-muted-foreground">
        <span className="font-medium text-foreground">Quiz attempts</span> — nothing to review;
        student attempts will appear here.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-depth-card p-4">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Quiz attempts</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Review written answers and return quiz results.
          </p>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {reviewable.length} with attempts
        </div>
      </div>
      {message ? (
        <div role="status" className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          {message}
        </div>
      ) : null}

      <div className="grid content-start gap-3">
        {reviewable.map((assessment) => {
          const items = assessmentItems.filter((item) => item.assessment_id === assessment.id);
          const recipients = assessmentRecipients.filter(
            (recipient) => recipient.assessment_id === assessment.id,
          );
          const attempts = assessmentAttempts.filter(
            (attempt) => attempt.assessment_id === assessment.id,
          );
          return (
            <div key={assessment.id} className="rounded-2xl border border-border bg-depth-sub p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">
                    {assessment.title}
                  </span>
                  <AssessmentStatusChip status={assessment.status} />
                </div>
                <div className="mt-1 text-[11.5px] text-muted-foreground">
                  {lessonTitle(lessons, assessment.lesson_id)} · {items.length} question
                  {items.length === 1 ? "" : "s"} · {attempts.length} attempt
                  {attempts.length === 1 ? "" : "s"}
                  {assessment.due_at ? <> · due {formatDateTime(assessment.due_at)}</> : null}
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {recipients.map((recipient) => {
                  const profile = profilesById.get(recipient.user_id) || null;
                  return (
                    <div
                      key={recipient.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-depth-field px-3 py-2"
                    >
                      <div className="text-[12.5px] text-foreground">
                        {displayName(profile, recipient.user_id)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AssessmentRecipientChip status={recipient.status} />
                        <span className="text-[11.5px] text-muted-foreground">
                          {recipient.final_score === null
                            ? "ungraded"
                            : formatScore(recipient.final_score)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-3">
                {attempts.map((attempt) => {
                  const profile = profilesById.get(attempt.user_id) || null;
                  const itemAttempts = assessmentItemAttempts.filter(
                    (item) => item.assessment_attempt_id === attempt.id,
                  );
                  const pending = itemAttempts.some(
                    (item) => item.review_state === "pending_review",
                  );
                  return (
                    <div
                      key={attempt.id}
                      className="rounded-2xl border border-border bg-background/45 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[12.5px] font-medium text-foreground">
                            {displayName(profile, attempt.user_id)}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {attempt.status} · {formatDateTime(attempt.created_at)}
                          </div>
                        </div>
                        <span className="text-[11.5px] text-muted-foreground">
                          {attempt.final_score === null
                            ? "pending"
                            : formatScore(attempt.final_score)}
                        </span>
                      </div>
                      <div className="grid gap-2">
                        {itemAttempts.map((itemAttempt) => {
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
                              className="rounded-2xl border border-border bg-background/45 p-3"
                            >
                              <div className="text-[12.5px] font-medium text-foreground">
                                {quiz?.prompt || "Question"}
                              </div>
                              <div className="mt-1 text-[11.5px] text-muted-foreground">
                                {itemAttempt.review_state.replace("_", " ")} · score{" "}
                                {itemAttempt.score === null
                                  ? "pending"
                                  : `${itemAttempt.score}/${itemAttempt.max_score}`}
                              </div>
                              {itemAttempt.answer_text ? (
                                <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                                  {itemAttempt.answer_text}
                                </p>
                              ) : null}
                              {itemAttempt.answer_code ? (
                                <pre
                                  className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-[var(--code-background)] p-3 text-[12px] leading-relaxed text-[var(--code-foreground)]"
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
                                    className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
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
                                    className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void reviewItem(itemAttempt)}
                                    disabled={draft.saving}
                                    className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                                  >
                                    Review
                                  </button>
                                </div>
                              ) : itemAttempt.feedback ? (
                                <p className="mt-2 text-[12.5px] text-muted-foreground">
                                  {itemAttempt.feedback}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void returnAttempt(attempt)}
                          disabled={pending || attempt.status === "returned"}
                          className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                        >
                          Return result
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
