import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GraduationCap, Loader2 } from "lucide-react";
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
import { ProgressGlyph } from "@/student/LessonTree";
import { ResourceCard } from "@/student/ResourceCard";
import type {
  Lesson,
  LessonChatResource,
  StudentAssessmentBundle,
  StudentClass,
  StudentGradeRow,
} from "@/lib/types";

// The student's classes in the board-5b tree-card language: a monogram avatar identity row
// with a mono completed-fraction and a due tag, expanding into LESSONS / ASSIGNMENTS /
// GRADES / RESOURCES. Lessons carry the ring+dot progress glyphs and struck-through
// completed titles — the same vocabulary as the sidebar tree, so a class never reads as a
// flat list of strings.
//
// Disclosure: secondary meta and per-row actions tuck away and reveal on hover/focus
// (.hvp/.hvr — the teacher-row "Step in →" pattern from the design bundle).
//
// Data reuse: the assessment bundle, grade rows, and the shell's per-lesson progress map are
// panel-level; lessons and resources are per-class lazy calls.

export type ClassesPanelProps = {
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
  assessments?: StudentAssessmentBundle | null;
  onOpenAssessment?: (assessmentId: string) => void;
  // The shell's per-lesson 0..1 progress map — drives glyphs and fractions.
  progress?: Record<string, number>;
};

type ClassTab = "lessons" | "assignments" | "grades" | "resources";

