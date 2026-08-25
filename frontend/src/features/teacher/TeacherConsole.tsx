import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BarChart3,
  Check,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Pause,
  Play,
  ExternalLink,
  GraduationCap,
  MessageSquare,
  NotebookText,
  Paperclip,
  Send,
  UsersRound,
} from "lucide-react";
import { NumberFlip } from "@/features/teacher/HotlistFeed";
import { AssignmentWorkView } from "@/features/teacher/AssignmentGrading";
import { AssessmentWorkView } from "@/features/teacher/AssessmentGrading";
// Type-only: erased at compile time, so it does NOT pull the heavy studio chunk in.
import type { ClassworkItem } from "@/routes/teacher.curriculum";
// R42: the authoring studio lives inside each class's Curriculum section now. Its code
// stays in the (heavy) route module and loads on demand the first time the section opens,
// so the Students landing stays as light as before.
const CurriculumStudio = lazy(() =>
  import("@/routes/teacher.curriculum").then((module) => ({ default: module.CurriculumStudio })),
);
import {
  lessonStatusClass,
  requiredCheckpointStatus,
  sessionProgressStatus,
  unifiedLessonStatus,
  unifiedStatusClass,
} from "@/features/teacher/lessonStatus";
import {
  AssessmentRecipientChip,
  AssessmentStatusChip,
  AssignmentRecipientChip,
  AssignmentStatusChip,
  displayName,
  formatDateTime,
  formatScore,
  lessonName,
  lessonTitle,
} from "@/features/teacher/classShared";
import { Tabs, WorkspaceTab, WorkspaceTabList, WorkspacePanel } from "@/components/WorkspaceTabs";
import { Collapsible } from "@/components/Collapsible";
import { PageShell } from "@/components/PageShell";
import { TeacherShell } from "@/features/teacher/shell/TeacherShell";
import {
  CLASS_SECTIONS,
  normalizeClassSection,
  type ClassSection,
} from "@/features/teacher/shell/teacherNav";
import { RouteLoader } from "@/components/RouteLoader";
import { EmptyState } from "@/components/EmptyState";
import { OverflowMenu } from "@/components/OverflowMenu";
import { notifyUndo } from "@/lib/feedback";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createAssignment,
  createAssessment,
  createLessonResource,
  createTeacherNote,
  enrollStudents,
  fetchEnrollableStudents,
  fetchTeacherDashboard,
  gradeAssignmentSubmission,
  getLessonResourceSignedUrl,
  getSession,
  fetchPrimaryRole,
  roleHomeNav,
  heartbeatLiveSessionViewer,
  sendTeacherLiveComment,
  startLiveSessionViewer,
  stopLiveSessionViewer,
  fetchSessionHold,
  holdSession,
  releaseSessionHold,
  setMemberSection,
  updateAssignmentStatus,
  updateAssessmentStatus,
  reviewAssessmentItem,
  returnAssessment,
  updateLessonResource,
} from "@/lib/api";
import type {
  Assignment,
  AssignmentRecipient,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentSubmissionFile,
  Assessment,
  AssessmentAttempt,
  AssessmentGradingMode,
  AssessmentItem,
  AssessmentItemAttempt,
  AssessmentRecipient,
  AssessmentResultReleasePolicy,
  AssessmentStatus,
  ChatInputModality,
  CurriculumQuizItem,
  LearningSession,
  Lesson,
  LessonResource,
  LessonResourceDisplayMode,
  LessonResourceSource,
  LessonResourceStatus,
  LessonResourceType,
  LessonResourceVisibility,
  LiveSessionViewer,
  Profile,
  TeacherClassSummary,
  TeacherDashboardData,
  TeacherNote,
} from "@/lib/types";

