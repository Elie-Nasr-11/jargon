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
import type { RoomStudent, RoomSummary, SectionSummary } from "@/lib/api";
import { countOf } from "@/lib/format";

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
  // R103: overload is the other alarm. It sits below dependency because a student who
  // is both is grouped as dependent — the help comes down before the task is chunked.
  load: 1,
  needs: 2,
  // R101b: the correction to an optimistic reading sits immediately before the reading
  // it corrects, so a teacher meets "it did not stick" before "ready for harder ground".
  not_held: 3,
  mastered: 4,
  steady: 5,
  unread: 6,
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
    case "load":
      return {
        title: "Overloaded — break tasks down",
        body:
          "They are taking a lot of help and giving back very little. That is a task too " +
          "big to hold at once, not a student who does not care: ask for one step, one " +
          "sentence, one example at a time, and let them finish it before the next.",
        tone: "alert",
      };
    case "not_held":
      return {
        title: "It did not stick",
        body:
          "They work well with you in the room, but asked again a day later with no help, " +
          "the idea was not there. Keep the support where it is and spend a session making " +
          "it stay — have them say it back in their own words, then use it on a new case.",
        tone: "neutral",
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
        body:
          "Nothing weak enough to steer on, and not yet independent enough to fade. Some " +
          "are here because almost everything they have done came with help — the chip " +
          "says which. Give those one thing to try before you offer anything.",
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

// ---------------------------------------------------------------------------
// R101b: §14 in the room.
//
// "A learner who performs well only when substantial AI support is available should not
// be classified as independently proficient." The groups above say what to DO about a
// student; this says what the saying rests on. Without it a teacher reading "needs:
// reasoning" cannot tell whether that came from work the child did alone or work the
// tutor carried, and those are different lessons.
//
// It is a COUNT over a count, never a percentage and never a dimension value: "2 of 14"
// and "14%" are different claims, and the second hides the denominator that decides how
// much the first is worth.
// ---------------------------------------------------------------------------

/** Cross-pinned to MASTERY_MIN_SHARE_UNAIDED in cognition-scorer and chat. Below this,
 *  the mentor will not fade and the room says so out loud. */
export const MOSTLY_SUPPORTED_BELOW = 0.25;

/** True when almost nothing this student has done was unaided. Never true for a student
 *  nobody has read: absent evidence is not evidence. */
export function mostlySupported(student: RoomStudent): boolean {
  if (student.group === "unread") return false;
  return student.share_unaided !== null && student.share_unaided < MOSTLY_SUPPORTED_BELOW;
}

/** The chip's short form: §14's fraction, exactly as it is counted. */
export function unaidedLabel(student: RoomStudent): string {
  return `${student.unaided_count}/${student.turns_scored}`;
}

/** The chip's tooltip. Says the fraction in words, then whether anyone has ever checked
 *  the reading away from the lesson that produced it. */
export function independenceNote(student: RoomStudent): string {
  const answers = countOf(student.turns_scored, "answer");
  const unaided = `${student.unaided_count} of ${answers} came with no help before them`;
  const checked =
    student.probes_answered > 0
      ? `checked a day later ${countOf(student.probes_answered, "time")}`
      : "never checked a day later";
  return `${unaided} · ${checked}`;
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
    return `${countOf(dependent, "student")} of the ${room.read} read ${isAre(dependent)} leaning on the tutor for most of their thinking. That is an assistance problem before it is a content one.`;
  }

  // R103: and overload outranks a weak dimension for the same reason — the dimensions
  // ARE weak in an overloaded room, and reteaching the weakest one is the wrong move
  // when the task itself is too big to hold.
  const overloaded = room.groups.load ?? 0;
  if (overloaded > 0 && overloaded >= room.read / 2) {
    return `${countOf(overloaded, "student")} of the ${room.read} read ${isAre(overloaded)} taking heavy help and giving back very little. Break the work into smaller steps before you reteach any of it.`;
  }

  if (!top) {
    return `Nothing is weak across the ${countOf(room.read, "student")} read. This room is ready for harder work.`;
  }

  const label = (DIMENSION_LABEL[top.dimension] ?? top.dimension).toLowerCase();
  if (top.students >= room.read / 2) {
    return `${top.students} of the ${room.read} students read are weak on the same thing — ${label}. That is a lesson to reteach, not ${countOf(top.students, "tutorial")}.`;
  }
  return `${countOf(top.students, "student")} of the ${room.read} read ${isAre(top.students)} weak on ${label}, and no single thing is holding the whole room back.`;
}

// "1 student ... are weak" reads as a bug in the product, not a bug in a sentence.
// Caught by the live probe: a five-student room with one weak reader hit it first try.
function isAre(n: number): string {
  return n === 1 ? "is" : "are";
}

// ---------------------------------------------------------------------------
// R94: the room has streams.
//
// A teacher who splits a class into sections teaches them at different hours and to
// different plans, so one blended reading hides the thing they most need: that one
// section is leaning on the tutor and the other is not. The server summarizes each
// section (the arithmetic reads dimension values, which stay on the server); this
// picks which summary the teacher is looking at.
// ---------------------------------------------------------------------------

/** What the section control offers. Empty when the class has never used sections. */
export type SectionChoice = { key: string; label: string; students: number };

/** The key the whole-class view is stored under. Not a section — a section named
 *  "all" must still be selectable, so the choice keys are prefixed. */
export const ALL_SECTIONS = "all";
const UNSECTIONED = "section:";

export function sectionKey(label: string | null): string {
  return label === null ? UNSECTIONED : `section:${label}`;
}

export function sectionChoices(
  sections: SectionSummary[] | null | undefined,
  room: RoomSummary | null | undefined,
): SectionChoice[] {
  // One section is not a choice — it is the whole class under another name.
  if (!sections || sections.length < 2) return [];
  return [
    { key: ALL_SECTIONS, label: "Whole class", students: room?.students ?? 0 },
    ...sections.map((section) => ({
      key: sectionKey(section.label),
      // The people not in a section are named, never labelled "null" or dropped.
      label: section.label ?? "No section",
      students: section.students,
    })),
  ];
}

/** The students the chosen view is about. */
export function studentsInSection(students: RoomStudent[], choice: string): RoomStudent[] {
  if (choice === ALL_SECTIONS) return students;
  return students.filter((student) => sectionKey(student.section) === choice);
}

/** The summary the chosen view is about — the class's own when nothing is chosen. */
export function summaryForChoice(
  choice: string,
  room: RoomSummary | null | undefined,
  sections: SectionSummary[] | null | undefined,
): RoomSummary | null {
  if (choice === ALL_SECTIONS) return room ?? null;
  return (sections ?? []).find((section) => sectionKey(section.label) === choice) ?? null;
}

/**
 * One line per section, for when the teacher is looking at the whole class. This is
 * the comparison, and it deliberately reuses roomHeadline rather than inventing a
 * second way of saying what a room needs: two sentences side by side show a divergence
 * a threshold rule would have had to guess at.
 */
export function sectionHeadlines(
  sections: SectionSummary[] | null | undefined,
): Array<{ key: string; label: string; line: string }> {
  if (!sections || sections.length < 2) return [];
  return sections.map((section) => ({
    key: sectionKey(section.label),
    label: section.label ?? "No section",
    line: roomHeadline(section),
  }));
}
