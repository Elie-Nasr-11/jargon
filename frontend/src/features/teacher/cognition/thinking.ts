/**
 * The Thinking tab's derivations — pure functions over the one payload the server returns.
 *
 * R101. The server hands the browser every judged response of one student as numbers and
 * ids (never a quote), the per-lesson profiles, and the delayed questions asked. This
 * file turns that into what a teacher reads: which scopes exist (Everything, a class, a
 * unit, a lesson), the statistics of the scope they picked, the line each dimension has
 * drawn across their sittings, the §14 pattern worth watching, and the one paragraph at
 * the top — built from the numbers, never by a model.
 *
 * Every scope is a filter over the same rows, so switching scope costs no request. And
 * nothing here produces a percentage or a single composite number: a share is a count
 * beside its denominator, and a level is a median a teacher can trace back to responses.
 *
 * The four thresholds below mirror the scorer's. The two files cannot import each other
 * (an edge function and a browser bundle), so tests/test_r101_thinking_view.py reads both
 * and fails on drift — the same pin R93 and R100 use between chat and the scorer.
 */
import {
  DIMENSION_LABEL,
  DIMENSION_LABELS,
  type DimensionKey,
} from "@/features/teacher/cognition/labels";
import { countOf, formatDate } from "@/lib/format";
import type { CognitionProfile, ThinkingProbe, ThinkingRow } from "@/lib/api";
import type { Lesson, TeacherClassMembership, TeacherClassSummary } from "@/lib/types";

// §14: a response at S0-S1 came with no help before it; S3+ came carried.
export const UNAIDED_AT_OR_BELOW = 1;
export const SUPPORTED_AT_OR_ABOVE = 3;
// §19: the mentor's own floor and ceiling for a dimension.
export const WEAK_AT_OR_BELOW = 2;
export const PROFICIENT_AT_OR_ABOVE = 3;
// The two delayed dimensions arrive once a day at most; buildProfile's window is five.
export const PROBE_WINDOW = 5;
// The line is the running middle of this many sittings, so one bad afternoon is a dip
// rather than a spike.
export const SMOOTH_WINDOW = 5;
// "first → now" compares the earlier half of their sittings with the later half; under
// four evidenced sittings each half would be a single point and the arrow would be noise.
export const MOVEMENT_MIN_SITTINGS = 4;
// §16: no pattern is called under three lessons, and never on a single signal.
export const PATTERN_MIN_LESSONS = 3;
export const PATTERN_MIN_SIGNALS = 2;
// Half a rung of help, and fifteen points of the unaided share: "rising" and "falling"
// have to clear the noise of a few responses.
export const PATTERN_SCAFFOLD_MARGIN = 0.5;
export const PATTERN_SHARE_MARGIN = 0.15;

export const ALL_SCOPE = "all";
export type ScopeKind = "all" | "class" | "unit" | "lesson";

export type ScopeOption = {
  /** "all" | "class:<id>" | "unit:<id>" | "lesson:<id>" — the select's value. */
  key: string;
  kind: ScopeKind;
  id: string | null;
  label: string;
  responses: number;
  /** null = every lesson: Everything, or a class with no course links (the platform rule). */
  lessonIds: string[] | null;
};

export type ScopeGroups = {
  all: ScopeOption;
  classes: ScopeOption[];
  units: ScopeOption[];
  lessons: ScopeOption[];
};

export type Dims = Record<DimensionKey, number | null>;

const DIMS: DimensionKey[] = DIMENSION_LABELS.map((entry) => entry.key);

