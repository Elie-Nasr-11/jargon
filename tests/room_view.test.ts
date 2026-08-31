// R93 property tests over the REAL room derivations (frontend/.../cognition/room.ts).
//
// The server decides which group a student is in; this file decides what a teacher
// sees. That means the branching a teacher actually depends on — which group is read
// first, whether dependency beats a weak dimension in the headline, whether the room
// admits how much it has not read — lives here, and is worth running rather than
// grepping. Driven by tests/test_r93_room_view.py, which rewrites the "@/" aliases.
import { roomGroups, roomHeadline } from "./room.ts";

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
    groups: { dependent: 0, mastered: 0, needs: 0, steady: 0, unread: 2 },
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
  ]);
  eq(
    groups.map((g) => g.key),
    ["dependent", "needs:reasoning", "mastered", "steady", "unread"],
    "a teacher meets the problem before the opportunity",
  );
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
