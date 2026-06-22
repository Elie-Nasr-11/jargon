import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  FileText,
  GraduationCap,
  MessageSquare,
  NotebookText,
  UsersRound,
} from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import { createTeacherNote, fetchTeacherDashboard, getSession } from "@/lib/api";
import type {
  LearningSession,
  Lesson,
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
  const [message, setMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteVisibility, setNoteVisibility] =
    useState<TeacherNote["visibility"]>("teacher_private");
  const [savingNote, setSavingNote] = useState(false);

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
                    studentIds={classStudents}
                    selectedStudentId={selectedStudentId}
                    onSelectStudent={setSelectedStudentId}
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
  studentIds,
  selectedStudentId,
  onSelectStudent,
}: {
  item: TeacherClassSummary;
  stats: ClassSummary;
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  lessonsById: Map<string, Lesson>;
  studentIds: string[];
  selectedStudentId: string | null;
  onSelectStudent: (studentId: string) => void;
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
  const attempts = dashboard.attempts.filter((item) => item.user_id === studentId);
  const quizAttempts = dashboard.quizAttempts.filter((item) => item.user_id === studentId);
  const evidence = dashboard.evidence.filter((item) => item.user_id === studentId);
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
