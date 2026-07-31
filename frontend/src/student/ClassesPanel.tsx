import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, GraduationCap, Loader2 } from "lucide-react";
import { Collapsible } from "@/components/Collapsible";
import { groupByUnit } from "@/features/student/lessonGroups";
import {
  fetchClassResources,
  fetchClassScopedLessons,
  fetchStudentClasses,
  fetchStudentGrades,
} from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";
import { checkpointRows, type CheckpointRowModel } from "@/student/checkpoints";
import { ResourceCard } from "@/student/ResourceCard";
import type {
  Lesson,
  LessonChatResource,
  StudentAssessmentBundle,
  StudentClass,
  StudentGradeRow,
} from "@/lib/types";

// The student's classes, each expanding into a small class canvas: an INFO strip (org,
// counts), then LESSONS / ASSIGNMENTS / GRADES / RESOURCES sections behind a tab strip.
// Everything loads lazily on first need — a student in four classes shouldn't pay for four
// catalogs, four resource lists, and a gradebook just to see their class names.
//
// Data reuse: the assessment bundle and grade rows are panel-level (they arrive as one fetch
// each and carry class_id), then filter per class. Lessons and resources are per-class calls.
// Clicking a lesson hands off to the shell — the same act as the sidebar tree.

export type ClassesPanelProps = {
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
  // The shell's formal-work bundle; feeds the Assignments section. Optional so the panel
  // still renders where the caller has nothing to pass.
  assessments?: StudentAssessmentBundle | null;
  onOpenAssessment?: (assessmentId: string) => void;
};

type ClassTab = "lessons" | "assignments" | "grades" | "resources";

const TABS: { id: ClassTab; label: string }[] = [
  { id: "lessons", label: "Lessons" },
  { id: "assignments", label: "Assignments" },
  { id: "grades", label: "Grades" },
  { id: "resources", label: "Resources" },
];

