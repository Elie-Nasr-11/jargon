import { useState } from "react";
import { Archive, Check, Paperclip } from "lucide-react";
import { getSubmissionFileSignedUrl, submissionFileState } from "@/lib/api";
import type {
  Assignment,
  AssignmentRecipient,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  Lesson,
  Profile,
} from "@/lib/types";
import { OverflowMenu } from "@/components/OverflowMenu";
import {
  AssignmentRecipientChip,
  AssignmentStatusChip,
  displayName,
  formatDateTime,
  formatScore,
  lessonTitle,
} from "@/features/teacher/classShared";

// R47: ONE assignment's whole surface — Classroom's "student work" page. Opened from the
// Classwork list (?tab=classwork&assignment=<id>); instructions + status controls up top,
// then the roster strip, then submissions grouped by what needs the teacher first.
// Grading happens here, ON the work; the Grades tab is just the rollup.
export function AssignmentWorkView({
  assignment,
  recipients,
  submissions,
  files,
  profilesById,
  lessons,
  onReviewSubmission,
  onSetStatus,
  onBack,
}: {
  assignment: Assignment;
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
  onSetStatus: (status: AssignmentStatus) => void;
  onBack: () => void;
}) {
  const [message, setMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; feedback: string; saving: boolean }>
  >({});

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

  const review = async (submission: AssignmentSubmission, decision: "accepted" | "returned") => {
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

  // What needs the teacher first: submitted → returned → accepted (graded).
  const statusOrder: Record<string, number> = { submitted: 0, returned: 1, accepted: 2 };
  const orderedSubmissions = [...submissions].sort(
    (a, b) =>
      (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) ||
      b.updated_at.localeCompare(a.updated_at),
  );

  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card sm:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-title font-medium text-foreground">{assignment.title}</h3>
          <AssignmentStatusChip status={assignment.status} />
        </div>
        <button type="button" onClick={onBack} className="btn btn-secondary btn-sm">
          ← Classwork
        </button>
      </div>
      <div className="text-meta text-muted-foreground">
        assignment · {lessonTitle(lessons, assignment.lesson_id)} · {submissions.length} submission
        {submissions.length === 1 ? "" : "s"}
        {assignment.due_at ? <> · due {formatDateTime(assignment.due_at)}</> : null}
      </div>
      {assignment.instructions ? (
        <p className="mt-2 whitespace-pre-wrap text-meta leading-relaxed text-muted-foreground">
          {assignment.instructions}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSetStatus("assigned")}
          disabled={assignment.status === "assigned"}
          className="inline-flex items-center gap-1.5 rounded-full border border-success/35 px-3 py-1.5 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-45"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
          Assign
        </button>
        <OverflowMenu
          actions={[
            {
              label: "Set to draft",
              onClick: () => onSetStatus("draft"),
              disabled: assignment.status === "draft",
            },
            {
              label: "Archive",
              icon: Archive,
              onClick: () => onSetStatus("archived"),
              disabled: assignment.status === "archived",
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
                <AssignmentRecipientChip status={recipient.status} />
                <span className="text-meta text-muted-foreground">
                  {recipient.score === null ? "ungraded" : formatScore(recipient.score)}
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
        {orderedSubmissions.map((submission) => {
          const profile = profilesById.get(submission.user_id) || null;
          const submissionFiles = files.filter((file) => file.submission_id === submission.id);
          const draft = reviewDrafts[submission.id] || {
            score:
              submission.score === null || submission.score === undefined
                ? ""
                : String(Math.round(submission.score * 100)),
            feedback: submission.feedback || "",
            saving: false,
          };
          return (
            <div key={submission.id} className="rounded-card border border-border bg-depth-sub p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-meta font-medium text-foreground">
                    {displayName(profile, submission.user_id)}
                  </div>
                  <div className="mt-0.5 text-meta text-muted-foreground">
                    {submission.status} · {formatDateTime(submission.created_at)}
                  </div>
                </div>
                <span className="text-meta text-muted-foreground">
                  {submission.score === null ? "not graded" : formatScore(submission.score)}
                </span>
              </div>
              {submission.content ? (
                <p className="whitespace-pre-wrap rounded-card border border-border bg-depth-sub p-3 text-meta leading-relaxed text-foreground">
                  {submission.content}
                </p>
              ) : null}
              {submission.code ? (
                <pre
                  className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-card border border-border bg-[var(--code-background)] p-3 text-meta leading-relaxed text-[var(--code-foreground)]"
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
                        className="btn btn-secondary btn-sm disabled:text-muted-foreground disabled:line-through"
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
                  aria-label="Score (0–100)"
                  className="jargon-input"
                />
                <input
                  value={draft.feedback}
                  onChange={(event) =>
                    updateReviewDraft(submission.id, {
                      feedback: event.target.value,
                    })
                  }
                  placeholder="Feedback for the student"
                  aria-label="Feedback for the student"
                  className="jargon-input"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void review(submission, "accepted")}
                  disabled={draft.saving}
                  className="rounded-full border border-success/35 px-3 py-1.5 text-meta text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                >
                  Mark complete
                </button>
                <button
                  type="button"
                  onClick={() => void review(submission, "returned")}
                  disabled={draft.saving}
                  className="rounded-full border border-warning/35 px-3 py-1.5 text-meta text-warning transition-colors hover:bg-warning/10 disabled:opacity-45"
                >
                  Return
                </button>
              </div>
            </div>
          );
        })}
        {orderedSubmissions.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            Nothing submitted yet — student work will appear here.
          </p>
        ) : null}
      </div>
    </section>
  );
}
