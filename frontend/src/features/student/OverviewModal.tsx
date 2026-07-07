import { useEffect, useState } from "react";
import { BookOpen, CalendarClock, CheckCircle2, ChevronRight, RotateCcw } from "lucide-react";
import { ModalCard } from "@/components/ModalCard";
import { StateNote } from "@/components/StateNote";
import { fetchReviewDue, fetchStudentGrades } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";
import type { ReviewDueSkill, StudentGradeRow } from "@/lib/types";

// The student overview, as its own drawer modal: continue the open lesson, a review nudge, what's
// due soon, and what just came back — each a pointer into its canonical surface (Grades / Review /
// the lesson), not a second home for the data. Self-fetches grades + the review queue on open.
export function OverviewModal({
  open,
  onOpenChange,
  currentLessonTitle,
  onOpenGrades,
  onOpenReview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLessonTitle: string | null;
  onOpenGrades: () => void;
  onOpenReview: () => void;
}) {
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [reviewDue, setReviewDue] = useState<ReviewDueSkill[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setGrades(null);
    setReviewDue(null);
    let alive = true;
    void fetchStudentGrades()
      .then((rows) => alive && setGrades(rows))
      .catch(() => alive && setGrades([]));
    void fetchReviewDue()
      .then((rows) => alive && setReviewDue(rows))
      .catch(() => alive && setReviewDue([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const now = Date.now();
  const upcoming = (grades ?? [])
    .filter(
      (g) =>
        g.due_at &&
        Date.parse(g.due_at) >= now &&
        !g.submitted_at &&
        g.status !== "complete" &&
        g.status !== "returned",
    )
    .sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string))
    .slice(0, 5);
  const recent = (grades ?? [])
    .filter((g) => g.submitted_at)
    .sort((a, b) => Date.parse(b.submitted_at as string) - Date.parse(a.submitted_at as string))
    .slice(0, 5);
  const released = (grades ?? []).filter((g) => g.score != null);
  const avg = released.length
    ? released.reduce((sum, g) => sum + (g.score ?? 0), 0) / released.length
    : null;

  return (
    <ModalCard open={open} onOpenChange={onOpenChange} title="Overview">
      {grades === null ? (
        <StateNote>Loading your overview…</StateNote>
      ) : (
        <div className="grid gap-4">
          {currentLessonTitle ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center gap-3 rounded-2xl border border-border bg-depth-field px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <BookOpen
                className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
                strokeWidth={1.6}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Continue
                </span>
                <span className="block truncate text-[13.5px] text-foreground">
                  {currentLessonTitle}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
            </button>
          ) : null}

          {reviewDue?.length ? (
            <button
              type="button"
              onClick={onOpenReview}
              className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/20"
            >
              <RotateCcw className="h-[18px] w-[18px] shrink-0 text-warning" strokeWidth={1.7} />
              <span className="min-w-0 flex-1 text-[13px] text-foreground">
                {reviewDue.length} {reviewDue.length === 1 ? "skill is" : "skills are"} due for a
                quick review
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
            </button>
          ) : null}

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Due soon
            </div>
            {upcoming.length ? (
              <div className="grid gap-1.5">
                {upcoming.map((g) => (
                  <div key={g.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <CalendarClock
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.7}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">{g.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      due {formatDate(g.due_at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Nothing due — you're all caught up.
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Recent
              </span>
              <button
                type="button"
                onClick={onOpenGrades}
                className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {avg != null
                  ? `${released.length} graded · avg ${formatScore(avg)}`
                  : "View grades"}
              </button>
            </div>
            {recent.length ? (
              <div className="grid gap-1.5">
                {recent.map((g) => (
                  <div key={g.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <CheckCircle2
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.7}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">{g.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {g.score != null ? formatScore(g.score) : g.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">No submitted work yet.</p>
            )}
          </div>
        </div>
      )}
    </ModalCard>
  );
}
