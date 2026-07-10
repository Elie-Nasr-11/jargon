import { useState } from "react";
import { Paperclip } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { getSubmissionFileSignedUrl, submissionFileState } from "@/lib/api";
import type {
  Assignment,
  AssignmentRecipient,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  Lesson,
  Profile,
} from "@/lib/types";
import {
  AssignmentRecipientChip,
  AssignmentStatusChip,
  displayName,
  formatDateTime,
  formatScore,
  lessonTitle,
} from "@/features/teacher/classShared";

// The grading half split out of AssignmentManager: submitted work queued for teacher
// review. The builder half (create/assign/status) stays with the class Structure section.
// Mount with a per-class key so drafts/messages reset on class switch.
export function AssignmentGrading({
  assignments,
  recipients,
  submissions,
  files,
  profilesById,
  lessons,
  onReviewSubmission,
}: {
  assignments: Assignment[];
  recipients: AssignmentRecipient[];
  submissions: AssignmentSubmission[];
  files: AssignmentSubmissionFile[];
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  onReviewSubmission: (input: {
    assignment: Assignment;
    submission: AssignmentSubmission;
    scorePercent: number;
    feedback: string;
    decision: "accepted" | "returned";
  }) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; feedback: string; saving: boolean }>
  >({});

  const gradable = assignments.filter(
    (assignment) =>
      assignment.status !== "archived" &&
      submissions.some((submission) => submission.assignment_id === assignment.id),
  );

  const openFile = async (file: AssignmentSubmissionFile) => {
    const state = submissionFileState(file);
    if (state === "purged") {
      setMessage("This file was removed under the retention policy and is no longer available.");
      return;
    }
    if (state === "quarantined") {
      setMessage("This file was flagged by the malware scan and cannot be opened.");
      return;
    }
    try {
      const url = await getSubmissionFileSignedUrl(file);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage((error as Error).message || "Could not open submission file.");
    }
  };

  const updateReviewDraft = (
    submissionId: string,
    patch: Partial<{ score: string; feedback: string; saving: boolean }>,
  ) => {
    setReviewDrafts((current) => ({
      ...current,
      [submissionId]: {
        score: current[submissionId]?.score || "",
        feedback: current[submissionId]?.feedback || "",
        saving: current[submissionId]?.saving || false,
        ...patch,
      },
    }));
  };

  const review = async (
    assignment: Assignment,
    submission: AssignmentSubmission,
    decision: "accepted" | "returned",
  ) => {
    const draft = reviewDrafts[submission.id] || { score: "", feedback: "", saving: false };
    const score = Number(draft.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setMessage("Enter a score from 0 to 100 before returning a review.");
      return;
    }
    updateReviewDraft(submission.id, { saving: true });
    try {
      await onReviewSubmission({
        assignment,
        submission,
        scorePercent: score,
        feedback: draft.feedback.trim(),
        decision,
      });
      setMessage(decision === "accepted" ? "Submission marked complete." : "Submission returned.");
    } catch (error) {
      setMessage((error as Error).message || "Could not review submission.");
    } finally {
      updateReviewDraft(submission.id, { saving: false });
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-depth-card p-4">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Assignment submissions</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Review submitted work and return teacher feedback.
          </p>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {gradable.length} with submissions
        </div>
      </div>
      {message ? (
        <div className="mb-3 text-[12px] leading-relaxed text-muted-foreground">{message}</div>
      ) : null}

      {gradable.length ? (
        <div className="grid content-start gap-3">
          {gradable.map((assignment) => {
            const assignmentRecipients = recipients.filter(
              (recipient) => recipient.assignment_id === assignment.id,
            );
            const assignmentSubmissions = submissions.filter(
              (submission) => submission.assignment_id === assignment.id,
            );
            return (
              <div
                key={assignment.id}
                className="rounded-2xl border border-border bg-depth-sub p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">
                      {assignment.title}
                    </span>
                    <AssignmentStatusChip status={assignment.status} />
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    {lessonTitle(lessons, assignment.lesson_id)} · {assignmentSubmissions.length}{" "}
                    submission{assignmentSubmissions.length === 1 ? "" : "s"}
                    {assignment.due_at ? <> · due {formatDateTime(assignment.due_at)}</> : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  {assignmentRecipients.map((recipient) => {
                    const profile = profilesById.get(recipient.user_id) || null;
                    return (
                      <div
                        key={recipient.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-depth-sub px-3 py-2"
                      >
                        <div className="text-[12.5px] text-foreground">
                          {displayName(profile, recipient.user_id)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <AssignmentRecipientChip status={recipient.status} />
                          <span className="text-[11.5px] text-muted-foreground">
                            {recipient.score === null ? "ungraded" : formatScore(recipient.score)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 grid gap-3">
                  {assignmentSubmissions.map((submission) => {
                    const profile = profilesById.get(submission.user_id) || null;
                    const submissionFiles = files.filter(
                      (file) => file.submission_id === submission.id,
                    );
                    const draft = reviewDrafts[submission.id] || {
                      score:
                        submission.score === null || submission.score === undefined
                          ? ""
                          : String(Math.round(submission.score * 100)),
                      feedback: submission.feedback || "",
                      saving: false,
                    };
                    return (
                      <div
                        key={submission.id}
                        className="rounded-2xl border border-border bg-background/45 p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-[12.5px] font-medium text-foreground">
                              {displayName(profile, submission.user_id)}
                            </div>
                            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                              {submission.status} · {formatDateTime(submission.created_at)}
                            </div>
                          </div>
                          <span className="text-[11.5px] text-muted-foreground">
                            {submission.score === null
                              ? "not graded"
                              : formatScore(submission.score)}
                          </span>
                        </div>
                        {submission.content ? (
                          <p className="whitespace-pre-wrap rounded-2xl border border-border bg-background/45 p-3 text-[12.5px] leading-relaxed text-foreground">
                            {submission.content}
                          </p>
                        ) : null}
                        {submission.code ? (
                          <pre
                            className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-[var(--code-background)] p-3 text-[12px] leading-relaxed text-[var(--code-foreground)]"
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            }}
                          >
                            {submission.code}
                          </pre>
                        ) : null}
                        {submissionFiles.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {submissionFiles.map((file) => {
                              const fileState = submissionFileState(file);
                              const unavailable = fileState !== "available";
                              return (
                                <button
                                  type="button"
                                  key={file.id}
                                  onClick={() => void openFile(file)}
                                  disabled={unavailable}
                                  title={
                                    fileState === "purged"
                                      ? "Removed under the retention policy"
                                      : fileState === "quarantined"
                                        ? "Flagged by the malware scan"
                                        : undefined
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:line-through disabled:hover:bg-transparent"
                                >
                                  <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
                                  {file.original_filename}
                                  {fileState === "quarantined" ? " · flagged" : ""}
                                  {fileState === "purged" ? " · removed" : ""}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={draft.score}
                            onChange={(event) =>
                              updateReviewDraft(submission.id, { score: event.target.value })
                            }
                            placeholder="Score"
                            className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                          />
                          <input
                            value={draft.feedback}
                            onChange={(event) =>
                              updateReviewDraft(submission.id, {
                                feedback: event.target.value,
                              })
                            }
                            placeholder="Feedback for the student"
                            className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void review(assignment, submission, "accepted")}
                            disabled={draft.saving}
                            className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                          >
                            Mark complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void review(assignment, submission, "returned")}
                            disabled={draft.saving}
                            className="rounded-full border border-warning/35 px-3 py-1.5 text-[11.5px] text-warning transition-colors hover:bg-warning/10 disabled:opacity-45"
                          >
                            Return
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
      ) : (
        <EmptyState>Nothing to grade — student submissions will appear here.</EmptyState>
      )}
    </div>
  );
}
