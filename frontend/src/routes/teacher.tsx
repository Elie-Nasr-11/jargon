import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  ExternalLink,
  FileText,
  GraduationCap,
  MessageSquare,
  NotebookText,
  Paperclip,
  Send,
  UsersRound,
} from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import {
  createAssignment,
  createLessonResource,
  createTeacherNote,
  fetchTeacherDashboard,
  getSubmissionFileSignedUrl,
  gradeAssignmentSubmission,
  getLessonResourceSignedUrl,
  getSession,
  updateAssignmentStatus,
  updateLessonResource,
} from "@/lib/api";
import type {
  Assignment,
  AssignmentRecipient,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  LearningSession,
  Lesson,
  LessonResource,
  LessonResourceDisplayMode,
  LessonResourceSource,
  LessonResourceStatus,
  LessonResourceType,
  LessonResourceVisibility,
  Profile,
  TeacherClassSummary,
  TeacherDashboardData,
  TeacherNote,
} from "@/lib/types";

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Teacher - Jargon" },
      {
        name: "description",
        content: "Teacher dashboard for Jargon classes, transcripts, evidence, and notes.",
      },
    ],
  }),
  component: TeacherPage,
});

function TeacherPage() {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [dashboard, setDashboard] = useState<TeacherDashboardData | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedGradebookLessonId, setSelectedGradebookLessonId] = useState("all");
  const [message, setMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteVisibility, setNoteVisibility] =
    useState<TeacherNote["visibility"]>("teacher_private");
  const [savingNote, setSavingNote] = useState(false);
  const [savingResource, setSavingResource] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const data = await fetchTeacherDashboard(session.user.id);
      setEmail(session.user.email || "");
      setTeacherId(session.user.id);
      setDashboard(data);
      setSelectedClassId((current) => current || data.classes[0]?.id || null);
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "Could not load teacher dashboard.");
    } finally {
      setBooting(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const model = useMemo(() => {
    if (!dashboard) return null;
    const profilesById = new Map(dashboard.profiles.map((profile) => [profile.id, profile]));
    const lessonsById = new Map(dashboard.lessons.map((lesson) => [lesson.id, lesson]));
    const classesById = new Map(dashboard.classes.map((item) => [item.id, item]));
    const studentIds = unique(
      dashboard.memberships
        .filter((membership) => membership.role === "student" && membership.status === "active")
        .map((membership) => membership.user_id),
    );
    return { profilesById, lessonsById, classesById, studentIds };
  }, [dashboard]);

  const selectedClass =
    selectedClassId && model ? model.classesById.get(selectedClassId) || null : null;
  const classStudents =
    dashboard && selectedClassId
      ? dashboard.memberships
          .filter(
            (membership) =>
              membership.class_id === selectedClassId &&
              membership.role === "student" &&
              membership.status === "active",
          )
          .map((membership) => membership.user_id)
      : [];
  const selectedStudent =
    selectedStudentId && model ? model.profilesById.get(selectedStudentId) || null : null;

  const studentSessions = useMemo(
    () =>
      dashboard && selectedStudentId
        ? dashboard.sessions
            .filter((session) => session.user_id === selectedStudentId)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        : [],
    [dashboard, selectedStudentId],
  );

  useEffect(() => {
    if (!selectedStudentId) {
      setSelectedSessionId(null);
      return;
    }
    if (studentSessions.length && !studentSessions.some((item) => item.id === selectedSessionId)) {
      const preferred =
        studentSessions.find((session) => session.status === "complete") || studentSessions[0];
      setSelectedSessionId(preferred.id);
    }
    if (!studentSessions.length) setSelectedSessionId(null);
  }, [selectedSessionId, selectedStudentId, studentSessions]);

  const selectedSession =
    selectedSessionId && dashboard
      ? dashboard.sessions.find((session) => session.id === selectedSessionId) || null
      : null;

  const classStats =
    dashboard && selectedClassId ? summarizeClass(dashboard, selectedClassId) : null;
  const studentStats =
    dashboard && selectedStudentId ? summarizeStudent(dashboard, selectedStudentId) : null;

  const saveNote = async () => {
    if (!teacherId || !selectedClassId || !selectedStudentId || !noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const note = await createTeacherNote({
        teacherId,
        studentId: selectedStudentId,
        classId: selectedClassId,
        note: noteDraft.trim(),
        visibility: noteVisibility,
      });
      setDashboard((current) =>
        current ? { ...current, notes: [note, ...current.notes] } : current,
      );
      setNoteDraft("");
    } catch (error) {
      setMessage((error as Error).message || "Could not save teacher note.");
    } finally {
      setSavingNote(false);
    }
  };

  const saveResource = async (input: ResourceFormValues) => {
    if (!teacherId || !dashboard) return;
    setSavingResource(true);
    try {
      if (input.resourceId) {
        const updated = await updateLessonResource(input.resourceId, {
          title: input.title,
          description: input.description,
          student_instructions: input.studentInstructions,
          teacher_notes: input.teacherNotes,
          status: input.status,
          visibility: input.visibility,
        });
        setDashboard((current) =>
          current
            ? {
                ...current,
                resources: current.resources.map((resource) =>
                  resource.id === updated.id ? updated : resource,
                ),
              }
            : current,
        );
        return;
      }

      const created = await createLessonResource({
        teacherId,
        organizationId: input.organizationId,
        classId: input.classId,
        lessonId: input.lessonId,
        title: input.title,
        description: input.description,
        studentInstructions: input.studentInstructions,
        teacherNotes: input.teacherNotes,
        resourceType: input.resourceType,
        sourceType: input.sourceType,
        status: input.status,
        visibility: input.visibility,
        displayMode: input.displayMode,
        externalUrl: input.externalUrl,
        file: input.file,
      });
      setDashboard((current) =>
        current ? { ...current, resources: [created, ...current.resources] } : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not save lesson resource.");
      throw error;
    } finally {
      setSavingResource(false);
    }
  };

  const saveAssignment = async (input: AssignmentFormValues) => {
    if (!teacherId) return;
    setSavingAssignment(true);
    try {
      const created = await createAssignment({
        teacherId,
        organizationId: input.organizationId,
        classId: input.classId,
        lessonId: input.lessonId,
        title: input.title,
        instructions: input.instructions,
        dueAt: input.dueAt || null,
        status: input.status,
        recipientIds: input.recipientIds,
        resourceIds: input.resourceIds,
      });
      setDashboard((current) =>
        current
          ? {
              ...current,
              assignments: [created.assignment, ...current.assignments],
              assignmentRecipients: [
                ...created.recipients,
                ...current.assignmentRecipients.filter(
                  (recipient) => recipient.assignment_id !== created.assignment.id,
                ),
              ],
              resources: current.resources.map((resource) =>
                input.resourceIds.includes(resource.id)
                  ? { ...resource, assignment_id: created.assignment.id }
                  : resource,
              ),
            }
          : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not create assignment.");
      throw error;
    } finally {
      setSavingAssignment(false);
    }
  };

  const setAssignmentStatus = async (assignmentId: string, status: AssignmentStatus) => {
    try {
      const updated = await updateAssignmentStatus(assignmentId, status);
      setDashboard((current) =>
        current
          ? {
              ...current,
              assignments: current.assignments.map((assignment) =>
                assignment.id === updated.id ? updated : assignment,
              ),
            }
          : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not update assignment.");
    }
  };

  const reviewSubmission = async (input: {
    assignment: Assignment;
    submission: AssignmentSubmission;
    scorePercent: number;
    feedback: string;
    decision: "accepted" | "returned";
  }) => {
    if (!teacherId) return;
    try {
      const reviewed = await gradeAssignmentSubmission({ teacherId, ...input });
      setDashboard((current) =>
        current
          ? {
              ...current,
              assignmentSubmissions: current.assignmentSubmissions.map((submission) =>
                submission.id === reviewed.submission.id ? reviewed.submission : submission,
              ),
              assignmentRecipients: current.assignmentRecipients.map((recipient) =>
                recipient.id === reviewed.recipient.id ? reviewed.recipient : recipient,
              ),
            }
          : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not review submission.");
      throw error;
    }
  };

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.24} />
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1240px] items-center justify-between gap-2 px-3 sm:px-6">
            <Link to="/chat" className="font-serif text-[22px] tracking-tight text-foreground">
              Jargon
            </Link>
            {email ? <SettingsMenu email={email} /> : null}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              Teacher dashboard
            </div>
            <h1 className="font-serif mt-2 text-[38px] leading-tight tracking-tight text-foreground sm:text-[48px]">
              Classroom evidence.
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              Inspect roster progress, learning attempts, chat transcripts, quiz checks, mastery,
              and notes for students in your assigned pilot classes.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              Refresh
            </button>
            <Link
              to="/teacher/curriculum"
              className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              Curriculum
            </Link>
            <Link
              to="/chat"
              className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              Student chat
            </Link>
          </div>
        </section>

        {booting ? (
          <GradientCard>
            <div className="p-6 text-[14px] text-muted-foreground">Loading teacher access...</div>
          </GradientCard>
        ) : message ? (
          <GradientCard>
            <div className="p-6 text-[14px] text-muted-foreground">{message}</div>
          </GradientCard>
        ) : null}

        {!booting && dashboard && model && (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="Classes" value={String(dashboard.classes.length)} />
              <MetricCard label="Students" value={String(model.studentIds.length)} />
              <MetricCard
                label="Completed"
                value={String(
                  dashboard.sessions.filter((session) => session.status === "complete").length,
                )}
              />
              <MetricCard label="Evidence" value={String(dashboard.evidence.length)} />
            </div>

            <div className="grid min-h-[680px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <GradientCard>
                <div className="p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-[16px] font-medium text-foreground">Classes</h2>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">
                        Live roster counts and latest student activity.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {dashboard.classes.map((item) => (
                      <ClassButton
                        key={item.id}
                        item={item}
                        active={item.id === selectedClassId}
                        stats={summarizeClass(dashboard, item.id)}
                        onClick={() => {
                          setSelectedClassId(item.id);
                          setSelectedStudentId(null);
                          setSelectedSessionId(null);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </GradientCard>

              <div className="grid gap-4">
                {selectedClass && classStats ? (
                  <ClassDetail
                    item={selectedClass}
                    stats={classStats}
                    dashboard={dashboard}
                    profilesById={model.profilesById}
                    lessons={dashboard.lessons}
                    lessonsById={model.lessonsById}
                    resources={dashboard.resources.filter(
                      (resource) => resource.class_id === selectedClass.id,
                    )}
                    assignments={dashboard.assignments.filter(
                      (assignment) => assignment.class_id === selectedClass.id,
                    )}
                    assignmentRecipients={dashboard.assignmentRecipients}
                    assignmentSubmissions={dashboard.assignmentSubmissions}
                    assignmentSubmissionFiles={dashboard.assignmentSubmissionFiles}
                    studentIds={classStudents}
                    selectedLessonId={selectedGradebookLessonId}
                    selectedStudentId={selectedStudentId}
                    onSelectLesson={setSelectedGradebookLessonId}
                    onSelectStudent={setSelectedStudentId}
                    savingResource={savingResource}
                    savingAssignment={savingAssignment}
                    onSaveResource={saveResource}
                    onSaveAssignment={saveAssignment}
                    onSetAssignmentStatus={(assignmentId, status) =>
                      void setAssignmentStatus(assignmentId, status)
                    }
                    onReviewSubmission={reviewSubmission}
                    onUpdateResource={(resource) =>
                      setDashboard((current) =>
                        current
                          ? {
                              ...current,
                              resources: current.resources.map((item) =>
                                item.id === resource.id ? resource : item,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <EmptyPanel
                    title="No class selected"
                    body="Choose a class to inspect the roster."
                  />
                )}

                {selectedStudentId && studentStats ? (
                  <StudentDetail
                    studentId={selectedStudentId}
                    profile={selectedStudent}
                    stats={studentStats}
                    dashboard={dashboard}
                    lessonsById={model.lessonsById}
                    sessions={studentSessions}
                    selectedSession={selectedSession}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={setSelectedSessionId}
                    noteDraft={noteDraft}
                    noteVisibility={noteVisibility}
                    savingNote={savingNote}
                    onNoteChange={setNoteDraft}
                    onNoteVisibilityChange={setNoteVisibility}
                    onSaveNote={() => void saveNote()}
                    onBack={() => {
                      setSelectedStudentId(null);
                      setSelectedSessionId(null);
                    }}
                  />
                ) : (
                  <EmptyPanel
                    title="Select a student"
                    body="Choose a student from the roster to view transcript, attempts, evidence, mastery, and notes."
                  />
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ClassButton({
  item,
  active,
  stats,
  onClick,
}: {
  item: TeacherClassSummary;
  active: boolean;
  stats: ClassSummary;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border p-4 text-left transition-colors ${
        active
          ? "border-foreground/25 bg-background/80"
          : "border-border bg-background/45 hover:bg-muted"
      }`}
    >
      <div className="text-[14px] font-medium text-foreground">{item.name}</div>
      <div className="mt-1 text-[12px] text-muted-foreground">{organizationName(item)}</div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <UsersRound className="h-3.5 w-3.5" strokeWidth={1.6} />
          {stats.students} students
        </span>
        <span className="inline-flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.6} />
          {stats.teachers} teachers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.6} />
          {stats.completedSessions} complete
        </span>
      </div>
    </button>
  );
}

function ClassDetail({
  item,
  stats,
  dashboard,
  profilesById,
  lessons,
  lessonsById,
  resources,
  assignments,
  assignmentRecipients,
  assignmentSubmissions,
  assignmentSubmissionFiles,
  studentIds,
  selectedLessonId,
  selectedStudentId,
  onSelectLesson,
  onSelectStudent,
  savingResource,
  savingAssignment,
  onSaveResource,
  onSaveAssignment,
  onSetAssignmentStatus,
  onReviewSubmission,
  onUpdateResource,
}: {
  item: TeacherClassSummary;
  stats: ClassSummary;
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  lessonsById: Map<string, Lesson>;
  resources: LessonResource[];
  assignments: Assignment[];
  assignmentRecipients: AssignmentRecipient[];
  assignmentSubmissions: AssignmentSubmission[];
  assignmentSubmissionFiles: AssignmentSubmissionFile[];
  studentIds: string[];
  selectedLessonId: string;
  selectedStudentId: string | null;
  onSelectLesson: (lessonId: string) => void;
  onSelectStudent: (studentId: string) => void;
  savingResource: boolean;
  savingAssignment: boolean;
  onSaveResource: (input: ResourceFormValues) => Promise<void>;
  onSaveAssignment: (input: AssignmentFormValues) => Promise<void>;
  onSetAssignmentStatus: (assignmentId: string, status: AssignmentStatus) => void;
  onReviewSubmission: (input: {
    assignment: Assignment;
    submission: AssignmentSubmission;
    scorePercent: number;
    feedback: string;
    decision: "accepted" | "returned";
  }) => Promise<void>;
  onUpdateResource: (resource: LessonResource) => void;
}) {
  return (
    <GradientCard>
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {organizationName(item)}
            </div>
            <h2 className="mt-1 text-[22px] font-medium text-foreground">{item.name}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {stats.students} students, {stats.teachers} teacher, {stats.sessions} learning
              sessions.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
            <MiniMetric label="Attempts" value={String(stats.attempts)} />
            <MiniMetric label="Quizzes" value={String(stats.quizAttempts)} />
            <MiniMetric label="Evidence" value={String(stats.evidence)} />
          </div>
        </div>

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

        <ResourceManager
          classSummary={item}
          lessons={lessons}
          resources={resources}
          saving={savingResource}
          onSaveResource={onSaveResource}
          onUpdateResource={onUpdateResource}
        />

        <AssignmentManager
          classSummary={item}
          lessons={lessons}
          resources={resources}
          assignments={assignments}
          recipients={assignmentRecipients}
          submissions={assignmentSubmissions}
          files={assignmentSubmissionFiles}
          studentIds={studentIds}
          profilesById={profilesById}
          saving={savingAssignment}
          onSaveAssignment={onSaveAssignment}
          onSetAssignmentStatus={onSetAssignmentStatus}
          onReviewSubmission={onReviewSubmission}
        />

        <div className="mt-5 grid gap-3">
          {studentIds.length ? (
            studentIds.map((studentId) => {
              const profile = profilesById.get(studentId) || null;
              const latest = latestSessionFor(dashboard.sessions, studentId);
              const completedLessons = completedLessonNamesFor(
                dashboard.sessions,
                studentId,
                lessonsById,
              );
              const masteryCount = dashboard.mastery.filter(
                (item) => item.user_id === studentId,
              ).length;
              return (
                <button
                  type="button"
                  key={studentId}
                  onClick={() => onSelectStudent(studentId)}
                  className={`rounded-3xl border p-4 text-left transition-colors ${
                    selectedStudentId === studentId
                      ? "border-foreground/25 bg-background/80"
                      : "border-border bg-background/45 hover:bg-muted"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[14px] font-medium text-foreground">
                        {displayName(profile, studentId)}
                      </div>
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {profile?.grade || "Grade not set"} - {masteryCount} mastery skills
                      </div>
                      <div className="mt-2 text-[12px] text-muted-foreground">
                        {completedLessons.length
                          ? `Completed: ${completedLessons.join(", ")}`
                          : "No completed lessons yet"}
                      </div>
                    </div>
                    <div className="text-left text-[12px] text-muted-foreground sm:text-right">
                      <div>{latest ? statusLabel(latest) : "No session yet"}</div>
                      <div className="mt-1">
                        {latest
                          ? lessonName(lessonsById, latest.lesson_id)
                          : "Waiting for first lesson"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-3xl border border-border bg-background/45 p-5 text-[13px] text-muted-foreground">
              No active students are assigned to this class yet.
            </div>
          )}
        </div>

        <LessonProgress
          lessons={lessons}
          studentIds={studentIds}
          dashboard={dashboard}
          profilesById={profilesById}
        />
      </div>
    </GradientCard>
  );
}

type ResourceFormValues = {
  resourceId?: string;
  organizationId: string;
  classId: string;
  lessonId: string;
  title: string;
  description: string;
  studentInstructions: string;
  teacherNotes: string;
  resourceType: LessonResourceType;
  sourceType: LessonResourceSource;
  status: LessonResourceStatus;
  visibility: LessonResourceVisibility;
  displayMode: LessonResourceDisplayMode;
  externalUrl?: string;
  file?: File | null;
};

function defaultResourceForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
): ResourceFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "lesson1",
    title: "",
    description: "",
    studentInstructions: "",
    teacherNotes: "",
    resourceType: "pdf",
    sourceType: "upload",
    status: "draft",
    visibility: "class_private",
    displayMode: "card",
    externalUrl: "",
    file: null,
  };
}

function ResourceManager({
  classSummary,
  lessons,
  resources,
  saving,
  onSaveResource,
  onUpdateResource,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  resources: LessonResource[];
  saving: boolean;
  onSaveResource: (input: ResourceFormValues) => Promise<void>;
  onUpdateResource: (resource: LessonResource) => void;
}) {
  const [draft, setDraft] = useState<ResourceFormValues>(() =>
    defaultResourceForm(classSummary, lessons),
  );
  const [resourceMessage, setResourceMessage] = useState("");
  const [openingId, setOpeningId] = useState("");

  useEffect(() => {
    setDraft(defaultResourceForm(classSummary, lessons));
    setResourceMessage("");
  }, [classSummary, lessons]);

  const setField = <K extends keyof ResourceFormValues>(key: K, value: ResourceFormValues[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const editResource = (resource: LessonResource) => {
    setDraft({
      resourceId: resource.id,
      organizationId: resource.organization_id || classSummary.organization_id,
      classId: resource.class_id || classSummary.id,
      lessonId: resource.lesson_id || lessons[0]?.id || "lesson1",
      title: resource.title,
      description: resource.description || "",
      studentInstructions: resource.student_instructions || "",
      teacherNotes: resource.teacher_notes || "",
      resourceType: resource.resource_type,
      sourceType: resource.source_type,
      status: resource.status,
      visibility: resource.visibility,
      displayMode: "card",
      externalUrl: resource.external_url || "",
      file: null,
    });
    setResourceMessage("Editing resource metadata. File/source cannot be replaced in v1.");
  };

  const cancelEdit = () => {
    setDraft(defaultResourceForm(classSummary, lessons));
    setResourceMessage("");
  };

  const submit = async () => {
    try {
      const title = draft.title.trim();
      const externalUrl = draft.externalUrl?.trim() || "";
      if (!title) throw new Error("Add a resource title.");
      if (!draft.lessonId) throw new Error("Choose a lesson.");
      if (draft.sourceType === "upload" && !draft.resourceId && !draft.file) {
        throw new Error("Choose a file to upload.");
      }
      if (draft.sourceType === "external_url") {
        const parsed = new URL(externalUrl);
        if (
          draft.resourceType === "youtube" &&
          !["youtube.com", "www.youtube.com", "youtu.be"].includes(parsed.hostname)
        ) {
          throw new Error("YouTube resources must use youtube.com or youtu.be.");
        }
      }

      await onSaveResource({
        ...draft,
        title,
        description: draft.description.trim(),
        studentInstructions: draft.studentInstructions.trim(),
        teacherNotes: draft.teacherNotes.trim(),
        externalUrl,
      });
      setResourceMessage(draft.resourceId ? "Resource metadata saved." : "Resource created.");
      setDraft(defaultResourceForm(classSummary, lessons));
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not save resource.");
    }
  };

  const setStatus = async (resource: LessonResource, status: LessonResourceStatus) => {
    try {
      const updated = await updateLessonResource(resource.id, { status });
      onUpdateResource(updated);
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not update resource status.");
    }
  };

  const openResource = async (resource: LessonResource) => {
    try {
      setOpeningId(resource.id);
      const url = await getLessonResourceSignedUrl(resource);
      if (!url) throw new Error("This resource does not have an openable URL.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not open resource.");
    } finally {
      setOpeningId("");
    }
  };

  return (
    <div className="mt-6 rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Lesson resources</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Attach teacher-approved files and links. Drafts stay hidden from students.
          </p>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {resources.length} resource{resources.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-border bg-background/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] font-medium text-foreground">
              {draft.resourceId ? "Edit resource" : "Add resource"}
            </div>
            {draft.resourceId ? (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-full border border-border px-3 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel edit
              </button>
            ) : null}
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                onChange={(event) => setField("lessonId", event.target.value)}
                disabled={Boolean(draft.resourceId)}
                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none disabled:opacity-60"
              >
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Title
              <input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder="Purpose explainer PDF"
                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Source
                <select
                  value={draft.sourceType}
                  onChange={(event) => {
                    const next = event.target.value as LessonResourceSource;
                    setDraft((current) => ({
                      ...current,
                      sourceType: next,
                      resourceType: next === "external_url" ? "link" : "pdf",
                      file: null,
                    }));
                  }}
                  disabled={Boolean(draft.resourceId)}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none disabled:opacity-60"
                >
                  <option value="upload">Upload</option>
                  <option value="external_url">External URL</option>
                </select>
              </label>

              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Type
                <select
                  value={draft.resourceType}
                  onChange={(event) =>
                    setField("resourceType", event.target.value as LessonResourceType)
                  }
                  disabled={draft.sourceType === "upload" || Boolean(draft.resourceId)}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none disabled:opacity-60"
                >
                  <option value="pdf">PDF</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                  <option value="image">Image</option>
                  <option value="document">Document</option>
                  <option value="youtube">YouTube</option>
                  <option value="link">Link</option>
                </select>
              </label>
            </div>

            {draft.sourceType === "upload" && !draft.resourceId ? (
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                File
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,image/*,audio/*,video/*"
                  onChange={(event) => setField("file", event.target.files?.[0] || null)}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:text-foreground"
                />
              </label>
            ) : null}

            {draft.sourceType === "external_url" ? (
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                External URL
                <input
                  value={draft.externalUrl || ""}
                  onChange={(event) => setField("externalUrl", event.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
            ) : null}

            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Student instructions
              <textarea
                value={draft.studentInstructions}
                onChange={(event) => setField("studentInstructions", event.target.value)}
                placeholder="Open this before the checkpoint and look for the input/process/output idea."
                className="min-h-[72px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Description
              <textarea
                value={draft.description}
                onChange={(event) => setField("description", event.target.value)}
                placeholder="Short student-facing summary."
                className="min-h-[66px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Teacher notes
              <textarea
                value={draft.teacherNotes}
                onChange={(event) => setField("teacherNotes", event.target.value)}
                placeholder="Private classroom context for teachers."
                className="min-h-[66px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setField("status", event.target.value as LessonResourceStatus)
                  }
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>

              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Visibility
                <select
                  value={draft.visibility}
                  onChange={(event) =>
                    setField("visibility", event.target.value as LessonResourceVisibility)
                  }
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                >
                  <option value="class_private">Class private</option>
                  <option value="org_private">Organization private</option>
                  <option value="public">Public metadata</option>
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="mt-1 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : draft.resourceId ? "Save resource" : "Create resource"}
            </button>
            {resourceMessage ? (
              <div className="text-[12px] leading-relaxed text-muted-foreground">
                {resourceMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid content-start gap-2">
          {resources.length ? (
            resources.map((resource) => (
              <div
                key={resource.id}
                className="rounded-2xl border border-border bg-background/35 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">
                        {resource.title}
                      </span>
                      <ResourceStatusChip status={resource.status} />
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                      {resource.resource_type} ·{" "}
                      {resource.source_type === "upload" ? "private file" : "external link"} ·{" "}
                      {lessonTitle(lessons, resource.lesson_id)}
                    </div>
                    {resource.student_instructions ? (
                      <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                        {resource.student_instructions}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => editResource(resource)}
                      className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void openResource(resource)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.6} />
                      {openingId === resource.id ? "Opening..." : "Open"}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void setStatus(resource, "draft")}
                    disabled={resource.status === "draft"}
                    className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                  >
                    Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void setStatus(resource, "published")}
                    disabled={resource.status === "published"}
                    className="rounded-full border border-emerald-500/35 px-3 py-1.5 text-[11.5px] text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-45"
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    onClick={() => void setStatus(resource, "archived")}
                    disabled={resource.status === "archived"}
                    className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                  >
                    Archive
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-border bg-background/35 p-5 text-[13px] text-muted-foreground">
              No lesson resources yet. Add a draft, then publish it when students should see it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type AssignmentFormValues = {
  organizationId: string;
  classId: string;
  lessonId: string;
  title: string;
  instructions: string;
  dueAt: string;
  status: Extract<AssignmentStatus, "draft" | "assigned">;
  recipientIds: string[];
  resourceIds: string[];
};

function defaultAssignmentForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
  studentIds: string[],
): AssignmentFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "lesson1",
    title: "",
    instructions: "",
    dueAt: "",
    status: "assigned",
    recipientIds: studentIds,
    resourceIds: [],
  };
}

function AssignmentManager({
  classSummary,
  lessons,
  resources,
  assignments,
  recipients,
  submissions,
  files,
  studentIds,
  profilesById,
  saving,
  onSaveAssignment,
  onSetAssignmentStatus,
  onReviewSubmission,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  resources: LessonResource[];
  assignments: Assignment[];
  recipients: AssignmentRecipient[];
  submissions: AssignmentSubmission[];
  files: AssignmentSubmissionFile[];
  studentIds: string[];
  profilesById: Map<string, Profile>;
  saving: boolean;
  onSaveAssignment: (input: AssignmentFormValues) => Promise<void>;
  onSetAssignmentStatus: (assignmentId: string, status: AssignmentStatus) => void;
  onReviewSubmission: (input: {
    assignment: Assignment;
    submission: AssignmentSubmission;
    scorePercent: number;
    feedback: string;
    decision: "accepted" | "returned";
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AssignmentFormValues>(() =>
    defaultAssignmentForm(classSummary, lessons, studentIds),
  );
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; feedback: string; saving: boolean }>
  >({});
  const resourcesForLesson = resources.filter(
    (resource) => resource.lesson_id === draft.lessonId && resource.status !== "archived",
  );

  useEffect(() => {
    setDraft(defaultAssignmentForm(classSummary, lessons, studentIds));
    setAssignmentMessage("");
    setReviewDrafts({});
  }, [classSummary, lessons, studentIds]);

  const setField = <K extends keyof AssignmentFormValues>(
    key: K,
    value: AssignmentFormValues[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleRecipient = (studentId: string) => {
    setDraft((current) => {
      const exists = current.recipientIds.includes(studentId);
      return {
        ...current,
        recipientIds: exists
          ? current.recipientIds.filter((id) => id !== studentId)
          : [...current.recipientIds, studentId],
      };
    });
  };

  const toggleResource = (resourceId: string) => {
    setDraft((current) => {
      const exists = current.resourceIds.includes(resourceId);
      return {
        ...current,
        resourceIds: exists
          ? current.resourceIds.filter((id) => id !== resourceId)
          : [...current.resourceIds, resourceId],
      };
    });
  };

  const submit = async () => {
    try {
      const title = draft.title.trim();
      const instructions = draft.instructions.trim();
      if (!title) throw new Error("Add an assignment title.");
      if (!instructions) throw new Error("Add student instructions.");
      if (!draft.lessonId) throw new Error("Choose a lesson.");
      if (!draft.recipientIds.length) throw new Error("Choose at least one student.");

      await onSaveAssignment({
        ...draft,
        title,
        instructions,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : "",
      });
      setAssignmentMessage(
        draft.status === "assigned"
          ? "Assignment created and assigned."
          : "Draft assignment saved.",
      );
      setDraft(defaultAssignmentForm(classSummary, lessons, studentIds));
    } catch (error) {
      setAssignmentMessage((error as Error).message || "Could not create assignment.");
    }
  };

  const openFile = async (file: AssignmentSubmissionFile) => {
    try {
      const url = await getSubmissionFileSignedUrl(file);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setAssignmentMessage((error as Error).message || "Could not open submission file.");
    }
  };

  const updateReviewDraft = (
    submissionId: string,
    patch: Partial<{ score: string; feedback: string; saving: boolean }>,
  ) => {
    setReviewDrafts((current) => ({
      ...current,
      [submissionId]: {
        score: current[submissionId]?.score || "",
        feedback: current[submissionId]?.feedback || "",
        saving: current[submissionId]?.saving || false,
        ...patch,
      },
    }));
  };

  const review = async (
    assignment: Assignment,
    submission: AssignmentSubmission,
    decision: "accepted" | "returned",
  ) => {
    const draft = reviewDrafts[submission.id] || { score: "", feedback: "", saving: false };
    const score = Number(draft.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setAssignmentMessage("Enter a score from 0 to 100 before returning a review.");
      return;
    }
    updateReviewDraft(submission.id, { saving: true });
    try {
      await onReviewSubmission({
        assignment,
        submission,
        scorePercent: score,
        feedback: draft.feedback.trim(),
        decision,
      });
      setAssignmentMessage(
        decision === "accepted" ? "Submission marked complete." : "Submission returned.",
      );
    } catch (error) {
      setAssignmentMessage((error as Error).message || "Could not review submission.");
    } finally {
      updateReviewDraft(submission.id, { saving: false });
    }
  };

  return (
    <div className="mt-6 rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Assignments</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Create class work, collect submissions, and return teacher-reviewed feedback.
          </p>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {assignments.length} assignment{assignments.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-border bg-background/35 p-4">
          <div className="text-[13px] font-medium text-foreground">Create assignment</div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lessonId: event.target.value,
                    resourceIds: [],
                  }))
                }
                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
              >
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Title
              <input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder="Purpose reflection"
                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Instructions
              <textarea
                value={draft.instructions}
                onChange={(event) => setField("instructions", event.target.value)}
                placeholder="Use the resource and explain what the tool is for in your own words."
                className="min-h-[86px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Due date
                <input
                  type="datetime-local"
                  value={draft.dueAt}
                  onChange={(event) => setField("dueAt", event.target.value)}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                />
              </label>

              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setField(
                      "status",
                      event.target.value as Extract<AssignmentStatus, "draft" | "assigned">,
                    )
                  }
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                >
                  <option value="assigned">Assigned</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
            </div>

            <div className="rounded-2xl border border-border bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Recipients
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setField(
                      "recipientIds",
                      draft.recipientIds.length === studentIds.length ? [] : studentIds,
                    )
                  }
                  className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {draft.recipientIds.length === studentIds.length ? "Clear" : "All students"}
                </button>
              </div>
              <div className="grid gap-2">
                {studentIds.map((studentId) => {
                  const profile = profilesById.get(studentId) || null;
                  return (
                    <label
                      key={studentId}
                      className="flex items-center gap-2 text-[12.5px] text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={draft.recipientIds.includes(studentId)}
                        onChange={() => toggleRecipient(studentId)}
                        className="h-4 w-4 accent-foreground"
                      />
                      {displayName(profile, studentId)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background/40 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Optional resources
              </div>
              {resourcesForLesson.length ? (
                <div className="grid gap-2">
                  {resourcesForLesson.map((resource) => (
                    <label
                      key={resource.id}
                      className="flex items-center gap-2 text-[12.5px] text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={draft.resourceIds.includes(resource.id)}
                        onChange={() => toggleResource(resource.id)}
                        className="h-4 w-4 accent-foreground"
                      />
                      <span className="min-w-0 truncate">
                        {resource.title} · {resource.status}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-[12.5px] text-muted-foreground">
                  No resources are attached to this lesson yet.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              {saving ? "Saving..." : draft.status === "assigned" ? "Assign work" : "Save draft"}
            </button>
            {assignmentMessage ? (
              <div className="text-[12px] leading-relaxed text-muted-foreground">
                {assignmentMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid content-start gap-3">
          {assignments.length ? (
            assignments.map((assignment) => {
              const assignmentRecipients = recipients.filter(
                (recipient) => recipient.assignment_id === assignment.id,
              );
              const assignmentSubmissions = submissions.filter(
                (submission) => submission.assignment_id === assignment.id,
              );
              const linkedResources = resources.filter(
                (resource) => resource.assignment_id === assignment.id,
              );
              return (
                <div
                  key={assignment.id}
                  className="rounded-2xl border border-border bg-background/35 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-foreground">
                          {assignment.title}
                        </span>
                        <AssignmentStatusChip status={assignment.status} />
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {lessonTitle(lessons, assignment.lesson_id)} · {assignmentRecipients.length}{" "}
                        recipients · {assignmentSubmissions.length} submissions
                      </div>
                      {assignment.due_at ? (
                        <div className="mt-1 text-[11.5px] text-muted-foreground">
                          Due {formatDateTime(assignment.due_at)}
                        </div>
                      ) : null}
                      <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                        {assignment.instructions || "No instructions."}
                      </p>
                      {linkedResources.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {linkedResources.map((resource) => (
                            <span
                              key={resource.id}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/45 px-2.5 py-1 text-[11.5px] text-muted-foreground"
                            >
                              <Paperclip className="h-3 w-3" strokeWidth={1.7} />
                              {resource.title}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onSetAssignmentStatus(assignment.id, "assigned")}
                        disabled={assignment.status === "assigned"}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 px-3 py-1.5 text-[11.5px] text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-45"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Assign
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetAssignmentStatus(assignment.id, "draft")}
                        disabled={assignment.status === "draft"}
                        className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                      >
                        Draft
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetAssignmentStatus(assignment.id, "archived")}
                        disabled={assignment.status === "archived"}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                      >
                        <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Archive
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    {assignmentRecipients.map((recipient) => {
                      const profile = profilesById.get(recipient.user_id) || null;
                      return (
                        <div
                          key={recipient.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-background/35 px-3 py-2"
                        >
                          <div className="text-[12.5px] text-foreground">
                            {displayName(profile, recipient.user_id)}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <AssignmentRecipientChip status={recipient.status} />
                            <span className="text-[11.5px] text-muted-foreground">
                              {recipient.score === null ? "ungraded" : formatScore(recipient.score)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-3">
                    {assignmentSubmissions.length ? (
                      assignmentSubmissions.map((submission) => {
                        const profile = profilesById.get(submission.user_id) || null;
                        const submissionFiles = files.filter(
                          (file) => file.submission_id === submission.id,
                        );
                        const draft = reviewDrafts[submission.id] || {
                          score:
                            submission.score === null || submission.score === undefined
                              ? ""
                              : String(Math.round(submission.score * 100)),
                          feedback: submission.feedback || "",
                          saving: false,
                        };
                        return (
                          <div
                            key={submission.id}
                            className="rounded-2xl border border-border bg-background/45 p-3"
                          >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-[12.5px] font-medium text-foreground">
                                  {displayName(profile, submission.user_id)}
                                </div>
                                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                  {submission.status} · {formatDateTime(submission.created_at)}
                                </div>
                              </div>
                              <span className="text-[11.5px] text-muted-foreground">
                                {submission.score === null
                                  ? "not graded"
                                  : formatScore(submission.score)}
                              </span>
                            </div>
                            {submission.content ? (
                              <p className="whitespace-pre-wrap rounded-2xl border border-border bg-background/45 p-3 text-[12.5px] leading-relaxed text-foreground">
                                {submission.content}
                              </p>
                            ) : null}
                            {submission.code ? (
                              <pre
                                className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-[var(--code-background)] p-3 text-[12px] leading-relaxed text-[var(--code-foreground)]"
                                style={{
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                }}
                              >
                                {submission.code}
                              </pre>
                            ) : null}
                            {submissionFiles.length ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {submissionFiles.map((file) => (
                                  <button
                                    type="button"
                                    key={file.id}
                                    onClick={() => void openFile(file)}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
                                    {file.original_filename}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            <div className="mt-3 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={draft.score}
                                onChange={(event) =>
                                  updateReviewDraft(submission.id, { score: event.target.value })
                                }
                                placeholder="Score"
                                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                              />
                              <input
                                value={draft.feedback}
                                onChange={(event) =>
                                  updateReviewDraft(submission.id, {
                                    feedback: event.target.value,
                                  })
                                }
                                placeholder="Feedback for the student"
                                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void review(assignment, submission, "accepted")}
                                disabled={draft.saving}
                                className="rounded-full border border-emerald-500/35 px-3 py-1.5 text-[11.5px] text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-45"
                              >
                                Mark complete
                              </button>
                              <button
                                type="button"
                                onClick={() => void review(assignment, submission, "returned")}
                                disabled={draft.saving}
                                className="rounded-full border border-amber-500/35 px-3 py-1.5 text-[11.5px] text-amber-500 transition-colors hover:bg-amber-500/10 disabled:opacity-45"
                              >
                                Return
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-border bg-background/35 p-4 text-[12.5px] text-muted-foreground">
                        No submissions yet.
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-border bg-background/35 p-5 text-[13px] text-muted-foreground">
              No assignments yet. Create one for a lesson when students need to submit work.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GradebookTable({
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

  return (
    <div className="mt-6 rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Gradebook</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Scan completion, scores, attempts, quizzes, evidence, and attention signals.
          </p>
        </div>
        <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          Lesson filter
          <select
            value={selectedLessonId}
            onChange={(event) => onSelectLesson(event.target.value)}
            className="min-w-[220px] rounded-full border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
          >
            <option value="all">All lessons</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto pb-1">
          <table className="min-w-[920px] w-full border-separate border-spacing-y-2 text-left">
            <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              <tr>
                <th className="px-3 py-1 font-medium">Student</th>
                <th className="px-3 py-1 font-medium">Lesson status</th>
                <th className="px-3 py-1 font-medium">Score</th>
                <th className="px-3 py-1 font-medium">Attempts</th>
                <th className="px-3 py-1 font-medium">Quiz</th>
                <th className="px-3 py-1 font-medium">Evidence</th>
                <th className="px-3 py-1 font-medium">Mastery</th>
                <th className="px-3 py-1 font-medium">Last activity</th>
                <th className="px-3 py-1 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const profile = profilesById.get(row.studentId) || null;
                return (
                  <tr
                    key={row.studentId}
                    className={`rounded-2xl border border-border bg-background/35 ${
                      selectedStudentId === row.studentId
                        ? "outline outline-1 outline-foreground/20"
                        : ""
                    }`}
                  >
                    <td className="rounded-l-2xl border-y border-l border-border px-3 py-3">
                      <div className="text-[13px] font-medium text-foreground">
                        {displayName(profile, row.studentId)}
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {profile?.grade || "Grade not set"}
                      </div>
                    </td>
                    <td className="border-y border-border px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] ${row.statusClass}`}
                        >
                          {row.statusLabel}
                        </span>
                        {row.needsAttention ? (
                          <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11.5px] text-amber-500">
                            Needs attention
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {row.lessonDetail}
                      </div>
                    </td>
                    <td className="border-y border-border px-3 py-3 text-[12.5px] text-foreground">
                      {row.scoreLabel}
                    </td>
                    <td className="border-y border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                      {row.attempts}
                    </td>
                    <td className="border-y border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                      {row.quizAttempts}
                    </td>
                    <td className="border-y border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                      {row.evidence}
                    </td>
                    <td className="border-y border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                      {row.mastery}
                    </td>
                    <td className="border-y border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                      {row.latestSession
                        ? formatDateTime(row.latestSession.updated_at)
                        : "No activity"}
                    </td>
                    <td className="rounded-r-2xl border-y border-r border-border px-3 py-3">
                      <button
                        type="button"
                        onClick={() => onSelectStudent(row.studentId)}
                        className="rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-muted"
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
      ) : (
        <div className="rounded-2xl border border-border bg-background/35 p-4 text-[12.5px] text-muted-foreground">
          Add students to this class to populate the gradebook.
        </div>
      )}
    </div>
  );
}

function LessonProgress({
  lessons,
  studentIds,
  dashboard,
  profilesById,
}: {
  lessons: Lesson[];
  studentIds: string[];
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
}) {
  return (
    <div className="mt-6 rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Lesson Progress</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Completed lessons stay visible even when a student starts a newer lesson.
          </p>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {lessons.length} lessons
        </div>
      </div>

      {studentIds.length ? (
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[760px] gap-2">
            {studentIds.map((studentId) => {
              const profile = profilesById.get(studentId) || null;
              return (
                <div
                  key={studentId}
                  className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 rounded-2xl border border-border bg-background/35 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {displayName(profile, studentId)}
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                      {profile?.grade || "Grade not set"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lessons.map((lesson) => {
                      const status = lessonProgressStatus(dashboard.sessions, studentId, lesson.id);
                      return (
                        <span
                          key={`${studentId}-${lesson.id}`}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] ${lessonStatusClass(
                            status,
                          )}`}
                          title={`${lesson.title}: ${status}`}
                        >
                          {lesson.title} · {status}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-background/35 p-4 text-[12.5px] text-muted-foreground">
          No students are assigned to this class yet.
        </div>
      )}
    </div>
  );
}

function StudentDetail({
  studentId,
  profile,
  stats,
  dashboard,
  lessonsById,
  sessions,
  selectedSession,
  selectedSessionId,
  onSelectSession,
  noteDraft,
  noteVisibility,
  savingNote,
  onNoteChange,
  onNoteVisibilityChange,
  onSaveNote,
  onBack,
}: {
  studentId: string;
  profile: Profile | null;
  stats: StudentSummary;
  dashboard: TeacherDashboardData;
  lessonsById: Map<string, Lesson>;
  sessions: LearningSession[];
  selectedSession: LearningSession | null;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  noteDraft: string;
  noteVisibility: TeacherNote["visibility"];
  savingNote: boolean;
  onNoteChange: (value: string) => void;
  onNoteVisibilityChange: (value: TeacherNote["visibility"]) => void;
  onSaveNote: () => void;
  onBack: () => void;
}) {
  const turns = selectedSession
    ? dashboard.turns.filter((turn) => turn.session_id === selectedSession.id)
    : [];
  const attempts = dashboard.attempts.filter(
    (item) =>
      item.user_id === studentId && (!selectedSession || item.session_id === selectedSession.id),
  );
  const quizAttempts = dashboard.quizAttempts.filter(
    (item) =>
      item.user_id === studentId && (!selectedSession || item.session_id === selectedSession.id),
  );
  const evidence = dashboard.evidence.filter(
    (item) =>
      item.user_id === studentId && (!selectedSession || item.session_id === selectedSession.id),
  );
  const mastery = dashboard.mastery.filter((item) => item.user_id === studentId);
  const notes = dashboard.notes.filter((item) => item.student_id === studentId);
  const activeSessions = sessions.filter((session) => session.status !== "complete");
  const completedSessions = sessions.filter((session) => session.status === "complete");

  return (
    <GradientCard>
      <div className="p-4 sm:p-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.6} /> Back to class
        </button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              Student detail
            </div>
            <h2 className="mt-1 text-[24px] font-medium text-foreground">
              {displayName(profile, studentId)}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {profile?.grade || "Grade not set"} - latest status:{" "}
              {sessions[0] ? statusLabel(sessions[0]) : "no session yet"}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-[12px]">
            <MiniMetric label="Sessions" value={String(stats.sessions)} />
            <MiniMetric label="Attempts" value={String(stats.attempts)} />
            <MiniMetric label="Quizzes" value={String(stats.quizAttempts)} />
            <MiniMetric label="Evidence" value={String(stats.evidence)} />
          </div>
        </div>

        {selectedSession ? (
          <div className="mt-4 rounded-3xl border border-border bg-background/35 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                  Selected session
                </div>
                <div className="mt-1 text-[15px] font-medium text-foreground">
                  {lessonName(lessonsById, selectedSession.lesson_id)}
                </div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">
                  {statusLabel(selectedSession)} - updated{" "}
                  {formatDateTime(selectedSession.updated_at)}
                </div>
              </div>
              <span
                className={`w-fit rounded-full border px-3 py-1.5 text-[12px] ${lessonStatusClass(
                  sessionProgressStatus(selectedSession),
                )}`}
              >
                {sessionProgressStatus(selectedSession)}
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Panel title="Transcript" icon={<MessageSquare className="h-4 w-4" strokeWidth={1.6} />}>
            {sessions.length ? (
              <div className="mb-3 grid gap-3">
                <SessionChipGroup
                  label="Active"
                  sessions={activeSessions}
                  lessonsById={lessonsById}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={onSelectSession}
                />
                <SessionChipGroup
                  label="Completed"
                  sessions={completedSessions}
                  lessonsById={lessonsById}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={onSelectSession}
                />
              </div>
            ) : null}

            {turns.length ? (
              <div className="max-h-[440px] space-y-3 overflow-auto pr-1">
                {turns.map((turn) => (
                  <div
                    key={turn.id}
                    className="rounded-3xl border border-border bg-background/45 p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                        {turn.role} - {turn.stage}
                      </span>
                      <span className="text-[11.5px] text-muted-foreground">
                        {formatDateTime(turn.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                      {turn.content || "[Empty turn]"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyInline
                title={
                  sessions.length && !selectedSession ? "Choose a session" : "No transcript yet"
                }
                body={
                  sessions.length && !selectedSession
                    ? "Choose a session to inspect the transcript."
                    : "The transcript will appear after this student starts or completes a lesson."
                }
              />
            )}
          </Panel>

          <div className="grid gap-4">
            <Panel
              title="Teacher notes"
              icon={<NotebookText className="h-4 w-4" strokeWidth={1.6} />}
            >
              <textarea
                value={noteDraft}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Add a private observation or student-visible note..."
                className="min-h-[96px] w-full rounded-2xl border border-border bg-background/60 px-3 py-3 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <select
                  value={noteVisibility}
                  onChange={(event) =>
                    onNoteVisibilityChange(event.target.value as TeacherNote["visibility"])
                  }
                  className="rounded-full border border-border bg-background/60 px-3 py-2 text-[12px] text-foreground outline-none"
                >
                  <option value="teacher_private">Teacher private</option>
                  <option value="student_visible">Student visible</option>
                </select>
                <button
                  type="button"
                  onClick={onSaveNote}
                  disabled={!noteDraft.trim() || savingNote}
                  className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {savingNote ? "Saving..." : "Save note"}
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {notes.length ? (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-2xl border border-border bg-background/45 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                        <span>
                          {note.visibility === "student_visible" ? "Student visible" : "Private"}
                        </span>
                        <span>{formatDateTime(note.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                        {note.note}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="text-[12.5px] text-muted-foreground">No notes yet.</div>
                )}
              </div>
            </Panel>

            <Panel title="Mastery" icon={<GraduationCap className="h-4 w-4" strokeWidth={1.6} />}>
              {mastery.length ? (
                <div className="space-y-2">
                  {mastery.map((item) => (
                    <div
                      key={`${item.user_id}-${item.skill_key}`}
                      className="rounded-2xl border border-border bg-background/45 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-foreground">
                          {item.skill_key}
                        </span>
                        <span className="text-[12px] text-muted-foreground">{item.level}</span>
                      </div>
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {item.evidence_count} evidence - score {formatScore(item.score)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyInline
                  title="No mastery rows"
                  body="Mastery appears after assessed lesson work."
                />
              )}
            </Panel>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Panel
            title="Lesson attempts"
            icon={<ClipboardList className="h-4 w-4" strokeWidth={1.6} />}
          >
            {attempts.length ? (
              <RecordList
                items={attempts.slice(0, 8).map((item) => ({
                  id: item.id,
                  title: `${lessonName(lessonsById, item.lesson_id)} - ${item.answer_mode}`,
                  meta: `${formatPass(item.passed)} - score ${formatScore(item.score)}`,
                  body:
                    item.feedback || item.answer_text || item.answer_code || "No feedback text.",
                }))}
              />
            ) : (
              <EmptyInline
                title="No attempts"
                body="Code/text attempts appear after lesson activity."
              />
            )}
          </Panel>

          <Panel title="Quiz checks" icon={<BookOpen className="h-4 w-4" strokeWidth={1.6} />}>
            {quizAttempts.length ? (
              <RecordList
                items={quizAttempts.slice(0, 8).map((item) => ({
                  id: item.id,
                  title: `${lessonName(lessonsById, item.lesson_id)} - ${item.choice_id || item.answer_mode}`,
                  meta: `${formatPass(item.passed)} - score ${formatScore(item.score)}`,
                  body: item.feedback || item.answer_text || "Objective quiz attempt.",
                }))}
              />
            ) : (
              <EmptyInline
                title="No quiz attempts"
                body="Quiz records appear after a checkpoint."
              />
            )}
          </Panel>

          <Panel title="Evidence" icon={<FileText className="h-4 w-4" strokeWidth={1.6} />}>
            {evidence.length ? (
              <RecordList
                items={evidence.slice(0, 8).map((item) => ({
                  id: item.id,
                  title: `${item.source_type} - ${item.skill_keys.join(", ") || "skill evidence"}`,
                  meta: `${lessonName(lessonsById, item.lesson_id)} - score ${formatScore(item.score)}`,
                  body: item.notes || "Evidence captured from lesson work.",
                }))}
              />
            ) : (
              <EmptyInline title="No evidence" body="Evidence appears after rubric-backed work." />
            )}
          </Panel>
        </div>
      </div>
    </GradientCard>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <GradientCard>
      <div className="p-5">
        <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="mt-2 font-serif text-[34px] leading-none text-foreground">{value}</div>
      </div>
    </GradientCard>
  );
}

function SessionChipGroup({
  label,
  sessions,
  lessonsById,
  selectedSessionId,
  onSelectSession,
}: {
  label: "Active" | "Completed";
  sessions: LearningSession[];
  lessonsById: Map<string, Lesson>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      {sessions.length ? (
        <div className="flex flex-wrap gap-2">
          {sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                selectedSessionId === session.id
                  ? "border-foreground/25 bg-background text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {lessonName(lessonsById, session.lesson_id)} · {session.status}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">
          {label === "Completed" ? "No completed lessons yet" : "No active lessons"}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/45 px-3 py-2">
      <div className="text-[15px] font-medium text-foreground">{value}</div>
      <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function ResourceStatusChip({ status }: { status: LessonResourceStatus }) {
  const classes =
    status === "published"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : "border-amber-500/35 bg-amber-500/10 text-amber-500";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  const classes =
    status === "assigned"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : status === "recommended"
          ? "border-blue-500/35 bg-blue-500/10 text-blue-500"
          : "border-amber-500/35 bg-amber-500/10 text-amber-500";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function AssignmentRecipientChip({ status }: { status: AssignmentRecipient["status"] }) {
  const classes =
    status === "complete"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
      : status === "submitted"
        ? "border-blue-500/35 bg-blue-500/10 text-blue-500"
        : status === "returned"
          ? "border-amber-500/35 bg-amber-500/10 text-amber-500"
          : "border-border bg-background/45 text-muted-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-background/35 p-4">
      <div className="mb-3 flex items-center gap-2 text-[14px] font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <GradientCard>
      <div className="p-6">
        <h2 className="text-[16px] font-medium text-foreground">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </GradientCard>
  );
}

function EmptyInline({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/45 p-4">
      <div className="text-[13px] font-medium text-foreground">{title}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{body}</div>
    </div>
  );
}

function RecordList({
  items,
}: {
  items: Array<{ id: string; title: string; meta: string; body: string }>;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-2xl border border-border bg-background/45 p-3">
          <div className="text-[13px] font-medium text-foreground">{item.title}</div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">{item.meta}</div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}

type ClassSummary = {
  students: number;
  teachers: number;
  sessions: number;
  completedSessions: number;
  attempts: number;
  quizAttempts: number;
  evidence: number;
};

type StudentSummary = {
  sessions: number;
  completedSessions: number;
  attempts: number;
  quizAttempts: number;
  evidence: number;
};

type GradebookRow = {
  studentId: string;
  statusLabel: string;
  statusClass: string;
  lessonDetail: string;
  scoreLabel: string;
  attempts: number;
  quizAttempts: number;
  evidence: number;
  mastery: number;
  latestSession: LearningSession | null;
  needsAttention: boolean;
};

function summarizeClass(dashboard: TeacherDashboardData, classId: string): ClassSummary {
  const studentIds = new Set(
    dashboard.memberships
      .filter(
        (membership) =>
          membership.class_id === classId &&
          membership.role === "student" &&
          membership.status === "active",
      )
      .map((membership) => membership.user_id),
  );
  const teachers = dashboard.memberships.filter(
    (membership) =>
      membership.class_id === classId &&
      membership.role === "teacher" &&
      membership.status === "active",
  ).length;
  const sessions = dashboard.sessions.filter((session) => studentIds.has(session.user_id));
  return {
    students: studentIds.size,
    teachers,
    sessions: sessions.length,
    completedSessions: sessions.filter((session) => session.status === "complete").length,
    attempts: dashboard.attempts.filter((item) => studentIds.has(item.user_id)).length,
    quizAttempts: dashboard.quizAttempts.filter((item) => studentIds.has(item.user_id)).length,
    evidence: dashboard.evidence.filter((item) => studentIds.has(item.user_id)).length,
  };
}

function gradebookRowForStudent(
  dashboard: TeacherDashboardData,
  studentId: string,
  selectedLessonId: string,
  lessons: Lesson[],
  lessonsById: Map<string, Lesson>,
): GradebookRow {
  const selectedLesson = selectedLessonId === "all" ? null : selectedLessonId;
  const sessions = dashboard.sessions
    .filter(
      (session) =>
        session.user_id === studentId && (!selectedLesson || session.lesson_id === selectedLesson),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const latestSession = sessions[0] || null;
  const completedSessions = sessions.filter((session) => session.status === "complete");
  const attempts = dashboard.attempts.filter(
    (item) => item.user_id === studentId && (!selectedLesson || item.lesson_id === selectedLesson),
  );
  const quizAttempts = dashboard.quizAttempts.filter(
    (item) => item.user_id === studentId && (!selectedLesson || item.lesson_id === selectedLesson),
  );
  const evidence = dashboard.evidence.filter(
    (item) => item.user_id === studentId && (!selectedLesson || item.lesson_id === selectedLesson),
  );
  const mastery = dashboard.mastery.filter((item) => item.user_id === studentId);
  const failedSignals =
    attempts.some((item) => item.passed === false) ||
    quizAttempts.some((item) => item.passed === false) ||
    sessions.some(
      (session) => session.status === "needs_retry" || session.status === "needs_rescue",
    );

  if (selectedLesson) {
    const progress = lessonProgressStatus(dashboard.sessions, studentId, selectedLesson);
    return {
      studentId,
      statusLabel: progress,
      statusClass: lessonStatusClass(progress),
      lessonDetail: lessonName(lessonsById, selectedLesson),
      scoreLabel: latestSession ? formatScore(latestSession.score) : "n/a",
      attempts: attempts.length,
      quizAttempts: quizAttempts.length,
      evidence: evidence.length,
      mastery: mastery.length,
      latestSession,
      needsAttention: progress === "Retry" || failedSignals,
    };
  }

  const completedLessonNames = completedLessonNamesFor(dashboard.sessions, studentId, lessonsById);
  const completedCount = completedLessonNames.length;
  const totalLessons = lessons.length;
  const activeCount = sessions.filter((session) => session.status !== "complete").length;
  const averageCompleteScore = completedSessions.length
    ? completedSessions.reduce((sum, session) => sum + Number(session.score || 0), 0) /
      completedSessions.length
    : null;

  return {
    studentId,
    statusLabel: `${completedCount}/${totalLessons} complete`,
    statusClass:
      completedCount > 0
        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
        : "border-border bg-background/45 text-muted-foreground",
    lessonDetail: activeCount
      ? `${activeCount} active lesson${activeCount === 1 ? "" : "s"}`
      : completedCount
        ? completedLessonNames.join(", ")
        : "No lessons started",
    scoreLabel: averageCompleteScore === null ? "n/a" : `${formatScore(averageCompleteScore)} avg`,
    attempts: attempts.length,
    quizAttempts: quizAttempts.length,
    evidence: evidence.length,
    mastery: mastery.length,
    latestSession,
    needsAttention: failedSignals,
  };
}

function summarizeStudent(dashboard: TeacherDashboardData, studentId: string): StudentSummary {
  return {
    sessions: dashboard.sessions.filter((session) => session.user_id === studentId).length,
    completedSessions: dashboard.sessions.filter(
      (session) => session.user_id === studentId && session.status === "complete",
    ).length,
    attempts: dashboard.attempts.filter((item) => item.user_id === studentId).length,
    quizAttempts: dashboard.quizAttempts.filter((item) => item.user_id === studentId).length,
    evidence: dashboard.evidence.filter((item) => item.user_id === studentId).length,
  };
}

function latestSessionFor(sessions: LearningSession[], studentId: string) {
  return sessions
    .filter((session) => session.user_id === studentId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

function completedLessonNamesFor(
  sessions: LearningSession[],
  studentId: string,
  lessonsById: Map<string, Lesson>,
) {
  return unique(
    sessions
      .filter((session) => session.user_id === studentId && session.status === "complete")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((session) => lessonName(lessonsById, session.lesson_id)),
  );
}

type LessonProgressStatus = "Not started" | "Active" | "Retry" | "Complete";

function sessionProgressStatus(session: LearningSession): LessonProgressStatus {
  if (session.status === "complete") return "Complete";
  if (session.status === "needs_retry") return "Retry";
  return "Active";
}

function lessonProgressStatus(
  sessions: LearningSession[],
  studentId: string,
  lessonId: string,
): LessonProgressStatus {
  const lessonSessions = sessions.filter(
    (session) => session.user_id === studentId && session.lesson_id === lessonId,
  );
  if (lessonSessions.some((session) => session.status === "complete")) return "Complete";
  if (lessonSessions.some((session) => session.status === "needs_retry")) return "Retry";
  if (
    lessonSessions.some(
      (session) => session.status === "active" || session.status === "needs_rescue",
    )
  ) {
    return "Active";
  }
  return "Not started";
}

function lessonStatusClass(status: LessonProgressStatus) {
  if (status === "Complete") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-500";
  }
  if (status === "Active") {
    return "border-blue-500/35 bg-blue-500/10 text-blue-500";
  }
  if (status === "Retry") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-500";
  }
  return "border-border bg-background/45 text-muted-foreground";
}

function displayName(profile: Profile | null | undefined, userId: string) {
  return profile?.name || `Student ${userId.slice(0, 8)}`;
}

function organizationName(summary: TeacherClassSummary) {
  const organization = Array.isArray(summary.organizations)
    ? summary.organizations[0]
    : summary.organizations;
  return organization?.name || "Organization";
}

function lessonName(lessonsById: Map<string, Lesson>, lessonId: string | null | undefined) {
  if (!lessonId) return "No lesson";
  return lessonsById.get(lessonId)?.title || lessonId;
}

function lessonTitle(lessons: Lesson[], lessonId: string | null | undefined) {
  if (!lessonId) return "No lesson";
  return lessons.find((lesson) => lesson.id === lessonId)?.title || lessonId;
}

function statusLabel(session: LearningSession) {
  return `${session.status} - ${session.stage} - score ${formatScore(session.score)}`;
}

function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "n/a";
  if (score <= 1) return `${Math.round(score * 100)}%`;
  return `${Math.round(score)}%`;
}

function formatPass(value: boolean | null | undefined) {
  if (value === true) return "passed";
  if (value === false) return "not passed";
  return "ungraded";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
