import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ArrowRight, BookOpen, Brain, GraduationCap, Loader2, Play } from "lucide-react";
import { BrainGraph } from "@/student/BrainGraph";
import {
  fetchIdeaMastery,
  fetchCurriculumLinks,
  fetchIdeas,
  fetchMostRecentLearningSession,
  fetchMyJargon,
  fetchStudentLinks,
  fetchProfile,
  fetchSessionSummaries,
  fetchStudentGrades,
  fetchStudentMemory,
  fetchVocabTerms,
  getSession,
  resetStudentMemory,
} from "@/lib/api";
import { formatScore, relativeTime } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { masteryBands, type IdeaMasteryRow } from "@/lib/mastery";
import { assignmentRows, checkpointRows, type CheckpointRowModel } from "@/student/checkpoints";
import { SectionLabel, StatPill, WorkRow } from "@/student/summaryBits";
import type {
  CurriculumLinkRow,
  IdeaNode,
  Lesson,
  MyJargonWord,
  StudentLinkRow,
  SessionSummary,
  StudentAssessmentBundle,
  StudentAssignmentBundle,
  StudentGradeRow,
  VocabTerm,
  StudentMemory,
  StudentMemoryProfile,
} from "@/lib/types";

// Home, in three deliberate tiers (top to bottom = most to least likely next act):
//   1. RECENT ACTIVITY — resume the last lesson + the last few session recaps (full width).
//   2. ASSIGNMENTS, QUIZZES & GRADES — work due and the recent-grades strip.
//   3. WHAT YOUR MENTOR REMEMBERS — the memory card + brain map, full width at the bottom
//      (the showpiece gets the room; classes live in the sidebar).
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
  // R48: the assignment bundle joins the due strip; rows dispatch on kind in the shell.
  assignments?: StudentAssignmentBundle | null;
  onOpenWork: (row: CheckpointRowModel) => void;
  // The shell's class list length (null while loading) — the identity band's CLASSES pill.
  classCount: number | null;
  // The shell's progress map + current lesson — the brain map's node colors and aurora.
  progress: Record<string, number>;
  currentLessonId: string | null;
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
            className="rounded-pill border border-border px-2 py-0.5 text-meta text-foreground"
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

