/**
 * One class, in three rooms: Students, Activity, Content.
 *
 * This is the surface the rebuild brief is aimed at. It is extracted whole and
 * unchanged so that the redesign happens against readable code rather than
 * inside a 4,500-line file.
 */
import { Suspense, lazy, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssessmentWorkView } from "@/features/teacher/AssessmentGrading";
import { AssignmentWorkView } from "@/features/teacher/AssignmentGrading";
import { ClassDigestCard } from "@/features/teacher/ClassDigestCard";
import type { ClassworkItem } from "@/features/teacher/authoring/types";
import { displayName, lessonName } from "@/features/teacher/classShared";
import { AssessmentManager } from "@/features/teacher/console/AssessmentManager";
import type { AssessmentFormValues } from "@/features/teacher/console/AssessmentManager";
import { AssignmentManager } from "@/features/teacher/console/AssignmentManager";
import type { AssignmentFormValues } from "@/features/teacher/console/AssignmentManager";
import { GradebookTable } from "@/features/teacher/console/GradebookTable";
import { ResourceManager } from "@/features/teacher/console/ResourceManager";
import type { ResourceFormValues } from "@/features/teacher/console/ResourceManager";
import {
  classSignals,
  globalReviewRows,
  gradeChipLabel,
  gradeSummariesForClass,
  relTime,
  studentContextLine,
} from "@/features/teacher/console/derive";
import { CLASS_SECTIONS } from "@/features/teacher/shell/teacherNav";
import type { ClassSection } from "@/features/teacher/shell/teacherNav";
import type {
  Assessment,
  AssessmentAttempt,
  AssessmentItem,
  AssessmentItemAttempt,
  AssessmentRecipient,
  AssessmentStatus,
  Assignment,
  AssignmentRecipient,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  CurriculumQuizItem,
  LearningSession,
  Lesson,
  LessonResource,
  Profile,
  TeacherClassSummary,
  TeacherDashboardData,
} from "@/lib/types";
import { useNavigate } from "@tanstack/react-router";

// R42: the class's curriculum lives inside the class. R80: it is the Course screen —
// the outline and nothing beside it — and it still loads on demand the first time the
// section opens, so the Students landing stays as light as before.
const CourseScreen = lazy(() =>
  import("@/features/teacher/course/CourseScreen").then((module) => ({
    default: module.CourseScreen,
  })),
);

