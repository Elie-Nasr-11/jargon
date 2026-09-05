// R101 property tests over the REAL Thinking-tab derivations
// (frontend/.../cognition/thinking.ts).
//
// The server hands the browser numbers and ids; this file decides what a teacher reads
// from them — which scopes exist, what a scope's medians are, what the line across
// sittings shows, when the §14 pattern is called, and what the sentence at the top says.
// Those are the promises worth RUNNING rather than grepping. Driven by
// tests/test_r101_thinking_view.py, which rewrites the "@/" aliases.
import {
  ALL_SCOPE,
  MOVEMENT_MIN_SITTINGS,
  PATTERN_MIN_LESSONS,
  SMOOTH_WINDOW,
  chronological,
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
} from "./thinking.ts";

// Zero-dependency helpers (the repo's other harnesses use the same pair — no jsr
// import, so the suite runs fully offline).
function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: got ${a}, expected ${b}`);
}

// A seeded generator so a failure reproduces.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIMS = [
  "retrieval", "organization", "reasoning", "elaboration",
  "vocabulary", "expression", "independence", "metacognition",
] as const;

// A small catalogue: two ICT lessons in one unit, one in another, two Science lessons
// in one unit — the shape the demo has, and enough for every scope kind.
const CATALOGUE = [
  { id: "ict-1", title: "Technology all around us", unit_id: "ict-u1", unit_title: "Chapter 1", course_id: "ict", position: 1 },
  { id: "ict-2", title: "Parts of a computer", unit_id: "ict-u1", unit_title: "Chapter 1", course_id: "ict", position: 2 },
  { id: "ict-3", title: "Being safe online", unit_id: "ict-u2", unit_title: "Chapter 2", course_id: "ict", position: 3 },
  { id: "sci-1", title: "Energy", unit_id: "sci-u1", unit_title: "Energy", course_id: "sci", position: 1 },
  { id: "sci-2", title: "Food chains", unit_id: "sci-u1", unit_title: "Energy", course_id: "sci", position: 2 },
  { id: "loose", title: "A lesson with no unit", unit_id: null, unit_title: null, course_id: null, position: 9 },
];
const lessonsById = new Map(CATALOGUE.map((lesson) => [lesson.id, lesson]));
const classes = [
  { id: "c-ict", name: "Grade 7A — ICT", status: "active", organization_id: "org" },
  { id: "c-sci", name: "Grade 7B — Science", status: "active", organization_id: "org" },
  { id: "c-none", name: "Homeroom", status: "active", organization_id: "org" },
];
const memberships = [
  { id: "m1", class_id: "c-ict", user_id: "s", role: "student", status: "active", created_at: "" },
  { id: "m2", class_id: "c-sci", user_id: "s", role: "student", status: "active", created_at: "" },
  { id: "m3", class_id: "c-none", user_id: "s", role: "student", status: "active", created_at: "" },
  { id: "m4", class_id: "c-other", user_id: "s", role: "student", status: "removed", created_at: "" },
];
const classLinks = [
  { class_id: "c-ict", course_id: "ict" },
  { class_id: "c-sci", course_id: "sci" },
  // c-none links nothing: the platform rule says an unlinked class scopes to everything.
];

type Row = ReturnType<typeof row>;

let counter = 0;
function row(over: Partial<Record<string, unknown>> & { lesson_id: string; session_id: string }) {
  counter += 1;
  return {
    id: `r${String(counter).padStart(5, "0")}`,
    created_at: `2026-09-0${1 + (counter % 5)}T10:${String(counter % 60).padStart(2, "0")}:00Z`,
    scaffold_level: 2,
    retrieval: 3, organization: 3, reasoning: 3, elaboration: 3,
    vocabulary: 3, expression: 3, independence: 3, metacognition: 3,
    retention: null, transfer: null,
    ...over,
  };
}

/** A random ledger: sessions in time order, each on one lesson, rows with holes. */
function ledger(rand: () => number): Row[] {
  const rows: Row[] = [];
  const sessions = 1 + Math.floor(rand() * 9);
  let minute = 0;
  for (let s = 0; s < sessions; s += 1) {
    const lesson = CATALOGUE[Math.floor(rand() * CATALOGUE.length)].id;
    const n = 1 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i += 1) {
      minute += 1 + Math.floor(rand() * 40);
      const over: Record<string, unknown> = {
        created_at: new Date(Date.UTC(2026, 8, 1, 0, minute)).toISOString(),
        scaffold_level: Math.floor(rand() * 6),
      };
      for (const dim of DIMS) over[dim] = rand() < 0.1 ? null : Math.floor(rand() * 5);
      if (rand() < 0.1) over.retention = Math.floor(rand() * 5);
      if (rand() < 0.05) over.transfer = Math.floor(rand() * 5);
      rows.push(row({ lesson_id: lesson, session_id: `sess-${s}`, ...over }));
    }
  }
  return rows;
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function referenceMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function options(rows: Row[], over: Partial<Parameters<typeof scopeOptions>[0]> = {}) {
  return scopeOptions({
    rows: rows as never,
    lessonsById: lessonsById as never,
    classes: classes as never,
    memberships: memberships as never,
    classLinks,
    currentClassId: "c-sci",
    ...over,
  });
}

const ITERATIONS = 200;

Deno.test("shuffling the rows changes nothing a teacher reads", () => {
  const rand = mulberry32(1);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rows = ledger(rand);
    const mixed = shuffle(rows, rand);
    eq(summarize(mixed as never), summarize(rows as never), `summary depends on input order (iteration ${i})`);
    eq(sittings(mixed as never), sittings(rows as never), `sittings depend on input order (iteration ${i})`);
    eq(options(mixed), options(rows), `scopes depend on input order (iteration ${i})`);
    eq(dependencyPattern(mixed as never), dependencyPattern(rows as never), `pattern depends on input order (iteration ${i})`);
  }
});

Deno.test("sittings partition the scope, one per session, in order", () => {
  const rand = mulberry32(2);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rows = ledger(rand);
    const points = sittings(rows as never);
    eq(points.reduce((sum, p) => sum + p.n, 0), rows.length, "every response sits in exactly one sitting");
    eq(new Set(points.map((p) => p.session_id)).size, points.length, "one point per session");
    for (let k = 1; k < points.length; k += 1) {
      ok(points[k - 1].at <= points[k].at, "sittings are in the order they happened");
    }
  }
});

Deno.test("a scope's medians are the scorer's medians over exactly its rows", () => {
  const rand = mulberry32(3);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rows = ledger(rand);
    const groups = options(rows);
    for (const option of [groups.all, ...groups.classes, ...groups.units, ...groups.lessons]) {
      const scoped = rowsInScope(rows as never, option);
      const summary = summarize(scoped);
      for (const dim of DIMS) {
        const values = scoped.map((r) => (r as never as Record<string, number | null>)[dim]).filter((v): v is number => typeof v === "number");
        eq(summary.dims[dim], referenceMedian(values), `${dim} median in ${option.key}`);
        const value = summary.dims[dim];
        ok(value === null || (value >= 0 && value <= 4), `${dim} is a level, not a score`);
      }
      eq(summary.turns_scored, scoped.length, "the count is the rows");
    }
  }
});

Deno.test("an empty scope is null, never zero", () => {
  const summary = summarize([]);
  eq(summary.turns_scored, 0, "no responses");
  eq(summary.lessons, 0, "no lessons");
  for (const dim of DIMS) eq(summary.dims[dim], null, `${dim} must be null, not 0`);
  eq(summary.share_unaided, null, "no share without a denominator");
  eq(summary.scaffold_trend, null, "no trend from silence");
  eq(summary.retention, null, "no retention from silence");
  eq(sittings([]), [], "no sittings");
  eq(movement([], "reasoning"), null, "no movement from nothing");
  eq(dependencyPattern([]), { fired: false, lessons: 0, signals: [] }, "no pattern from nothing");
});

Deno.test("every offered scope holds work, and Everything holds all of it", () => {
  const rand = mulberry32(4);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rows = ledger(rand);
    const groups = options(rows);
    eq(groups.all.responses, rows.length, "Everything is everything");
    const every = [...groups.classes, ...groups.units, ...groups.lessons];
    for (const option of every) {
      ok(option.responses >= 1, `${option.key} is offered with nothing in it`);
      ok(option.responses <= groups.all.responses, `${option.key} exceeds Everything`);
      eq(option.responses, rowsInScope(rows as never, option).length, `${option.key} count is its rows`);
    }
    eq(groups.lessons.reduce((sum, o) => sum + o.responses, 0), rows.length, "lessons partition the work");
    const unitless = rows.filter((r) => !lessonsById.get(r.lesson_id)?.unit_id).length;
    eq(groups.units.reduce((sum, o) => sum + o.responses, 0), rows.length - unitless, "units partition the work that has a unit");
  }
});

Deno.test("a lesson or unit with no rows is never offered", () => {
  const rows = [row({ lesson_id: "ict-1", session_id: "a" }), row({ lesson_id: "ict-1", session_id: "a" })];
  const groups = options(rows);
  eq(groups.lessons.map((o) => o.id), ["ict-1"], "only the lesson with work");
  eq(groups.units.map((o) => o.id), ["ict-u1"], "only the unit with work");
  eq(groups.classes.map((o) => o.id), ["c-ict", "c-none"], "the Science class has none of this work; the unlinked class has all of it");
});

Deno.test("the class the teacher came from is first", () => {
  const rows = [row({ lesson_id: "ict-1", session_id: "a" }), row({ lesson_id: "sci-1", session_id: "b" })];
  eq(options(rows).classes.map((o) => o.id)[0], "c-sci", "current class first");
  eq(options(rows, { currentClassId: "c-ict" }).classes.map((o) => o.id)[0], "c-ict", "current class first");
});

Deno.test("a class with no course links scopes to everything", () => {
  const rows = [row({ lesson_id: "ict-1", session_id: "a" }), row({ lesson_id: "sci-1", session_id: "b" })];
  const homeroom = options(rows).classes.find((o) => o.id === "c-none");
  ok(homeroom, "the unlinked class is offered");
  eq(homeroom?.lessonIds, null, "null means every lesson — the platform rule");
  eq(homeroom?.responses, rows.length, "and its count says so");
});

Deno.test("no links yet means no Classes group, and the selection stays put", () => {
  const rows = [row({ lesson_id: "ict-1", session_id: "a" })];
  const groups = options(rows, { classLinks: undefined });
  eq(groups.classes, [], "a wrong scope for a moment is worse than a missing one");
  eq(resolveScope(groups, ALL_SCOPE).key, ALL_SCOPE, "Everything is still there");
});

Deno.test("a vanished key lands on Everything", () => {
  const rows = [row({ lesson_id: "ict-1", session_id: "a" })];
  const groups = options(rows);
  eq(resolveScope(groups, scopeKey("lesson", "sci-2")).key, ALL_SCOPE, "an emptied scope falls back");
  eq(resolveScope(groups, "class:nope").key, ALL_SCOPE, "an unknown class falls back");
  eq(resolveScope(groups, scopeKey("lesson", "ict-1")).id, "ict-1", "a live key resolves");
});

Deno.test("rowsInScope never leaks a row from outside the scope", () => {
  const rand = mulberry32(5);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rows = ledger(rand);
    const groups = options(rows);
    for (const option of [...groups.classes, ...groups.units, ...groups.lessons]) {
      const set = new Set(option.lessonIds ?? rows.map((r) => r.lesson_id));
      for (const r of rowsInScope(rows as never, option)) ok(set.has(r.lesson_id), `${option.key} leaked ${r.lesson_id}`);
    }
  }
});

Deno.test("the scaffold halves rule matches the scorer's", () => {
  const four = [3, 3, 1, 1].map((s, i) => row({ lesson_id: "ict-1", session_id: "a", scaffold_level: s, created_at: `2026-09-01T10:0${i}:00Z` }));
  const summary = summarize(four as never);
  eq([summary.scaffold_earlier, summary.scaffold_recent, summary.scaffold_trend], [3, 1, "falling"], "earlier half vs later half");
  const one = summarize([row({ lesson_id: "ict-1", session_id: "a", scaffold_level: 4 })] as never);
  eq([one.scaffold_earlier, one.scaffold_recent, one.scaffold_trend], [null, 4, null], "one row has no earlier half");
});

Deno.test("the line never invents a value and honours its window", () => {
  const rand = mulberry32(6);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const points = sittings(ledger(rand) as never);
    for (const key of ["reasoning", "retention", "scaffold"] as const) {
      const line = smoothed(points, key);
      eq(line.length, points.length, "one value per sitting");
      const values: number[] = [];
      points.forEach((point, index) => {
        const value = key === "scaffold" ? point.scaffold : key === "retention" ? point.retention : point.dims[key];
        if (value === null) {
          eq(line[index], null, "a sitting with no value is a hole");
          return;
        }
        values.push(value);
        const window = values.slice(-SMOOTH_WINDOW);
        ok(line[index] !== null, "a sitting with a value is drawn");
        ok((line[index] as number) >= Math.min(...window) && (line[index] as number) <= Math.max(...window), "the running middle stays inside its window");
      });
    }
  }
});

Deno.test("movement needs four evidenced sittings and reads its direction", () => {
  const rising = [0, 1, 2, 3, 4, 4].map((v, i) => row({ lesson_id: "ict-1", session_id: `s${i}`, reasoning: v, created_at: `2026-09-01T1${i}:00:00Z` }));
  const up = movement(sittings(rising as never), "reasoning");
  ok(up && up.direction === "up" && up.now > up.first, `a rising series reads up: ${JSON.stringify(up)}`);
  const falling = [4, 4, 3, 1, 0, 0].map((v, i) => row({ lesson_id: "ict-1", session_id: `s${i}`, reasoning: v, created_at: `2026-09-01T1${i}:00:00Z` }));
  const down = movement(sittings(falling as never), "reasoning");
  ok(down && down.direction === "down", "a falling series reads down");
  const few = [3, 2, 3].map((v, i) => row({ lesson_id: "ict-1", session_id: `s${i}`, reasoning: v }));
  eq(movement(sittings(few as never), "reasoning"), null, `under ${MOVEMENT_MIN_SITTINGS} sittings there is no arrow`);
  const silent = [1, 2, 3, 4].map((_, i) => row({ lesson_id: "ict-1", session_id: `s${i}`, retention: null }));
  eq(movement(sittings(silent as never), "retention"), null, "no arrow from silence");
});

Deno.test("the pattern is silent under three lessons and on one signal, and names what fired", () => {
  // Two lessons that would otherwise fire everything: not enough lessons.
  const two = [
    ...[0, 1, 2].map((i) => row({ lesson_id: "ict-1", session_id: "a", independence: 1, scaffold_level: 1, created_at: `2026-09-01T10:0${i}:00Z` })),
    ...[0, 1, 2].map((i) => row({ lesson_id: "ict-2", session_id: "b", independence: 1, scaffold_level: 4, created_at: `2026-09-02T10:0${i}:00Z` })),
  ];
  eq(dependencyPattern(two as never), { fired: false, lessons: 2, signals: [] }, `silent under ${PATTERN_MIN_LESSONS} lessons`);

  // Three lessons, independence low, nothing else moving: one signal, no pattern.
  const one = ["ict-1", "ict-2", "ict-3"].flatMap((lesson, l) =>
    [0, 1, 2].map((i) => row({ lesson_id: lesson, session_id: `s${l}`, independence: 1, scaffold_level: 2, created_at: `2026-09-0${l + 1}T10:0${i}:00Z` })),
  );
  const single = dependencyPattern(one as never);
  eq(single.fired, false, "one signal is not a pattern");
  eq(single.signals, ["low_independence"], "but it is named");

  // A four-lesson slide: help rising and unaided answers vanishing under low independence.
  const slide = ["ict-1", "ict-2", "ict-3", "sci-1"].flatMap((lesson, l) =>
    [0, 1, 2].map((i) => row({
      lesson_id: lesson, session_id: `s${l}`, independence: 1,
      scaffold_level: l < 2 ? 0 : 4, created_at: `2026-09-0${l + 1}T10:0${i}:00Z`,
    })),
  );
  const fired = dependencyPattern(slide as never);
  eq(fired.fired, true, "two concurring signals over four lessons");
  eq(fired.signals, ["low_independence", "scaffold_rising", "unaided_falling"], "and each is named");
  ok(patternSentence(fired)?.includes("4 lessons"), "the sentence says how many lessons");
  eq(patternSentence(single), null, "no sentence without a pattern");
});

const GRADE_WORDS = /%|\/4\b|average|\bmean\b|score/i;

Deno.test("no sentence carries a grade", () => {
  const rand = mulberry32(7);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rows = ledger(rand);
    const groups = options(rows);
    for (const option of [groups.all, ...groups.classes, ...groups.units]) {
      const summary = summarize(rowsInScope(rows as never, option));
      const sentence = scopeSentence(summary, option.kind === "all" ? null : option.label);
      ok(!GRADE_WORDS.test(sentence), `a grade leaked: ${sentence}`);
      ok(sentence.includes(`${summary.unaided_count} of ${summary.turns_scored}`), `the share must carry its denominator: ${sentence}`);
    }
    const points = sittings(rows as never);
    const label = sparklineLabel("Reasons with it", movement(points, "reasoning"), summarize(rows as never).dims.reasoning, (v) => `${v} of 4`);
    ok(!GRADE_WORDS.test(label), `the drawing's words leaked a grade: ${label}`);
  }
  ok(!GRADE_WORDS.test(scopeSentence(summarize([]), null)), "the empty reading has no grade either");
  ok(!GRADE_WORDS.test(truncationNote(true, 5000) ?? ""), "the truncation note has no grade");
});