function AssignmentRow({
  row,
  onOpen,
}: {
  row: CheckpointRowModel;
  onOpen?: (assessmentId: string) => void;
}) {
  const actionable = (row.state === "todo" || row.state === "in_progress") && onOpen;
  const body = (
    <>
      <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
      {row.dueAt ? (
        <span className="shrink-0 text-meta text-muted-foreground">
          Due {formatDate(row.dueAt)}
        </span>
      ) : null}
      <span className="shrink-0 text-meta font-medium text-foreground">
        {row.state === "todo"
          ? "Start"
          : row.state === "in_progress"
            ? "Continue"
            : row.state === "waiting_review"
              ? "Submitted"
              : formatScore(row.score)}
      </span>
    </>
  );
  return (
    <li>
      {actionable ? (
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2.5 px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}

function ClassCard({
  klass,
  currentLessonId,
  onOpenLesson,
  assignmentRows,
  gradeRows,
  onOpenAssessment,
}: {
  klass: StudentClass;
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
  assignmentRows: CheckpointRowModel[];
  gradeRows: StudentGradeRow[];
  onOpenAssessment?: (assessmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ClassTab>("lessons");
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lessonsFailed, setLessonsFailed] = useState(false);
  const [resources, setResources] = useState<LessonChatResource[] | null>(null);
  const [resourcesFailed, setResourcesFailed] = useState(false);

  useEffect(() => {
    if (!open || lessons !== null || lessonsFailed) return;
    let cancelled = false;
    void fetchClassScopedLessons(klass.id)
      .then((rows) => !cancelled && setLessons(rows))
      .catch(() => !cancelled && setLessonsFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, lessons, lessonsFailed, klass.id]);

  useEffect(() => {
    if (!open || tab !== "resources" || resources !== null || resourcesFailed) return;
    let cancelled = false;
    void fetchClassResources(klass.id)
      .then((rows) => !cancelled && setResources(rows))
      .catch(() => !cancelled && setResourcesFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, tab, resources, resourcesFailed, klass.id]);

  const groups = useMemo(() => (lessons ? groupByUnit(lessons) : []), [lessons]);
  const due = assignmentRows.filter((r) => r.state === "todo" || r.state === "in_progress");
  const graded = gradeRows.filter((r) => r.score !== null);

  // The INFO strip: what this class is, from data already in hand.
  const infoBits = [
    klass.organizationName,
    lessons ? `${lessons.length} lesson${lessons.length === 1 ? "" : "s"}` : null,
    due.length ? `${due.length} due` : null,
    graded.length ? `${graded.length} graded` : null,
  ].filter(Boolean);

  const loading = (
    <p className="flex items-center gap-2 px-1 text-meta text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
    </p>
  );

  return (
    <div className="rounded-card border border-border bg-depth-card p-3">
      <Collapsible
        open={open}
        onToggle={() => setOpen((v) => !v)}
        headerClassName="rounded-control px-1 py-1 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
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
        meta={
          due.length ? (
            <span className="shrink-0 rounded-pill bg-foreground px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-background">
              {due.length}
            </span>
          ) : undefined
        }
        bodyClassName="pt-2"
      >
        {infoBits.length ? (
          <p className="mb-2 px-1 text-meta text-muted-foreground">{infoBits.join(" · ")}</p>
        ) : null}

        <div role="tablist" aria-label={`${klass.name} sections`} className="mb-2 flex gap-1 px-1">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            const count =
              id === "assignments" ? assignmentRows.length : id === "grades" ? graded.length : 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={`rounded-pill border px-2.5 py-1 text-meta transition-colors duration-(--dur-fast) ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                {count ? <span className="pl-1 tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {tab === "lessons" ? (
          lessonsFailed ? (
            <p className="px-1 text-meta text-muted-foreground">
              Couldn&rsquo;t load this class&rsquo;s lessons.
            </p>
          ) : lessons === null ? (
            loading
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
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )
        ) : tab === "assignments" ? (
          assignmentRows.length ? (
            <ul className="flex flex-col">
              {assignmentRows.map((row) => (
                <AssignmentRow key={row.id} row={row} onOpen={onOpenAssessment} />
              ))}
            </ul>
          ) : (
            <p className="px-1 text-meta text-muted-foreground">
              Nothing assigned in this class yet.
            </p>
          )
        ) : tab === "grades" ? (
          graded.length ? (
            <ul className="flex flex-col px-1">
              {graded.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline gap-3 border-b border-border py-2 last:border-0"
                >
                  <GraduationCap
                    className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground"
                    strokeWidth={1.6}
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">
                    {row.title}
                  </span>
                  <span className="shrink-0 text-meta capitalize text-muted-foreground">
                    {row.kind}
                  </span>
                  <span className="shrink-0 text-meta font-medium tabular-nums text-foreground">
                    {formatScore(row.score)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-meta text-muted-foreground">
              No graded work in this class yet.
            </p>
          )
        ) : resourcesFailed ? (
          <p className="px-1 text-meta text-muted-foreground">
            Couldn&rsquo;t load this class&rsquo;s materials.
          </p>
        ) : resources === null ? (
          loading
        ) : resources.length ? (
          <div className="flex flex-col gap-2">
            {resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-meta text-muted-foreground">
            No materials shared with this class yet.
          </p>
        )}
      </Collapsible>
    </div>
  );
}

export function ClassesPanel({
  currentLessonId,
  onOpenLesson,
  assessments,
  onOpenAssessment,
}: ClassesPanelProps) {
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [error, setError] = useState("");
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);

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
    void fetchStudentGrades()
      .then((rows) => !cancelled && setGrades(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-class assignment rows: the unified checkpoint rows, resolved back to their class
  // through the assessment's class_id.
  const rowsByClass = useMemo(() => {
    const map = new Map<string, CheckpointRowModel[]>();
    if (!assessments) return map;
    const classByAssessment = new Map(assessments.assessments.map((a) => [a.id, a.class_id]));
    for (const row of checkpointRows(assessments)) {
      const classId = classByAssessment.get(row.id);
      if (!classId) continue;
      map.set(classId, [...(map.get(classId) ?? []), row]);
    }
    return map;
  }, [assessments]);

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
          assignmentRows={rowsByClass.get(klass.id) ?? []}
          gradeRows={grades.filter((row) => row.class_id === klass.id)}
          onOpenAssessment={onOpenAssessment}
        />
      ))}
    </div>
  );
}
