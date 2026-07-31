import { useEffect, useMemo, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { Collapsible } from "@/components/Collapsible";
import { groupByUnit } from "@/features/student/lessonGroups";
import { fetchClassScopedLessons, fetchStudentClasses } from "@/lib/api";
import type { Lesson, StudentClass } from "@/lib/types";

// The Classes destination: the student's real class list (fetchStudentClasses — active
// memberships resolved to class + org names), each expanding to that class's scoped lesson
// catalog (fetchClassScopedLessons: linked courses, or the full catalog when unlinked).
// Clicking a lesson hands off to the shell, which jumps to Learn and opens it — the same act
// as the sidebar tree, so the two paths cannot drift.
//
// Lessons load lazily on first expand: a student in four classes shouldn't pay for four
// catalog reads to see their class names.

export type ClassesPanelProps = {
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
};

function ClassCard({
  klass,
  currentLessonId,
  onOpenLesson,
}: {
  klass: StudentClass;
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || lessons !== null || failed) return;
    let cancelled = false;
    void fetchClassScopedLessons(klass.id)
      .then((rows) => !cancelled && setLessons(rows))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, lessons, failed, klass.id]);

  const groups = useMemo(() => (lessons ? groupByUnit(lessons) : []), [lessons]);

  return (
    <div className="rounded-card border border-border bg-depth-card p-3">
      <Collapsible
        open={open}
        onToggle={() => setOpen((v) => !v)}
        headerClassName="rounded-control px-1 py-1 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted/60"
        title={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-medium">{klass.name}</span>
            {klass.organizationName ? (
              <span className="truncate text-meta text-muted-foreground">
                {klass.organizationName}
              </span>
            ) : null}
          </span>
        }
        bodyClassName="pt-2"
      >
        {failed ? (
          <p className="px-1 text-meta text-muted-foreground">
            Couldn't load this class's lessons.
          </p>
        ) : lessons === null ? (
          <p className="flex items-center gap-2 px-1 text-meta text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lessons…
          </p>
        ) : !groups.length ? (
          <p className="px-1 text-meta text-muted-foreground">No published lessons yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((group) => (
              <div key={group.unitId}>
                <div className="mb-0.5 px-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {group.unitTitle}
                </div>
                {group.lessons.map((lesson) => {
                  const current = lesson.id === currentLessonId;
                  return (
                    <button
                      key={lesson.id}
                      type="button"
                      onClick={() => onOpenLesson(lesson.id)}
                      aria-current={current ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-body transition-colors duration-(--dur-fast) ${
                        current
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Collapsible>
    </div>
  );
}

export function ClassesPanel({ currentLessonId, onOpenLesson }: ClassesPanelProps) {
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchStudentClasses()
      .then((rows) => !cancelled && setClasses(rows))
      .catch(() => {
        if (!cancelled) {
          setClasses([]);
          setError("Couldn't load your classes. Check your connection and try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (classes === null) {
    return (
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your classes…
      </p>
    );
  }
  if (!classes.length) {
    return (
      <div className="rounded-card border border-dashed border-border bg-depth-sub p-6">
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <GraduationCap className="h-4 w-4" strokeWidth={1.6} />
          {error || "You're not in a class yet — your school adds you, nothing to do here."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {classes.map((klass) => (
        <ClassCard
          key={klass.id}
          klass={klass}
          currentLessonId={currentLessonId}
          onOpenLesson={onOpenLesson}
        />
      ))}
    </div>
  );
}