export function ClassDetail({
  item,
  dashboard,
  profilesById,
  lessons,
  lessonsById,
  resources,
  assignments,
  assignmentRecipients,
  assignmentSubmissions,
  assignmentSubmissionFiles,
  assessments,
  assessmentItems,
  assessmentRecipients,
  assessmentAttempts,
  assessmentItemAttempts,
  quizItems,
  studentIds,
  selectedLessonId,
  selectedStudentId,
  onSelectLesson,
  onSelectStudent,
  savingResource,
  savingAssignment,
  savingAssessment,
  onSaveResource,
  onSaveAssignment,
  onSaveAssessment,
  onSetAssignmentStatus,
  onSetAssessmentStatus,
  onReviewSubmission,
  onReviewAssessmentItem,
  onReturnAssessment,
  onUpdateResource,
  section,
  openAssignmentId,
  openAssessmentId,
  onSetSection,
  onListEnrollable,
  onEnroll,
}: {
  item: TeacherClassSummary;
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  lessonsById: Map<string, Lesson>;
  resources: LessonResource[];
  assignments: Assignment[];
  assignmentRecipients: AssignmentRecipient[];
  assignmentSubmissions: AssignmentSubmission[];
  assignmentSubmissionFiles: AssignmentSubmissionFile[];
  assessments: Assessment[];
  assessmentItems: AssessmentItem[];
  assessmentRecipients: AssessmentRecipient[];
  assessmentAttempts: AssessmentAttempt[];
  assessmentItemAttempts: AssessmentItemAttempt[];
  quizItems: CurriculumQuizItem[];
  studentIds: string[];
  selectedLessonId: string;
  selectedStudentId: string | null;
  onSelectLesson: (lessonId: string) => void;
  onSelectStudent: (studentId: string) => void;
  savingResource: boolean;
  savingAssignment: boolean;
  savingAssessment: boolean;
  onSaveResource: (input: ResourceFormValues) => Promise<void>;
  onSaveAssignment: (input: AssignmentFormValues) => Promise<void>;
  onSaveAssessment: (input: AssessmentFormValues) => Promise<void>;
  onSetAssignmentStatus: (assignmentId: string, status: AssignmentStatus) => void;
  onSetAssessmentStatus: (assessmentId: string, status: AssessmentStatus) => void;
  onReviewSubmission: (input: {
    assignment: Assignment;
    submission: AssignmentSubmission;
    scorePercent: number;
    feedback: string;
    decision: "accepted" | "returned";
  }) => Promise<void>;
  onReviewAssessmentItem: (input: {
    itemAttemptId: string;
    scorePercent: number;
    feedback: string;
  }) => Promise<void>;
  onReturnAssessment: (input: { attemptId: string; feedback: string }) => Promise<void>;
  onUpdateResource: (resource: LessonResource) => void;
  section: ClassSection;
  // R47: a work item opened inside Classwork (?assignment= / ?assessment=) — the
  // student-work view takes the surface over from the studio while set.
  openAssignmentId: string | null;
  openAssessmentId: string | null;
  // R45 sections — student groupings within the class.
  onSetSection: (studentId: string, section: string | null) => Promise<void>;
  onListEnrollable: () => Promise<Array<{ user_id: string; name: string; grade: string | null }>>;
  onEnroll: (userIds: string[], section: string | null) => Promise<void>;
}) {
  const navigate = useNavigate();
  // R47: the one + Create menu — everything a teacher makes starts from the same button.
  // Which create dialog is open (null = none); "material" reuses ResourceManager's dialog.
  const [createOpen, setCreateOpen] = useState<"assignment" | "assessment" | "material" | null>(
    null,
  );
  // R48: when + Create was invoked FROM a lesson step ("create the assignment for this
  // step"), the dialog locks the lesson and stamps the step link on the created row.
  // R80: work created from HERE belongs to the class, not to a lesson or a step —
  // those are created on the lesson's own screen, which supplies its own context.
  // A material row opened for editing from the Classwork list.
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);

  // R45 sections: the roster is grouped by section (a label on the class membership).
  const sectionByStudent = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const membership of dashboard.memberships) {
      if (membership.class_id === item.id && membership.role === "student") {
        map.set(membership.user_id, membership.section ?? null);
      }
    }
    return map;
  }, [dashboard.memberships, item.id]);
  const sectionNames = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(sectionByStudent.values()).filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [sectionByStudent],
  );
  const sectionGroups = useMemo(() => {
    const groups = new Map<string | null, string[]>();
    for (const studentId of studentIds) {
      const label = sectionByStudent.get(studentId) ?? null;
      const list = groups.get(label) ?? [];
      list.push(studentId);
      groups.set(label, list);
    }
    const named = (
      Array.from(groups.entries()).filter(([label]) => label !== null) as Array<[string, string[]]>
    ).sort((a, b) => a[0].localeCompare(b[0]));
    const result: Array<{ label: string | null; students: string[] }> = named.map(
      ([label, students]) => ({ label, students }),
    );
    const unsectioned = groups.get(null);
    if (unsectioned) result.push({ label: null, students: unsectioned });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentIds.join(","), sectionByStudent]);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollable, setEnrollable] = useState<Array<{
    user_id: string;
    name: string;
    grade: string | null;
  }> | null>(null);
  const [enrollChecked, setEnrollChecked] = useState<Set<string>>(() => new Set());
  const [enrollSection, setEnrollSection] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const openEnroll = () => {
    setEnrollOpen(true);
    setEnrollable(null);
    setEnrollChecked(new Set());
    setRosterError(null);
    void onListEnrollable()
      .then(setEnrollable)
      .catch((error) => {
        setEnrollable([]);
        setRosterError((error as Error).message || "Could not load the school's students.");
      });
  };

  const submitEnroll = async () => {
    if (!enrollChecked.size) return;
    setEnrollBusy(true);
    setRosterError(null);
    try {
      await onEnroll(Array.from(enrollChecked), enrollSection.trim() || null);
      setEnrollOpen(false);
    } catch (error) {
      setRosterError((error as Error).message || "Could not add those students.");
    } finally {
      setEnrollBusy(false);
    }
  };

  // R46 roster context: who's live right now, and who has work waiting in Review.
  const nowMs = Date.now();
  const liveByStudent = useMemo(() => {
    const map = new Map<string, LearningSession>();
    for (const session of dashboard.sessions) {
      if (session.status === "complete") continue;
      const existing = map.get(session.user_id);
      if (!existing || session.updated_at > existing.updated_at) {
        map.set(session.user_id, session);
      }
    }
    return map;
  }, [dashboard.sessions]);
  const signals = useMemo(() => classSignals(dashboard, item.id), [dashboard, item.id]);
  // R60 Students: per-student grade rollup for the roster chips, one pass per snapshot.
  const gradeSummaries = useMemo(
    () => gradeSummariesForClass(dashboard, item.id),
    [dashboard, item.id],
  );
  // R60 Activity: this class's slice of the review queue (materials belong to Content).
  const reviewRows = useMemo(
    () =>
      globalReviewRows(dashboard, profilesById, lessonsById).filter(
        (row) => row.classId === item.id,
      ),
    [dashboard, profilesById, lessonsById, item.id],
  );
  // Live tab rows: this class's students with an unfinished session, most recent first.
  const liveStudents = useMemo(
    () =>
      studentIds
        .filter((studentId) => liveByStudent.has(studentId))
        .sort((a, b) =>
          (liveByStudent.get(b)?.updated_at ?? "").localeCompare(
            liveByStudent.get(a)?.updated_at ?? "",
          ),
        ),
    [studentIds, liveByStudent],
  );

  // R47 Classwork: every work item as a lightweight row for the studio's list — the studio
  // groups them under its unit headings via the item's lesson. Counts feed the row badges.
  const workItems = useMemo<ClassworkItem[]>(() => {
    const submittedByAssignment = new Map<string, { submitted: number; toReview: number }>();
    for (const submission of dashboard.assignmentSubmissions) {
      const entry = submittedByAssignment.get(submission.assignment_id) ?? {
        submitted: 0,
        toReview: 0,
      };
      entry.submitted += 1;
      if (submission.status === "submitted") entry.toReview += 1;
      submittedByAssignment.set(submission.assignment_id, entry);
    }
    const attemptsByAssessment = new Map<string, { submitted: number; toReview: number }>();
    for (const attempt of dashboard.assessmentAttempts) {
      const entry = attemptsByAssessment.get(attempt.assessment_id) ?? {
        submitted: 0,
        toReview: 0,
      };
      entry.submitted += 1;
      if (attempt.status === "submitted") entry.toReview += 1;
      attemptsByAssessment.set(attempt.assessment_id, entry);
    }
    return [
      ...assignments
        .filter((assignment) => assignment.status !== "archived")
        .map((assignment) => ({
          kind: "assignment" as const,
          id: assignment.id,
          lessonId: assignment.lesson_id,
          activityId: assignment.activity_id ?? null,
          title: assignment.title || "Assignment",
          status: assignment.status,
          dueAt: assignment.due_at,
          needsReviewCount: submittedByAssignment.get(assignment.id)?.toReview ?? 0,
          submittedCount: submittedByAssignment.get(assignment.id)?.submitted ?? 0,
        })),
      ...assessments
        .filter((assessment) => assessment.status !== "archived")
        .map((assessment) => ({
          kind: "assessment" as const,
          id: assessment.id,
          lessonId: assessment.lesson_id,
          activityId: assessment.activity_id ?? null,
          title: assessment.title || "Quiz",
          status: assessment.status,
          dueAt: assessment.due_at,
          needsReviewCount: attemptsByAssessment.get(assessment.id)?.toReview ?? 0,
          submittedCount: attemptsByAssessment.get(assessment.id)?.submitted ?? 0,
        })),
      ...resources
        .filter((resource) => resource.status !== "archived")
        .map((resource) => ({
          kind: "material" as const,
          id: resource.id,
          lessonId: resource.lesson_id,
          activityId: resource.activity_id ?? null,
          title: resource.title || "Material",
          status: resource.status,
          dueAt: null,
          needsReviewCount: 0,
          submittedCount: 0,
        })),
    ];
  }, [
    assignments,
    assessments,
    resources,
    dashboard.assignmentSubmissions,
    dashboard.assessmentAttempts,
  ]);
  const activityItems = useMemo(
    () =>
      workItems
        .filter((entry) => entry.kind !== "material")
        .slice()
        .sort(
          (a, b) =>
            b.needsReviewCount - a.needsReviewCount ||
            (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
        ),
    [workItems],
  );
  const [studentsView, setStudentsView] = useState<"roster" | "gradebook">("roster");

  const openAssignment = openAssignmentId
    ? (assignments.find((assignment) => assignment.id === openAssignmentId) ?? null)
    : null;
  const openAssessment = openAssessmentId
    ? (assessments.find((assessment) => assessment.id === openAssessmentId) ?? null)
    : null;
  const editingResource = editingResourceId
    ? (resources.find((resource) => resource.id === editingResourceId) ?? null)
    : null;
  const backToActivity = () =>
    navigate({
      to: "/teacher/class/$classId",
      params: { classId: item.id },
      search: { tab: "activity" },
    });

  const changeSection = async (studentId: string, value: string) => {
    let next: string | null = value || null;
    if (value === "__new__") {
      const name = window.prompt("Section name (e.g. 7A)")?.trim();
      if (!name) return;
      next = name.slice(0, 60);
    }
    setRosterError(null);
    try {
      await onSetSection(studentId, next);
    } catch (error) {
      setRosterError((error as Error).message || "Could not update the section.");
    }
  };
  return (
    <>
      {/* min-w-0: this card is a grid item, and grid items refuse to shrink below their
          content (min-width:auto) — without it the 920px gradebook table stretched the
          whole card past the viewport and CLIPPED the action column + header tabs at
          tablet widths instead of scrolling inside .table-scroll (R52). */}
      <section className="min-w-0 rounded-card border border-border bg-depth-card shadow-card">
        <div className="p-4 sm:p-5">
          {/* R60 header: the class name and the three fixed tabs — Students, Activity,
              Content. Rendered FROM CLASS_SECTIONS so the pills and the sidebar sub-rows can
              never disagree; tabs never appear or disappear (principle P2: no hidden rooms). */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-serif text-display text-foreground">{item.name}</h2>
            <div className="flex flex-wrap gap-2">
              {CLASS_SECTIONS.map((tabItem) => (
                <button
                  key={tabItem.value}
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/teacher/class/$classId",
                      params: { classId: item.id },
                      search: { tab: tabItem.value },
                    })
                  }
                  className={`rounded-full border px-4 py-1.5 text-body transition-colors ${
                    section === tabItem.value
                      ? "border-primary bg-primary font-medium text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity = what's happening and what's out for work (R60: the old Live room
              plus every quiz and assignment, one door). An open work item takes the room —
              rendered outside the card, below. */}
          {section === "activity" && !openAssignmentId && !openAssessmentId ? (
            <div className="panel-fade mt-4 grid gap-6">
              <h3 className="sr-only">Activity</h3>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Live now
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateOpen("assignment")}
                      className="btn btn-secondary btn-sm"
                    >
                      New assignment
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateOpen("assessment")}
                      className="btn btn-primary btn-sm"
                    >
                      New quiz
                    </button>
                  </div>
                </div>
                {liveStudents.length ? (
                  <div className="grid gap-3">
                    {liveStudents.map((studentId) => {
                      const profile = profilesById.get(studentId) || null;
                      const live = liveByStudent.get(studentId)!;
                      return (
                        // R52: ONE row container owns the chrome; the open-student hit
                        // area and the Watch action both live INSIDE it (previously two
                        // detached pills side by side).
                        <div
                          key={studentId}
                          className="flex items-center gap-3 rounded-card border border-border bg-depth-sub py-2 pl-4 pr-2"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectStudent(studentId)}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-control py-1 text-left transition-colors hover:opacity-80"
                          >
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                            </span>
                            <span className="min-w-[140px] shrink-0 truncate text-body font-medium text-foreground">
                              {displayName(profile, studentId)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                              {lessonName(lessonsById, live.lesson_id)}
                              {live.stage ? ` · ${live.stage}` : ""} ·{" "}
                              {relTime(live.updated_at, nowMs)}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              navigate({
                                to: "/teacher/class/$classId/student/$studentId",
                                params: { classId: item.id, studentId },
                                search: { tab: "overview", session: live.id },
                              })
                            }
                            className="btn btn-secondary btn-sm shrink-0"
                          >
                            Watch
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-meta text-muted-foreground">
                    No one is live right now — students appear here the moment they start a lesson.
                  </p>
                )}
              </div>

              <div>
                <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  To review
                </span>
                {reviewRows.length ? (
                  <div className="mt-2 grid gap-2">
                    {reviewRows.map((row) => (
                      <button
                        key={`${row.kind}:${row.itemId}:${row.studentName}:${row.at}`}
                        type="button"
                        onClick={() =>
                          navigate({
                            to: "/teacher/class/$classId",
                            params: { classId: item.id },
                            search:
                              row.kind === "assignment"
                                ? { tab: "activity", assignment: row.itemId }
                                : { tab: "activity", assessment: row.itemId },
                          })
                        }
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
                    Nothing waiting on you — submitted work lands here the moment it arrives.
                  </p>
                )}
              </div>

              <div>
                <span className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Quizzes &amp; assignments
                </span>
                {activityItems.length ? (
                  <div className="mt-2 grid gap-2">
                    {activityItems.map((entry) => (
                      <button
                        key={`${entry.kind}:${entry.id}`}
                        type="button"
                        onClick={() =>
                          navigate({
                            to: "/teacher/class/$classId",
                            params: { classId: item.id },
                            search:
                              entry.kind === "assignment"
                                ? { tab: "activity", assignment: entry.id }
                                : { tab: "activity", assessment: entry.id },
                          })
                        }
                        className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-depth-sub px-4 py-2.5 text-left transition-colors hover:bg-muted"
                      >
                        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-meta text-muted-foreground">
                          {entry.kind === "assignment" ? "assignment" : "quiz"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-body text-foreground">
                          {entry.title}
                        </span>
                        {entry.needsReviewCount > 0 ? (
                          <span className="shrink-0 rounded-full border border-warning/40 bg-warning/12 px-2 py-0.5 text-meta text-warning">
                            {entry.needsReviewCount} to review
                          </span>
                        ) : null}
                        <span className="shrink-0 text-meta text-muted-foreground">
                          {entry.status}
                          {entry.dueAt
                            ? ` · due ${new Date(entry.dueAt).toLocaleDateString()}`
                            : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-meta text-muted-foreground">
                    No quizzes or assignments yet — create one above, or add a quiz step inside a
                    lesson under Content.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {/* Students = who's in the class and how they're doing — the roster with
              sections and enrolment, each row carrying its own signals (live dot, last
              activity, grade average), and the full gradebook one toggle away (R60 merge
              of the old People + Grades rooms). The landing tab. */}
          {section === "students" ? (
            <div className="panel-fade mt-4">
              <h3 className="sr-only">Students</h3>
              {/* R73: Students is the room a teacher lands in, so it opens with what
                  the class LEARNED — the "reports back" half of the pitch — before the
                  roster. Activity keeps answering "who needs me right this second". */}
              <div className="mb-4">
                <ClassDigestCard classId={item.id} />
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-meta text-muted-foreground">
                  {studentIds.length} student{studentIds.length === 1 ? "" : "s"}
                  {signals.sections.length ? ` · sections ${signals.sections.join(" · ")}` : ""}
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 rounded-full border border-border p-0.5">
                    {(["roster", "gradebook"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setStudentsView(view)}
                        className={`rounded-full px-3 py-1 text-meta transition-colors ${
                          studentsView === view
                            ? "bg-primary font-medium text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {view === "roster" ? "Roster" : "Gradebook"}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={openEnroll} className="btn btn-secondary btn-sm">
                    Add students
                  </button>
                </div>
              </div>
              {rosterError ? <p className="mb-2 text-meta text-danger">{rosterError}</p> : null}
              {studentsView === "gradebook" ? (
                <GradebookTable
                  lessons={lessons}
                  lessonsById={lessonsById}
                  studentIds={studentIds}
                  dashboard={dashboard}
                  profilesById={profilesById}
                  selectedLessonId={selectedLessonId}
                  selectedStudentId={selectedStudentId}
                  onSelectLesson={onSelectLesson}
                  onSelectStudent={onSelectStudent}
                />
              ) : (
                <div className="grid gap-4">
                  {sectionGroups.length ? (
                    sectionGroups.map((group) => (
                      <div key={group.label ?? "__none__"}>
                        {sectionGroups.length > 1 || group.label ? (
                          <div className="mb-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                            {group.label ? `Section ${group.label}` : "No section"} ·{" "}
                            {group.students.length}
                          </div>
                        ) : null}
                        <div className="grid gap-3">
                          {group.students.map((studentId) => {
                            const profile = profilesById.get(studentId) || null;
                            return (
                              // R52: one row container; the section picker lives inside
                              // the row instead of floating next to it. Row fill stays
                              // distinct from field chrome so rows never read as inputs.
                              <div
                                key={studentId}
                                className={`flex items-center gap-3 rounded-card border py-2 pl-4 pr-2 transition-colors ${
                                  selectedStudentId === studentId
                                    ? "border-primary/45 bg-depth-card"
                                    : "border-border bg-depth-sub"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectStudent(studentId)}
                                  className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left transition-colors hover:opacity-80"
                                >
                                  {liveByStudent.has(studentId) ? (
                                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                                    </span>
                                  ) : (
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-border" />
                                  )}
                                  <span className="min-w-[140px] shrink-0 truncate text-body font-medium text-foreground">
                                    {displayName(profile, studentId)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                                    {studentContextLine(
                                      profile,
                                      dashboard.sessions,
                                      studentId,
                                      lessonsById,
                                      nowMs,
                                    )}
                                  </span>
                                  <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-meta text-muted-foreground">
                                    {gradeChipLabel(gradeSummaries.get(studentId))}
                                  </span>
                                </button>
                                <label className="flex shrink-0 items-center">
                                  <span className="sr-only">
                                    Section for {displayName(profile, studentId)}
                                  </span>
                                  <select
                                    value={sectionByStudent.get(studentId) ?? ""}
                                    onChange={(event) =>
                                      void changeSection(studentId, event.target.value)
                                    }
                                    className="jargon-input !w-auto"
                                  >
                                    <option value="">No section</option>
                                    {sectionNames.map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))}
                                    <option value="__new__">New section…</option>
                                  </select>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-card border border-border bg-depth-sub p-5 text-body text-muted-foreground">
                      No students in this class yet — add your students and group them into
                      sections.
                    </div>
                  )}
                </div>
              )}

              <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[480px]">
                  <DialogHeader>
                    <DialogTitle>Add students</DialogTitle>
                  </DialogHeader>
                  <p className="text-meta text-muted-foreground">
                    Pick from your school's registered students. New accounts are created by your
                    admin.
                  </p>
                  <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Section (optional)
                    <input
                      value={enrollSection}
                      onChange={(event) => setEnrollSection(event.target.value)}
                      placeholder="e.g. 7A"
                      className="jargon-input normal-case tracking-normal"
                    />
                  </label>
                  {enrollable === null ? (
                    <p className="text-meta text-muted-foreground">Loading students…</p>
                  ) : enrollable.length === 0 ? (
                    <p className="text-meta text-muted-foreground">
                      Every registered student is already in this class.
                    </p>
                  ) : (
                    <div className="grid max-h-[300px] gap-1.5 overflow-y-auto">
                      {enrollable.map((student) => (
                        <label
                          key={student.user_id}
                          className="flex items-center gap-2.5 rounded-control border border-border bg-depth-field px-3 py-2 text-meta text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={enrollChecked.has(student.user_id)}
                            onChange={() =>
                              setEnrollChecked((current) => {
                                const next = new Set(current);
                                if (next.has(student.user_id)) next.delete(student.user_id);
                                else next.add(student.user_id);
                                return next;
                              })
                            }
                            className="h-4 w-4 shrink-0 accent-foreground"
                          />
                          <span className="min-w-0 flex-1 truncate">{student.name}</span>
                          {student.grade ? (
                            <span className="shrink-0 text-meta text-muted-foreground">
                              Grade {student.grade}
                            </span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  )}
                  {rosterError ? <p className="text-meta text-danger">{rosterError}</p> : null}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEnrollOpen(false)}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitEnroll()}
                      disabled={enrollBusy || !enrollChecked.size}
                      className="btn btn-secondary btn-sm"
                    >
                      {enrollBusy
                        ? "Adding…"
                        : `Add ${enrollChecked.size || ""} student${enrollChecked.size === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : null}
        </div>
      </section>

      {/* R60 Activity, grading face: an open assignment or quiz (student-work view)
          takes the whole room — rendered OUTSIDE the header card so grading gets the
          full page width (the R47 precedence contract, now scoped to Activity). */}
      {section === "activity" && (openAssignmentId || openAssessmentId) ? (
        <div className="panel-fade flex flex-col gap-4">
          <h3 className="sr-only">Student work</h3>
          {openAssignment ? (
            <AssignmentWorkView
              assignment={openAssignment}
              recipients={assignmentRecipients.filter(
                (recipient) => recipient.assignment_id === openAssignment.id,
              )}
              submissions={assignmentSubmissions.filter(
                (submission) => submission.assignment_id === openAssignment.id,
              )}
              files={assignmentSubmissionFiles.filter(
                (file) => file.assignment_id === openAssignment.id,
              )}
              profilesById={profilesById}
              lessons={lessons}
              onReviewSubmission={onReviewSubmission}
              onSetStatus={(status) => onSetAssignmentStatus(openAssignment.id, status)}
              onBack={backToActivity}
            />
          ) : openAssessment ? (
            <AssessmentWorkView
              assessment={openAssessment}
              items={assessmentItems.filter(
                (assessmentItem) => assessmentItem.assessment_id === openAssessment.id,
              )}
              recipients={assessmentRecipients.filter(
                (recipient) => recipient.assessment_id === openAssessment.id,
              )}
              attempts={assessmentAttempts.filter(
                (attempt) => attempt.assessment_id === openAssessment.id,
              )}
              itemAttempts={assessmentItemAttempts}
              quizItems={quizItems}
              profilesById={profilesById}
              lessons={lessons}
              onReviewAssessmentItem={onReviewAssessmentItem}
              onReturnAssessment={onReturnAssessment}
              onSetStatus={(status) => onSetAssessmentStatus(openAssessment.id, status)}
              onBack={backToActivity}
            />
          ) : (
            <div className="rounded-card border border-border bg-depth-card p-6 shadow-card">
              <p className="text-body text-muted-foreground">
                That piece of work isn't here any more — it may have been archived.
              </p>
              <button
                type="button"
                onClick={backToActivity}
                className="btn btn-secondary btn-sm mt-3"
              >
                ← Activity
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* R60 Content: the units and lessons — the studio, full width. Work items live in
          Activity now; opening one from a lesson's step navigates there. */}
      {section === "content" ? (
        <div className="panel-fade flex flex-col gap-4">
          <h3 className="sr-only">Content</h3>
          <Suspense
            fallback={
              <section className="rounded-card border border-border bg-depth-card shadow-card">
                <div className="p-6 text-body text-muted-foreground">Loading content...</div>
              </section>
            }
          >
            <CourseScreen
              classId={item.id}
              onAddMaterial={() => setCreateOpen("material")}
            />
          </Suspense>
        </div>
      ) : null}

      {/* R47 + Create: one menu in the Classwork list, three dialogs here. The managers
          keep their names and form copy; only their old in-page lists are gone (rows now
          live in the Classwork list itself). */}
      <Dialog
        open={createOpen === "assignment"}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>New assignment</DialogTitle>
          </DialogHeader>
          <AssignmentManager
            classSummary={item}
            lessons={lessons}
            resources={resources}
            studentIds={studentIds}
            profilesById={profilesById}
            saving={savingAssignment}
            context={null}
            onSaveAssignment={async (input) => {
              await onSaveAssignment(input);
              setCreateOpen(null);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={createOpen === "assessment"}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>New quiz</DialogTitle>
          </DialogHeader>
          <AssessmentManager
            classSummary={item}
            lessons={lessons}
            quizItems={quizItems}
            studentIds={studentIds}
            profilesById={profilesById}
            saving={savingAssessment}
            context={null}
            onSaveAssessment={async (input) => {
              await onSaveAssessment(input);
              setCreateOpen(null);
            }}
          />
        </DialogContent>
      </Dialog>
      <ResourceManager
        classSummary={item}
        lessons={lessons}
        saving={savingResource}
        open={createOpen === "material" || editingResource !== null}
        resource={editingResource}
        onSaveResource={async (input) => {
          await onSaveResource(input);
          setCreateOpen(null);
          setEditingResourceId(null);
        }}
        onUpdateResource={onUpdateResource}
        onClose={() => {
          setCreateOpen(null);
          setEditingResourceId(null);
        }}
      />
    </>
  );
}