export function scopeKey(kind: ScopeKind, id: string | null): string {
  return kind === "all" || !id ? ALL_SCOPE : `${kind}:${id}`;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * The scorer's median, exactly: for an even count the two middle values are averaged
 * and ROUNDED, because a dimension is an integer 0-4 and lesson scope must read the same
 * number the stored profile holds. Scaffold means are not integers; they use `midpoint`.
 */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function midpoint(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function present(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function byCreated(a: ThinkingRow, b: ThinkingRow): number {
  const t = String(a.created_at || "").localeCompare(String(b.created_at || ""));
  return t !== 0 ? t : String(a.id || "").localeCompare(String(b.id || ""));
}

/** Oldest first, ties by id — one INSERT batch shares a timestamp. Every derivation sorts. */
export function chronological(rows: ThinkingRow[]): ThinkingRow[] {
  return [...rows].sort(byCreated);
}

function emptyDims(): Dims {
  const dims = {} as Dims;
  for (const dim of DIMS) dims[dim] = null;
  return dims;
}

function dimsOf(rows: ThinkingRow[]): Dims {
  const dims = emptyDims();
  for (const dim of DIMS) dims[dim] = median(present(rows.map((row) => numOrNull(row[dim]))));
  return dims;
}

function scaffoldOf(row: ThinkingRow): number | null {
  return numOrNull(row.scaffold_level);
}

function responsesByLesson(rows: ThinkingRow[]): Map<string, ThinkingRow[]> {
  const map = new Map<string, ThinkingRow[]>();
  for (const row of rows) {
    const list = map.get(row.lesson_id) ?? [];
    list.push(row);
    map.set(row.lesson_id, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * Which scopes this student's work admits. Every option carries its response count and
 * an option with nothing in it is never offered — a control that cannot change what is
 * shown should not exist.
 *
 * Classes: the student's active memberships among the teacher's own classes, the class
 * the teacher came from first. A lesson belongs to a class when its course is one the
 * class links — the STRICT rule the class room uses (cognition-scorer's classView), so
 * "this class" here agrees with the room the teacher just left. A class with no links
 * scopes to everything, which is the platform rule. While the links are still loading
 * (`undefined`) no Classes group is offered at all: a wrong scope for a moment is worse
 * than a missing one.
 *
 * Units come from the lessons' own unit ids, in course order; lessons most recent first.
 */
export function scopeOptions(input: {
  rows: ThinkingRow[];
  lessonsById: Map<string, Lesson>;
  classes: TeacherClassSummary[];
  /** This student's memberships (any class); filtered here to active student rows. */
  memberships: TeacherClassMembership[];
  classLinks: Array<{ class_id: string; course_id: string }> | undefined;
  currentClassId: string | null;
}): ScopeGroups {
  const rows = chronological(input.rows);
  const perLesson = responsesByLesson(rows);
  const all: ScopeOption = {
    key: ALL_SCOPE,
    kind: "all",
    id: null,
    label: "Everything",
    responses: rows.length,
    lessonIds: null,
  };

  const classes: ScopeOption[] = [];
  if (input.classLinks !== undefined) {
    const links = input.classLinks;
    const mine = new Map(input.classes.map((cls) => [cls.id, cls]));
    const memberOf = new Set(
      input.memberships
        .filter((m) => m.role === "student" && m.status === "active")
        .map((m) => m.class_id),
    );
    const candidates = Array.from(memberOf)
      .map((id) => mine.get(id))
      .filter((cls): cls is TeacherClassSummary => Boolean(cls))
      .sort((a, b) => {
        if (a.id === input.currentClassId) return -1;
        if (b.id === input.currentClassId) return 1;
        return a.name.localeCompare(b.name);
      });
    for (const cls of candidates) {
      const courses = new Set(
        links.filter((link) => link.class_id === cls.id).map((link) => link.course_id),
      );
      let lessonIds: string[] | null = null;
      let responses = rows.length;
      if (courses.size) {
        lessonIds = Array.from(perLesson.keys()).filter((lessonId) => {
          const course = input.lessonsById.get(lessonId)?.course_id;
          return Boolean(course) && courses.has(course as string);
        });
        responses = lessonIds.reduce((sum, id) => sum + (perLesson.get(id)?.length ?? 0), 0);
      }
      if (responses === 0) continue;
      classes.push({
        key: scopeKey("class", cls.id),
        kind: "class",
        id: cls.id,
        label: cls.name,
        responses,
        lessonIds,
      });
    }
  }

  const unitMap = new Map<
    string,
    { title: string; position: number; lessonIds: string[]; responses: number }
  >();
  for (const [lessonId, list] of perLesson) {
    const lesson = input.lessonsById.get(lessonId);
    if (!lesson?.unit_id) continue;
    const entry = unitMap.get(lesson.unit_id) ?? {
      title: lesson.unit_title || "Unit",
      position: Number.POSITIVE_INFINITY,
      lessonIds: [],
      responses: 0,
    };
    const position = numOrNull(lesson.position);
    if (position !== null) entry.position = Math.min(entry.position, position);
    entry.lessonIds.push(lessonId);
    entry.responses += list.length;
    unitMap.set(lesson.unit_id, entry);
  }
  const units: ScopeOption[] = Array.from(unitMap.entries())
    .sort((a, b) => a[1].position - b[1].position || a[1].title.localeCompare(b[1].title))
    .map(([id, entry]) => ({
      key: scopeKey("unit", id),
      kind: "unit",
      id,
      label: entry.title,
      responses: entry.responses,
      lessonIds: entry.lessonIds,
    }));

  const lastAt = (list: ThinkingRow[]) => String(list[list.length - 1]?.created_at || "");
  const lessons: ScopeOption[] = Array.from(perLesson.entries())
    .sort((a, b) => lastAt(b[1]).localeCompare(lastAt(a[1])))
    .map(([id, list]) => ({
      key: scopeKey("lesson", id),
      kind: "lesson",
      id,
      label: input.lessonsById.get(id)?.title || id,
      responses: list.length,
      lessonIds: [id],
    }));

  return { all, classes, units, lessons };
}

/** A key that no longer exists (a scope that emptied, a class dropped) lands on Everything. */
export function resolveScope(groups: ScopeGroups, key: string): ScopeOption {
  return (
    [groups.all, ...groups.classes, ...groups.units, ...groups.lessons].find(
      (option) => option.key === key,
    ) ?? groups.all
  );
}

export function rowsInScope(rows: ThinkingRow[], option: ScopeOption): ThinkingRow[] {
  const sorted = chronological(rows);
  if (option.lessonIds === null) return sorted;
  const set = new Set(option.lessonIds);
  return sorted.filter((row) => set.has(row.lesson_id));
}

// ---------------------------------------------------------------------------
// The scope's statistics
// ---------------------------------------------------------------------------

export type ScopeSummary = {
  turns_scored: number;
  lessons: number;
  sittings: number;
  dims: Dims;
  retention: number | null;
  transfer: number | null;
  probes_answered: number;
  unaided_count: number;
  supported_count: number;
  share_unaided: number | null;
  split: { independent: Dims; supported: Dims };
  scaffold_earlier: number | null;
  scaffold_recent: number | null;
  scaffold_trend: "falling" | "rising" | "steady" | null;
  first_at: string | null;
  last_at: string | null;
};

/**
 * The eight dimensions as the median over EVERY response in the scope.
 *
 * Deliberately not buildProfile's last-ten: that statistic feeds §19, which must react to
 * now, so it windows. A scope is the teacher's question "how has this student done across
 * this unit / this class", and a last-ten window would make Everything equal to the most
 * recent lesson. Recency lives in the line and in "first → now" instead. The two delayed
 * dimensions keep buildProfile's five-deep window so lesson scope agrees with the stored
 * profile. Scaffold earlier/recent use buildProfile's halves rule verbatim.
 *
 * An empty scope is counts of zero and NULL everywhere else — never a zero that could be
 * read as "scored nothing".
 */
export function summarize(rows: ThinkingRow[]): ScopeSummary {
  const sorted = chronological(rows);
  const dims = dimsOf(sorted);

  const probeMedian = (key: "retention" | "transfer") =>
    median(present(sorted.map((row) => numOrNull(row[key]))).slice(-PROBE_WINDOW));
  const probes_answered = sorted.filter(
    (row) => numOrNull(row.retention) !== null || numOrNull(row.transfer) !== null,
  ).length;

  const scaffolds = present(sorted.map(scaffoldOf));
  let scaffold_earlier: number | null = null;
  let scaffold_recent: number | null = null;
  if (scaffolds.length >= 2) {
    const half = Math.floor(scaffolds.length / 2);
    scaffold_earlier = round2(mean(scaffolds.slice(0, half)) as number);
    scaffold_recent = round2(mean(scaffolds.slice(half)) as number);
  } else if (scaffolds.length === 1) {
    scaffold_recent = scaffolds[0];
  }
  const scaffold_trend =
    scaffold_earlier !== null && scaffold_recent !== null
      ? scaffold_recent < scaffold_earlier
        ? "falling"
        : scaffold_recent > scaffold_earlier
          ? "rising"
          : "steady"
      : null;

  const unaided = sorted.filter((row) => {
    const level = scaffoldOf(row);
    return level !== null && level <= UNAIDED_AT_OR_BELOW;
  });
  const supported = sorted.filter((row) => {
    const level = scaffoldOf(row);
    return level !== null && level >= SUPPORTED_AT_OR_ABOVE;
  });

  return {
    turns_scored: sorted.length,
    lessons: new Set(sorted.map((row) => row.lesson_id)).size,
    sittings: new Set(sorted.map((row) => row.session_id)).size,
    dims,
    retention: probeMedian("retention"),
    transfer: probeMedian("transfer"),
    probes_answered,
    unaided_count: unaided.length,
    supported_count: supported.length,
    share_unaided: sorted.length ? round2(unaided.length / sorted.length) : null,
    split: { independent: dimsOf(unaided), supported: dimsOf(supported) },
    scaffold_earlier,
    scaffold_recent,
    scaffold_trend,
    first_at: sorted[0]?.created_at ?? null,
    last_at: sorted[sorted.length - 1]?.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Over time: one sitting is one point
// ---------------------------------------------------------------------------

export type Sitting = {
  session_id: string;
  lesson_id: string;
  at: string;
  n: number;
  dims: Dims;
  retention: number | null;
  transfer: number | null;
  scaffold: number | null;
};

export type SeriesKey = DimensionKey | "retention" | "transfer" | "scaffold";

/**
 * One point per session, in the order the sittings happened. A sitting keys on the
 * session id, which is exact; only the ORDER of sittings uses the time the judge read
 * the work, which trails the work itself by up to fifteen minutes (the sweep) or two
 * hours (a lesson's tail).
 */
export function sittings(rows: ThinkingRow[]): Sitting[] {
  const sorted = chronological(rows);
  const groups = new Map<string, ThinkingRow[]>();
  for (const row of sorted) {
    const list = groups.get(row.session_id) ?? [];
    list.push(row);
    groups.set(row.session_id, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => {
      const t = String(a[1][0].created_at || "").localeCompare(String(b[1][0].created_at || ""));
      return t !== 0 ? t : a[0].localeCompare(b[0]);
    })
    .map(([session_id, list]) => {
      const scaffolds = present(list.map(scaffoldOf));
      return {
        session_id,
        lesson_id: list[0].lesson_id,
        at: list[0].created_at,
        n: list.length,
        dims: dimsOf(list),
        retention: median(present(list.map((row) => numOrNull(row.retention)))),
        transfer: median(present(list.map((row) => numOrNull(row.transfer)))),
        scaffold: scaffolds.length ? round2(mean(scaffolds) as number) : null,
      };
    });
}

function valueOf(point: Sitting, key: SeriesKey): number | null {
  if (key === "scaffold") return point.scaffold;
  if (key === "retention") return point.retention;
  if (key === "transfer") return point.transfer;
  return point.dims[key];
}

function middle(values: number[], key: SeriesKey): number | null {
  return key === "scaffold" ? midpoint(values) : median(values);
}

/**
 * The line: for each sitting, the middle of the last `window` sittings that have a value
 * for this key. A sitting with no value is a hole — null, never a value invented from
 * silence — and the drawing breaks the line there.
 */
export function smoothed(
  points: Sitting[],
  key: SeriesKey,
  window = SMOOTH_WINDOW,
): Array<number | null> {
  const out: Array<number | null> = [];
  const recent: number[] = [];
  for (const point of points) {
    const value = valueOf(point, key);
    if (value === null) {
      out.push(null);
      continue;
    }
    recent.push(value);
    if (recent.length > window) recent.shift();
    out.push(middle(recent, key));
  }
  return out;
}

export type Movement = {
  first: number;
  now: number;
  direction: "up" | "down" | "flat";
  sittings: number;
} | null;

/**
 * "first → now": the middle of the earlier half of their evidenced sittings against the
 * middle of the later half — the same halves rule the scaffold trend uses. Null under
 * MOVEMENT_MIN_SITTINGS, so one sitting reads as "one sitting so far", not as "no
 * progress".
 */
export function movement(points: Sitting[], key: SeriesKey): Movement {
  const values = present(points.map((point) => valueOf(point, key)));
  if (values.length < MOVEMENT_MIN_SITTINGS) return null;
  const half = Math.floor(values.length / 2);
  const first = middle(values.slice(0, half), key) as number;
  const now = middle(values.slice(half), key) as number;
  return {
    first,
    now,
    direction: now > first ? "up" : now < first ? "down" : "flat",
    sittings: values.length,
  };
}

/** What the sparkline says to a screen reader — the same facts as the drawing, in words. */
export function sparklineLabel(
  label: string,
  moved: Movement,
  current: number | null,
  format: (value: number) => string,
): string {
  if (moved) {
    return `${label} by sitting: first ${format(moved.first)}, now ${format(moved.now)} over ${countOf(moved.sittings, "sitting")}`;
  }
  if (current !== null) return `${label} by sitting: ${format(current)}`;
  return `${label}: no evidence yet`;
}

// ---------------------------------------------------------------------------
// §16 / §14: the pattern worth watching
// ---------------------------------------------------------------------------

export type PatternSignal =
  | "low_independence"
  | "scaffold_rising"
  | "unaided_falling"
  | "retention_lags_retrieval";

export type DependencyPattern = { fired: boolean; lessons: number; signals: PatternSignal[] };

/**
 * The rubric's §14 warning — "a learner who performs well only when substantial AI
 * support is available should not be classified as independently proficient" — read
 * across lessons. It is called only at three or more lessons AND on two or more
 * concurring signals, and it returns the signals so the sentence can say which. This is
 * a reading for the teacher; it is not a §19 input and steers nothing.
 */
export function dependencyPattern(rows: ThinkingRow[]): DependencyPattern {
  const sorted = chronological(rows);
  const lessons = Array.from(responsesByLesson(sorted).values());
  if (lessons.length < PATTERN_MIN_LESSONS) {
    return { fired: false, lessons: lessons.length, signals: [] };
  }
  const summary = summarize(sorted);
  const signals: PatternSignal[] = [];

  const independence = summary.dims.independence;
  if (independence !== null && independence <= WEAK_AT_OR_BELOW) signals.push("low_independence");

  const half = Math.floor(lessons.length / 2);
  const perLessonHelp = present(lessons.map((list) => mean(present(list.map(scaffoldOf)))));
  const earlierHelp = mean(perLessonHelp.slice(0, half));
  const laterHelp = mean(perLessonHelp.slice(half));
  if (
    earlierHelp !== null &&
    laterHelp !== null &&
    laterHelp > earlierHelp + PATTERN_SCAFFOLD_MARGIN
  ) {
    signals.push("scaffold_rising");
  }

  const perLessonShare = lessons.map((list) => {
    const unaided = list.filter((row) => {
      const level = scaffoldOf(row);
      return level !== null && level <= UNAIDED_AT_OR_BELOW;
    }).length;
    return unaided / list.length;
  });
  const earlierShare = mean(perLessonShare.slice(0, half));
  const laterShare = mean(perLessonShare.slice(half));
  if (
    earlierShare !== null &&
    laterShare !== null &&
    laterShare < earlierShare - PATTERN_SHARE_MARGIN
  ) {
    signals.push("unaided_falling");
  }

  const retrieval = summary.dims.retrieval;
  if (
    summary.retention !== null &&
    retrieval !== null &&
    summary.retention <= WEAK_AT_OR_BELOW &&
    retrieval >= PROFICIENT_AT_OR_ABOVE
  ) {
    signals.push("retention_lags_retrieval");
  }

  return { fired: signals.length >= PATTERN_MIN_SIGNALS, lessons: lessons.length, signals };
}

const SIGNAL_CLAUSE: Record<PatternSignal, string> = {
  low_independence: "little of the thinking in their answers is their own",
  scaffold_rising: "the help under them has been rising from lesson to lesson",
  unaided_falling: "fewer of their answers come with no help before them",
  retention_lags_retrieval: "what they recall in the lesson does not come back a day later",
};

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses.join("");
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

export function patternSentence(pattern: DependencyPattern): string | null {
  if (!pattern.fired) return null;
  const clauses = pattern.signals.map((signal) => SIGNAL_CLAUSE[signal]);
  return (
    `Across ${countOf(pattern.lessons, "lesson")}, a pattern worth watching: ${joinClauses(clauses)} — ` +
    "work that holds up while the tutor carries it. Give less, and check what stays a day later."
  );
}

// ---------------------------------------------------------------------------
// The reading at the top, and the small counts beside it
// ---------------------------------------------------------------------------

/** A share in words. Never a percentage — "68%" is the sentence a parent hears as a grade. */
export function shareWord(share: number | null): string {
  if (share === null) return "";
  if (share <= 0) return "none";
  if (share <= 0.25) return "a few";
  if (share <= 0.6) return "about half";
  if (share < 1) return "most";
  return "all";
}

/**
 * The whole-student reading for any scope that is not a single lesson (a lesson keeps
 * its stored narrative). Built from the summary, so it is exact and always current; it
 * carries every count beside its denominator and no percentage.
 *
 * `scopeLabel` is null for Everything.
 */
export function scopeSentence(summary: ScopeSummary, scopeLabel: string | null): string {
  if (summary.turns_scored === 0) {
    const where = scopeLabel ? ` in ${scopeLabel}` : "";
    return `Nothing read${where} yet. Jargon reads new work on its own every fifteen minutes.`;
  }
  const parts: string[] = [];
  const since = summary.first_at ? ` since ${formatDate(summary.first_at)}` : "";
  parts.push(
    `${countOf(summary.turns_scored, "response")} across ${countOf(summary.lessons, "lesson")} in ${countOf(summary.sittings, "sitting")}${since}.`,
  );

  const label = (dim: DimensionKey) => DIMENSION_LABEL[dim].toLowerCase();
  const evidenced = DIMS.filter((dim) => summary.dims[dim] !== null);
  const strong = evidenced
    .filter((dim) => (summary.dims[dim] as number) >= PROFICIENT_AT_OR_ABOVE)
    .slice(0, 3)
    .map(label);
  const weak = evidenced
    .filter((dim) => (summary.dims[dim] as number) <= WEAK_AT_OR_BELOW)
    .slice(0, 3)
    .map(label);
  if (!evidenced.length) {
    parts.push("No dimension has enough evidence yet.");
  } else if (strong.length && weak.length) {
    parts.push(`Strong on: ${strong.join(", ")}. Weak on: ${weak.join(", ")}.`);
  } else if (strong.length) {
    parts.push(`Strong on: ${strong.join(", ")} — and nothing is weak across this work.`);
  } else if (weak.length) {
    parts.push(`Weak on: ${weak.join(", ")}.`);
  } else {
    parts.push("Nothing is weak across this work, and nothing is solid yet either.");
  }

  const share = shareWord(summary.share_unaided);
  parts.push(
    `${summary.unaided_count} of ${summary.turns_scored} came with no help before them${share ? ` (${share})` : ""}.`,
  );

  if (
    summary.scaffold_trend &&
    summary.scaffold_earlier !== null &&
    summary.scaffold_recent !== null
  ) {
    parts.push(
      `The help under them has been ${summary.scaffold_trend} (S${summary.scaffold_earlier} → S${summary.scaffold_recent}).`,
    );
  } else {
    parts.push("Not enough sittings yet to see whether the help is falling.");
  }
  return parts.join(" ");
}

/** Said whenever the server kept the newest rows and dropped older work. */
export function truncationNote(truncated: boolean, delivered: number): string | null {
  if (!truncated) return null;
  return `Showing the most recent ${countOf(delivered, "response")} — older work is not in these numbers.`;
}

export type ProbeTally = { asked: number; answered: number; skipped: number; waiting: number };

/** The delayed questions in this scope, as counts: a skipped one is visible as itself. */
export function probeTally(probes: ThinkingProbe[], option: ScopeOption): ProbeTally {
  const set = option.lessonIds === null ? null : new Set(option.lessonIds);
  const inScope = probes.filter((probe) => set === null || set.has(probe.lesson_id));
  const answered = inScope.filter((probe) => probe.status === "answered").length;
  const skipped = inScope.filter((probe) => probe.status === "expired").length;
  return {
    asked: inScope.length,
    answered,
    skipped,
    waiting: inScope.length - answered - skipped,
  };
}

export type LessonLine = {
  lesson_id: string;
  title: string;
  unit_title: string | null;
  responses: number;
  scaffold_recent: number | null;
  last_read: string | null;
};

/** One row per lesson in the scope, most recently read first — the ledger is the count. */
export function lessonLines(
  rows: ThinkingRow[],
  option: ScopeOption,
  lessonsById: Map<string, Lesson>,
  profiles: CognitionProfile[],
): LessonLine[] {
  const profileOf = new Map(profiles.map((profile) => [profile.lesson_id, profile]));
  const perLesson = responsesByLesson(rowsInScope(rows, option));
  return Array.from(perLesson.entries())
    .map(([lesson_id, list]) => {
      const lesson = lessonsById.get(lesson_id);
      const profile = profileOf.get(lesson_id);
      const lastRow = list[list.length - 1]?.created_at ?? null;
      return {
        lesson_id,
        title: lesson?.title || lesson_id,
        unit_title: lesson?.unit_title || null,
        responses: list.length,
        scaffold_recent: numOrNull(profile?.scaffold_recent),
        last_read: profile?.updated_at || lastRow,
      };
    })
    .sort((a, b) => String(b.last_read || "").localeCompare(String(a.last_read || "")));
}
