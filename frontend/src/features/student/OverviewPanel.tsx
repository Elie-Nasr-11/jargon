import { useEffect, useState } from "react";
import { BookOpen, CalendarClock, CheckCircle2, ChevronRight, RotateCcw } from "lucide-react";
import { StateNote } from "@/components/StateNote";
import { fetchReviewDue, fetchStudentGrades } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";
import type { ReviewDueSkill, StudentGradeRow } from "@/lib/types";

// The Overview workspace view's content: continue the open lesson, a review nudge, what's due
// soon, and what just came back — each a pointer into its canonical surface (Grades / Review /
// the lesson), not a second home for the data. Self-fetches on mount (views remount per open).
// At md+ the two lists sit side by side; every card uses the L1 elevation recipe.
export function OverviewPanel({
  currentLessonTitle,
  onContinue,
  onOpenGrades,
  onOpenReview,
}: {
  currentLessonTitle: string | null;
  onContinue: () => void;
  onOpenGrades: () => void;
  onOpenReview: () => void;
}) {
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [reviewDue, setReviewDue] = useState<ReviewDueSkill[] | null>(null);

  useEffect(() => {
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
  }, []);

  if (grades === null) return <StateNote>Loading your overview…</StateNote>;

  const now = Date.now();
  const upcoming = grades
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
  const recent = grades
    .filter((g) => g.submitted_at)
    .sort((a, b) => Date.parse(b.submitted_at as string) - Date.parse(a.submitted_at as string))
    .slice(0, 5);
  const released = grades.filter((g) => g.score != null);
  const avg = released.length
    ? released.reduce((sum, g) => sum + (g.score ?? 0), 0) / released.length
    : null;

  return (
    <div className="grid gap-4">
      {currentLessonTitle ? (
        <button
          type="button"
          onClick={onContinue}
          className="elev-hover flex items-center gap-3 rounded-card border border-border/60 bg-depth-card px-5 py-4 text-left shadow-card"
        >
          <BookOpen
            className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
            strokeWidth={1.6}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-overline uppercase tracking-[0.1em] text-muted-foreground">
              Continue
            </span>
            <span className="block truncate text-title font-medium text-foreground">
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
          className="elev-hover flex items-center gap-3 rounded-card border border-warning/40 bg-warning/10 px-5 py-4 text-left"
        >
          <RotateCcw className="h-[18px] w-[18px] shrink-0 text-warning" strokeWidth={1.7} />
          <span className="min-w-0 flex-1 text-body text-foreground">
            {reviewDue.length} {reviewDue.length === 1 ? "skill is" : "skills are"} due for a quick
            review
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        </button>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-border/60 bg-depth-card p-5 shadow-card">
          <div className="mb-3 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Due soon
          </div>
          {upcoming.length ? (
            <div className="grid gap-2">
              {upcoming.map((g) => (
                <div key={g.id} className="flex items-center gap-2.5 text-body">
                  <CalendarClock
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{g.title}</span>
                  <span className="shrink-0 text-meta text-muted-foreground">
                    due {formatDate(g.due_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-body text-muted-foreground">Nothing due — you're all caught up.</p>
          )}
        </section>

        <section className="rounded-card border border-border/60 bg-depth-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Recent
            </span>
            <button
              type="button"
              onClick={onOpenGrades}
              className="text-meta text-muted-foreground underline underline-offset-2 transition-colors duration-(--dur-fast) hover:text-foreground"
            >
              {avg != null ? `${released.length} graded · avg ${formatScore(avg)}` : "View grades"}
            </button>
          </div>
          {recent.length ? (
            <div className="grid gap-2">
              {recent.map((g) => (
                <div key={g.id} className="flex items-center gap-2.5 text-body">
                  <CheckCircle2
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.7}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{g.title}</span>
                  <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                    {g.score != null ? formatScore(g.score) : g.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-body text-muted-foreground">No submitted work yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
