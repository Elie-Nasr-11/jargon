// R93 property tests over the REAL room derivations (frontend/.../cognition/room.ts).
//
// The server decides which group a student is in; this file decides what a teacher
// sees. That means the branching a teacher actually depends on — which group is read
// first, whether dependency beats a weak dimension in the headline, whether the room
// admits how much it has not read — lives here, and is worth running rather than
// grepping. Driven by tests/test_r93_room_view.py, which rewrites the "@/" aliases.
import {
  ALL_SECTIONS,
  roomGroups,
  roomHeadline,
  sectionChoices,
  sectionHeadlines,
  sectionKey,
  studentsInSection,
  summaryForChoice,
} from "./room.ts";

// Zero-dependency helpers (the repo's flow suite uses the same pair — no jsr import,
// so the harness runs fully offline).
function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: got ${a}, expected ${b}`);
}

type AnyStudent = Parameters<typeof roomGroups>[0][number];

function student(over: Partial<AnyStudent> & { user_id: string }): AnyStudent {
  return {
    section: null,
    group: "steady",
    focus: null,
    dims: {
      retrieval: 3, organization: 3, reasoning: 3, elaboration: 3,
      vocabulary: 3, expression: 3, independence: 3, metacognition: 3,
    },
    turns_scored: 6,
    lessons_read: 1,
    scaffold_recent: 2,
    scaffold_trend: null,
    latest_lesson_id: "l1",
    updated_at: "2026-08-31T00:00:00Z",
    ...over,
  } as AnyStudent;
}

function room(over: Partial<Parameters<typeof roomHeadline>[0]> = {}) {
  return {
    students: 10,
    read: 8,
    unread: 2,
    weakest: [],
    groups: { dependent: 0, load: 0, mastered: 0, needs: 0, steady: 0, unread: 2 },
    ...over,
  } as Parameters<typeof roomHeadline>[0];
}

Deno.test("the alarm is read before the good news", () => {
  const groups = roomGroups([
    student({ user_id: "a", group: "mastered" }),
    student({ user_id: "b", group: "unread" }),
    student({ user_id: "c", group: "dependent" }),
    student({ user_id: "d", group: "needs", focus: "reasoning" }),
    student({ user_id: "e", group: "steady" }),
    student({ user_id: "f", group: "load" }),
  ]);
  eq(
    groups.map((g) => g.key),
    ["dependent", "load", "needs:reasoning", "mastered", "steady", "unread"],
    "a teacher meets the problem before the opportunity",
  );
});

// --- R103: §19's eighth rule in the room --------------------------------------------

Deno.test("R103: overload is an alarm, and it says what to do", () => {
  const [group] = roomGroups([student({ user_id: "a", group: "load" })]);
  eq(group.tone, "alert", "an overloaded room is not a quiet one");
  ok(/break tasks down/i.test(group.title), `the title names the move: ${group.title}`);
  ok(
    /one step|one sentence|one example/i.test(group.body),
    `the body says what smaller looks like: ${group.body}`,
  );
  ok(
    !/\d/.test(group.title + group.body),
    "the teacher's copy carries no measurement either",
  );
});

Deno.test("R103: an overloaded room is not told to reteach", () => {
  // The dimensions ARE weak in an overloaded room — that is what producing stubs looks
  // like. Reteaching the weakest one is the wrong instruction, so the headline must not
  // be the weak-dimension one.
  const line = roomHeadline(
    room({
      read: 6,
      weakest: [{ dimension: "elaboration", students: 5 }],
      groups: { dependent: 0, load: 4, mastered: 0, needs: 2, steady: 0, unread: 0 },
    }),
  );
  ok(/smaller steps/i.test(line), `the headline breaks the work down: ${line}`);
  ok(
    !/weak on/i.test(line) && !/a lesson to reteach, not/i.test(line),
    `and it is not the weak-dimension sentence: ${line}`,
  );
});

Deno.test("R103: dependency still outranks overload in the headline", () => {
  const line = roomHeadline(
    room({
      read: 6,
      weakest: [],
      groups: { dependent: 4, load: 4, mastered: 0, needs: 0, steady: 0, unread: 0 },
    }),
  );
  ok(
    /assistance problem/i.test(line),
    `a room being carried is named first, as it is in the mentor: ${line}`,
  );
});

Deno.test("R103: one overloaded student in a big room is not the headline", () => {
  const line = roomHeadline(
    room({
      read: 8,
      weakest: [{ dimension: "reasoning", students: 3 }],
      groups: { dependent: 0, load: 1, mastered: 0, needs: 3, steady: 4, unread: 0 },
    }),
  );
  ok(!/smaller steps/i.test(line), `one student is a tutorial, not a room problem: ${line}`);
});

Deno.test("needs splits by dimension, most-affected group first", () => {
  const groups = roomGroups([
    student({ user_id: "a", group: "needs", focus: "vocabulary" }),
    student({ user_id: "b", group: "needs", focus: "reasoning" }),
    student({ user_id: "c", group: "needs", focus: "reasoning" }),
  ]);
  eq(
    groups.map((g) => `${g.key}:${g.students.length}`),
    ["needs:reasoning:2", "needs:vocabulary:1"],
    "four students needing reasoning is a lesson; four needing something is not",
  );
});

Deno.test("every group carries a move a person can act on", () => {
  const groups = roomGroups([
    student({ user_id: "a", group: "dependent" }),
    student({ user_id: "b", group: "mastered" }),
    student({ user_id: "c", group: "needs", focus: "metacognition" }),
    student({ user_id: "d", group: "unread" }),
  ]);
  for (const group of groups) {
    ok(group.title.length > 0, `${group.key} has no title`);
    ok(group.body.length > 20, `${group.key} has no usable move`);
    // §19's own move text is shouted AT the mentor; a teacher cannot act on that.
    ok(group.body === group.body.replace(/[A-Z]{4,}:/g, ""), `${group.key} shouts at a model`);
  }
});

Deno.test("no student is dropped and none is duplicated", () => {
  const roster = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
    student({
      user_id: id,
      group: (["dependent", "mastered", "needs", "steady", "unread", "needs"] as const)[i],
      focus: i === 2 ? "retrieval" : i === 5 ? "retrieval" : null,
    })
  );
  const seen = roomGroups(roster).flatMap((g) => g.students.map((s) => s.user_id)).sort();
  eq(seen, ["a", "b", "c", "d", "e", "f"], "the room view must report the whole room");
});

Deno.test("a group is never a ranking", () => {
  // Same group, different dimension values: order must not follow the numbers.
  const weak = student({
    user_id: "z",
    group: "needs",
    focus: "reasoning",
    dims: { ...student({ user_id: "x" }).dims, reasoning: 0 },
  });
  const less = student({ user_id: "a", group: "needs", focus: "reasoning" });
  const [group] = roomGroups([weak, less]);
  eq(group.students.map((s) => s.user_id), ["z", "a"], "input order is preserved, not score order");
});

Deno.test("dependency outranks a weak dimension in the headline", () => {
  const line = roomHeadline(
    room({
      read: 8,
      groups: { dependent: 4, mastered: 0, needs: 4, steady: 0, unread: 2 },
      weakest: [{ dimension: "reasoning", students: 8 }],
    }),
  );
  ok(line.includes("assistance problem"), `dependency must win the headline: ${line}`);
});

Deno.test("a widely shared weakness reads as a reteach, not as tutorials", () => {
  const line = roomHeadline(
    room({ read: 8, weakest: [{ dimension: "reasoning", students: 6 }] }),
  );
  ok(line.includes("reteach"), `a room-wide weakness is a lesson: ${line}`);
});

Deno.test("a narrow weakness does not claim the whole room", () => {
  const line = roomHeadline(
    room({ read: 8, weakest: [{ dimension: "reasoning", students: 2 }] }),
  );
  ok(!line.includes("reteach"), `two of eight is not a reteach: ${line}`);
  ok(line.includes("no single thing"), `it should say so plainly: ${line}`);
});

Deno.test("a room with nothing read admits it", () => {
  const line = roomHeadline(room({ students: 6, read: 0, unread: 6 }));
  ok(line.includes("Nothing read yet"), `silence would look like health: ${line}`);
  ok(line.includes("6 students"), `it should name how many: ${line}`);
});

Deno.test("an empty class says so rather than reporting a healthy room", () => {
  eq(roomHeadline(room({ students: 0, read: 0, unread: 0 })), "No students in this class yet.", "empty is empty");
  eq(roomHeadline(null), "No students in this class yet.", "a failed load is not a verdict");
});

Deno.test("a room with no weakness is named as ready, not as perfect", () => {
  const line = roomHeadline(room({ read: 5, unread: 0, students: 5, weakest: [] }));
  ok(line.includes("ready for harder work"), `${line}`);
});

Deno.test("the headline never carries a score", () => {
  const lines = [
    roomHeadline(room({ read: 8, weakest: [{ dimension: "reasoning", students: 6 }] })),
    roomHeadline(room({ read: 8, groups: { dependent: 5, mastered: 0, needs: 3, steady: 0, unread: 2 } })),
    roomHeadline(room({ students: 6, read: 0, unread: 6 })),
    roomHeadline(room({ read: 5, unread: 0, students: 5, weakest: [] })),
  ];
  for (const line of lines) {
    ok(!/\d+\s*(%|\/\s*4)/.test(line), `a room headline is never a score: ${line}`);
    ok(!/average|mean\b/i.test(line), `a room headline is never an average: ${line}`);
  }
});


// ---------------------------------------------------------------------------
// R94: the room has streams.
// ---------------------------------------------------------------------------

function summary(over: Record<string, unknown> = {}) {
  return {
    students: 4, read: 4, unread: 0, weakest: [],
    groups: { dependent: 0, mastered: 0, needs: 0, steady: 4, unread: 0 },
    ...over,
  } as any;
}
function section(label: string | null, over: Record<string, unknown> = {}) {
  return { label, ...summary(over) } as any;
}

Deno.test("a class that has never used sections gets no control", () => {
  eq(sectionChoices([], summary()), [], "one flat room needs no picker");
  eq(sectionChoices(undefined, summary()), [], "an old response shape must not crash it");
});

Deno.test("one section is not a choice", () => {
  // It is the whole class under another name, and a control that does nothing is worse
  // than no control.
  eq(sectionChoices([section("A")], summary()), [], "a single stream is the class");
  eq(sectionHeadlines([section("A")]), [], "and there is nothing to compare it with");
});

Deno.test("the whole class leads, then the sections, and nobody is nameless", () => {
  const choices = sectionChoices(
    [section("B", { students: 2 }), section(null, { students: 1 })],
    summary({ students: 3 }),
  );
  eq(
    choices.map((c) => `${c.key}|${c.label}|${c.students}`),
    ["all|Whole class|3", "section:B|B|2", "section:|No section|1"],
    "the people not in a section are named, never dropped or shown as null",
  );
});

Deno.test("a section actually called 'all' is still selectable", () => {
  // The keys are prefixed for exactly this reason: a label must never collide with the
  // whole-class view and make a real section unreachable.
  const choices = sectionChoices([section("all"), section("B")], summary());
  const keys = choices.map((c) => c.key);
  ok(new Set(keys).size === keys.length, `keys collided: ${keys.join(",")}`);
  ok(keys.includes(sectionKey("all")), "a section named 'all' has its own key");
});

Deno.test("choosing a section narrows the room to exactly that section", () => {
  const roster = [
    student({ user_id: "a", section: "A" }),
    student({ user_id: "b", section: "B" }),
    student({ user_id: "c", section: null }),
    student({ user_id: "d", section: "A" }),
  ];
  eq(studentsInSection(roster, ALL_SECTIONS).map((s) => s.user_id), ["a", "b", "c", "d"], "all");
  eq(studentsInSection(roster, sectionKey("A")).map((s) => s.user_id), ["a", "d"], "one stream");
  eq(studentsInSection(roster, sectionKey(null)).map((s) => s.user_id), ["c"], "the unsectioned");
});

Deno.test("every student is reachable through exactly one section choice", () => {
  const roster = [
    student({ user_id: "a", section: "A" }),
    student({ user_id: "b", section: "B" }),
    student({ user_id: "c", section: null }),
  ];
  const sections = [section("A"), section("B"), section(null)];
  const seen = sections.flatMap((s) => studentsInSection(roster, sectionKey(s.label)).map((x) => x.user_id));
  eq(seen.sort(), ["a", "b", "c"], "the sections partition the room");
  eq(new Set(seen).size, 3, "and never double-count anyone");
});

Deno.test("the summary follows the choice", () => {
  const room = summary({ students: 9 });
  const sections = [section("A", { students: 5 }), section("B", { students: 4 })];
  eq(summaryForChoice(ALL_SECTIONS, room, sections).students, 9, "the class");
  eq(summaryForChoice(sectionKey("B"), room, sections).students, 4, "the section");
  eq(summaryForChoice(sectionKey("Z"), room, sections), null, "a section that is gone");
});

Deno.test("the comparison is the same sentence each section gets on its own", () => {
  // Not a second opinion: selecting a section must not tell a teacher something
  // different from what the comparison line just told them.
  const sections = [
    section("A", { read: 6, groups: { dependent: 4, mastered: 0, needs: 2, steady: 0, unread: 0 } }),
    section("B", { read: 6, weakest: [{ dimension: "reasoning", students: 5 }] }),
  ];
  const lines = sectionHeadlines(sections);
  eq(lines.length, 2, "one line per section");
  for (let i = 0; i < sections.length; i++) {
    eq(lines[i].line, roomHeadline(sections[i]), `${lines[i].label} disagrees with itself`);
  }
  ok(lines[0].line.includes("assistance problem"), `A is the dependent one: ${lines[0].line}`);
  ok(lines[1].line.includes("reteach"), `B has a shared weakness: ${lines[1].line}`);
});

Deno.test("a divergence between sections is visible rather than averaged away", () => {
  // The whole reason sections exist here: blended, these two rooms look unremarkable.
  const sections = [
    section("A", { read: 6, groups: { dependent: 6, mastered: 0, needs: 0, steady: 0, unread: 0 } }),
    section("B", { read: 6, groups: { dependent: 0, mastered: 6, needs: 0, steady: 0, unread: 0 } }),
  ];
  const [a, b] = sectionHeadlines(sections).map((s) => s.line);
  ok(a !== b, "two very different rooms must not read identically");
  ok(a.includes("assistance problem"), a);
  ok(!b.includes("assistance problem"), b);
});

Deno.test("a section headline never carries a score either", () => {
  const lines = sectionHeadlines([
    section("A", { read: 6, weakest: [{ dimension: "reasoning", students: 5 }] }),
    section(null, { students: 3, read: 0, unread: 3 }),
  ]);
  for (const { line } of lines) {
    ok(!/\d+\s*(%|\/\s*4)/.test(line), `a section headline is never a score: ${line}`);
    ok(!/average|mean\b/i.test(line), `nor an average: ${line}`);
  }
});


Deno.test("one student does not read as many", () => {
  // "1 student ... are weak" reads as a bug in the product, not a bug in a sentence.
  // The live probe hit it on its first five-student room.
  const one = roomHeadline(room({ read: 5, weakest: [{ dimension: "reasoning", students: 1 }] }));
  ok(one.includes("1 student of the 5 read is weak"), one);
  const many = roomHeadline(room({ read: 5, weakest: [{ dimension: "reasoning", students: 2 }] }));
  ok(many.includes("2 students of the 5 read are weak"), many);

  const oneDep = roomHeadline(
    room({ read: 2, groups: { dependent: 1, mastered: 1, needs: 0, steady: 0, unread: 0 } }),
  );
  ok(oneDep.includes("1 student of the 2 read is leaning"), oneDep);
});