// "My Jargon" — Wael's name for the student's collected vocabulary (workspace task,
// Aug 9). Every word the mentor has introduced (student_vocab) in one place: the term,
// its child-readable definition, its home subject, and a bridge marker once the word
// has traveled into a second subject. Self-fetching like MemoryCard; an empty state
// that tells a new student what will grow here.
function MyJargonCard({
  words,
  highlightTerm,
}: {
  // R36: Home owns the fetch now (the night sky reads the same rows), and a clicked
  // word star scrolls here with its term flashing so the jump lands somewhere obvious.
  words: MyJargonWord[] | null;
  highlightTerm?: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  // A highlighted word must be visible even if it sits past the fold of the trimmed
  // list — expand first, then scroll ITS ROW to center (R39: the anchor scroll alone
  // left the word below the fold, so "nothing highlighted").
  useEffect(() => {
    if (!highlightTerm || !words) return;
    const index = words.findIndex((w) => w.term === highlightTerm);
    if (index >= 12) setShowAll(true);
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-jargon-term=${JSON.stringify(highlightTerm)}]`)
        ?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [highlightTerm, words]);

  const visible = words ? (showAll ? words : words.slice(0, 12)) : [];
  // Grouped by subject (tester: "maybe it should be split by topic"). Subjects appear in
  // the order their newest word does, so the topic you just studied sits at the top; a
  // word whose subject is blank collects under "Other" rather than a nameless heading.
  const groups: { subject: string; words: MyJargonWord[] }[] = [];
  for (const word of visible) {
    const subject = word.subject || "Other";
    const group = groups.find((entry) => entry.subject === subject);
    if (group) group.words.push(word);
    else groups.push({ subject, words: [word] });
  }
  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card">
      <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
        <BookOpen className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
        My Jargon
        {words?.length ? (
          <span className="font-mono text-overline uppercase tracking-[0.1em] text-muted-foreground">
            {words.length} word{words.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </h3>
      {words === null ? (
        <p className="flex items-center gap-2 text-meta text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : words.length ? (
        <>
          {groups.map((group) => (
            <div key={group.subject} className="mb-2.5 last:mb-0">
              <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {group.subject}
              </div>
              <ul className="flex flex-col">
                {group.words.map((word) => (
                  <li
                    key={word.term}
                    data-jargon-term={word.term}
                    className={`hvp flex items-baseline gap-3 border-b border-border py-1.5 transition-all duration-500 last:border-0 ${
                      highlightTerm === word.term ? "rounded-control px-2 ring-1 ring-inset" : ""
                    }`}
                    style={
                      highlightTerm === word.term
                        ? {
                            background: "color-mix(in oklab, var(--accent-text) 14%, transparent)",
                            ["--tw-ring-color" as string]:
                              "color-mix(in oklab, var(--accent-text) 45%, transparent)",
                          }
                        : undefined
                    }
                  >
                    <span className="shrink-0 text-body font-semibold text-foreground">
                      {word.term}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                      {word.definition}
                    </span>
                    {word.traveled ? (
                      <span className="hvr shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                        bridges subjects
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {words.length > 12 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
            >
              {showAll ? "Show fewer" : `Show all ${words.length}`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-body text-muted-foreground">
          Every new word your mentor teaches you collects here — your own jargon, one lesson at a
          time.
        </p>
      )}
    </section>
  );
}

function MemoryCard({ onAfterReset }: { onAfterReset?: () => void }) {
  const [memory, setMemory] = useState<StudentMemory | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Reset ladder: idle → confirm (inline, no modal) → busy → back to the empty state.
  const [resetState, setResetState] = useState<"idle" | "confirm" | "busy">("idle");
  const cardRef = useRef<HTMLElement>(null);

  const runReset = () => {
    setResetState("busy");
    void resetStudentMemory()
      .then(() => {
        setMemory(null);
        onAfterReset?.();
      })
      .catch(() => {
        // A failed reset leaves the memory as-is; the card simply returns to idle.
      })
      .finally(() => setResetState("idle"));
  };

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
  const empty =
    !profile?.narrative &&
    !profile?.strengths?.length &&
    !profile?.struggles?.length &&
    !profile?.notes?.length &&
    !profile?.avoid?.length;

  return (
    <section
      ref={cardRef}
      className="hvp rounded-card border border-border bg-depth-card p-4 shadow-card"
      aria-label="What your mentor remembers"
    >
      <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
        <Brain className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
        <span className="min-w-0 flex-1">What your mentor remembers</span>
        {/* Memory is the student's: one hover-revealed control erases all of it (profile +
            recaps) under their own JWT. Two-step inline — no modal for a reversible-by-
            forgetting act. */}
        {!empty && resetState === "idle" ? (
          <button
            type="button"
            onClick={() => setResetState("confirm")}
            className="hvr shrink-0 rounded-control px-2 py-0.5 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
          >
            Reset
          </button>
        ) : null}
      </h3>
      {resetState !== "idle" ? (
        <div className="mb-2 flex items-center gap-2 rounded-control border border-border bg-depth-sub px-2.5 py-2">
          <span className="min-w-0 flex-1 text-meta text-foreground">
            Forget everything your mentor remembers?
          </span>
          <button
            type="button"
            disabled={resetState === "busy"}
            onClick={runReset}
            className="shrink-0 rounded-control px-2 py-1 text-meta font-semibold transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-50"
            style={{ color: "var(--danger)" }}
          >
            {resetState === "busy" ? "Forgetting…" : "Reset"}
          </button>
          <button
            type="button"
            disabled={resetState === "busy"}
            onClick={() => setResetState("idle")}
            className="shrink-0 rounded-control px-2 py-1 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Keep
          </button>
        </div>
      ) : null}
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
          <Chips label="Notes" values={profile?.notes ?? []} />
          <Chips label="Steering around" values={profile?.avoid ?? []} />
        </>
      )}
    </section>
  );
}

export function StudentHome({
  lessons,
  onOpenLesson,
  assessments,
  onOpenWork,
  assignments = null,
  classCount,
  progress,
  currentLessonId,
}: StudentHomeProps) {
  const [name, setName] = useState("");
  const [resumeLessonId, setResumeLessonId] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);
  // Learning framework (F4): the knowledge layer for the brain map — best-effort reads,
  // an empty graph just renders the familiar galaxy.
  const [ideas, setIdeas] = useState<IdeaNode[]>([]);
  const [ideaMastery, setIdeaMastery] = useState<IdeaMasteryRow[]>([]);
  const [studentLinks, setStudentLinks] = useState<StudentLinkRow[]>([]);
  const [curriculumLinks, setCurriculumLinks] = useState<CurriculumLinkRow[]>([]);
  // R36 (night sky): the word plane needs the student's collected words plus the
  // published vocabulary they haven't met yet — Home now owns both and hands them to
  // the sky AND to My Jargon, so one fetch feeds both surfaces.
  const [jargonWords, setJargonWords] = useState<MyJargonWord[] | null>(null);
  const [vocabTerms, setVocabTerms] = useState<VocabTerm[]>([]);
  // R38: the graph waits for its WHOLE data bundle. Mounting it per-fetch made the
  // layout re-settle on every arrival — the reported load-time snapping.
  const [brainReady, setBrainReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const settle = Promise.allSettled([
      fetchIdeas().then((rows) => !cancelled && setIdeas(rows)),
      fetchIdeaMastery().then((rows) => !cancelled && setIdeaMastery(rows)),
      fetchStudentLinks().then((rows) => !cancelled && setStudentLinks(rows)),
      fetchCurriculumLinks().then((rows) => !cancelled && setCurriculumLinks(rows)),
      fetchMyJargon()
        .then((rows) => !cancelled && setJargonWords(rows))
        .catch(() => !cancelled && setJargonWords([])),
      fetchVocabTerms().then((rows) => !cancelled && setVocabTerms(rows)),
    ]);
    void settle.then(() => !cancelled && setBrainReady(true));
    return () => {
      cancelled = true;
    };
  }, []);
  // R40 (whole-page jank + "camera resets by itself"): masteryBands() built a FRESH
  // Map on every Home render, so any unrelated update invalidated the graph's memo —
  // tearing the scene down, re-running the synchronous physics settle on the main
  // thread, and re-fitting the camera. One memo kills the whole class of churn.
  const bands = useMemo(() => masteryBands(ideaMastery), [ideaMastery]);
  // Word-star click → scroll My Jargon into view with that chip flashing.
  const jargonAnchorRef = useRef<HTMLDivElement>(null);
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const openWord = (term: string) => {
    setHighlightTerm(term);
    jargonAnchorRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
    window.setTimeout(() => setHighlightTerm(null), 2600);
  };
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
    // One read feeds two things: the recap strip (first 4) and the brain map's memory
    // glows (every lesson a summary references).
    void fetchSessionSummaries(40)
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
    return [
      ...checkpointRows(assessments),
      ...(assignments ? assignmentRows(assignments) : []),
    ].filter((row) => row.state === "todo" || row.state === "in_progress");
  }, [assessments, assignments]);

  const recentGrades = useMemo(
    () =>
      (grades ?? [])
        .filter((row) => row.score !== null)
        .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""))
        .slice(0, 5),
    [grades],
  );

  const released = useMemo(() => (grades ?? []).filter((row) => row.score !== null), [grades]);
  const average = released.length
    ? released.reduce((sum, row) => sum + (row.score ?? 0), 0) / released.length
    : null;

  // Every lesson the mentor's session summaries reference — the brain map's memory glows.
  const memoryLessonIds = useMemo(
    () =>
      new Set(
        recaps
          .map((recap) => recap.lesson_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    [recaps],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl">
        {/* ---- Identity band: the serif greeting stays personal; the stat cluster mirrors
             the class pages (mono counters, orange only when something is actionable). ---- */}
        <header className="mb-7 flex flex-wrap items-center gap-4">
          <h1 className="min-w-0 flex-1 truncate font-serif text-[26px] tracking-tight text-foreground">
            {greetingForHour(new Date().getHours())}
            {name ? `, ${name}` : ""}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {classCount !== null ? (
              <StatPill ariaLabel={`${classCount} classes`}>
                {classCount} {classCount === 1 ? "CLASS" : "CLASSES"}
              </StatPill>
            ) : null}
            {due.length ? <StatPill filled>{due.length} due</StatPill> : null}
            {average !== null ? (
              <StatPill ariaLabel="Average released grade">AVG {formatScore(average)}</StatPill>
            ) : null}
          </div>
        </header>

        {/* ---- 1. Recent activity (full width) ----------------------------------------- */}
        <SectionLabel>Recent activity</SectionLabel>
        <div className="mb-7">
          <section className="rounded-card border border-border bg-depth-card p-4 shadow-card">
            <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
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
                className="hvp flex w-full items-center gap-2.5 rounded-control border border-border px-3 py-2.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-foreground">
                    {resumeLesson.title}
                  </span>
                  {resumeLesson.unit_title ? (
                    <span className="block truncate text-meta text-muted-foreground">
                      {resumeLesson.unit_title}
                    </span>
                  ) : null}
                </span>
                <ArrowRight
                  className="hvr h-4 w-4 shrink-0 text-muted-foreground"
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
                  {recaps.slice(0, 4).map((recap) => {
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
        </div>

        {/* ---- 2. Assignments, quizzes & grades ---------------------------------------- */}
        <SectionLabel>Assignments, quizzes &amp; grades</SectionLabel>
        <div className="mb-7 grid gap-3 md:grid-cols-2">
          <section className="rounded-card border border-border bg-depth-card p-4 shadow-card">
            <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
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
                  <WorkRow key={row.id} row={row} onOpen={onOpenWork} />
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">Nothing due right now.</p>
            )}
          </section>

          <section className="rounded-card border border-border bg-depth-card p-4 shadow-card">
            <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-foreground">
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
                    className="hvp flex items-baseline gap-3 border-b border-border py-1.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {row.title}
                    </span>
                    <span className="hvr shrink-0 text-meta capitalize text-muted-foreground">
                      {row.kind}
                    </span>
                    <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-foreground">
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

        {/* ---- 3. The knowledge map — the hero, with ONE slim header row (R37:
             "too much information over the constellation window"). Mastery stats ride
             the label line; everything narrative moved below the map. ---------------- */}
        <div className="mb-7">
          {(() => {
            const total = bands.solid + bands.growing + bands.refresh;
            return (
              <div className="mb-2 flex items-baseline gap-3">
                <SectionLabel>Your brain</SectionLabel>
                <span className="flex-1" />
                {total > 0 ? (
                  <span className="flex items-center gap-3 font-mono text-overline uppercase tracking-[0.14em] text-muted-foreground">
                    <span style={{ color: "var(--mode-practice)" }}>{bands.solid} solid</span>
                    <span>{bands.growing} growing</span>
                    <span style={{ color: "var(--mode-discuss)" }}>{bands.refresh} to refresh</span>
                  </span>
                ) : null}
              </div>
            );
          })()}
          {brainReady ? (
            <BrainGraph
              lessons={lessons}
              words={jargonWords ?? []}
              vocabTerms={vocabTerms}
              ideas={ideas}
              studentLinks={studentLinks}
              progress={progress}
              currentLessonId={currentLessonId}
              mastery={bands.byKey}
              onOpenLesson={onOpenLesson}
              onOpenWord={openWord}
            />
          ) : (
            <div
              aria-hidden
              className="h-[420px] w-full animate-pulse rounded-card border border-border bg-muted/40"
            />
          )}
        </div>

        {/* ---- 4. What your mentor remembers — compact, below the map ---------------- */}
        <div className="mb-7">
          <MemoryCard onAfterReset={() => setRecaps([])} />
        </div>

        {/* ---- 5. My Jargon — the words this student has collected ---------------------- */}
        <div className="mb-7 scroll-mt-4" ref={jargonAnchorRef}>
          <MyJargonCard words={jargonWords} highlightTerm={highlightTerm} />
        </div>

        {/* Classes live in the Home SIDEBAR now — each one opens its own summary page. */}
      </div>
    </section>
  );
}
