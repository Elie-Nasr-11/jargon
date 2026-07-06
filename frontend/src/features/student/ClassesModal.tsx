import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { ModalCard } from "@/components/ModalCard";
import {
  ClassDashboard,
  ClassMenu,
  StateNote,
  UnitView,
  type UnitGroup,
} from "@/features/student/ClassViews";
import { StudentCalendarBody } from "@/features/student/StudentCalendar";
import { GradesPanel } from "@/features/student/GradesPanel";
import { ReviewPanel } from "@/features/student/ReviewPanel";
import { fetchReviewDue, fetchStudentGrades } from "@/lib/api";
import { store } from "@/lib/jargon-store";
import type { MentorPreferences, ReviewDueSkill, StudentClass, StudentGradeRow } from "@/lib/types";

// The student hub — ONE large popup off the Classes header icon holding the whole LMS:
// Overview (continue lesson / due soon / recent / review nudge) · Classes (in-modal drill-down:
// class list → dashboard → unit view) · Calendar · Grades · Review. Grade rows are fetched once
// per open and shared across Overview/Calendar/Grades. Opening a lesson hands off to the chat
// surface and closes the modal.

type Tab = "overview" | "classes" | "calendar" | "grades" | "review";
const TABS: Tab[] = ["overview", "classes", "calendar", "grades", "review"];
const TAB_TITLES: Record<Tab, string> = {
  overview: "Overview",
  classes: "Classes",
  calendar: "Calendar",
  grades: "Grades",
  review: "Review",
};

function fmtDue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pctScore(n: number): string {
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

// The hub's landing tab: continue the open lesson, what's due soon, what just came back, and a
// review nudge — each a pointer into its canonical tab, not a second home for the data.
function HubOverview({
  grades,
  reviewDue,
  currentLessonTitle,
  onClose,
  onGoTab,
}: {
  grades: StudentGradeRow[] | null;
  reviewDue: ReviewDueSkill[] | null;
  currentLessonTitle: string | null;
  onClose: () => void;
  onGoTab: (tab: Tab) => void;
}) {
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
          onClick={onClose}
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
          onClick={() => onGoTab("review")}
          className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/20"
        >
          <RotateCcw className="h-[18px] w-[18px] shrink-0 text-warning" strokeWidth={1.7} />
          <span className="min-w-0 flex-1 text-[13px] text-foreground">
            {reviewDue.length} {reviewDue.length === 1 ? "skill is" : "skills are"} due for a quick
            review
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
                <span className="shrink-0 text-muted-foreground">due {fmtDue(g.due_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">Nothing due — you're all caught up.</p>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Recent
          </span>
          <button
            type="button"
            onClick={() => onGoTab("grades")}
            className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {avg != null ? `${released.length} graded · avg ${pctScore(avg)}` : "View grades"}
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
                  {g.score != null ? pctScore(g.score) : g.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">No submitted work yet.</p>
        )}
      </div>
    </div>
  );
}

export function ClassesModal({
  open,
  onOpenChange,
  accessToken,
  mentorPreferences,
  currentLessonTitle = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessToken: string | null;
  mentorPreferences: MentorPreferences;
  currentLessonTitle?: string | null;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [unit, setUnit] = useState<UnitGroup | null>(null);
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [reviewDue, setReviewDue] = useState<ReviewDueSkill[] | null>(null);

  // Start fresh each open + fetch the shared grade rows / review queue once.
  useEffect(() => {
    if (!open) return;
    setTab("overview");
    setCls(null);
    setUnit(null);
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

  const openLesson = (lessonId: string) => {
    store.setLessonId(lessonId);
    onOpenChange(false);
    navigate({ to: "/chat" });
  };

  const back = () => {
    if (unit) setUnit(null);
    else if (cls) setCls(null);
  };

  const drilledIn = tab === "classes" && (unit !== null || cls !== null);
  const title = drilledIn ? (unit ? unit.unitTitle : (cls as StudentClass).name) : TAB_TITLES[tab];

  return (
    <ModalCard open={open} onOpenChange={onOpenChange} title={title} size="large">
      <div className="mb-3">
        {drilledIn ? (
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
            {unit ? "Back to class" : "All classes"}
          </button>
        ) : (
          <div className="inline-flex rounded-full border border-border p-[3px] text-[12.5px]">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1 capitalize transition-colors ${
                  tab === t ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "overview" ? (
        <HubOverview
          grades={grades}
          reviewDue={reviewDue}
          currentLessonTitle={currentLessonTitle}
          onClose={() => onOpenChange(false)}
          onGoTab={setTab}
        />
      ) : tab === "calendar" ? (
        <StudentCalendarBody grades={grades} />
      ) : tab === "grades" ? (
        <GradesPanel grades={grades} />
      ) : tab === "review" ? (
        <ReviewPanel accessToken={accessToken} mentorPreferences={mentorPreferences} />
      ) : unit && cls ? (
        <UnitView classId={cls.id} unitId={unit.unitId} onOpenLesson={openLesson} />
      ) : cls ? (
        <ClassDashboard classId={cls.id} onSelectUnit={setUnit} />
      ) : (
        <ClassMenu onSelectClass={setCls} />
      )}
    </ModalCard>
  );
}
