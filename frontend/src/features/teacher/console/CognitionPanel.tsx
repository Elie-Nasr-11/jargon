/**
 * The Thinking tab — the Independent Cognitive Production Profile (docs/COGNITION.md).
 *
 * The rubric's whole point rendered: never "63%". A teacher reads WHAT this student's
 * own thinking produced — eight dimensions at 0-4, how much tutor assistance sat under
 * each response (S0-S5), whether that assistance is falling (the §14 trajectory), and
 * a reading in sentences: what they understand, what they confuse, the one next move.
 *
 * R101: it shows; it does not ask. There is no button that judges — the sweep reads new
 * work every fifteen minutes and finishes a lesson's tail two hours after the student
 * leaves it. One read brings every judged response of this student as numbers and ids,
 * and every scope a teacher can pick (Everything, a class, a unit, a lesson) is a filter
 * over that one payload in the browser, so switching costs no request. The quotes that
 * ground a score stay on the per-lesson read, fetched only when a lesson is selected.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain } from "lucide-react";
// R93: one home for the dimension vocabulary — this panel and the class room view
// render the same eight names, and two copies of a label list drift.
import { DIMENSION_LABELS, PROBE_LABELS } from "@/features/teacher/cognition/labels";
import {
  attributionFallback,
  attributionSide,
  dimensionQuotes,
  signalsLine,
  traceableShareLabel,
} from "@/features/teacher/cognition/evidence";
import {
  ALL_SCOPE,
  dependencyPattern,
  lessonLines,
  movement,
  patternSentence,
  probeTally,
  resolveScope,
  rowsInScope,
  scopeKey,
  scopeOptions,
  scopeSentence,
  sittings,
  smoothed,
  sparklineLabel,
  summarize,
  truncationNote,
  type Movement,
  type SeriesKey,
} from "@/features/teacher/cognition/thinking";
import { EmptyInline, Panel } from "@/features/teacher/console/chrome";
import { formatDateTime } from "@/features/teacher/classShared";
import { countOf } from "@/lib/format";
import {
  fetchCognitionProfile,
  fetchStudentThinking,
  getSession,
  type CognitionProfile,
  type CognitionTurnScore,
  type ThinkingProbe,
  type ThinkingRow,
} from "@/lib/api";
import type {
  LearningSession,
  Lesson,
  TeacherClassMembership,
  TeacherClassSummary,
} from "@/lib/types";

const NO_ROWS: ThinkingRow[] = [];
const NO_LESSONS: CognitionProfile[] = [];
const NO_PROBES: ThinkingProbe[] = [];

const level = (value: number) => `${value} of 4`;

function DimensionRow({
  label,
  value,
  pending = false,
  series,
  moved,
}: {
  label: string;
  value: number | null;
  /** Nothing has been asked yet — different from "asked and scored nothing". */
  pending?: boolean;
  /** The line across their sittings, from thinking.ts — a null is a hole. */
  series?: Array<number | null>;
  moved?: Movement;
}) {
  const drawn = series?.some((point) => point !== null) ?? false;
  return (
    // R98's rule: a row with fixed-width children must be allowed to wrap, or the one
    // flexible child gives up its space. On a phone the line takes its own row.
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-40 shrink-0 text-meta text-muted-foreground">{label}</span>
      <span
        className="flex items-center gap-1"
        aria-label={`${label}: ${value !== null ? `${value} of 4` : pending ? "not checked yet" : "no evidence"}`}
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-2 w-6 rounded-full ${
              value !== null && value >= step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </span>
      <span className="w-14 text-meta font-medium text-foreground">
        {value !== null ? `${value}/4` : pending ? "Pending" : "—"}
      </span>
      {drawn && series ? (
        <span className="flex basis-full items-center gap-2 text-primary sm:ml-auto sm:basis-auto">
          <Sparkline
            values={series}
            max={4}
            label={sparklineLabel(label, moved ?? null, value, level)}
          />
          {moved ? (
            <span
              className={`font-mono text-[10px] ${
                moved.direction === "up"
                  ? "text-success"
                  : moved.direction === "down"
                    ? "text-warning"
                    : "text-muted-foreground"
              }`}
            >
              {moved.first} → {moved.now}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A line across their sittings, as one inline SVG. No chart library: R82 made the app
 * start fast and a chart package is most of a font's weight for eighty pixels.
 *
 * A run of consecutive points is one polyline; a run of one is a dot; a null is a hole
 * and never an interpolated slope. Colour comes from the parent — one hue, no gradient.
 */
function Sparkline({
  values,
  max,
  label,
}: {
  values: Array<number | null>;
  max: number;
  label: string;
}) {
  const n = values.length;
  const x = (index: number) => (n <= 1 ? 40 : 2 + (index * 76) / (n - 1));
  const y = (value: number) => 2 + (1 - Math.min(Math.max(value, 0), max) / max) * 12;
  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push([x(index), y(value)]);
  });
  if (run.length) runs.push(run);
  if (!runs.length) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 80 16"
      className="h-4 w-20 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {runs.map((points, index) =>
        points.length === 1 ? (
          <circle
            key={index}
            cx={points[0][0]}
            cy={points[0][1]}
            r={1.5}
            fill="currentColor"
            stroke="none"
          />
        ) : (
          <polyline
            key={index}
            points={points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}
          />
        ),
      )}
    </svg>
  );
}

/**
 * What the judge actually saw, for one response.
 *
 * Closed by default: a teacher reading top to bottom wants the sentence, and the
 * quotes are what they open when they doubt it — or when a parent asks how the system
 * knows. Everything here is quotes and counts. §15's rule that the model is never one
 * number holds one level down too: no score appears in this disclosure, and the
 * traceable share is words rather than a percentage.
 */
function ResponseEvidence({ turn }: { turn: CognitionTurnScore }) {
  const quotes = dimensionQuotes(
    turn.evidence,
    DIMENSION_LABELS.map(({ key }) => key),
  );
  const fromTutor = attributionSide(turn.evidence, "ai_supplied");
  const theirOwn = attributionSide(turn.evidence, "student_originated");
  const tutorFallback = attributionFallback(turn.evidence, "ai_supplied");
  const ownFallback = attributionFallback(turn.evidence, "student_originated");
  const line = signalsLine(turn.signals);
  const share = traceableShareLabel(turn.signals);

  if (
    !quotes.length &&
    !fromTutor.length &&
    !theirOwn.length &&
    !tutorFallback &&
    !ownFallback &&
    !line
  ) {
    return null;
  }

  const labelFor = (key: string) =>
    DIMENSION_LABELS.find((entry) => entry.key === key)?.label ?? key;

  return (
    <details className="mt-1.5 group">
      <summary className="cursor-pointer list-none text-meta text-muted-foreground transition-colors hover:text-foreground">
        Evidence
        {share ? <span className="ml-2 text-muted-foreground">· {share}</span> : null}
      </summary>
      <div className="mt-2 grid gap-2 border-l border-border pl-3">
        {quotes.length ? (
          <div className="grid gap-1">
            {quotes.map(({ dimension, quote }) => (
              <p key={dimension} className="text-meta text-muted-foreground">
                <span className="text-foreground">{labelFor(dimension)}</span> — “{quote}”
              </p>
            ))}
          </div>
        ) : null}

        {fromTutor.length || theirOwn.length || tutorFallback || ownFallback ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <AttributionColumn
              title="From the tutor"
              rows={fromTutor}
              fallback={tutorFallback}
              empty="Nothing was supplied before this."
            />
            <AttributionColumn
              title="Their own"
              rows={theirOwn}
              fallback={ownFallback}
              empty="Nothing new in this response."
            />
          </div>
        ) : null}

        {line ? <p className="font-mono text-[10px] text-muted-foreground">{line}</p> : null}
      </div>
    </details>
  );
}

function AttributionColumn({
  title,
  rows,
  fallback,
  empty,
}: {
  title: string;
  rows: ReturnType<typeof attributionSide>;
  /** Pre-R99 rows carry one free-text string instead of the five categories. */
  fallback: string;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </div>
      {rows.length ? (
        <ul className="mt-1 grid gap-0.5">
          {rows.map(({ category, label, quotes }) => (
            <li key={category} className="text-meta text-muted-foreground">
              <span className="text-foreground">{label}:</span> {quotes.join("; ")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-meta text-muted-foreground">{fallback || empty}</p>
      )}
    </div>
  );
}

export function CognitionPanel({
  studentId,
  sessions,
  lessonsById,
  classId,
  classes,
  memberships,
  classLinks,
}: {
  studentId: string;
  sessions: LearningSession[];
  lessonsById: Map<string, Lesson>;
  /** The class the teacher came from — listed first among the scopes. */
  classId: string | null;
  classes: TeacherClassSummary[];
  /** This student's memberships. */
  memberships: TeacherClassMembership[];
  /** Which courses each class links; undefined until the query resolves. */
  classLinks: Array<{ class_id: string; course_id: string }> | undefined;
}) {
  // One read per student. The tab is mounted with the student (WorkspacePanel
  // force-mounts), so this fires when they are opened and the tab itself is instant;
  // the dashboard's 30-second refetch never touches it.
  const thinking = useQuery({
    queryKey: ["studentThinking", studentId],
    queryFn: async () => {
      const session = await getSession();
      if (!session) throw new Error("Sign in again to read this.");
      return fetchStudentThinking({ accessToken: session.access_token, userId: studentId });
    },
    staleTime: 60_000,
  });
  const rows = thinking.data?.rows ?? NO_ROWS;
  const lessons = thinking.data?.lessons ?? NO_LESSONS;
  const probes = thinking.data?.probes ?? NO_PROBES;

  const [scope, setScope] = useState(ALL_SCOPE);
  useEffect(() => {
    setScope(ALL_SCOPE);
  }, [studentId]);

  const groups = useMemo(
    () =>
      scopeOptions({
        rows,
        lessonsById,
        classes,
        memberships,
        classLinks,
        currentClassId: classId,
      }),
    [rows, lessonsById, classes, memberships, classLinks, classId],
  );
  // A key that emptied or vanished lands on Everything rather than on a blank panel.
  const option = resolveScope(groups, scope);
  const scoped = useMemo(() => rowsInScope(rows, option), [rows, option]);
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const points = useMemo(() => sittings(scoped), [scoped]);
  const pattern = useMemo(() => dependencyPattern(scoped), [scoped]);
  const tally = useMemo(() => probeTally(probes, option), [probes, option]);
  const lines = useMemo(
    () => lessonLines(rows, option, lessonsById, lessons),
    [rows, option, lessonsById, lessons],
  );
  const lineFor = (key: SeriesKey) => smoothed(points, key);

  // Lesson scope only: the per-response list with its evidence — the one read that
  // carries quotes, fetched when a lesson is chosen and not before.
  const lessonId = option.kind === "lesson" ? option.id : null;
  const lessonRead = useQuery({
    queryKey: ["cognitionProfile", studentId, lessonId],
    queryFn: async () => {
      const session = await getSession();
      if (!session) throw new Error("Sign in again to read this.");
      return fetchCognitionProfile({
        accessToken: session.access_token,
        userId: studentId,
        lessonId: lessonId as string,
      });
    },
    enabled: Boolean(lessonId),
    staleTime: 60_000,
  });
  const turns: CognitionTurnScore[] = lessonRead.data?.turns ?? [];
  const storedLesson = lessonId
    ? (lessons.find((lesson) => lesson.lesson_id === lessonId) ?? null)
    : null;
  const reading = lessonId
    ? storedLesson?.narrative || lessonRead.data?.profile?.narrative || ""
    : scopeSentence(summary, option.kind === "all" ? null : option.label);
  const patternText = patternSentence(pattern);
  const note = truncationNote(Boolean(thinking.data?.truncated), rows.length);
  const lastRead = lessons.reduce(
    (latest, lesson) =>
      String(lesson.updated_at || "") > latest ? String(lesson.updated_at) : latest,
    "",
  );
  const error = thinking.error ? (thinking.error as Error).message || "Could not load." : "";
  const hasWork = sessions.length > 0 || rows.length > 0;
  const trendTone =
    summary.scaffold_trend === "falling"
      ? "text-success"
      : summary.scaffold_trend === "rising"
        ? "text-warning"
        : "text-muted-foreground";
  const scaffoldLine = lineFor("scaffold");

  return (
    <div className="mt-5 grid gap-4">
      <Panel title="How they think" icon={<Brain className="h-4 w-4" strokeWidth={1.6} />}>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <select
            value={option.key}
            onChange={(event) => setScope(event.target.value)}
            aria-label="Scope"
            className="jargon-input w-full sm:w-auto"
          >
            <option value={groups.all.key}>
              Everything · {countOf(groups.all.responses, "response")}
            </option>
            {groups.classes.length ? (
              <optgroup label="Classes">
                {groups.classes.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label} · {item.responses}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {groups.units.length ? (
              <optgroup label="Units">
                {groups.units.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label} · {item.responses}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {groups.lessons.length ? (
              <optgroup label="Lessons">
                {groups.lessons.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label} · {item.responses}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <span className="text-meta text-muted-foreground">
            Reads itself every fifteen minutes
            {lastRead ? <> · last read {formatDateTime(lastRead)}</> : <> · nothing read yet</>}
          </span>
        </div>

        {note ? <p className="mb-3 text-meta text-muted-foreground">{note}</p> : null}
        {error ? <p className="text-meta text-danger">{error}</p> : null}
        {thinking.isPending ? (
          <p className="text-meta text-muted-foreground">Reading their thinking…</p>
        ) : null}

        {!thinking.isPending && !hasWork ? (
          <EmptyInline
            title="No lesson work yet"
            body="Nothing to read until this student has worked in a lesson."
          />
        ) : !thinking.isPending && !error && rows.length === 0 ? (
          <EmptyInline
            title="Nothing read yet"
            body="Jargon reads new work on its own every fifteen minutes, and a lesson's last few responses two hours after the student leaves it."
          />
        ) : null}

        {rows.length ? (
          <div className="grid gap-4">
            {reading ? (
              // The rubric's deliverable: sentences a teacher acts on, not a number. A
              // lesson keeps the judge's own narrative; every other scope is built from
              // the numbers, so it is exact and never stale.
              <p className="rounded-card border border-primary/25 bg-primary/[0.04] px-4 py-3 font-serif text-body leading-relaxed text-foreground">
                {reading}
              </p>
            ) : null}

            {patternText ? (
              // §14 read across lessons: called only at three lessons and two concurring
              // signals, and it says which. A reading for the teacher — it steers nothing.
              <p className="rounded-card border border-warning/40 bg-warning/[0.06] px-4 py-3 text-body leading-relaxed text-foreground">
                {patternText}
              </p>
            ) : null}

            <div className="grid gap-1.5">
              {DIMENSION_LABELS.map(({ key, label }) => (
                <DimensionRow
                  key={key}
                  label={label}
                  value={summary.dims[key]}
                  series={lineFor(key)}
                  moved={movement(points, key)}
                />
              ))}
              {/* R100 (§10/§11): what a delayed unaided question found. Kept apart from
                  the eight by a hairline, because these come from a different KIND of
                  evidence — one question at the start of a later session, not the work
                  the lesson itself collected. "Pending" is the honest reading before one
                  has been asked; the rubric's own §15 example prints "Retention: Pending"
                  the same way. */}
              <div className="mt-1 border-t border-border pt-1.5">
                {PROBE_LABELS.map(({ key, label }) => (
                  <DimensionRow
                    key={key}
                    label={label}
                    value={summary[key]}
                    pending={summary.probes_answered === 0}
                    series={lineFor(key)}
                    moved={movement(points, key)}
                  />
                ))}
              </div>
              {points.length > 1 ? (
                <p className="text-meta text-muted-foreground">
                  Lines are by sitting — each point is one session, the running middle of the last
                  five.
                </p>
              ) : null}
            </div>

            <p className="text-meta text-muted-foreground">
              {countOf(summary.turns_scored, "response")} judged across{" "}
              {countOf(summary.lessons, "lesson")} in {countOf(summary.sittings, "sitting")}.{" "}
              {summary.unaided_count} of {summary.turns_scored} came with no help before them.
              {summary.scaffold_trend &&
              summary.scaffold_earlier !== null &&
              summary.scaffold_recent !== null ? (
                <>
                  {" "}
                  Tutor assistance under them:{" "}
                  <span className="font-medium text-foreground">
                    S{summary.scaffold_earlier} → S{summary.scaffold_recent}
                  </span>{" "}
                  <span className={trendTone}>
                    ({summary.scaffold_trend}
                    {summary.scaffold_trend === "falling" ? " — the direction you want" : ""})
                  </span>
                  {scaffoldLine.some((point) => point !== null) ? (
                    <span className="ml-2 inline-flex align-middle text-muted-foreground">
                      <Sparkline
                        values={scaffoldLine}
                        max={5}
                        label={sparklineLabel(
                          "Tutor assistance",
                          movement(points, "scaffold"),
                          summary.scaffold_recent,
                          (value) => `S${value}`,
                        )}
                      />
                    </span>
                  ) : null}
                </>
              ) : null}
              {tally.asked ? (
                <>
                  {" "}
                  Delayed checks: {tally.asked} asked · {tally.answered} answered · {tally.skipped}{" "}
                  skipped{tally.waiting ? ` · ${tally.waiting} waiting` : ""}.
                </>
              ) : null}
            </p>

            {!lessonId && lines.length ? (
              <div className="grid gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Lessons in this scope
                </div>
                {lines.map((item) => (
                  <button
                    key={item.lesson_id}
                    type="button"
                    onClick={() => setScope(scopeKey("lesson", item.lesson_id))}
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-depth-sub px-3 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 text-meta text-foreground">
                      {item.title}
                      {item.unit_title ? (
                        <span className="text-muted-foreground"> · {item.unit_title}</span>
                      ) : null}
                    </span>
                    <span className="text-meta text-muted-foreground">
                      {countOf(item.responses, "response")}
                      {item.scaffold_recent !== null ? ` · S${item.scaffold_recent}` : ""}
                      {item.last_read ? ` · ${formatDateTime(item.last_read)}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {lessonId && lessonRead.isPending ? (
              <p className="text-meta text-muted-foreground">Reading the responses…</p>
            ) : null}
            {lessonId && turns.length ? (
              <div className="grid gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Response by response
                </div>
                {turns.slice(0, 12).map((turn) => (
                  <div
                    key={turn.id}
                    className="flex items-start gap-2.5 rounded-card border border-border bg-depth-sub px-3 py-2"
                  >
                    <span
                      title={`Assistance immediately before this response: S${turn.scaffold_level}`}
                      className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${
                        turn.scaffold_level >= 4
                          ? "border-warning/40 text-warning"
                          : turn.scaffold_level >= 2
                            ? "border-border text-muted-foreground"
                            : "border-success/40 text-success"
                      }`}
                    >
                      S{turn.scaffold_level}
                    </span>
                    <span className="min-w-0 flex-1 text-meta leading-relaxed text-foreground">
                      {turn.note || "Judged — no note."}
                      <span className="ml-2 text-muted-foreground">
                        {formatDateTime(turn.created_at)}
                      </span>
                      <ResponseEvidence turn={turn} />
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
