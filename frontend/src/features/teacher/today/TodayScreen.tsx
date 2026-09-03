/**
 * Today: what the class learned, and what needs you now.
 *
 * The landing screen (rebuild brief, step 5). A teacher who opens Jargon and
 * does nothing else still learns something — the weekly digest reports what the
 * class actually did, and beneath it sit the only two things that can need a
 * person: a student in a lesson right now, and work waiting to be marked.
 *
 * It creates nothing. Work is set on the lesson it belongs to, which is the one
 * place that knows what it is for.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchClassCourseLinks } from "@/lib/api";
import { relTime } from "@/features/teacher/console/derive";
import { ClassRoomPanel } from "@/features/teacher/cognition/ClassRoomPanel";
import { liveNowRows, teachesLessonFor, toMarkRows } from "@/features/teacher/today/needsYou";
import type { Lesson, Profile, TeacherDashboardData } from "@/lib/types";

export function TodayScreen({
  classId,
  dashboard,
  profilesById,
  lessonsById,
  onWatch,
  onOpenStudent,
  onOpenWork,
}: {
  classId: string;
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
  lessonsById: Map<string, Lesson>;
  onWatch: (studentId: string, sessionId: string) => void;
  onOpenStudent: (studentId: string) => void;
  onOpenWork: (kind: "assignment" | "assessment", itemId: string) => void;
}) {
  const nowMs = Date.now();

  // Which courses this class teaches — so "in a lesson now" reports lessons of THIS
  // class, not whatever else a student shared with another of the teacher's classes.
  const classIds = dashboard.classes.map((row) => row.id);
  const linksQuery = useQuery({
    queryKey: ["classCourseLinks", classIds.join(",")],
    queryFn: () => fetchClassCourseLinks(classIds),
    enabled: classIds.length > 0,
    staleTime: 60 * 1000,
  });
  const teachesLesson = useMemo(
    () => teachesLessonFor(linksQuery.data, classId, lessonsById),
    [linksQuery.data, classId, lessonsById],
  );

  const live = liveNowRows(dashboard, classId, profilesById, lessonsById, teachesLesson);
  const toMark = toMarkRows(dashboard, classId, profilesById, lessonsById);

  return (
    <div className="panel-fade mt-4 grid gap-6">
      <h3 className="sr-only">Today</h3>

      {/* What the class learned. The reporting-back half of the pitch, and the
          reason this screen is worth opening on a quiet day. */}

      {/* R93: what the class LEARNED, one level below the digest's what-they-did.
          It sits above the two live sections because it is the thing a teacher plans
          tomorrow from, where those two are about the next ten minutes. */}
      <ClassRoomPanel classId={classId} profilesById={profilesById} onOpenStudent={onOpenStudent} />

      <section>
        <h4 className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          In a lesson now
        </h4>
        {live.length ? (
          <div className="mt-2 grid gap-2">
            {live.map((row) => (
              <div
                key={row.studentId}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-depth-sub py-2 pl-4 pr-2"
              >
                <button
                  type="button"
                  onClick={() => onOpenStudent(row.studentId)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-control py-1 text-left transition-colors hover:opacity-80"
                >
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                  </span>
                  <span className="min-w-0 truncate text-body font-medium text-foreground sm:min-w-[140px] sm:shrink-0">
                    {row.studentName}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                    {row.lessonTitle}
                    {row.stage ? ` · ${row.stage}` : ""} · {relTime(row.at, nowMs)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onWatch(row.studentId, row.sessionId)}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Watch
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-meta text-muted-foreground">
            No one is in a lesson right now — students appear here the moment they start one.
          </p>
        )}
      </section>

      <section>
        <h4 className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Waiting on you
        </h4>
        {toMark.length ? (
          <div className="mt-2 grid gap-2">
            {toMark.map((row) => (
              <button
                key={`${row.kind}:${row.itemId}:${row.studentName}:${row.at}`}
                type="button"
                onClick={() => onOpenWork(row.kind, row.itemId)}
                className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-depth-sub px-4 py-2.5 text-left transition-colors hover:bg-muted"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {row.studentName}
                  <span className="text-muted-foreground"> · {row.itemTitle}</span>
                </span>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground">
                  {row.kind === "assignment" ? "assignment" : "quiz"}
                </span>
                <span className="shrink-0 text-meta text-muted-foreground">
                  {relTime(row.at, nowMs)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-meta text-muted-foreground">
            Nothing is waiting on you — submitted work lands here the moment it arrives.
          </p>
        )}
      </section>
    </div>
  );
}