const TABS: { id: ClassTab; label: string }[] = [
  { id: "lessons", label: "Lessons" },
  { id: "assignments", label: "Assignments" },
  { id: "grades", label: "Grades" },
  { id: "resources", label: "Resources" },
];

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

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
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{row.title}</span>
      {row.dueAt ? (
        <span className="hvr shrink-0 text-meta text-muted-foreground">
          Due {formatDate(row.dueAt)}
        </span>
      ) : null}
      <span className="shrink-0 text-meta font-semibold text-foreground">
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
          className="hvp flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          {body}
        </button>
      ) : (
        <div className="hvp flex w-full items-center gap-2.5 px-2 py-1.5">{body}</div>
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
  progress,
  onOpenAssessment,
}: {
  klass: StudentClass;
  currentLessonId: string | null;
  onOpenLesson: (lessonId: string) => void;
  assignmentRows: CheckpointRowModel[];
  gradeRows: StudentGradeRow[];
  progress: Record<string, number>;
  onOpenAssessment?: (assessmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ClassTab>("lessons");
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lessonsFailed, setLessonsFailed] = useState(false);
  const [resources, setResources] = useState<LessonChatResource[] | null>(null);
  const [resourcesFailed, setResourcesFailed] = useState(false);

  // Lessons load as soon as the card is on screen (not on expand) so the header's
  // completed-fraction is real, not a dash.
  useEffect(() => {
    if (lessons !== null || lessonsFailed) return;
    let cancelled = false;
    void fetchClassScopedLessons(klass.id)
      .then((rows) => !cancelled && setLessons(rows))
      .catch(() => !cancelled && setLessonsFailed(true));
    return () => {
      cancelled = true;
    };
  }, [lessons, lessonsFailed, klass.id]);

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
  const done = (lessons ?? []).filter((l) => (progress[l.id] ?? 0) >= 1).length;

  const loading = (
    <p className="flex items-center gap-2 px-1 text-meta text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
    </p>
  );

  return (
    <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
      {/* The header owns its own reveal scope (hvp) so hovering the card body doesn't
          light up every row's tucked action at once. */}
      <Collapsible
        open={open}
        onToggle={() => setOpen((v) => !v)}
        headerClassName="hvp rounded-control px-1 py-1 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
        title={
          <span className="flex min-w-0 items-center gap-3">
            {/* The board's soft-circle monogram avatar — same anatomy as every circle control. */}
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-overline font-bold text-muted-foreground"
              style={{
                background:
                  "radial-gradient(circle at 32% 28%, var(--depth-field), var(--depth-sub))",
              }}
              aria-hidden
            >
              {monogram(klass.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{klass.name}</span>
              {klass.organizationName ? (
                <span className="block truncate text-meta text-muted-foreground">
                  {klass.organizationName}
                </span>
              ) : null}
            </span>
          </span>
        }
        meta={
          <span className="flex shrink-0 items-center gap-2.5">
            {lessons ? (
              <span
                className="font-mono text-overline tracking-[0.14em] text-muted-foreground"
                aria-label={`${done} of ${lessons.length} lessons complete`}
              >
                {done}/{lessons.length}
              </span>
            ) : null}
            {due.length ? (
              <span
                className="ds-tag px-2 py-0.5 text-overline"
                style={{
                  ["--tag-bg" as string]: "var(--mode-open)",
                  ["--tag-ink" as string]: "var(--mode-open-ink)",
                }}
              >
                {due.length} due
              </span>
            ) : null}
            {/* The teacher-row reveal: the card's action shows itself on hover. */}
            <span className="hvr inline-flex items-center gap-1 rounded-pill border border-border px-2.5 py-1 text-meta font-semibold text-foreground">
              {open ? "Close" : "Open"}
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </span>
          </span>
        }
        bodyClassName="pt-3"
      >
        <div
          role="tablist"
          aria-label={`${klass.name} sections`}
          className="mb-2.5 flex gap-1 px-1"
        >
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
                className={`rounded-pill border px-2.5 py-1 text-meta font-semibold transition-colors duration-(--dur-fast) ${
                  active
                    ? "border-transparent bg-primary text-background"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                {count ? <span className="pl-1 font-mono tabular-nums">{count}</span> : null}
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
            <div className="flex flex-col gap-2.5">
              {groups.map((group) => {
                const unitDone = group.lessons.filter((l) => (progress[l.id] ?? 0) >= 1).length;
                return (
                  <div key={group.unitId}>
                    <div className="mb-1 flex items-baseline px-1">
                      <span className="min-w-0 flex-1 truncate font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
                        {group.unitTitle}
                      </span>
                      <span className="shrink-0 pl-2 font-mono text-overline tracking-[0.14em] text-muted-foreground">
                        {unitDone}/{group.lessons.length}
                      </span>
                    </div>
                    {group.lessons.map((lesson) => {
                      const current = lesson.id === currentLessonId;
                      const value = progress[lesson.id] ?? 0;
                      return (
                        <button
                          key={lesson.id}
                          type="button"
                          onClick={() => onOpenLesson(lesson.id)}
                          aria-current={current ? "true" : undefined}
                          className={`hvp flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left text-body transition-colors duration-(--dur-fast) ${
                            current
                              ? "bg-muted font-semibold text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <ProgressGlyph value={value} current={current} />
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              value >= 1 && !current
                                ? "line-through decoration-[var(--ink-16)]"
                                : ""
                            }`}
                          >
                            {lesson.title}
                          </span>
                          <span className="hvr inline-flex shrink-0 items-center gap-1 rounded-pill border border-border px-2 py-0.5 text-overline font-semibold text-foreground">
                            {value >= 1 ? "Revisit" : value > 0 ? "Continue" : "Start"}
                            <ArrowRight className="h-2.5 w-2.5" strokeWidth={2.2} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
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
                  className="hvp flex items-baseline gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">
                    {row.title}
                  </span>
                  <span className="hvr shrink-0 text-meta capitalize text-muted-foreground">
                    {row.kind}
                  </span>
                  <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-foreground">
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
  progress = {},
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
    <div className="flex w-full flex-col gap-2.5">
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {classes.map((klass) => (
        <ClassCard
          key={klass.id}
          klass={klass}
          currentLessonId={currentLessonId}
          onOpenLesson={onOpenLesson}
          assignmentRows={rowsByClass.get(klass.id) ?? []}
          gradeRows={grades.filter((row) => row.class_id === klass.id)}
          progress={progress}
          onOpenAssessment={onOpenAssessment}
        />
      ))}
    </div>
  );
}