Deno.test("the empty reading says so, and says where", () => {
  ok(scopeSentence(summarize([]), null).startsWith("Nothing read yet."), "Everything, empty");
  ok(scopeSentence(summarize([]), "Chapter 2").startsWith("Nothing read in Chapter 2 yet."), "a scope, empty");
  ok(scopeSentence(summarize([]), null).includes("fifteen minutes"), "and when it will be");
});

Deno.test("truncation is said, or not said", () => {
  eq(truncationNote(false, 62), null, "nothing to say when nothing was dropped");
  ok((truncationNote(true, 5000) ?? "").includes("5000 responses"), "the note says how many were kept");
});

Deno.test("probes partition into answered, skipped and waiting, within the scope", () => {
  const probes = [
    { lesson_id: "ict-1", idea_title: "a", kind: "retention", status: "answered", retention: 3, transfer: null, asked_at: "", answered_at: "" },
    { lesson_id: "ict-1", idea_title: "b", kind: "retention", status: "expired", retention: null, transfer: null, asked_at: "", answered_at: null },
    { lesson_id: "sci-1", idea_title: "c", kind: "transfer", status: "asked", retention: null, transfer: null, asked_at: "", answered_at: null },
  ];
  const rows = [row({ lesson_id: "ict-1", session_id: "a" }), row({ lesson_id: "sci-1", session_id: "b" })];
  const groups = options(rows);
  eq(probeTally(probes as never, groups.all), { asked: 3, answered: 1, skipped: 1, waiting: 1 }, "everything");
  const ict = groups.units.find((o) => o.id === "ict-u1") as NonNullable<typeof groups.units[number]>;
  eq(probeTally(probes as never, ict), { asked: 2, answered: 1, skipped: 1, waiting: 0 }, "one unit");
});

Deno.test("lesson lines are the ledger's count, most recent first", () => {
  const rows = [
    row({ lesson_id: "ict-1", session_id: "a", created_at: "2026-09-01T10:00:00Z" }),
    row({ lesson_id: "ict-1", session_id: "a", created_at: "2026-09-01T10:05:00Z" }),
    row({ lesson_id: "sci-1", session_id: "b", created_at: "2026-09-02T10:00:00Z" }),
  ];
  const profiles = [{ lesson_id: "ict-1", turns_scored: 99, scaffold_recent: 1.5, updated_at: "2026-09-01T10:10:00Z", narrative: "" }];
  const lines = lessonLines(rows as never, options(rows).all, lessonsById as never, profiles as never);
  eq(lines.map((l) => [l.lesson_id, l.responses]), [["sci-1", 1], ["ict-1", 2]], "the ledger counts, not the stored profile");
  eq(lines[1].scaffold_recent, 1.5, "the stored profile supplies the recent help level");
  eq(chronological(rows as never).map((r) => r.lesson_id), ["ict-1", "ict-1", "sci-1"], "and time order is stable");
});
