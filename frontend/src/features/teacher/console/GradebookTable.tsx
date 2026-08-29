/**
 * The class's grades, one row per student.
 *
 * Every column is derived (see derive.ts); the table's own job is to stay
 * readable at narrow widths, which is why it scrolls inside its card rather
 * than pushing the page sideways.
 */
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { displayName, formatDateTime } from "@/features/teacher/classShared";
import { gradebookRowForStudent, statusLabel } from "@/features/teacher/console/derive";
import type { Lesson, Profile, TeacherDashboardData } from "@/lib/types";
import { UsersRound } from "lucide-react";

export function GradebookTable({
  lessons,
  lessonsById,
  studentIds,
  dashboard,
  profilesById,
  selectedLessonId,
  selectedStudentId,
  onSelectLesson,
  onSelectStudent,
}: {
  lessons: Lesson[];
  lessonsById: Map<string, Lesson>;
  studentIds: string[];
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
  selectedLessonId: string;
  selectedStudentId: string | null;
  onSelectLesson: (lessonId: string) => void;
  onSelectStudent: (studentId: string) => void;
}) {
  const rows = studentIds.map((studentId) =>
    gradebookRowForStudent(dashboard, studentId, selectedLessonId, lessons, lessonsById),
  );
  const lessonGroups = lessons.reduce<Record<string, Lesson[]>>((acc, lesson) => {
    const key = lesson.module || "Other";
    (acc[key] ??= []).push(lesson);
    return acc;
  }, {});

  return (
    <div className="mt-6 rounded-card border border-border bg-depth-card p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-title font-medium text-foreground">Gradebook</h3>
          <p className="text-meta text-muted-foreground">
            Scan completion, scores, attempts, quizzes, evidence, and attention signals.
          </p>
        </div>
        <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Lesson filter
          <select
            value={selectedLessonId}
            onChange={(event) => onSelectLesson(event.target.value)}
            className="jargon-input min-w-[220px] normal-case tracking-normal"
          >
            <option value="all">All lessons</option>
            {Object.entries(lessonGroups).map(([moduleName, moduleLessons]) => (
              <optgroup key={moduleName} label={moduleName}>
                {moduleLessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {rows.length ? (
        <>
          {/* On phones the wide table can't fit; show one stacked card per student. */}
          <div className="grid gap-2 md:hidden">
            {rows.map((row) => {
              const profile = profilesById.get(row.studentId) || null;
              const cardStats: { label: string; value: ReactNode }[] = [
                { label: "Score", value: row.scoreLabel },
                { label: "Attempts", value: row.attempts },
                { label: "Quiz", value: row.quizAttempts },
                { label: "Evidence", value: row.evidence },
                { label: "Mastery", value: row.mastery },
                {
                  label: "Last activity",
                  value: row.latestSession
                    ? formatDateTime(row.latestSession.updated_at)
                    : "No activity",
                },
              ];
              return (
                <button
                  key={row.studentId}
                  type="button"
                  onClick={() => onSelectStudent(row.studentId)}
                  className={`w-full rounded-card border border-border bg-depth-sub p-3 text-left transition-colors hover:bg-muted ${
                    selectedStudentId === row.studentId
                      ? "outline outline-1 outline-foreground/20"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-body font-medium text-foreground">
                        {displayName(profile, row.studentId)}
                      </div>
                      <div className="mt-0.5 text-meta text-muted-foreground">
                        {profile?.grade || "Grade not set"}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-meta ${row.statusClass}`}
                    >
                      {row.statusLabel}
                    </span>
                  </div>
                  {row.needsAttention ? (
                    <span className="mt-2 inline-block rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 text-meta text-warning">
                      Needs attention
                    </span>
                  ) : null}
                  {row.lessonDetail ? (
                    <div className="mt-1 text-meta text-muted-foreground">{row.lessonDetail}</div>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    {cardStats.map((stat) => (
                      <div key={stat.label}>
                        <div className="text-overline uppercase tracking-[0.1em] text-muted-foreground">
                          {stat.label}
                        </div>
                        <div className="mt-0.5 text-meta text-foreground">{stat.value}</div>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="table-scroll hidden max-h-[58vh] overflow-auto pb-1 md:block">
            {/* R53: rows inside a .table-scroll are hairline rows, never rounded
                row-cards — card borders sliced mid-strip at the clip edge when the
                table scrolled sideways. The Student column stays pinned via
                .table-sticky-cell (opaque, with a right-edge lip). */}
            <table className="min-w-[920px] w-full border-collapse text-left">
              <thead className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  <th className="table-sticky-cell top-0 z-[3] border-b border-border px-3 py-1.5 font-medium">
                    Student
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Lesson status
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Score
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Attempts
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Quiz
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Evidence
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Mastery
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Last activity
                  </th>
                  <th className="sticky top-0 z-[2] border-b border-border bg-depth-card px-3 py-1.5 font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const profile = profilesById.get(row.studentId) || null;
                  return (
                    <tr
                      key={row.studentId}
                      onClick={() => onSelectStudent(row.studentId)}
                      className={`group cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/50 ${
                        selectedStudentId === row.studentId
                          ? "outline outline-1 -outline-offset-1 outline-primary/45"
                          : ""
                      }`}
                    >
                      <td className="table-sticky-cell z-[1] px-3 py-3">
                        <div className="text-body font-medium text-foreground">
                          {displayName(profile, row.studentId)}
                        </div>
                        <div className="mt-1 text-meta text-muted-foreground">
                          {profile?.grade || "Grade not set"}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-meta ${row.statusClass}`}
                          >
                            {row.statusLabel}
                          </span>
                          {row.needsAttention ? (
                            <span className="rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 text-meta text-warning">
                              Needs attention
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-meta text-muted-foreground">
                          {row.lessonDetail}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-meta text-foreground">{row.scoreLabel}</td>
                      <td className="px-3 py-3 text-meta text-muted-foreground">{row.attempts}</td>
                      <td className="px-3 py-3 text-meta text-muted-foreground">
                        {row.quizAttempts}
                      </td>
                      <td className="px-3 py-3 text-meta text-muted-foreground">{row.evidence}</td>
                      <td className="px-3 py-3 text-meta text-muted-foreground">{row.mastery}</td>
                      <td className="px-3 py-3 text-meta text-muted-foreground">
                        {row.latestSession
                          ? formatDateTime(row.latestSession.updated_at)
                          : "No activity"}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => onSelectStudent(row.studentId)}
                          className="btn btn-secondary btn-sm"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState icon={UsersRound}>
          Add students to this class to populate the gradebook.
        </EmptyState>
      )}
    </div>
  );
}
