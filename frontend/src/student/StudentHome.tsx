import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ArrowRight, Brain, ClipboardCheck, GraduationCap, Loader2, Play } from "lucide-react";
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

// Home, in three deliberate tiers (top to bottom = most to least likely next act):
//   1. RECENT ACTIVITY — resume the last lesson + the last few session recaps, beside
//      "What your mentor remembers" (memory v1).
//   2. ASSIGNMENTS, QUIZZES & GRADES — work due and the recent-grades strip.
//   3. CLASSES — the class list (moved here from the sidebar), expanding to lessons on click.
//
// Disclosure follows the same ladder everywhere: primary facts just show; secondary detail
// (dates, kinds, arrows) reveals on hover; deep content (a class's lesson list, an assessment)
// takes a click. Data: every read is an existing api.ts call.

export type StudentHomeProps = {
  // The shell's catalog — used to resolve the resume session's lesson without a second fetch.
  lessons: Lesson[];
  onOpenLesson: (lessonId: string) => void;
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

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-overline font-medium uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </h2>
  );
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
            className="rounded-pill border border-border px-2 py-0.5 text-meta text-foreground"
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
  const [loaded, setLoaded] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchStudentMemory()
      .catch(() => null)
      .then((m) => {
        if (cancelled) return;
        setMemory(m);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The reveal: once, when the data first lands. Reduced motion renders in place.
  useEffect(() => {
    if (!loaded || !cardRef.current || prefersReducedMotion()) return;
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
      <h3 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
        <Brain className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
        What your mentor remembers
      </h3>
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
        className="hvp flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
      >
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
        {row.dueAt ? (
          <span className="hvr shrink-0 text-meta text-muted-foreground">
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
  onOpenLesson,
  assessments,
  onOpenAssessment,
}: StudentHomeProps) {
  const [name, setName] = useState("");
  const [resumeLessonId, setResumeLessonId] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  const [recaps, setRecaps] = useState<SessionSummary[]>([]);

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
    void fetchSessionSummaries(4)
      .then((rows) => !cancelled && setRecaps(rows))
      .catch(() => {});
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
        <h1 className="mb-6 font-serif text-[26px] tracking-tight text-foreground">
          {greetingForHour(new Date().getHours())}
          {name ? `, ${name}` : ""}
        </h1>

        {/* ---- 1. Recent activity ------------------------------------------------------ */}
        <SectionLabel>Recent activity</SectionLabel>
        <div className="mb-7 grid gap-3 md:grid-cols-2">
          <section className="rounded-card border border-border bg-depth-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
              <Play className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
              Pick up where you left off
            </h3>
            {!resumeChecked ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : resumeLesson ? (
              <button
                type="button"
                onClick={() => onOpenLesson(resumeLesson.id)}
                className="group flex w-full items-center gap-2.5 rounded-control border border-border px-3 py-2.5 text-left transition-colors duration-(--dur-fast) hover:border-foreground/40 hover:bg-muted"
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
                Nothing in progress yet — open a lesson from a class below to begin.
              </p>
            )}
            {recaps.length ? (
              <div className="mt-3 border-t border-border pt-2.5">
                <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Recent sessions
                </div>
                <ul className="flex flex-col gap-1.5">
                  {recaps.map((recap) => {
                    const line =
                      recap.summary?.covered || recap.summary?.wins || recap.summary?.note || "";
                    if (!line) return null;
                    return (
                      <li key={recap.id} className="hvp flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                          {line}
                        </span>
                        <span className="hvr shrink-0 text-meta text-muted-foreground">
                          {relativeTime(recap.created_at)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>

          <MemoryCard />
        </div>

        {/* ---- 2. Assignments, quizzes & grades ---------------------------------------- */}
        <SectionLabel>Assignments, quizzes &amp; grades</SectionLabel>
        <div className="mb-7 grid gap-3 md:grid-cols-2">
          <section className="rounded-card border border-border bg-depth-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
              Work due
              {due.length ? (
                <span className="text-meta tabular-nums text-muted-foreground">{due.length}</span>
              ) : null}
            </h3>
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

          <section className="rounded-card border border-border bg-depth-card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-body font-medium text-foreground">
              <GraduationCap
                className="h-[15px] w-[15px] text-muted-foreground"
                strokeWidth={1.6}
              />
              Recent grades
            </h3>
            {grades === null ? (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : recentGrades.length ? (
              <ul className="flex flex-col">
                {recentGrades.map((row) => (
                  <li
                    key={row.id}
                    className="hvp flex items-baseline gap-3 border-b border-border py-2 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {row.title}
                    </span>
                    <span className="hvr shrink-0 text-meta capitalize text-muted-foreground">
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

        {/* Classes live in the Home SIDEBAR now — each one opens its own summary page. */}
      </div>
    </section>
  );
}