export function TeacherConsole() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as {
    classId?: string;
    studentId?: string;
  };
  const search = useSearch({ strict: false }) as {
    tab?: string;
    session?: string;
    assignment?: string;
    assessment?: string;
  };
  const [auth, setAuth] = useState<{ id: string; email: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedGradebookLessonId, setSelectedGradebookLessonId] = useState("all");
  const [message, setMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteVisibility, setNoteVisibility] =
    useState<TeacherNote["visibility"]>("teacher_private");
  const [savingNote, setSavingNote] = useState(false);
  const [savingResource, setSavingResource] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [liveViewer, setLiveViewer] = useState<LiveSessionViewer | null>(null);
  const [liveCommentDraft, setLiveCommentDraft] = useState("");
  // Phase 3: whether the selected session is paused by a teacher, + an in-flight guard.
  const [sessionHeld, setSessionHeld] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [sendingLiveComment, setSendingLiveComment] = useState(false);

  const teacherId = auth?.id ?? "";
  const email = auth?.email ?? "";
  const selectedClassId = params.classId ?? null;
  const selectedStudentId = params.studentId ?? null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const session = await getSession();
        if (!alive) return;
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const role = await fetchPrimaryRole(session.access_token, session.user.id);
        if (!alive) return;
        if (role !== "teacher") {
          navigate({ ...roleHomeNav(role), replace: true });
          return;
        }
        setAuth({ id: session.user.id, email: session.user.email || "" });
        // Only mark checked once the teacher role is confirmed, so the gate below
        // never renders teacher chrome for a wrong-role user mid-redirect.
        if (alive) setAuthChecked(true);
      } catch {
        if (alive) navigate({ to: "/login", replace: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  const dashboardQuery = useQuery({
    queryKey: ["teacherDashboard", teacherId],
    queryFn: () => fetchTeacherDashboard(teacherId),
    enabled: Boolean(teacherId),
    staleTime: 5 * 60 * 1000,
    // Keep the live surfaces (hotlist live_now, the class Overview live-now strip, and every
    // "N min ago" label) current: refetch every 30s in the foreground only (React Query skips
    // background tabs by default), which also re-renders with a fresh clock.
    refetchInterval: 30 * 1000,
  });
  const dashboard = dashboardQuery.data ?? null;
  const booting = !authChecked || (Boolean(teacherId) && dashboardQuery.isPending);

  // Optimistic dashboard updates now target the React Query cache so every
  // teacher route (home / class / student) shares one fetch and stays in sync.
  // Keeps the existing `setDashboard(updater)` call sites unchanged.
  const setDashboard = useCallback(
    (
      updater:
        | TeacherDashboardData
        | null
        | ((current: TeacherDashboardData | null) => TeacherDashboardData | null),
    ) => {
      queryClient.setQueryData<TeacherDashboardData | null>(
        ["teacherDashboard", teacherId],
        (current) => {
          const next =
            typeof updater === "function"
              ? (updater as (c: TeacherDashboardData | null) => TeacherDashboardData | null)(
                  current ?? null,
                )
              : updater;
          return next ?? current ?? null;
        },
      );
    },
    [queryClient, teacherId],
  );

  const loadDashboard = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["teacherDashboard", teacherId] });
  }, [queryClient, teacherId]);

  // R45 sections: sections are student groupings WITHIN the class. Optimistic label
  // change; enrollment pulls existing org accounts (account creation stays with the
  // admin) and refetches the dashboard so profiles/rosters fill in.
  const setStudentSection = useCallback(
    async (classId: string, studentId: string, section: string | null) => {
      const session = await getSession();
      if (!session) throw new Error("Sign in again to update sections.");
      await setMemberSection({
        accessToken: session.access_token,
        classId,
        userId: studentId,
        section,
      });
      setDashboard((current) =>
        current
          ? {
              ...current,
              memberships: current.memberships.map((membership) =>
                membership.class_id === classId &&
                membership.user_id === studentId &&
                membership.role === "student"
                  ? { ...membership, section }
                  : membership,
              ),
            }
          : current,
      );
    },
    [setDashboard],
  );

  const listEnrollable = useCallback(async (classId: string) => {
    const session = await getSession();
    if (!session) throw new Error("Sign in again.");
    return fetchEnrollableStudents({ accessToken: session.access_token, classId });
  }, []);

  const enrollIntoClass = useCallback(
    async (classId: string, userIds: string[], section: string | null) => {
      const session = await getSession();
      if (!session) throw new Error("Sign in again.");
      await enrollStudents({ accessToken: session.access_token, classId, userIds, section });
      await loadDashboard();
    },
    [loadDashboard],
  );

  useEffect(() => {
    if (dashboardQuery.error) {
      setMessage((dashboardQuery.error as Error).message || "Could not load teacher dashboard.");
    }
  }, [dashboardQuery.error]);

  const model = useMemo(() => {
    if (!dashboard) return null;
    const profilesById = new Map(dashboard.profiles.map((profile) => [profile.id, profile]));
    const lessonsById = new Map(dashboard.lessons.map((lesson) => [lesson.id, lesson]));
    const classesById = new Map(dashboard.classes.map((item) => [item.id, item]));
    return { profilesById, lessonsById, classesById };
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
      // Honor an explicit ?session (from the class "Live now" strip) so drilling in lands on
      // that live session; otherwise fall back to the finished transcript, then the newest.
      const preferred =
        (search.session && studentSessions.find((session) => session.id === search.session)) ||
        studentSessions.find((session) => session.status === "complete") ||
        studentSessions[0];
      setSelectedSessionId(preferred.id);
    }
    if (!studentSessions.length) setSelectedSessionId(null);
  }, [selectedSessionId, selectedStudentId, studentSessions, search.session]);

  const selectedSession =
    selectedSessionId && dashboard
      ? dashboard.sessions.find((session) => session.id === selectedSessionId) || null
      : null;
  const liveViewerId = liveViewer?.id || null;
  const selectedSessionKey = selectedSession?.id || null;

  // Reflect the selected session's current hold state (Phase 3) so Pause/Resume shows the truth.
  useEffect(() => {
    if (!selectedSessionKey) {
      setSessionHeld(false);
      return;
    }
    let active = true;
    void fetchSessionHold(selectedSessionKey)
      .then((hold) => {
        if (active) setSessionHeld(hold?.active === true);
      })
      .catch(() => {
        if (active) setSessionHeld(false);
      });
    return () => {
      active = false;
    };
  }, [selectedSessionKey]);

  useEffect(() => {
    if (!liveViewerId) return;
    const interval = window.setInterval(() => {
      void heartbeatLiveSessionViewer(liveViewerId)
        .then((viewer) => setLiveViewer(viewer))
        .catch(() => {
          setMessage("Live watch heartbeat failed. Try starting watch again.");
          setLiveViewer(null);
        });
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [liveViewerId]);

  useEffect(() => {
    if (!liveViewerId) return;
    return () => {
      void stopLiveSessionViewer(liveViewerId).catch(() => undefined);
    };
  }, [liveViewerId]);

  useEffect(() => {
    if (liveViewer && liveViewer.session_id !== selectedSessionId) {
      setLiveViewer(null);
      setLiveCommentDraft("");
    }
  }, [liveViewer, selectedSessionId]);

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
        activityId: input.activityId ?? null,
        title: input.title,
        instructions: input.instructions,
        dueAt: input.dueAt || null,
        status: input.status,
        required: input.required,
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

  const setAssignmentStatus = async (
    assignmentId: string,
    status: AssignmentStatus,
    isUndo = false,
  ) => {
    const prev = dashboard?.assignments.find((a) => a.id === assignmentId)?.status;
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
      if (!isUndo && prev && prev !== status) {
        const label =
          status === "assigned" ? "assigned" : status === "draft" ? "moved to draft" : "archived";
        notifyUndo(
          `Assignment ${label}.`,
          () => void setAssignmentStatus(assignmentId, prev, true),
        );
      }
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

  const saveAssessment = async (input: AssessmentFormValues) => {
    setSavingAssessment(true);
    try {
      const created = await createAssessment({
        organizationId: input.organizationId,
        classId: input.classId,
        lessonId: input.lessonId,
        activityId: input.activityId ?? null,
        title: input.title,
        instructions: input.instructions,
        dueAt: input.dueAt || null,
        status: input.status,
        gradingMode: input.gradingMode,
        resultReleasePolicy: input.resultReleasePolicy,
        attemptLimit: input.attemptLimit,
        required: input.required,
        recipientIds: input.recipientIds,
        items: input.items,
      });
      if (!created?.assessment) return;
      setDashboard((current) =>
        current
          ? {
              ...current,
              assessments: [created.assessment!, ...current.assessments],
              assessmentItems: [
                ...(created.items || []),
                ...current.assessmentItems.filter(
                  (item) => item.assessment_id !== created.assessment!.id,
                ),
              ],
              assessmentRecipients: [
                ...(created.recipients || []),
                ...current.assessmentRecipients.filter(
                  (recipient) => recipient.assessment_id !== created.assessment!.id,
                ),
              ],
            }
          : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not create assessment.");
      throw error;
    } finally {
      setSavingAssessment(false);
    }
  };

  const setAssessmentStatus = async (
    assessmentId: string,
    status: AssessmentStatus,
    isUndo = false,
  ) => {
    const prev = dashboard?.assessments.find((a) => a.id === assessmentId)?.status;
    try {
      const updated = await updateAssessmentStatus(assessmentId, status);
      if (!updated) return;
      setDashboard((current) =>
        current
          ? {
              ...current,
              assessments: current.assessments.map((assessment) =>
                assessment.id === updated.id ? updated : assessment,
              ),
            }
          : current,
      );
      if (!isUndo && prev && prev !== status) {
        const label =
          status === "published" ? "published" : status === "draft" ? "moved to draft" : "archived";
        notifyUndo(
          `Assessment ${label}.`,
          () => void setAssessmentStatus(assessmentId, prev, true),
        );
      }
    } catch (error) {
      setMessage((error as Error).message || "Could not update assessment.");
    }
  };

  const reviewAssessment = async (input: {
    itemAttemptId: string;
    scorePercent: number;
    feedback: string;
  }) => {
    try {
      const updated = await reviewAssessmentItem(input);
      if (!updated) return;
      setDashboard((current) =>
        current
          ? {
              ...current,
              assessmentItemAttempts: current.assessmentItemAttempts.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not review quiz question.");
      throw error;
    }
  };

  const returnAssessmentResult = async (input: { attemptId: string; feedback: string }) => {
    try {
      await returnAssessment(input);
      await loadDashboard();
    } catch (error) {
      setMessage((error as Error).message || "Could not return quiz result.");
      throw error;
    }
  };

  const startWatchingSelectedSession = async () => {
    if (!selectedSession || !selectedStudentId || !selectedClassId) return;
    if (selectedSession.status === "complete") {
      setMessage("Choose an active student session before watching live.");
      return;
    }
    try {
      const viewer = await startLiveSessionViewer({
        sessionId: selectedSession.id,
        studentId: selectedStudentId,
        classId: selectedClassId,
      });
      setLiveViewer(viewer);
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "Could not start live watch.");
    }
  };

  const stopWatchingSelectedSession = async () => {
    if (!liveViewer) return;
    try {
      // Release any pause FIRST: the Pause/Resume control only shows while watching, so a held
      // student would otherwise be stuck (composer locked + server gate) once the teacher stops
      // watching. Stopping the watch always lifts the teacher's own pause. Best-effort.
      if (sessionHeld && selectedSession) {
        await releaseSessionHold(selectedSession.id).catch(() => undefined);
        setSessionHeld(false);
      }
      await stopLiveSessionViewer(liveViewer.id);
      setLiveViewer(null);
      setLiveCommentDraft("");
    } catch (error) {
      setMessage((error as Error).message || "Could not stop live watch.");
    }
  };

  const sendLiveComment = async () => {
    if (!selectedSession || !selectedStudentId || !selectedClassId || !liveCommentDraft.trim()) {
      return;
    }
    setSendingLiveComment(true);
    try {
      const comment = await sendTeacherLiveComment({
        sessionId: selectedSession.id,
        studentId: selectedStudentId,
        classId: selectedClassId,
        lessonId: selectedSession.lesson_id,
        content: liveCommentDraft.trim(),
      });
      setDashboard((current) =>
        current ? { ...current, liveComments: [...current.liveComments, comment] } : current,
      );
      setLiveCommentDraft("");
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "Could not send live teacher comment.");
    } finally {
      setSendingLiveComment(false);
    }
  };

  const holdSelectedSession = async () => {
    if (!selectedSession || !selectedStudentId) return;
    setHoldBusy(true);
    try {
      await holdSession({
        sessionId: selectedSession.id,
        studentId: selectedStudentId,
        classId: selectedClassId,
        lessonId: selectedSession.lesson_id,
      });
      setSessionHeld(true);
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "Could not pause the session.");
    } finally {
      setHoldBusy(false);
    }
  };

  const resumeSelectedSession = async () => {
    if (!selectedSession) return;
    setHoldBusy(true);
    try {
      await releaseSessionHold(selectedSession.id);
      setSessionHeld(false);
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "Could not resume the session.");
    } finally {
      setHoldBusy(false);
    }
  };

  // R60: an open work item always lives in Activity, whatever the URL's ?tab says — old
  // bookmarks and notification emails carry ?tab=classwork&assignment=…, and grading must
  // never strand behind a renamed tab.
  const effectiveSection: ClassSection =
    search.assignment || search.assessment ? "activity" : normalizeClassSection(search.tab);

  if (!authChecked) {
    return <RouteLoader label="Loading…" />;
  }

  return (
    <TeacherShell
      email={email}
      classes={dashboard?.classes ?? []}
      activeView={selectedClassId || selectedStudentId ? "class" : "home"}
      activeClassId={selectedClassId}
      activeSection={selectedStudentId ? "students" : selectedClassId ? effectiveSection : null}
    >
      {/* Keyed per navigation level so the page's entrance fade + focus handoff re-run on
          landing → class → student moves, like the student views. */}
      <PageShell
        key={`${selectedClassId ?? ""}:${selectedStudentId ?? ""}`}
        widthClass="max-w-[1240px]"
        onBack={
          selectedStudentId
            ? () =>
                navigate({
                  to: "/teacher/class/$classId",
                  params: { classId: selectedClassId ?? "" },
                  // The drill-down opens from Students (and Activity) — land back on the landing tab.
                  search: { tab: "students" },
                })
            : selectedClassId
              ? () => navigate({ to: "/teacher" })
              : undefined
        }
        backLabel={
          selectedStudentId ? selectedClass?.name || "Class" : selectedClassId ? "Home" : undefined
        }
        ariaLabel={
          selectedStudentId
            ? displayName(selectedStudent, selectedStudentId)
            : selectedClassId
              ? selectedClass?.name || "Class"
              : "Teacher home"
        }
      >
        <div className="flex flex-col gap-5">
          {/* R46 sketchboard: Home is just your classes — no hero, no feed. Each card
              carries its own signals; the class pages carry their own name headers. */}
          {!selectedClassId ? (
            <h1 className="font-serif text-title text-foreground">Your classes</h1>
          ) : null}

          {booting ? (
            <section className="rounded-card border border-border bg-depth-card shadow-card">
              <div className="p-6 text-body text-muted-foreground">Loading teacher access...</div>
            </section>
          ) : message ? (
            <section className="rounded-card border border-border bg-depth-card shadow-card">
              <div className="p-6 text-body text-muted-foreground">{message}</div>
            </section>
          ) : null}

          {!booting && dashboard && model && (
            <>
              <div className="flex flex-col gap-4">
                {!selectedClassId ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(dashboard.classes ?? []).map((item) => (
                      <div key={item.id} className="min-w-0 h-full">
                        <ClassButton
                          item={item}
                          active={item.id === selectedClassId}
                          signals={classSignals(dashboard, item.id)}
                          onClick={() =>
                            navigate({
                              to: "/teacher/class/$classId",
                              params: { classId: item.id },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* R47: the global To-review queue — grading never hides inside a class
                    (Classroom's quiet masterstroke). Rows deep-link straight to the item's
                    student-work view in its class. */}
                {!selectedClassId ? (
                  <GlobalReviewQueue
                    rows={globalReviewRows(dashboard, model.profilesById, model.lessonsById)}
                    onOpen={(row) =>
                      navigate({
                        to: "/teacher/class/$classId",
                        params: { classId: row.classId },
                        search:
                          row.kind === "assignment"
                            ? { tab: "activity", assignment: row.itemId }
                            : { tab: "activity", assessment: row.itemId },
                      })
                    }
                  />
                ) : null}

                <div className="grid gap-4">
                  {selectedStudentId ? null : selectedClass ? (
                    <ClassDetail
                      item={selectedClass}
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
                      assessments={dashboard.assessments.filter(
                        (assessment) => assessment.class_id === selectedClass.id,
                      )}
                      assessmentItems={dashboard.assessmentItems}
                      assessmentRecipients={dashboard.assessmentRecipients}
                      assessmentAttempts={dashboard.assessmentAttempts}
                      assessmentItemAttempts={dashboard.assessmentItemAttempts}
                      quizItems={dashboard.quizItems}
                      studentIds={classStudents}
                      selectedLessonId={selectedGradebookLessonId}
                      selectedStudentId={selectedStudentId}
                      onSelectLesson={setSelectedGradebookLessonId}
                      onSelectStudent={(studentId) =>
                        navigate({
                          to: "/teacher/class/$classId/student/$studentId",
                          params: { classId: selectedClass.id, studentId },
                        })
                      }
                      section={effectiveSection}
                      openAssignmentId={search.assignment ?? null}
                      openAssessmentId={search.assessment ?? null}
                      onSetSection={(studentId, sectionLabel) =>
                        setStudentSection(selectedClass.id, studentId, sectionLabel)
                      }
                      onListEnrollable={() => listEnrollable(selectedClass.id)}
                      onEnroll={(userIds, sectionLabel) =>
                        enrollIntoClass(selectedClass.id, userIds, sectionLabel)
                      }
                      savingResource={savingResource}
                      savingAssignment={savingAssignment}
                      savingAssessment={savingAssessment}
                      onSaveResource={saveResource}
                      onSaveAssignment={saveAssignment}
                      onSaveAssessment={saveAssessment}
                      onSetAssignmentStatus={(assignmentId, status) =>
                        void setAssignmentStatus(assignmentId, status)
                      }
                      onSetAssessmentStatus={(assessmentId, status) =>
                        void setAssessmentStatus(assessmentId, status)
                      }
                      onReviewSubmission={reviewSubmission}
                      onReviewAssessmentItem={reviewAssessment}
                      onReturnAssessment={returnAssessmentResult}
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
                  ) : null}

                  {selectedStudentId && studentStats ? (
                    <StudentDetail
                      studentId={selectedStudentId}
                      profile={selectedStudent}
                      stats={studentStats}
                      section={
                        dashboard.memberships.find(
                          (membership) =>
                            membership.class_id === selectedClassId &&
                            membership.user_id === selectedStudentId,
                        )?.section ?? null
                      }
                      classLabel={selectedClass?.name ?? null}
                      dashboard={dashboard}
                      lessonsById={model.lessonsById}
                      sessions={studentSessions}
                      selectedSession={selectedSession}
                      selectedSessionId={selectedSessionId}
                      onSelectSession={setSelectedSessionId}
                      noteDraft={noteDraft}
                      noteVisibility={noteVisibility}
                      savingNote={savingNote}
                      liveViewer={liveViewer}
                      liveCommentDraft={liveCommentDraft}
                      sendingLiveComment={sendingLiveComment}
                      onNoteChange={setNoteDraft}
                      onNoteVisibilityChange={setNoteVisibility}
                      onSaveNote={() => void saveNote()}
                      onLiveCommentChange={setLiveCommentDraft}
                      onStartWatching={() => void startWatchingSelectedSession()}
                      onStopWatching={() => void stopWatchingSelectedSession()}
                      onSendLiveComment={() => void sendLiveComment()}
                      sessionHeld={sessionHeld}
                      holdBusy={holdBusy}
                      onHoldSession={() => void holdSelectedSession()}
                      onResumeSession={() => void resumeSelectedSession()}
                      tab={search.tab ?? "overview"}
                      onTabChange={(value) =>
                        navigate({
                          to: "/teacher/class/$classId/student/$studentId",
                          params: {
                            classId: selectedClassId ?? "",
                            studentId: selectedStudentId,
                          },
                          search: { tab: value },
                        })
                      }
                    />
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </PageShell>
    </TeacherShell>
  );
}

// R46 sketchboard card: the class name, who's in it, and the two signals that matter —
// live now and to review. No stats tiles, no feed; the card IS the summary.
function ClassButton({
  item,
  active,
  signals,
  onClick,
}: {
  item: TeacherClassSummary;
  active: boolean;
  signals: ClassSignals;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`elev-hover flex h-full w-full flex-col gap-2 rounded-card border bg-depth-card p-4 text-left shadow-card ${
        active ? "border-primary/45" : "border-border"
      }`}
    >
      <div className="text-body font-medium text-foreground">{item.name}</div>
      <div className="text-meta text-muted-foreground">
        {signals.students} student{signals.students === 1 ? "" : "s"}
        {signals.sections.length ? ` · sections ${signals.sections.join(" · ")}` : ""}
      </div>
      <div className="mt-auto flex flex-wrap gap-3 pt-1 text-meta">
        {signals.liveNow > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <NumberFlip value={signals.liveNow} /> live now
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-border" /> quiet
          </span>
        )}
        {signals.toReview > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <span className="h-2 w-2 rounded-full bg-warning" />
            <NumberFlip value={signals.toReview} /> to review
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-border" /> nothing to review
          </span>
        )}
      </div>
    </button>
  );
}

function ClassDetail({
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
  const [createContext, setCreateContext] = useState<{
    lessonId: string;
    activityId: string;
  } | null>(null);
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
            <CurriculumStudio
              classId={item.id}
              workItems={workItems}
              onOpenItem={(kind, id) => {
                if (kind === "material") {
                  setEditingResourceId(id);
                  return;
                }
                navigate({
                  to: "/teacher/class/$classId",
                  params: { classId: item.id },
                  search:
                    kind === "assignment"
                      ? { tab: "activity", assignment: id }
                      : { tab: "activity", assessment: id },
                });
              }}
              onCreate={(kind) => setCreateOpen(kind)}
              onCreateForStep={(kind, ctx) => {
                setCreateContext(ctx);
                setCreateOpen(kind);
              }}
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
            setCreateContext(null);
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
            context={createContext}
            onSaveAssignment={async (input) => {
              await onSaveAssignment(input);
              setCreateOpen(null);
              setCreateContext(null);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={createOpen === "assessment"}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(null);
            setCreateContext(null);
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
            context={createContext}
            onSaveAssessment={async (input) => {
              await onSaveAssessment(input);
              setCreateOpen(null);
              setCreateContext(null);
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
    lessonId: lessons[0]?.id || "",
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
  saving,
  open,
  resource,
  onSaveResource,
  onUpdateResource,
  onClose,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  saving: boolean;
  // R47: a controlled dialog — the + Create menu opens it empty, a material row opens it
  // in edit mode. The old in-page list is gone (rows live in the Classwork list).
  open: boolean;
  resource: LessonResource | null;
  onSaveResource: (input: ResourceFormValues) => Promise<void>;
  onUpdateResource: (resource: LessonResource) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ResourceFormValues>(() =>
    defaultResourceForm(classSummary, lessons),
  );
  const [resourceMessage, setResourceMessage] = useState("");
  const [openingId, setOpeningId] = useState("");

  // Seed the draft each time the dialog opens: edit mode from the material row,
  // create mode from the + Create menu.
  useEffect(() => {
    if (!open) return;
    if (resource) {
      setDraft({
        resourceId: resource.id,
        organizationId: resource.organization_id || classSummary.organization_id,
        classId: resource.class_id || classSummary.id,
        lessonId: resource.lesson_id || lessons[0]?.id || "",
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
    } else {
      setDraft(defaultResourceForm(classSummary, lessons));
      setResourceMessage("");
    }
  }, [open, resource, classSummary, lessons]);

  const setField = <K extends keyof ResourceFormValues>(key: K, value: ResourceFormValues[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
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
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not save resource.");
    }
  };

  const setStatus = async (
    target: LessonResource,
    status: LessonResourceStatus,
    isUndo = false,
  ) => {
    const prev = target.status;
    try {
      const updated = await updateLessonResource(target.id, { status });
      onUpdateResource(updated);
      if (!isUndo && prev !== status) {
        const label =
          status === "published"
            ? "published"
            : status === "archived"
              ? "archived"
              : "moved to draft";
        notifyUndo(`Resource ${label}.`, () => void setStatus(updated, prev, true));
      }
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not update resource status.");
    }
  };

  const openResource = async (target: LessonResource) => {
    try {
      setOpeningId(target.id);
      const url = await getLessonResourceSignedUrl(target);
      if (!url) throw new Error("This resource does not have an openable URL.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not open resource.");
    } finally {
      setOpeningId("");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{draft.resourceId ? "Edit resource" : "New resource"}</DialogTitle>
        </DialogHeader>

        {resource ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void openResource(resource)}
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.6} />
              {openingId === resource.id ? "Opening..." : "Open"}
            </button>
            <OverflowMenu
              actions={[
                {
                  label: "Set to draft",
                  onClick: () => void setStatus(resource, "draft"),
                  disabled: resource.status === "draft",
                },
                {
                  label: "Publish",
                  onClick: () => void setStatus(resource, "published"),
                  disabled: resource.status === "published",
                },
                {
                  label: "Archive",
                  icon: Archive,
                  onClick: () => void setStatus(resource, "archived"),
                  disabled: resource.status === "archived",
                },
              ]}
            />
            <ResourceStatusChip status={resource.status} />
          </div>
        ) : null}

        <div className="grid gap-3">
          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Lesson
            <select
              value={draft.lessonId}
              onChange={(event) => setField("lessonId", event.target.value)}
              disabled={Boolean(draft.resourceId)}
              className="jargon-input normal-case tracking-normal disabled:opacity-60"
            >
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.title}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Title
            <input
              value={draft.title}
              onChange={(event) => setField("title", event.target.value)}
              placeholder="Purpose explainer PDF"
              className="jargon-input normal-case tracking-normal"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
                className="jargon-input normal-case tracking-normal disabled:opacity-60"
              >
                <option value="upload">Upload</option>
                <option value="external_url">External URL</option>
              </select>
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Type
              <select
                value={draft.resourceType}
                onChange={(event) =>
                  setField("resourceType", event.target.value as LessonResourceType)
                }
                disabled={draft.sourceType === "upload" || Boolean(draft.resourceId)}
                className="jargon-input normal-case tracking-normal disabled:opacity-60"
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
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              File
              <input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,image/*,audio/*,video/*"
                onChange={(event) => setField("file", event.target.files?.[0] || null)}
                className="jargon-input normal-case tracking-normal file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-meta file:text-foreground"
              />
            </label>
          ) : null}

          {draft.sourceType === "external_url" ? (
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              External URL
              <input
                value={draft.externalUrl || ""}
                onChange={(event) => setField("externalUrl", event.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="jargon-input normal-case tracking-normal"
              />
            </label>
          ) : null}

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Student instructions
            <textarea
              value={draft.studentInstructions}
              onChange={(event) => setField("studentInstructions", event.target.value)}
              placeholder="Open this before the checkpoint and look for the input/process/output idea."
              className="jargon-input min-h-[72px] normal-case leading-relaxed tracking-normal"
            />
          </label>

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Description
            <textarea
              value={draft.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="Short student-facing summary."
              className="jargon-input min-h-[66px] normal-case leading-relaxed tracking-normal"
            />
          </label>

          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Teacher notes
            <textarea
              value={draft.teacherNotes}
              onChange={(event) => setField("teacherNotes", event.target.value)}
              placeholder="Private classroom context for teachers."
              className="jargon-input min-h-[66px] normal-case leading-relaxed tracking-normal"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Status
              <select
                value={draft.status}
                onChange={(event) => setField("status", event.target.value as LessonResourceStatus)}
                className="jargon-input normal-case tracking-normal"
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Visibility
              <select
                value={draft.visibility}
                onChange={(event) =>
                  setField("visibility", event.target.value as LessonResourceVisibility)
                }
                className="jargon-input normal-case tracking-normal"
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
            className="btn btn-secondary mt-1"
          >
            {saving ? "Saving..." : draft.resourceId ? "Save resource" : "Create resource"}
          </button>
          {resourceMessage ? (
            <div className="text-meta leading-relaxed text-muted-foreground">{resourceMessage}</div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AssignmentFormValues = {
  organizationId: string;
  classId: string;
  lessonId: string;
  // R48: set when the dialog was opened FROM a lesson step — links the created row.
  activityId?: string | null;
  title: string;
  instructions: string;
  dueAt: string;
  status: Extract<AssignmentStatus, "draft" | "assigned">;
  required: boolean;
  recipientIds: string[];
  resourceIds: string[];
};

type AssessmentFormQuestion = {
  quizItemId?: string;
  prompt?: string;
  questionType?: "multiple_choice" | "text" | "code";
  choices?: Array<{ id: string; text: string }>;
  correctChoiceIds?: string[];
  rubric?: Record<string, unknown>;
  skillKeys?: string[];
  points: number;
  required: boolean;
};

type AssessmentFormValues = {
  organizationId: string;
  classId: string;
  lessonId: string;
  // R48: set when the dialog was opened FROM a lesson step — links the created row.
  activityId?: string | null;
  title: string;
  instructions: string;
  dueAt: string;
  status: Extract<AssessmentStatus, "draft" | "published">;
  gradingMode: AssessmentGradingMode;
  resultReleasePolicy: AssessmentResultReleasePolicy;
  attemptLimit: number;
  required: boolean;
  recipientIds: string[];
  items: AssessmentFormQuestion[];
};

function defaultAssessmentQuestion(): AssessmentFormQuestion {
  return {
    prompt: "",
    questionType: "multiple_choice",
    choices: [
      { id: "a", text: "" },
      { id: "b", text: "" },
      { id: "c", text: "" },
    ],
    correctChoiceIds: ["a"],
    skillKeys: [],
    points: 1,
    required: true,
  };
}

function defaultAssessmentForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
  studentIds: string[],
): AssessmentFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "",
    title: "",
    instructions: "",
    dueAt: "",
    status: "published",
    gradingMode: "mixed",
    resultReleasePolicy: "after_review",
    attemptLimit: 1,
    required: false,
    recipientIds: studentIds,
    items: [defaultAssessmentQuestion(), { ...defaultAssessmentQuestion() }],
  };
}

function AssessmentManager({
  classSummary,
  lessons,
  quizItems,
  studentIds,
  profilesById,
  saving,
  context = null,
  onSaveAssessment,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  quizItems: CurriculumQuizItem[];
  studentIds: string[];
  profilesById: Map<string, Profile>;
  saving: boolean;
  // R48: present when the dialog was opened FROM a lesson step — the lesson is locked
  // to that step's lesson and the created row carries the step link.
  context?: { lessonId: string; activityId: string } | null;
  onSaveAssessment: (input: AssessmentFormValues) => Promise<void>;
}) {
  const seedDraft = () => ({
    ...defaultAssessmentForm(classSummary, lessons, studentIds),
    ...(context ? { lessonId: context.lessonId, activityId: context.activityId } : {}),
  });
  const [draft, setDraft] = useState<AssessmentFormValues>(seedDraft);
  const [assessmentMessage, setAssessmentMessage] = useState("");
  const lessonQuizItems = quizItems.filter(
    (quiz) => quiz.lesson_id === draft.lessonId && quiz.status !== "archived",
  );

  useEffect(() => {
    setDraft(seedDraft());
    setAssessmentMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSummary, lessons, studentIds, context]);

  const setField = <K extends keyof AssessmentFormValues>(key: K, value: AssessmentFormValues[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const updateQuestion = (index: number, patch: Partial<AssessmentFormQuestion>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const toggleRecipient = (studentId: string) => {
    setDraft((current) => ({
      ...current,
      recipientIds: current.recipientIds.includes(studentId)
        ? current.recipientIds.filter((id) => id !== studentId)
        : [...current.recipientIds, studentId],
    }));
  };

  const updateChoice = (questionIndex: number, choiceId: string, text: string) => {
    const question = draft.items[questionIndex];
    const choices = (question.choices || []).map((choice) =>
      choice.id === choiceId ? { ...choice, text } : choice,
    );
    updateQuestion(questionIndex, { choices });
  };

  const submit = async () => {
    try {
      if (!draft.title.trim()) throw new Error("Add an assessment title.");
      if (!draft.lessonId) throw new Error("Choose a lesson.");
      if (!draft.recipientIds.length) throw new Error("Choose at least one student.");
      const items = draft.items.map((item) => {
        if (item.quizItemId) return item;
        const prompt = item.prompt?.trim() || "";
        if (!prompt) throw new Error("Every new question needs a prompt.");
        if (item.questionType === "multiple_choice") {
          const choices = (item.choices || []).filter((choice) => choice.text.trim());
          if (choices.length < 2)
            throw new Error("Multiple-choice questions need at least two choices.");
          if (!item.correctChoiceIds?.[0])
            throw new Error("Choose the correct answer for each MCQ.");
          return { ...item, choices, prompt };
        }
        return { ...item, prompt };
      });

      await onSaveAssessment({
        ...draft,
        title: draft.title.trim(),
        instructions: draft.instructions.trim(),
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : "",
        items,
      });
      setAssessmentMessage(
        draft.status === "published" ? "Quiz created and assigned." : "Draft quiz saved.",
      );
      setDraft(defaultAssessmentForm(classSummary, lessons, studentIds));
    } catch (error) {
      setAssessmentMessage((error as Error).message || "Could not create quiz.");
    }
  };

  return (
    <div className="pt-1">
      {/* Hosted inside the Structure section's "Quizzes" bench — title + count live on the
          Collapsible header; grading moved to Students + performance. */}
      <p className="mb-3 text-meta text-muted-foreground">
        Build and publish multi-question quizzes for a lesson. MCQ items auto-grade on submission.
      </p>

      <div className="grid gap-4">
        <div className="rounded-card border border-border bg-depth-sub p-4">
          <div className="text-body font-medium text-foreground">Create quiz</div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                onChange={(event) => setField("lessonId", event.target.value)}
                disabled={Boolean(context)}
                className="jargon-input normal-case tracking-normal disabled:opacity-60"
              >
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Title
              <input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder="Clear reasons checkpoint"
                className="jargon-input normal-case tracking-normal"
              />
            </label>
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Instructions
              <textarea
                value={draft.instructions}
                onChange={(event) => setField("instructions", event.target.value)}
                placeholder="Answer each question carefully. Written answers will be reviewed by your teacher."
                className="jargon-input min-h-[76px] normal-case leading-relaxed tracking-normal"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Due
                <input
                  type="datetime-local"
                  value={draft.dueAt}
                  onChange={(event) => setField("dueAt", event.target.value)}
                  className="jargon-input normal-case tracking-normal"
                />
              </label>
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setField(
                      "status",
                      event.target.value as Extract<AssessmentStatus, "draft" | "published">,
                    )
                  }
                  className="jargon-input normal-case tracking-normal"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Attempts
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.attemptLimit}
                  onChange={(event) => setField("attemptLimit", Number(event.target.value) || 1)}
                  className="jargon-input normal-case tracking-normal"
                />
              </label>
            </div>

            <label className="flex items-start gap-2.5 rounded-card border border-border bg-depth-field p-3">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) => setField("required", event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
              />
              <span className="text-meta text-foreground">
                Required for lesson completion
                <span className="mt-0.5 block text-meta text-muted-foreground">
                  Students can't finish the lesson until they complete this quiz.
                </span>
              </span>
            </label>

            <div className="rounded-card border border-border bg-depth-field p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
                  className="text-meta text-muted-foreground transition-colors hover:text-foreground"
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
                      className="flex items-center gap-2 text-meta text-foreground"
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

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Questions
                </div>
                <button
                  type="button"
                  onClick={() => setField("items", [...draft.items, defaultAssessmentQuestion()])}
                  className="btn btn-secondary btn-sm"
                >
                  Add question
                </button>
              </div>
              {draft.items.map((question, index) => (
                <div key={index} className="rounded-card border border-border bg-depth-sub p-3">
                  <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <select
                      value={question.quizItemId || ""}
                      onChange={(event) =>
                        updateQuestion(index, {
                          quizItemId: event.target.value || undefined,
                          prompt: event.target.value ? "" : question.prompt,
                        })
                      }
                      className="jargon-input"
                    >
                      <option value="">New question</option>
                      {lessonQuizItems.map((quiz) => (
                        <option key={quiz.id} value={quiz.id}>
                          Existing: {quiz.prompt.slice(0, 70)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      value={question.points}
                      onChange={(event) =>
                        updateQuestion(index, { points: Number(event.target.value) || 1 })
                      }
                      className="jargon-input"
                    />
                  </div>
                  {!question.quizItemId ? (
                    <div className="grid gap-2">
                      <select
                        value={question.questionType || "multiple_choice"}
                        onChange={(event) =>
                          updateQuestion(index, {
                            questionType: event.target
                              .value as AssessmentFormQuestion["questionType"],
                          })
                        }
                        className="jargon-input"
                      >
                        <option value="multiple_choice">Multiple choice</option>
                        <option value="text">Text response</option>
                        <option value="code">Code response</option>
                      </select>
                      <textarea
                        value={question.prompt || ""}
                        onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                        placeholder="Question prompt"
                        className="jargon-input min-h-[72px] leading-relaxed"
                      />
                      {question.questionType === "multiple_choice" ? (
                        <div className="grid gap-2">
                          {(question.choices || []).map((choice) => (
                            <div
                              key={choice.id}
                              className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)]"
                            >
                              <label className="flex items-center gap-2 text-meta text-muted-foreground">
                                <input
                                  type="radio"
                                  checked={question.correctChoiceIds?.[0] === choice.id}
                                  onChange={() =>
                                    updateQuestion(index, { correctChoiceIds: [choice.id] })
                                  }
                                  className="h-4 w-4 accent-foreground"
                                />
                                {choice.id.toUpperCase()}
                              </label>
                              <input
                                value={choice.text}
                                onChange={(event) =>
                                  updateChoice(index, choice.id, event.target.value)
                                }
                                placeholder={`Choice ${choice.id.toUpperCase()}`}
                                className="jargon-input"
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <input
                        value={(question.skillKeys || []).join(", ")}
                        onChange={(event) =>
                          updateQuestion(index, {
                            skillKeys: event.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Skill keys, comma separated"
                        className="jargon-input"
                      />
                    </div>
                  ) : (
                    <div className="text-meta text-muted-foreground">
                      Uses existing lesson question. Points and recipients are controlled here.
                    </div>
                  )}
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setField(
                          "items",
                          draft.items.length > 1
                            ? draft.items.filter((_, itemIndex) => itemIndex !== index)
                            : draft.items,
                        )
                      }
                      className="text-meta text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="btn btn-secondary mt-1"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              {saving ? "Saving..." : draft.status === "published" ? "Assign quiz" : "Save draft"}
            </button>
            {assessmentMessage ? (
              <div className="text-meta leading-relaxed text-muted-foreground">
                {assessmentMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultAssignmentForm(
  classSummary: TeacherClassSummary,
  lessons: Lesson[],
  studentIds: string[],
): AssignmentFormValues {
  return {
    organizationId: classSummary.organization_id,
    classId: classSummary.id,
    lessonId: lessons[0]?.id || "",
    title: "",
    instructions: "",
    dueAt: "",
    status: "assigned",
    required: false,
    recipientIds: studentIds,
    resourceIds: [],
  };
}

function AssignmentManager({
  classSummary,
  lessons,
  resources,
  studentIds,
  profilesById,
  saving,
  context = null,
  onSaveAssignment,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  resources: LessonResource[];
  studentIds: string[];
  profilesById: Map<string, Profile>;
  saving: boolean;
  // R48: present when the dialog was opened FROM a lesson step — the lesson is locked
  // to that step's lesson and the created row carries the step link.
  context?: { lessonId: string; activityId: string } | null;
  onSaveAssignment: (input: AssignmentFormValues) => Promise<void>;
}) {
  const seedDraft = () => ({
    ...defaultAssignmentForm(classSummary, lessons, studentIds),
    ...(context ? { lessonId: context.lessonId, activityId: context.activityId } : {}),
  });
  const [draft, setDraft] = useState<AssignmentFormValues>(seedDraft);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const resourcesForLesson = resources.filter(
    (resource) => resource.lesson_id === draft.lessonId && resource.status !== "archived",
  );

  useEffect(() => {
    setDraft(seedDraft());
    setAssignmentMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSummary, lessons, studentIds, context]);

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

  return (
    <div className="pt-1">
      {/* Hosted inside the Structure section's "Assignments" bench — title + count live on the
          Collapsible header; grading moved to Students + performance. */}
      <p className="mb-3 text-meta text-muted-foreground">
        Create class work for a lesson, choose recipients, and assign or save as draft.
      </p>

      <div className="grid gap-4">
        <div className="rounded-card border border-border bg-depth-sub p-4">
          <div className="text-body font-medium text-foreground">Create assignment</div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                disabled={Boolean(context)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lessonId: event.target.value,
                    resourceIds: [],
                  }))
                }
                className="jargon-input normal-case tracking-normal"
              >
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Title
              <input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder="Purpose reflection"
                className="jargon-input normal-case tracking-normal"
              />
            </label>

            <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Instructions
              <textarea
                value={draft.instructions}
                onChange={(event) => setField("instructions", event.target.value)}
                placeholder="Use the resource and explain what the tool is for in your own words."
                className="jargon-input min-h-[86px] normal-case leading-relaxed tracking-normal"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Due date
                <input
                  type="datetime-local"
                  value={draft.dueAt}
                  onChange={(event) => setField("dueAt", event.target.value)}
                  className="jargon-input normal-case tracking-normal"
                />
              </label>

              <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setField(
                      "status",
                      event.target.value as Extract<AssignmentStatus, "draft" | "assigned">,
                    )
                  }
                  className="jargon-input normal-case tracking-normal"
                >
                  <option value="assigned">Assigned</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
            </div>

            <label className="flex items-start gap-2.5 rounded-card border border-border bg-depth-field p-3">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) => setField("required", event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-foreground"
              />
              <span className="text-meta text-foreground">
                Required for lesson completion
                <span className="mt-0.5 block text-meta text-muted-foreground">
                  Students can't finish the lesson until they complete this assignment.
                </span>
              </span>
            </label>

            <div className="rounded-card border border-border bg-depth-field p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
                  className="text-meta text-muted-foreground transition-colors hover:text-foreground"
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
                      className="flex items-center gap-2 text-meta text-foreground"
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

            <div className="rounded-card border border-border bg-depth-field p-3">
              <div className="mb-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Optional resources
              </div>
              {resourcesForLesson.length ? (
                <div className="grid gap-2">
                  {resourcesForLesson.map((resource) => (
                    <label
                      key={resource.id}
                      className="flex items-center gap-2 text-meta text-foreground"
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
                <div className="text-meta text-muted-foreground">
                  No resources are attached to this lesson yet.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="btn btn-secondary mt-1"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              {saving ? "Saving..." : draft.status === "assigned" ? "Assign work" : "Save draft"}
            </button>
            {assignmentMessage ? (
              <div className="text-meta leading-relaxed text-muted-foreground">
                {assignmentMessage}
              </div>
            ) : null}
          </div>
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

function StudentDetail({
  studentId,
  profile,
  stats,
  section,
  classLabel,
  dashboard,
  lessonsById,
  sessions,
  selectedSession,
  selectedSessionId,
  onSelectSession,
  noteDraft,
  noteVisibility,
  savingNote,
  liveViewer,
  liveCommentDraft,
  sendingLiveComment,
  onNoteChange,
  onNoteVisibilityChange,
  onSaveNote,
  onLiveCommentChange,
  onStartWatching,
  onStopWatching,
  onSendLiveComment,
  sessionHeld,
  holdBusy,
  onHoldSession,
  onResumeSession,
  tab,
  onTabChange,
}: {
  studentId: string;
  profile: Profile | null;
  stats: StudentSummary;
  section: string | null;
  classLabel: string | null;
  dashboard: TeacherDashboardData;
  lessonsById: Map<string, Lesson>;
  sessions: LearningSession[];
  selectedSession: LearningSession | null;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  noteDraft: string;
  noteVisibility: TeacherNote["visibility"];
  savingNote: boolean;
  liveViewer: LiveSessionViewer | null;
  liveCommentDraft: string;
  sendingLiveComment: boolean;
  onNoteChange: (value: string) => void;
  onNoteVisibilityChange: (value: TeacherNote["visibility"]) => void;
  onSaveNote: () => void;
  onLiveCommentChange: (value: string) => void;
  onStartWatching: () => void;
  onStopWatching: () => void;
  onSendLiveComment: () => void;
  sessionHeld: boolean;
  holdBusy: boolean;
  onHoldSession: () => void;
  onResumeSession: () => void;
  tab?: string;
  onTabChange?: (value: string) => void;
}) {
  const [localTab, setLocalTab] = useState("overview");
  // Old deep links may still carry tab=records|messages — those tabs are gone; land on Overview.
  const requestedTab = tab ?? localTab;
  const studentTab = requestedTab === "transcript" ? "transcript" : "overview";
  const setStudentTab = (value: string) => (onTabChange ? onTabChange(value) : setLocalTab(value));
  const turns = selectedSession
    ? dashboard.turns.filter((turn) => turn.session_id === selectedSession.id)
    : [];
  const mastery = dashboard.mastery.filter((item) => item.user_id === studentId);
  const notes = dashboard.notes.filter((item) => item.student_id === studentId);
  const liveComments = selectedSession
    ? dashboard.liveComments.filter((comment) => comment.session_id === selectedSession.id)
    : [];
  const transcriptItems = [
    ...turns.map((turn) => ({
      id: `turn-${turn.id}`,
      kind: "turn" as const,
      createdAt: turn.created_at,
      turn,
    })),
    ...liveComments.map((comment) => ({
      id: `live-comment-${comment.id}`,
      kind: "live_comment" as const,
      createdAt: comment.created_at,
      comment,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activeSessions = sessions.filter((session) => session.status !== "complete");
  const completedSessions = sessions.filter((session) => session.status === "complete");
  const watchingSelectedSession =
    Boolean(liveViewer) &&
    Boolean(selectedSession) &&
    liveViewer?.session_id === selectedSession?.id;
  const canWatchSelectedSession =
    Boolean(selectedSession) && selectedSession?.status !== "complete";

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Student detail
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="font-serif text-display text-foreground">
                {displayName(profile, studentId)}
              </h2>
              {section ? (
                <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-meta font-medium text-foreground">
                  {section}
                </span>
              ) : null}
              {classLabel ? (
                <span className="text-body text-muted-foreground">{classLabel}</span>
              ) : null}
            </div>
            <p className="mt-1 text-body text-muted-foreground">
              {profile?.grade || "Grade not set"} - latest status:{" "}
              {sessions[0] ? statusLabel(sessions[0]) : "no session yet"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-meta sm:grid-cols-4">
            <MiniMetric label="Sessions" value={String(stats.sessions)} />
            <MiniMetric label="Attempts" value={String(stats.attempts)} />
            <MiniMetric label="Quizzes" value={String(stats.quizAttempts)} />
            <MiniMetric label="Evidence" value={String(stats.evidence)} />
          </div>
        </div>

        {selectedSession ? (
          <div className="mt-4 rounded-card border border-border bg-depth-sub p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Selected session
                </div>
                <div className="mt-1 text-body-lg font-medium text-foreground">
                  {lessonName(lessonsById, selectedSession.lesson_id)}
                </div>
                <div className="mt-1 text-meta text-muted-foreground">
                  {statusLabel(selectedSession)} - updated{" "}
                  {formatDateTime(selectedSession.updated_at)}
                </div>
              </div>
              <span
                className={`w-fit rounded-full border px-3 py-1.5 text-meta ${lessonStatusClass(
                  sessionProgressStatus(selectedSession),
                )}`}
              >
                {sessionProgressStatus(selectedSession)}
              </span>
              <button
                type="button"
                onClick={watchingSelectedSession ? onStopWatching : onStartWatching}
                disabled={!canWatchSelectedSession}
                className="btn btn-secondary btn-sm w-fit"
              >
                {watchingSelectedSession ? (
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} />
                ) : (
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.7} />
                )}
                {watchingSelectedSession ? "Stop watching" : "Watch live"}
              </button>
              {watchingSelectedSession ? (
                <button
                  type="button"
                  onClick={sessionHeld ? onResumeSession : onHoldSession}
                  disabled={holdBusy}
                  className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-meta transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    sessionHeld
                      ? "border-warning/45 bg-warning/12 text-warning hover:bg-warning/20"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {sessionHeld ? (
                    <Play className="h-3.5 w-3.5" strokeWidth={1.7} />
                  ) : (
                    <Pause className="h-3.5 w-3.5" strokeWidth={1.7} />
                  )}
                  {sessionHeld ? "Resume mentor" : "Pause mentor"}
                </button>
              ) : null}
            </div>
            {watchingSelectedSession ? (
              <div className="mt-3 rounded-card border border-info/35 bg-info/10 px-3 py-2 text-meta text-info">
                You are watching live. The student will see a teacher-viewing indicator while your
                heartbeat is active.
                {sessionHeld
                  ? " The mentor is paused — the student can't send turns until you resume."
                  : ""}
              </div>
            ) : null}
          </div>
        ) : null}

        <Tabs value={studentTab} onValueChange={setStudentTab}>
          <WorkspaceTabList>
            <WorkspaceTab value="overview">Overview</WorkspaceTab>
            <WorkspaceTab value="transcript">Transcript &amp; notes</WorkspaceTab>
          </WorkspaceTabList>

          <WorkspacePanel value="overview">
            <StudentAnalyticsPanel dashboard={dashboard} studentId={studentId} />
          </WorkspacePanel>

          <WorkspacePanel value="transcript">
            <div className="mt-5 grid gap-4">
              <Panel
                title="Transcript"
                icon={<MessageSquare className="h-4 w-4" strokeWidth={1.6} />}
              >
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

                {selectedSession && canWatchSelectedSession ? (
                  <div className="mb-3 rounded-card border border-border bg-depth-sub p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-meta font-medium text-foreground">
                          Live teacher tip
                        </div>
                        <div className="text-meta text-muted-foreground">
                          Visible in the student chat as a Teacher message.
                        </div>
                      </div>
                      {watchingSelectedSession ? (
                        <span className="rounded-full border border-info/35 bg-info/10 px-2.5 py-1 text-meta text-info">
                          Watching
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={liveCommentDraft}
                        onChange={(event) => onLiveCommentChange(event.target.value)}
                        disabled={!watchingSelectedSession}
                        placeholder={
                          watchingSelectedSession
                            ? "Send a short tip to this student..."
                            : "Start watching live before sending a tip."
                        }
                        className="jargon-input min-w-0 flex-1 disabled:opacity-55"
                      />
                      <button
                        type="button"
                        onClick={onSendLiveComment}
                        disabled={
                          !watchingSelectedSession || !liveCommentDraft.trim() || sendingLiveComment
                        }
                        className="btn btn-secondary btn-sm"
                      >
                        <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
                        {sendingLiveComment ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* The read-only transcript renders as v6-style bubbles so what the teacher
                    reads visually matches what the student saw (src/student/Transcript.tsx):
                    student turns right-aligned in ink, mentor turns left on depth-sub, teacher
                    tips as the info-bordered "teacher" tone. All metadata (stage, modality,
                    timestamp) is preserved as an overline row inside each bubble. */}
                {transcriptItems.length ? (
                  <div className="flex max-h-[440px] flex-col gap-3 overflow-auto pr-1">
                    {transcriptItems.map((item) => {
                      if (item.kind === "live_comment") {
                        return (
                          <div key={item.id} className="flex justify-start">
                            <div className="max-w-[min(46rem,85%)] rounded-card border border-info/40 bg-depth-sub px-3.5 py-2.5 text-body text-foreground">
                              <span className="mb-1 flex flex-wrap items-center justify-between gap-2 text-overline uppercase tracking-[0.08em] text-info">
                                Teacher live
                                <span className="normal-case tracking-normal text-muted-foreground">
                                  {formatDateTime(item.comment.created_at)}
                                </span>
                              </span>
                              <span className="whitespace-pre-wrap">{item.comment.content}</span>
                            </div>
                          </div>
                        );
                      }
                      const modality = inputModalityFromPayload(item.turn.payload);
                      const isStudent = item.turn.role === "student";
                      const toneClass = isStudent
                        ? "bg-primary text-primary-foreground"
                        : item.turn.role === "mentor"
                          ? "bg-depth-sub text-foreground"
                          : "border border-border bg-depth-sub text-muted-foreground";
                      return (
                        <div
                          key={item.id}
                          className={`flex ${isStudent ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[min(46rem,85%)] rounded-card px-3.5 py-2.5 text-body ${toneClass}`}
                          >
                            <span
                              className={`mb-1 flex flex-wrap items-center gap-2 text-overline uppercase tracking-[0.08em] ${
                                isStudent ? "text-primary-foreground/70" : "text-muted-foreground"
                              }`}
                            >
                              {item.turn.role} · {item.turn.stage}
                              {modality === "dictated" || modality === "audio_session" ? (
                                <span
                                  className={`rounded-pill border px-2 py-0.5 ${
                                    isStudent ? "border-background/30" : "border-border"
                                  }`}
                                >
                                  {modality === "audio_session" ? "Voice" : "Dictated"}
                                </span>
                              ) : null}
                              <span className="normal-case tracking-normal">
                                {formatDateTime(item.turn.created_at)}
                              </span>
                            </span>
                            <span className="whitespace-pre-wrap">
                              {item.turn.content || "[Empty turn]"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
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
                    className="jargon-input min-h-[96px] w-full py-3 text-body leading-relaxed transition-colors focus:border-foreground/30"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <select
                      value={noteVisibility}
                      onChange={(event) =>
                        onNoteVisibilityChange(event.target.value as TeacherNote["visibility"])
                      }
                      className="jargon-input"
                    >
                      <option value="teacher_private">Teacher private</option>
                      <option value="student_visible">Student visible</option>
                    </select>
                    <button
                      type="button"
                      onClick={onSaveNote}
                      disabled={!noteDraft.trim() || savingNote}
                      className="btn btn-secondary"
                    >
                      {savingNote ? "Saving..." : "Save note"}
                    </button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {notes.length ? (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded-card border border-border bg-depth-sub p-3"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2 text-meta text-muted-foreground">
                            <span>
                              {note.visibility === "student_visible"
                                ? "Student visible"
                                : "Private"}
                            </span>
                            <span>{formatDateTime(note.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-body leading-relaxed text-foreground">
                            {note.note}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="text-meta text-muted-foreground">No notes yet.</div>
                    )}
                  </div>
                </Panel>

                <Panel
                  title="Mastery"
                  icon={<GraduationCap className="h-4 w-4" strokeWidth={1.6} />}
                >
                  {mastery.length ? (
                    <div className="space-y-2">
                      {mastery.map((item) => (
                        <div
                          key={`${item.user_id}-${item.skill_key}`}
                          className="rounded-card border border-border bg-depth-sub p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-body font-medium text-foreground">
                              {item.skill_key}
                            </span>
                            <span className="text-meta text-muted-foreground">{item.level}</span>
                          </div>
                          <div className="mt-1 text-meta text-muted-foreground">
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
          </WorkspacePanel>
        </Tabs>
      </div>
    </section>
  );
}

function StudentAnalyticsPanel({
  dashboard,
  studentId,
}: {
  dashboard: TeacherDashboardData;
  studentId: string;
}) {
  const analytics = studentAnalyticsFor(dashboard, studentId);
  const strongest = dashboard.mastery
    .filter((item) => item.user_id === studentId)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const weakest = dashboard.mastery
    .filter((item) => item.user_id === studentId)
    .sort((a, b) => Number(a.score || 0) - Number(b.score || 0))[0];

  return (
    <div className="mt-5 rounded-card border border-border bg-depth-card p-4">
      <div className="mb-3 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        <BarChart3 className="h-4 w-4" strokeWidth={1.6} />
        Student analytics
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MiniMetric label="Completion" value={formatPercent(analytics.completionRate)} />
        <MiniMetric label="Quiz avg" value={formatPercent(analytics.averageQuizScore)} />
        <MiniMetric label="Resources" value={String(analytics.resourceOpened)} />
      </div>
      <div className="mt-3 grid gap-3">
        <div className="rounded-card border border-border bg-depth-sub p-3">
          <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Strongest skill
          </div>
          <div className="mt-1 text-body text-foreground">
            {strongest ? strongest.skill_key : "No mastery yet"}
          </div>
          <div className="mt-1 text-meta text-muted-foreground">
            {strongest
              ? `${formatPercent(strongest.score)} · ${strongest.evidence_count} evidence`
              : "Complete assessed work to populate this."}
          </div>
        </div>
        <div className="rounded-card border border-border bg-depth-sub p-3">
          <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Weakest skill
          </div>
          <div className="mt-1 text-body text-foreground">
            {weakest ? weakest.skill_key : "No mastery yet"}
          </div>
          <div className="mt-1 text-meta text-muted-foreground">
            {weakest
              ? `${formatPercent(weakest.score)} · ${weakest.evidence_count} evidence`
              : "No weak signal recorded."}
          </div>
        </div>
      </div>
    </div>
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
      <div className="mb-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      {sessions.length ? (
        <div className="flex flex-wrap gap-2">
          {sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                selectedSessionId === session.id
                  ? "border-primary/45 bg-background text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {lessonName(lessonsById, session.lesson_id)} · {session.status}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-meta text-muted-foreground">
          {label === "Completed" ? "No completed lessons yet" : "No active lessons"}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub px-3 py-2">
      <div className="text-body-lg font-medium text-foreground">{value}</div>
      <div className="mt-0.5 text-overline uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function ResourceStatusChip({ status }: { status: LessonResourceStatus }) {
  const classes =
    status === "published"
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-depth-sub text-muted-foreground"
        : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-meta capitalize ${classes}`}>
      {status}
    </span>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="mb-3 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyInline({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="text-body font-medium text-foreground">{title}</div>
      <div className="mt-1 text-meta leading-relaxed text-muted-foreground">{body}</div>
    </div>
  );
}

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

type StudentAnalytics = {
  completionRate: number | null;
  averageQuizScore: number | null;
  resourceOpened: number;
};

function studentAnalyticsFor(dashboard: TeacherDashboardData, studentId: string): StudentAnalytics {
  const sessions = dashboard.sessions.filter((session) => session.user_id === studentId);
  const completed = sessions.filter((session) => session.status === "complete");
  const quizAttempts = dashboard.quizAttempts.filter((attempt) => attempt.user_id === studentId);
  const scoredQuizAttempts = quizAttempts.filter((attempt) => typeof attempt.score === "number");
  const resourceOpened = dashboard.resourceInteractions.filter(
    (interaction) =>
      interaction.user_id === studentId &&
      ["opened", "played", "completed", "downloaded"].includes(interaction.event_type),
  ).length;

  return {
    completionRate: ratio(completed.length, sessions.length),
    averageQuizScore: scoredQuizAttempts.length
      ? scoredQuizAttempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) /
        scoredQuizAttempts.length
      : null,
    resourceOpened,
  };
}

// R46 sketchboard signals: everything a class card (and the Students tab's review
// strip) needs — roster size, section names, who's live, and how much is waiting in
// Review (submitted assignment work + submitted quiz attempts).
type ClassSignals = {
  students: number;
  sections: string[];
  liveNow: number;
  toReview: number;
};

function classSignals(dashboard: TeacherDashboardData, classId: string): ClassSignals {
  const studentSet = new Set<string>();
  const sections = new Set<string>();
  for (const membership of dashboard.memberships) {
    if (
      membership.class_id === classId &&
      membership.role === "student" &&
      membership.status === "active"
    ) {
      studentSet.add(membership.user_id);
      if (membership.section) sections.add(membership.section);
    }
  }
  const liveNow = dashboard.sessions.filter(
    (session) => studentSet.has(session.user_id) && session.status !== "complete",
  ).length;
  const classAssignmentIds = new Set(
    dashboard.assignments.filter((a) => a.class_id === classId).map((a) => a.id),
  );
  const classAssessmentIds = new Set(
    dashboard.assessments.filter((a) => a.class_id === classId).map((a) => a.id),
  );
  const toReview =
    dashboard.assignmentSubmissions.filter(
      (s) => s.status === "submitted" && classAssignmentIds.has(s.assignment_id),
    ).length +
    dashboard.assessmentAttempts.filter(
      (a) => a.status === "submitted" && classAssessmentIds.has(a.assessment_id),
    ).length;
  return {
    students: studentSet.size,
    sections: Array.from(sections).sort((a, b) => a.localeCompare(b)),
    liveNow,
    toReview,
  };
}

// R47 Home: the global To-review queue — every piece of submitted, ungraded work across ALL
// classes, newest first. Each row deep-links to the item's student-work view in its class.
type GlobalReviewRow = {
  kind: "assignment" | "assessment";
  classId: string;
  className: string;
  itemId: string;
  itemTitle: string;
  studentName: string;
  at: string;
};

function globalReviewRows(
  dashboard: TeacherDashboardData,
  profilesById: Map<string, Profile>,
  lessonsById: Map<string, Lesson>,
): GlobalReviewRow[] {
  const classNames = new Map(dashboard.classes.map((item) => [item.id, item.name]));
  const rows: GlobalReviewRow[] = [];
  const assignmentsById = new Map(dashboard.assignments.map((item) => [item.id, item]));
  for (const submission of dashboard.assignmentSubmissions) {
    if (submission.status !== "submitted") continue;
    const assignment = assignmentsById.get(submission.assignment_id);
    if (!assignment?.class_id) continue;
    rows.push({
      kind: "assignment",
      classId: assignment.class_id,
      className: classNames.get(assignment.class_id) ?? "Class",
      itemId: assignment.id,
      itemTitle: assignment.title || lessonName(lessonsById, assignment.lesson_id),
      studentName: displayName(profilesById.get(submission.user_id) ?? null, submission.user_id),
      at: submission.updated_at || submission.created_at,
    });
  }
  const assessmentsById = new Map(dashboard.assessments.map((item) => [item.id, item]));
  for (const attempt of dashboard.assessmentAttempts) {
    if (attempt.status !== "submitted") continue;
    const assessment = assessmentsById.get(attempt.assessment_id);
    if (!assessment?.class_id) continue;
    rows.push({
      kind: "assessment",
      classId: assessment.class_id,
      className: classNames.get(assessment.class_id) ?? "Class",
      itemId: assessment.id,
      itemTitle: assessment.title || lessonName(lessonsById, assessment.lesson_id),
      studentName: displayName(profilesById.get(attempt.user_id) ?? null, attempt.user_id),
      at: attempt.updated_at || attempt.created_at,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

function GlobalReviewQueue({
  rows,
  onOpen,
}: {
  rows: GlobalReviewRow[];
  onOpen: (row: GlobalReviewRow) => void;
}) {
  const nowMs = Date.now();
  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-body-lg font-medium text-foreground">To review</h2>
          <span className="text-meta text-muted-foreground">
            {rows.length ? `${rows.length} across your classes` : "all caught up"}
          </span>
        </div>
        {rows.length ? (
          <div className="mt-3 grid gap-2">
            {rows.map((row) => (
              <button
                key={`${row.kind}:${row.itemId}:${row.studentName}:${row.at}`}
                type="button"
                onClick={() => onOpen(row)}
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
                <span className="shrink-0 text-meta text-muted-foreground">{row.className}</span>
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
    </section>
  );
}

// Relative time for roster rows ("2h ago"), shared shape with the old overview strips.
function relTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
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
    const unified = unifiedLessonStatus(dashboard, studentId, selectedLesson);
    const { total, outstanding } = unified.checkpoints;
    const checkpointDetail = total > 0 ? ` • ${total - outstanding}/${total} required done` : "";
    return {
      studentId,
      statusLabel: unified.status,
      statusClass: unifiedStatusClass(unified.status),
      lessonDetail: `${lessonName(lessonsById, selectedLesson)}${checkpointDetail}`,
      scoreLabel: latestSession ? formatScore(latestSession.score) : "n/a",
      attempts: attempts.length,
      quizAttempts: quizAttempts.length,
      evidence: evidence.length,
      mastery: mastery.length,
      latestSession,
      needsAttention:
        unified.status === "Retry" || unified.status === "Checkpoints due" || failedSignals,
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
  const outstandingRequired = lessons.reduce(
    (sum, lesson) => sum + requiredCheckpointStatus(dashboard, studentId, lesson.id).outstanding,
    0,
  );
  const detailBase = activeCount
    ? `${activeCount} active lesson${activeCount === 1 ? "" : "s"}`
    : completedCount
      ? completedLessonNames.join(", ")
      : "No lessons started";
  const requiredNote =
    outstandingRequired > 0
      ? ` • ${outstandingRequired} required checkpoint${
          outstandingRequired === 1 ? "" : "s"
        } outstanding`
      : "";

  return {
    studentId,
    statusLabel: `${completedCount}/${totalLessons} complete`,
    statusClass:
      completedCount > 0
        ? "border-success/40 bg-success/12 text-success"
        : "border-border bg-depth-sub text-muted-foreground",
    lessonDetail: `${detailBase}${requiredNote}`,
    scoreLabel: averageCompleteScore === null ? "n/a" : `${formatScore(averageCompleteScore)} avg`,
    attempts: attempts.length,
    quizAttempts: quizAttempts.length,
    evidence: evidence.length,
    mastery: mastery.length,
    latestSession,
    needsAttention: failedSignals || outstandingRequired > 0,
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

// R60 Students roster: the per-student grade rollup behind the row chip. Mirrors
// fetchStudentGrades exactly — released statuses only, final_score ?? score — so the
// teacher's chip and the student's own grades list can never disagree.
type StudentGradeSummary = { avg: number | null; graded: number; waiting: number; overdue: number };

function gradeSummariesForClass(
  dashboard: TeacherDashboardData,
  classId: string,
): Map<string, StudentGradeSummary> {
  const released = new Set(["complete", "returned", "graded"]);
  const checkpointsById = new Map(
    dashboard.checkpoints
      .filter((checkpoint) => checkpoint.class_id === classId && checkpoint.status !== "archived")
      .map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const nowMs = Date.now();
  const totals = new Map<
    string,
    { sum: number; graded: number; waiting: number; overdue: number }
  >();
  for (const recipient of dashboard.checkpointRecipients) {
    const checkpoint = checkpointsById.get(recipient.checkpoint_id);
    if (!checkpoint) continue;
    const entry = totals.get(recipient.user_id) ?? { sum: 0, graded: 0, waiting: 0, overdue: 0 };
    const rawScore = recipient.final_score ?? recipient.score;
    if (released.has(recipient.status) && rawScore != null) {
      entry.sum += Number(rawScore);
      entry.graded += 1;
    } else if (recipient.submitted_at) {
      entry.waiting += 1;
    } else if (checkpoint.due_at && Date.parse(checkpoint.due_at) < nowMs) {
      entry.overdue += 1;
    }
    totals.set(recipient.user_id, entry);
  }
  const summaries = new Map<string, StudentGradeSummary>();
  for (const [studentId, entry] of totals) {
    summaries.set(studentId, {
      avg: entry.graded ? entry.sum / entry.graded : null,
      graded: entry.graded,
      waiting: entry.waiting,
      overdue: entry.overdue,
    });
  }
  return summaries;
}

function gradeChipLabel(summary: StudentGradeSummary | undefined): string {
  if (!summary || (!summary.graded && !summary.overdue)) return "No grades yet";
  const parts: string[] = [];
  if (summary.graded) parts.push(`Avg ${formatScore(summary.avg)}`);
  if (summary.overdue) parts.push(`${summary.overdue} overdue`);
  return parts.join(" · ");
}

// The roster row's one-line story: profile grade, recency, lessons finished.
function studentContextLine(
  profile: Profile | null,
  sessions: LearningSession[],
  studentId: string,
  lessonsById: Map<string, Lesson>,
  nowMs: number,
): string {
  const parts: string[] = [];
  if (profile?.grade) parts.push(`Grade ${profile.grade}`);
  const latest = latestSessionFor(sessions, studentId);
  if (latest) {
    parts.push(`last active ${relTime(latest.updated_at, nowMs)}`);
    const completedCount = completedLessonNamesFor(sessions, studentId, lessonsById).length;
    parts.push(`${completedCount} lesson${completedCount === 1 ? "" : "s"} done`);
  } else {
    parts.push("no sessions yet");
  }
  return parts.join(" · ");
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

function inputModalityFromPayload(
  payload: Record<string, unknown> | null | undefined,
): ChatInputModality | null {
  const modality = payload?.input_modality;
  return modality === "typed" || modality === "dictated" || modality === "audio_session"
    ? modality
    : null;
}

function statusLabel(session: LearningSession) {
  return `${session.status} - ${session.stage} - score ${formatScore(session.score)}`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return null;
  return numerator / denominator;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
