import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { Collapsible } from "@/components/Collapsible";
import { EmptyState } from "@/components/EmptyState";
import { fetchClassCourses } from "@/lib/api";
import type { Lesson, TeacherDashboardData } from "@/lib/types";
import { groupByUnit } from "@/features/student/lessonGroups";
import { LinkedCoursesPanel } from "@/features/teacher/LinkedCoursesPanel";
import { unifiedLessonStatus } from "@/features/teacher/lessonStatus";

// The class's curriculum structure: linked courses → units → lessons, with publish state
// and honest per-lesson class progress (unifiedLessonStatus — activities + required
// checkpoints, same math as the gradebook). Scoping mirrors fetchClassScopedLessons: the
// class's class_courses links filter the catalog; an empty link set means no scoping (full
// catalog). Drafts stay visible — publish state is the point of this view. Editing
// deep-links into the curriculum studio by lesson id (the studio's class scope isn't
// URL-addressable; the node still selects and its ancestors auto-expand).
export function ClassStructurePanel({
  classId,
  lessons,
  dashboard,
  studentIds,
  onOpenGradebook,
}: {
  classId: string;
  lessons: Lesson[];
  dashboard: TeacherDashboardData;
  studentIds: string[];
  onOpenGradebook: (lessonId: string) => void;
}) {
  const navigate = useNavigate();
  // null = loading; a failed read degrades to an empty set (= unscoped full catalog) but is
  // labeled honestly via loadError.
  const [courseIds, setCourseIds] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Per-course open overrides; courses without an override follow the default (open for small
  // catalogs, closed when the list is long — e.g. the unscoped full-catalog case).
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    setCourseIds(null);
    setLoadError(false);
    setOpenOverrides({});
    fetchClassCourses(classId)
      .then((ids) => {
        if (alive) setCourseIds(new Set(ids));
      })
      .catch(() => {
        if (alive) {
          setLoadError(true);
          setCourseIds(new Set());
        }
      });
    return () => {
      alive = false;
    };
  }, [classId]);

  const scoped = useMemo(() => {
    if (!courseIds) return null;
    return courseIds.size
      ? lessons.filter((lesson) => lesson.course_id && courseIds.has(lesson.course_id))
      : lessons;
  }, [lessons, courseIds]);

  const courses = useMemo(() => {
    if (!scoped) return [];
    const byCourse = new Map<string, { title: string; lessons: Lesson[] }>();
    for (const lesson of scoped) {
      const id = lesson.course_id || "__none__";
      let bucket = byCourse.get(id);
      if (!bucket) {
        bucket = {
          title: lesson.course_id ? lesson.course_title || lesson.course_id : "Other lessons",
          lessons: [],
        };
        byCourse.set(id, bucket);
      }
      bucket.lessons.push(lesson);
    }
    return Array.from(byCourse, ([id, bucket]) => ({
      id,
      title: bucket.title,
      units: groupByUnit(bucket.lessons),
      count: bucket.lessons.length,
    })).sort((a, b) =>
      a.id === "__none__" ? 1 : b.id === "__none__" ? -1 : a.title.localeCompare(b.title),
    );
  }, [scoped]);

  // One pass over the scoped catalog; checkpointIndexFor's WeakMap keeps the per-cell cost
  // identical to the roster progress grid's.
  const completeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!scoped) return counts;
    for (const lesson of scoped) {
      let complete = 0;
      for (const studentId of studentIds) {
        if (unifiedLessonStatus(dashboard, studentId, lesson.id).status === "Complete") {
          complete += 1;
        }
      }
      counts.set(lesson.id, complete);
    }
    return counts;
  }, [scoped, dashboard, studentIds]);

  // Open by default only while the list is small; the unscoped full catalog can be the whole
  // org's curriculum, so long lists start folded to stay scannable (and cheap to lay out).
  const defaultOpen = courses.length <= 3;
  const toggleCourse = (id: string) => {
    setOpenOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultOpen) }));
  };

  return (
    <div className="mt-5">
      <div className="rounded-3xl border border-border bg-depth-card p-4">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-[15px] font-medium text-foreground">Class structure</h3>
            <p className="text-[12.5px] text-muted-foreground">
              The courses, units, and lessons this class works through — with publish state and
              class progress.
            </p>
          </div>
          {scoped ? (
            <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
              {scoped.length} lesson{scoped.length === 1 ? "" : "s"}
              {loadError
                ? " · couldn't load course links — showing all"
                : courseIds && !courseIds.size
                  ? " · all courses"
                  : ""}
            </div>
          ) : null}
        </div>

        {!scoped ? (
          <p className="text-[12.5px] text-muted-foreground">Loading structure…</p>
        ) : !courses.length ? (
          <EmptyState>
            No lessons in this class's linked courses yet. Link a course below or author lessons in
            the curriculum studio.
          </EmptyState>
        ) : (
          <div className="grid gap-2">
            {courses.map((course) => (
              <div key={course.id} className="rounded-2xl border border-border bg-depth-sub p-3">
                <Collapsible
                  open={openOverrides[course.id] ?? defaultOpen}
                  onToggle={() => toggleCourse(course.id)}
                  title={
                    <span className="text-[13px] font-medium text-foreground">{course.title}</span>
                  }
                  meta={
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">
                      {course.count} lesson{course.count === 1 ? "" : "s"}
                    </span>
                  }
                  headerClassName="rounded-xl px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                  bodyClassName="mt-1 grid gap-2 pl-2"
                >
                  {course.units.map((unit) => (
                    <div key={unit.unitId}>
                      {course.units.length > 1 || unit.unitTitle !== course.title ? (
                        <div className="mb-1 mt-1 px-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          {unit.unitTitle}
                        </div>
                      ) : null}
                      <div className="grid gap-1">
                        {unit.lessons.map((lesson) => {
                          const complete = completeCounts.get(lesson.id) ?? 0;
                          return (
                            <div
                              key={lesson.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/45 px-3 py-2"
                            >
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="min-w-0 truncate text-[12.5px] text-foreground">
                                  {lesson.title}
                                </span>
                                {lesson.publication_status &&
                                lesson.publication_status !== "published" ? (
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10.5px] capitalize ${
                                      lesson.publication_status === "archived"
                                        ? "border-border bg-background/45 text-muted-foreground"
                                        : "border-warning/40 bg-warning/12 text-warning"
                                    }`}
                                  >
                                    {lesson.publication_status}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <span className="text-[11.5px] text-muted-foreground">
                                  {studentIds.length
                                    ? `${complete}/${studentIds.length} complete`
                                    : "No students"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onOpenGradebook(lesson.id)}
                                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  Gradebook
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void navigate({
                                      to: "/teacher/curriculum",
                                      search: { lesson: lesson.id },
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <Pencil className="h-3 w-3" strokeWidth={1.7} />
                                  Edit
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </Collapsible>
              </div>
            ))}
          </div>
        )}

        <LinkedCoursesPanel
          classId={classId}
          lessons={lessons}
          onSaved={(ids) => setCourseIds(new Set(ids))}
        />
      </div>
    </div>
  );
}
