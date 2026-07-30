import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { AMBIENT_FOCUS_EVENT } from "@/components/AmbientCanvas";
import {
  ArrowRight,
  Brain,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  Loader2,
  Play,
} from "lucide-react";
import {
  fetchMostRecentLearningSession,
  fetchProfile,
  fetchSessionSummaries,
  fetchStudentGrades,
  fetchStudentMemory,
  getSession,
} from "@/lib/api";
import { formatDate, formatScore, relativeTime } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { checkpointRows, type CheckpointRowModel } from "@/student/checkpoints";
import type {
  Lesson,
  SessionSummary,
  StudentAssessmentBundle,
  StudentGradeRow,
  StudentMemory,
} from "@/lib/types";

// Home (DESIGN_V6 §6): greeting, resume-last-lesson card, "What your mentor remembers"
// (memory v1), the work-due strip, and a recent-grades strip. The LMS half of the surface —
// everything here either resumes work or reports on it; nothing competes with Learn.
//
// The memory card is the premium moment: it reveals with a slow rise+fade the first time its
// data lands (reduced motion snaps), and announces that reveal on the ambient focus event so
// the shell's AmbientCanvas blooms once in sync.
//
// Data: every read is an existing api.ts call. Resume = the newest learning session across all
// lessons resolved against the catalog the shell already holds; memory = student_memory +
// session_summaries (owner RLS); grades = the unified checkpoint rows.

export type StudentHomeProps = {
  // The shell's catalog — used to resolve the resume session's lesson without a second fetch.
  lessons: Lesson[];
  onResumeLesson: (lessonId: string) => void;
  // The shell's assessment bundle (null while loading) — feeds the due strip.
  assessments: StudentAssessmentBundle | null;
  onOpenAssessment: (assessmentId: string) => void;
};

