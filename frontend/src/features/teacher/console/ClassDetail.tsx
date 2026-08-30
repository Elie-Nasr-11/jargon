/**
 * One class, in three rooms — Today, People, Course — and a fourth screen, Settings,
 * behind the gear.
 *
 * By R83 this file is a router and a grading face, not a screen: each room owns its own
 * module under features/teacher/, loads its own data and does its own derivations. What
 * is left here is the header, the room switch, the work-grading view that takes the page
 * over, and the create dialogs.
 */
import { Suspense, lazy, useState } from "react";
import { Settings } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssessmentWorkView } from "@/features/teacher/AssessmentGrading";
import { AssignmentWorkView } from "@/features/teacher/AssignmentGrading";
import { AssessmentManager } from "@/features/teacher/console/AssessmentManager";
import type { AssessmentFormValues } from "@/features/teacher/console/AssessmentManager";
import { AssignmentManager } from "@/features/teacher/console/AssignmentManager";
import type { AssignmentFormValues } from "@/features/teacher/console/AssignmentManager";
import { PeopleScreen } from "@/features/teacher/people/PeopleScreen";
import { TodayScreen } from "@/features/teacher/today/TodayScreen";
import { ResourceManager } from "@/features/teacher/console/ResourceManager";
import type { ResourceFormValues } from "@/features/teacher/console/ResourceManager";
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

// Settings pulls the whole course-link picker with it and is opened about once a term —
// exactly the shape that should never ride in the chunk every teacher downloads (R82).
const ClassSettingsScreen = lazy(() =>
  import("@/features/teacher/settings/ClassSettingsScreen").then((module) => ({
    default: module.ClassSettingsScreen,
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
  onRemove,
  onRosterChanged,
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
  // R83: remove-from-class and the settings writes both change data the console already
  // holds, so the console refetches rather than each screen keeping its own copy.
  onRemove: (studentId: string) => Promise<void>;
  onRosterChanged: () => void;
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

  // R83: the roster's own derivations (sections, live dots, grade rollups) moved with
  // it to features/teacher/people. reviewRows, liveStudents and workItems went with the
  // Activity room in R81 — they kept being COMPUTED on every render for eight releases
  // with nothing reading them, including a full pass over every submission and attempt.

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
      search: { tab: "today" },
    });

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
            <div className="flex flex-wrap items-center gap-2">
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
              {/* Settings gets an icon, not a pill: it is a screen a teacher opens about
                  once a term, and a fourth pill would sit beside the three daily rooms
                  all year claiming equal weight. */}
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/teacher/class/$classId",
                    params: { classId: item.id },
                    search: { tab: "settings" },
                  })
                }
                aria-label="Class settings"
                aria-current={section === "settings" ? "page" : undefined}
                title="Class settings"
                className={`rounded-full border p-2 transition-colors ${
                  section === "settings"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <Settings className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>
          </div>

          {/* Today = what the class learned, and the only two things that can need a
              person: someone in a lesson right now, and work waiting to be marked. The
              landing (R81) — a teacher who opens Jargon and does nothing else still
              learns something. */}
          {section === "today" && !openAssignmentId && !openAssessmentId ? (
            <TodayScreen
              classId={item.id}
              dashboard={dashboard}
              profilesById={profilesById}
              lessonsById={lessonsById}
              onOpenStudent={onSelectStudent}
              onWatch={(studentId, sessionId) =>
                navigate({
                  to: "/teacher/class/$classId/student/$studentId",
                  params: { classId: item.id, studentId },
                  search: { tab: "overview", session: sessionId },
                })
              }
              onOpenWork={(kind, itemId) =>
                navigate({
                  to: "/teacher/class/$classId",
                  params: { classId: item.id },
                  search:
                    kind === "assignment"
                      ? { tab: "today", assignment: itemId }
                      : { tab: "today", assessment: itemId },
                })
              }
            />
          ) : null}

          {/* People = the roster: who is in this class, in what section, how each is
              doing. Adding picks from the school directory and removing marks one
              membership 'removed' — this screen never creates or destroys an account
              (R83, brief step 6, replacing the Students room). */}
          {section === "people" ? (
            <PeopleScreen
              classId={item.id}
              dashboard={dashboard}
              profilesById={profilesById}
              lessons={lessons}
              lessonsById={lessonsById}
              studentIds={studentIds}
              selectedLessonId={selectedLessonId}
              selectedStudentId={selectedStudentId}
              onSelectLesson={onSelectLesson}
              onSelectStudent={onSelectStudent}
              onSetSection={onSetSection}
              onListEnrollable={onListEnrollable}
              onEnroll={onEnroll}
              onRemove={onRemove}
            />
          ) : null}

          {/* Settings = the rare, real things: which courses this class teaches, its
              name, its sections, archiving it. Not a pill — reached from the gear by the
              class name, because none of it is daily work (Law 4). */}
          {section === "settings" ? (
            <Suspense
              fallback={
                <div className="mt-4 text-body text-muted-foreground">Loading settings…</div>
              }
            >
              <ClassSettingsScreen
                classId={item.id}
                className={item.name}
                dashboard={dashboard}
                studentIds={studentIds}
                onChanged={onRosterChanged}
              />
            </Suspense>
          ) : null}
        </div>
      </section>

      {/* The grading face: an open assignment or quiz (student-work view) takes the whole
          room — rendered OUTSIDE the header card so grading gets the full page width (the
          R47 precedence contract). R81: reached from Today, where the work was waiting. */}
      {section === "today" && (openAssignmentId || openAssessmentId) ? (
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

      {/* Course: the units and lessons — the outline, full width. R83 renamed the room
          from "Content", a word the lexicon retired as a noun; ?tab=content still lands
          here through normalizeClassSection. */}
      {section === "course" ? (
        <div className="panel-fade flex flex-col gap-4">
          <h3 className="sr-only">Course</h3>
          <Suspense
            fallback={
              <section className="rounded-card border border-border bg-depth-card shadow-card">
                <div className="p-6 text-body text-muted-foreground">Loading content...</div>
              </section>
            }
          >
            <CourseScreen classId={item.id} onAddMaterial={() => setCreateOpen("material")} />
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
