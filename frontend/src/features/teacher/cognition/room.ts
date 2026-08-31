/**
 * The room, arranged for a teacher — pure derivations over what the server returned.
 *
 * The server decides WHICH group each student is in, using the mentor's own §19
 * thresholds, so the view and the tutor cannot disagree about a student. This file
 * decides what a teacher SEES: the order the groups appear in, what each is called,
 * and the one sentence at the top saying what the room as a whole needs.
 *
 * Nothing here ranks students and nothing here produces a score. A room view whose
 * headline was "class average 2.7" would be §15's failure one level up.
 */
import {
  DIMENSION_LABEL,
  DIMENSION_MOVE,
  type DimensionKey,
} from "@/features/teacher/cognition/labels";
import type { RoomStudent, RoomSummary } from "@/lib/api";

export type RoomGroup = {
  /** Stable key: the server group, or "needs:<dimension>" split out by focus. */
  key: string;
  title: string;
  /** What this group means and what to do about it, in a teacher's language. */
  body: string;
  tone: "alert" | "opportunity" | "neutral" | "quiet";
  students: RoomStudent[];
};

// Alarm first, then the teachable groups, then the opportunity, then the quiet ones.
// A teacher reading top-to-bottom should meet the thing that is going wrong before the
// thing that is going well.
const GROUP_RANK: Record<string, number> = {
  dependent: 0,
  needs: 1,
  mastered: 2,
  steady: 3,
  unread: 4,
};

/**
 * The groups, in reading order. "needs" splits into one group per weak dimension,
 * because "four students need reasoning" is a lesson and "four students need something"
 * is not.
 */
export function roomGroups(students: RoomStudent[]): RoomGroup[] {
  const buckets = new Map<string, RoomStudent[]>();
  for (const student of students) {
    const key =
      student.group === "needs" && student.focus ? `needs:${student.focus}` : student.group;
    const list = buckets.get(key) ?? [];
    list.push(student);
    buckets.set(key, list);
  }

  const groups: RoomGroup[] = [];
  for (const [key, list] of buckets) {
    groups.push({ key, ...describeGroup(key), students: [...list] });
  }

  return groups.sort((a, b) => {
    const rank = GROUP_RANK[a.key.split(":")[0]] - GROUP_RANK[b.key.split(":")[0]];
    if (rank !== 0) return rank;
    // Within the needs groups: the one that affects the most students first.
    if (b.students.length !== a.students.length) return b.students.length - a.students.length;
    return a.key.localeCompare(b.key);
  });
}

function describeGroup(key: string): Omit<RoomGroup, "key" | "students"> {
  if (key.startsWith("needs:")) {
    const dimension = key.slice("needs:".length) as DimensionKey;
    return {
      title: DIMENSION_LABEL[dimension] ?? dimension,
      body: DIMENSION_MOVE[dimension] ?? "",
      tone: "neutral",
    };
  }
  switch (key) {
    case "dependent":
      return {
        title: "Leaning on the tutor",
        body:
          "Most of the thinking in their recent answers came from Jargon, not from them. " +
          "They need less help, not more — a question where you would have given a hint.",
        tone: "alert",
      };
    case "mastered":
      return {
        title: "Ready for harder ground",
        body:
          "They are producing this material on their own. Give them something the lesson " +
          "has not covered — a case to predict, or the idea applied somewhere new.",
        tone: "opportunity",
      };
    case "steady":
      return {
        title: "Holding steady",
        body: "Nothing weak enough to steer on, and not yet independent enough to fade. Leave them be.",
        tone: "quiet",
      };
    default:
      return {
        title: "Not read yet",
        body:
          "Fewer than three responses judged, so there is nothing solid to say about them. " +
          "Jargon reads new work on its own every fifteen minutes.",
        tone: "quiet",
      };
  }
}

/**
 * The one sentence at the top. It answers "what does this room need from me?" — a
 * different question from what any one student needs, and the only reason a
 * class-level view earns its space.
 */
export function roomHeadline(room: RoomSummary | null | undefined): string {
  if (!room || room.students === 0) return "No students in this class yet.";
  if (room.read === 0) {
    return `Nothing read yet across ${countOf(room.students, "student")}. Jargon reads new work on its own every fifteen minutes.`;
  }

  const top = room.weakest[0];
  const dependent = room.groups.dependent ?? 0;

  // Dependency outranks a weak dimension the way it does in §19: a room being carried
  // by the tutor is a different, worse problem than a room that finds one thing hard.
  if (dependent > 0 && dependent >= room.read / 2) {
    return `${countOf(dependent, "student")} of the ${room.read} read are leaning on the tutor for most of their thinking. That is an assistance problem before it is a content one.`;
  }

  if (!top) {
    return `Nothing is weak across the ${countOf(room.read, "student")} read. This room is ready for harder work.`;
  }

  const label = (DIMENSION_LABEL[top.dimension] ?? top.dimension).toLowerCase();
  if (top.students >= room.read / 2) {
    return `${top.students} of the ${room.read} students read are weak on the same thing — ${label}. That is a lesson to reteach, not ${countOf(top.students, "tutorial")}.`;
  }
  return `${countOf(top.students, "student")} of the ${room.read} read are weak on ${label}, and no single thing is holding the whole room back.`;
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
