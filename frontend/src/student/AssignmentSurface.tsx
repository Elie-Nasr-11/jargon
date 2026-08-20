import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { CheckCircle2, Clock, Loader2, Lock, NotebookPen, Paperclip, X } from "lucide-react";
import {
  fetchStudentAssignments,
  MAX_SUBMISSION_FILE_BYTES,
  MAX_SUBMISSION_FILES,
  submitAssignment,
} from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import type { Assignment, StudentAssignmentBundle } from "@/lib/types";

// R48: the student assignment surface — the first UI over submitAssignment (which shipped
// with the assignment schema but had no caller until work-step hand-offs needed one).
//
// Same posture as AssessmentSurface (DESIGN_V6 §6 focus surfaces): a full-screen overlay
// that scales in from 0.985, no backdrop dismiss, no Escape, and a two-step Leave while
// writing — a stray click can never eat a half-written submission. Unlike AssessmentSurface
// it loads its own bundle (no Home strip pre-fetches assignments), so it opens on a
// lightweight loading phase.
//
// Submitting flips the recipient to "submitted" server-side; when this surface was opened
// from a lesson's work card, StudentApp's onFinished fires the continue handshake and the
// mentor picks the lesson back up (the chat runtime re-reads satisfaction on that turn).

type Phase = "loading" | "intro" | "writing" | "submitting" | "done";

export type AssignmentSurfaceProps = {
  assignmentId: string;
  onClose: () => void;
  // Fired after a submit lands so the parent can refresh strips / continue the lesson.
  onFinished?: () => void;
};

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

export function AssignmentSurface({ assignmentId, onClose, onFinished }: AssignmentSurfaceProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [bundle, setBundle] = useState<StudentAssignmentBundle | null>(null);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchStudentAssignments()
      .then((data) => {
        if (cancelled) return;
        setBundle(data);
        setPhase("intro");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn't load this assignment.");
        setPhase("intro");
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const assignment: Assignment | null = useMemo(
    () => bundle?.assignments.find((a) => a.id === assignmentId) ?? null,
    [bundle, assignmentId],
  );
  const submissions = useMemo(
    () => (bundle?.submissions ?? []).filter((s) => s.assignment_id === assignmentId),
    [bundle, assignmentId],
  );
  const recipient = useMemo(
    () => (bundle?.recipients ?? []).find((r) => r.assignment_id === assignmentId) ?? null,
    [bundle, assignmentId],
  );
  const latest = submissions[0] ?? null;

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

  const locked = phase === "writing" || phase === "submitting";

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    setError("");
    const next = [...files];
    for (const file of Array.from(incoming)) {
      if (next.length >= MAX_SUBMISSION_FILES) {
        setError(`Attach at most ${MAX_SUBMISSION_FILES} files per submission.`);
        break;
      }
      if (file.size > MAX_SUBMISSION_FILE_BYTES) {
        setError(
          `"${file.name}" is too large — each file must be under ${megabytes(
            MAX_SUBMISSION_FILE_BYTES,
          )} MB.`,
        );
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const submit = async () => {
    setPhase("submitting");
    setError("");
    try {
      await submitAssignment({ assignmentId, content, code: "", files });
      setPhase("done");
      onFinished?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't submit. Your work is still here — try again.",
      );
      setPhase("writing");
    }
  };

  const requestClose = () => {
    if (!locked) {
      onClose();
      return;
    }
    // The lock: leaving half-written work is a deliberate two-step act, never a stray click.
    setConfirmLeave(true);
  };

  const canSubmit = Boolean(content.trim() || files.length);

  return (
    // Plain overlay by design: no Radix Dialog, so there is no Escape-to-close or
    // backdrop-click dismissal to suppress — the ONLY exits are the buttons below.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={assignment?.title || "Assignment"}
      className="fixed inset-0 z-[var(--z-header)] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    >
      <div
        ref={cardRef}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-card border border-border bg-depth-card shadow-raised"
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-5 py-3.5">
          <NotebookPen className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body font-medium text-foreground">
              {assignment?.title || "Assignment"}
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
              Leave this assignment? Work typed here is only saved when you submit.
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

          {phase === "loading" ? (
            <p className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : !assignment ? (
            <p className="text-body text-muted-foreground">
              This assignment isn't available any more.
            </p>
          ) : phase === "intro" ? (
            <div>
              {assignment.instructions ? (
                <p className="whitespace-pre-wrap text-body text-foreground">
                  {assignment.instructions}
                </p>
              ) : null}
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
                {assignment.due_at ? (
                  <li className="flex items-center gap-1">
                    <Clock className="h-3 w-3" strokeWidth={1.8} /> Due{" "}
                    {formatDate(assignment.due_at)}
                  </li>
                ) : null}
                <li>Write your answer, attach files, or both</li>
              </ul>

              {latest ? (
                <div className="mt-4 rounded-card border border-border bg-depth-sub p-3">
                  <p className="text-meta text-muted-foreground">
                    {recipient?.status === "returned" ||
                    recipient?.status === "complete" ||
                    latest.status === "returned"
                      ? `Returned${
                          recipient?.score != null
                            ? ` — scored ${formatScore(recipient.score)}`
                            : ""
                        }`
                      : "Submitted — waiting for your teacher's review"}
                  </p>
                  {recipient?.feedback ? (
                    <p className="mt-1 text-meta text-foreground">{recipient.feedback}</p>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setPhase("writing")}
                className="mt-5 rounded-control bg-primary px-3.5 py-2 text-body font-medium text-primary-foreground"
              >
                {latest ? "Submit another version" : "Start working"}
              </button>
            </div>
          ) : phase === "writing" || phase === "submitting" ? (
            <div className="flex flex-col gap-3">
              {assignment.instructions ? (
                <p className="whitespace-pre-wrap text-meta text-muted-foreground">
                  {assignment.instructions}
                </p>
              ) : null}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                aria-label="Your work"
                placeholder="Write your work here"
                className="w-full rounded-control border border-border bg-depth-sub p-2.5 text-body text-foreground outline-none focus:border-foreground/40"
              />
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded-card border border-border bg-depth-sub px-3 py-2"
                >
                  <Paperclip
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-overline text-muted-foreground">
                    {Math.max(1, Math.round(file.size / 1024))} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    title="Remove this file"
                    className="shrink-0 rounded-full border border-border p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </div>
              ))}
              <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-control border border-border px-2.5 py-1.5 text-meta text-muted-foreground transition-colors hover:text-foreground">
                <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
                Attach files
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-body font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.8} />
                Submitted
              </p>
              <p className="mt-2 text-body text-muted-foreground">
                Your teacher will review it. If this was part of a lesson, the mentor picks things
                back up in the chat.
              </p>
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

        {phase === "writing" || phase === "submitting" ? (
          <footer className="flex shrink-0 items-center gap-3 border-t border-border/60 px-5 py-3">
            <span className="text-meta tabular-nums text-muted-foreground">
              {files.length ? `${files.length}/${MAX_SUBMISSION_FILES} files` : ""}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={phase === "submitting" || !canSubmit}
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
