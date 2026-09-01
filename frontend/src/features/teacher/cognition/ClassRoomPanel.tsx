/**
 * The whole room, in one panel (R93, docs/COGNITION.md).
 *
 * R90 gives one profile per (student, lesson) and R92 makes them appear on their own.
 * This is the first surface that reads ACROSS the class, and the temptation it exists
 * to resist is the class average: "this class is at 2.7 / 4" is the rubric's own §15
 * failure one level up, and it tells a teacher nothing they can do on Monday.
 *
 * So the room is arranged by what to DO. One sentence saying what the room as a whole
 * needs, then students grouped by the move §19 would make for each of them — the alarm
 * first, the teachable groups next, the opportunity after, and the students nobody has
 * read yet named rather than quietly dropped.
 *
 * Names are resolved here, from the roster the console already holds: the function
 * returns ids and numbers and never a student's words.
 */
import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import { displayName } from "@/features/teacher/classShared";
import {
  ALL_SECTIONS,
  roomGroups,
  roomHeadline,
  sectionChoices,
  sectionHeadlines,
  studentsInSection,
  summaryForChoice,
  type RoomGroup,
} from "@/features/teacher/cognition/room";
import { fetchClassCognition, getSession, type ClassCognitionResponse } from "@/lib/api";
import type { Profile } from "@/lib/types";

const TONE_RING: Record<RoomGroup["tone"], string> = {
  alert: "border-warning/40 bg-warning/[0.06]",
  opportunity: "border-success/40 bg-success/[0.06]",
  neutral: "border-border bg-depth-sub",
  quiet: "border-border bg-transparent",
};

export function ClassRoomPanel({
  classId,
  profilesById,
  onOpenStudent,
}: {
  classId: string;
  profilesById: Map<string, Profile>;
  onOpenStudent: (studentId: string) => void;
}) {
  const [data, setData] = useState<ClassCognitionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // R94: which stream the teacher is looking at. Resets with the class, because a
  // section label is only meaningful inside the class that defines it.
  const [choice, setChoice] = useState<string>(ALL_SECTIONS);
  useEffect(() => setChoice(ALL_SECTIONS), [classId]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to read this class.");
        const result = await fetchClassCognition({
          accessToken: session.access_token,
          classId,
        });
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Could not read this class.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  useEffect(() => load(), [load]);

  const allStudents = data?.students ?? [];
  const choices = sectionChoices(data?.sections, data?.room);
  // A section that has gone away between loads must not leave the panel showing an
  // empty room with no way back.
  const active = choices.some((option) => option.key === choice) ? choice : ALL_SECTIONS;
  const students = studentsInSection(allStudents, active);
  const room = summaryForChoice(active, data?.room, data?.sections);
  const groups = roomGroups(students);
  // The comparison, and only when there is something to compare and the teacher is
  // looking at the whole class.
  const perSection = active === ALL_SECTIONS ? sectionHeadlines(data?.sections) : [];

  return (
    <section className="rounded-card border border-border bg-depth-sub p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          <Brain className="h-4 w-4" strokeWidth={1.6} />
          How the room is thinking
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="btn btn-ghost btn-sm shrink-0"
          aria-label="Refresh the room"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-meta text-danger">{error}</p>
      ) : loading && !data ? (
        <p className="mt-2 text-meta text-muted-foreground">Reading the room…</p>
      ) : (
        <>
          {/* The whole reason a class-level view earns its space: what does this room
              need from me, as one sentence, before any list of names. */}
          {choices.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {choices.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setChoice(option.key)}
                  aria-pressed={option.key === active}
                  className={`rounded-full border px-2.5 py-1 text-meta transition-colors ${
                    option.key === active
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-depth-field text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {option.label}
                  <span className="ml-1.5 text-muted-foreground">{option.students}</span>
                </button>
              ))}
            </div>
          ) : null}

          <p className="mt-3 font-serif text-body leading-relaxed text-foreground">
            {roomHeadline(room)}
          </p>

          {perSection.length ? (
            // Two sentences side by side show a divergence a threshold rule would have
            // had to guess at — and each is the SAME sentence the section gets when a
            // teacher selects it, so nothing here is a second opinion.
            <div className="mt-2.5 grid gap-1.5 border-l-2 border-border pl-3">
              {perSection.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setChoice(section.key)}
                  className="text-left text-meta leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="font-medium text-foreground">{section.label}</span>
                  {" — "}
                  {section.line}
                </button>
              ))}
            </div>
          ) : null}

          {groups.length ? (
            <div className="mt-4 grid gap-2.5">
              {groups.map((group) => (
                <div
                  key={group.key}
                  className={`rounded-card border px-3.5 py-3 ${TONE_RING[group.tone]}`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-body font-medium text-foreground">{group.title}</span>
                    <span className="text-meta text-muted-foreground">
                      {group.students.length}
                      {group.key.startsWith("needs:") ? " to steer" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
                    {group.body}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.students.map((student) => (
                      <button
                        key={student.user_id}
                        type="button"
                        onClick={() => onOpenStudent(student.user_id)}
                        title={
                          student.group === "unread"
                            ? `${student.turns_scored} response${student.turns_scored === 1 ? "" : "s"} judged so far`
                            : `${student.turns_scored} responses judged across ${student.lessons_read} lesson${student.lessons_read === 1 ? "" : "s"}`
                        }
                        className="rounded-full border border-border bg-depth-field px-2.5 py-1 text-meta text-foreground transition-colors hover:bg-muted"
                      >
                        {displayName(profilesById.get(student.user_id), student.user_id)}
                        {student.scaffold_trend === "falling" ? (
                          // The direction the rubric wants: they are needing less help.
                          <span className="ml-1 text-success" title="Needing less help than before">
                            ↓
                          </span>
                        ) : student.scaffold_trend === "rising" ? (
                          <span className="ml-1 text-warning" title="Needing more help than before">
                            ↑
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-meta text-muted-foreground">
              {active === ALL_SECTIONS
                ? "No students in this class yet."
                : "Nobody is in this section."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