function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Chips({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div className="mt-2.5">
      <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="rounded-pill border border-border bg-depth-sub px-2 py-0.5 text-meta text-foreground"
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function MemoryCard() {
  const [memory, setMemory] = useState<StudentMemory | null>(null);
  const [recaps, setRecaps] = useState<SessionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchStudentMemory().catch(() => null),
      fetchSessionSummaries(3).catch(() => [] as SessionSummary[]),
    ]).then(([m, s]) => {
      if (cancelled) return;
      setMemory(m);
      setRecaps(s);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The premium reveal: once, when the data first lands. Reduced motion renders in place.
  useEffect(() => {
    if (!loaded || !cardRef.current) return;
    // The ambient uFocus pulse on first reveal (DESIGN_V6 §6): announced on window; the shell
    // that owns the AmbientCanvas listens and bumps its focusSignal. Dispatched regardless of
    // reduced motion — the canvas itself suppresses blooms under that preference.
    window.dispatchEvent(new Event(AMBIENT_FOCUS_EVENT));
    if (prefersReducedMotion()) return;
    gsap.fromTo(
      cardRef.current,
      { y: 12, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" },
    );
  }, [loaded]);

  const profile = memory?.profile;
  const empty = !profile?.narrative && !profile?.strengths?.length && !profile?.struggles?.length;

  return (
    <section
      ref={cardRef}
      className="rounded-card border border-border bg-depth-card p-4"
      aria-label="What your mentor remembers"
    >
      <h2 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
        <Brain className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
        What your mentor remembers
      </h2>
      {!loaded ? (
        <p className="flex items-center gap-2 text-meta text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : empty ? (
        <p className="text-body text-muted-foreground">
          Your mentor is still getting to know you — finish a lesson to start building memory.
        </p>
      ) : (
        <>
          {profile?.narrative ? (
            <p className="text-body text-foreground">{profile.narrative}</p>
          ) : null}
          <Chips label="Strengths" values={profile?.strengths ?? []} />
          <Chips label="Working on" values={profile?.struggles ?? []} />
          {recaps.length ? (
            <div className="mt-3 border-t border-border/60 pt-2.5">
              <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Recent sessions
              </div>
              <ul className="flex flex-col gap-1.5">
                {recaps.map((recap) => {
                  const line =
                    recap.summary?.covered || recap.summary?.wins || recap.summary?.note || "";
                  if (!line) return null;
                  return (
                    <li key={recap.id} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                        {line}
                      </span>
                      <span className="shrink-0 text-meta text-muted-foreground">
                        {relativeTime(recap.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function DueRow({ row, onOpen }: { row: CheckpointRowModel; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted/60"
      >
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
        {row.dueAt ? (
          <span className="shrink-0 text-meta text-muted-foreground">
            Due {formatDate(row.dueAt)}
          </span>
        ) : null}
        <span className="shrink-0 text-meta font-medium text-foreground">
          {row.state === "in_progress" ? "Continue" : "Start"}
        </span>
      </button>
    </li>
  );
}

export function StudentHome({
  lessons,
  onResumeLesson,
  assessments,
  onOpenAssessment,
}: StudentHomeProps) {
  const [name, setName] = useState("");
  const [resumeLessonId, setResumeLessonId] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then(async (session) => {
        const userId = session?.user?.id;
        if (!userId) return;
        const profile = await fetchProfile(userId).catch(() => null);
        if (cancelled) return;
        setName(profile?.name || session?.user?.email?.split("@")[0] || "");
      })
      .catch(() => {});
    void fetchMostRecentLearningSession()
      .then((session) => {
        if (cancelled) return;
        setResumeLessonId(session?.lesson_id ?? null);
        setResumeChecked(true);
      })
      .catch(() => !cancelled && setResumeChecked(true));
    void fetchStudentGrades()
      .then((rows) => !cancelled && setGrades(rows))
      .catch(() => !cancelled && setGrades([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const resumeLesson = useMemo(
    () => (resumeLessonId ? (lessons.find((l) => l.id === resumeLessonId) ?? null) : null),
    [lessons, resumeLessonId],
  );

  const due = useMemo(() => {
    if (!assessments) return [];
    return checkpointRows(assessments).filter(
      (row) => row.state === "todo" || row.state === "in_progress",
    );
  }, [assessments]);

  const recentGrades = useMemo(
    () =>
      (grades ?? [])
        .filter((row) => row.score !== null)
        .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""))
        .slice(0, 5),
    [grades],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-5 font-serif text-[24px] tracking-tight text-foreground">
          {greetingForHour(new Date().getHours())}
          {name ? `, ${name}` : ""}
        </h1>

        <div className="grid gap-3 md:grid-cols-2">
          {/* Resume: the single most likely next act, so it leads. */}
          <section className="rounded-card border border-border bg-depth-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
              <Play className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
              Pick up where you left off
            </h2>
            {!resumeChecked ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : resumeLesson ? (
              <button
                type="button"
                onClick={() => onResumeLesson(resumeLesson.id)}
                className="group flex w-full items-center gap-2.5 rounded-control border border-border bg-depth-sub px-3 py-2.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-foreground">
                    {resumeLesson.title}
                  </span>
                  {resumeLesson.unit_title ? (
                    <span className="block truncate text-meta text-muted-foreground">
                      {resumeLesson.unit_title}
                    </span>
                  ) : null}
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
                  strokeWidth={1.7}
                />
              </button>
            ) : (
              <p className="text-body text-muted-foreground">
                Nothing in progress yet — open a lesson from the sidebar to begin.
              </p>
            )}
          </section>

          <MemoryCard />

          {/* Work due: teacher-assigned checkpoints, one tap into the focused surface. */}
          <section className="rounded-card border border-border bg-depth-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
              <CalendarClock
                className="h-[15px] w-[15px] text-muted-foreground"
                strokeWidth={1.6}
              />
              Work due
              {due.length ? (
                <span className="text-meta tabular-nums text-muted-foreground">{due.length}</span>
              ) : null}
            </h2>
            {assessments === null ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : due.length ? (
              <ul className="flex flex-col">
                {due.slice(0, 5).map((row) => (
                  <DueRow key={row.id} row={row} onOpen={() => onOpenAssessment(row.id)} />
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">Nothing due right now.</p>
            )}
          </section>

          {/* Recent grades: the slim strip; Reports holds the full gradebook. */}
          <section className="rounded-card border border-border bg-depth-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
              <GraduationCap
                className="h-[15px] w-[15px] text-muted-foreground"
                strokeWidth={1.6}
              />
              Recent grades
            </h2>
            {grades === null ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : recentGrades.length ? (
              <ul className="flex flex-col">
                {recentGrades.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline gap-3 border-b border-border/60 py-2 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {row.title}
                    </span>
                    <span className="shrink-0 text-meta capitalize text-muted-foreground">
                      {row.kind}
                    </span>
                    <span className="shrink-0 text-meta font-medium tabular-nums text-foreground">
                      {formatScore(row.score)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No graded work yet.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
