/**
 * The teacher console: the shell, the class list, and which room is open.
 *
 * This file owns the console's state - which class, which student, which
 * section - and the write paths that the rooms call back into. The rooms
 * themselves, and everything they render, live under features/teacher/console/;
 * the authoring studio loads on demand from features/teacher/authoring/.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause } from "lucide-react";
import { ClassDetail } from "@/features/teacher/console/ClassDetail";
import { GlobalReviewQueue } from "@/features/teacher/console/GlobalReviewQueue";
import { StudentDetail } from "@/features/teacher/console/StudentDetail";
import type { AssignmentFormValues } from "@/features/teacher/console/AssignmentManager";
import type { AssessmentFormValues } from "@/features/teacher/console/AssessmentManager";
import type { ResourceFormValues } from "@/features/teacher/console/ResourceManager";
import { ClassButton } from "@/features/teacher/console/chrome";
import {
  classSignals,
  globalReviewRows,
  summarizeStudent,
} from "@/features/teacher/console/derive";
import { displayName } from "@/features/teacher/classShared";
import { PageShell } from "@/components/PageShell";
import { TeacherShell } from "@/features/teacher/shell/TeacherShell";
import { normalizeClassSection, type ClassSection } from "@/features/teacher/shell/teacherNav";
import { RouteLoader } from "@/components/RouteLoader";
import { notifyUndo } from "@/lib/feedback";
import {
  createAssignment,
  createAssessment,
  createLessonResource,
  createTeacherNote,
  enrollStudents,
  removeFromClass,
  fetchEnrollableStudents,
  fetchClassCourseLinks,
  fetchTeacherDashboard,
  gradeAssignmentSubmission,
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
  AssignmentStatus,
  AssignmentSubmission,
  Assessment,
  AssessmentStatus,
  LiveSessionViewer,
  TeacherDashboardData,
  TeacherNote,
} from "@/lib/types";
import { teachesLessonFor } from "@/features/teacher/today/needsYou";

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

  // Which courses each class teaches. The landing card's "N live now" used to count
  // every live session of every class member, while Today counted only lessons the
  // class actually teaches — so the two screens reported different numbers for the same
  // fact. Same query, same staleTime and same predicate as TodayScreen.
  const classIds = (dashboard?.classes ?? []).map((row) => row.id);
  const classLinksQuery = useQuery({
    queryKey: ["classCourseLinks", classIds.join(",")],
    queryFn: () => fetchClassCourseLinks(classIds),
    enabled: classIds.length > 0,
    staleTime: 60 * 1000,
  });
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

  // R83: removing a student marks THIS membership 'removed' (a value the column's own
  // check constraint already allows) — the account, its evidence and its other classes
  // are untouched. The dashboard refetch drops them from every roster and count at once.
  const removeFromThisClass = useCallback(
    async (classId: string, studentId: string) => {
      await removeFromClass({ classId, userId: studentId });
      await loadDashboard();
    },
    [loadDashboard],
  );

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

  // R60: an open work item takes the room whatever the URL's ?tab says — old bookmarks
  // and notification emails carry ?tab=classwork&assignment=…, and grading must never
  // strand behind a renamed tab. R81: that room is Today, where the work was waiting.
  const effectiveSection: ClassSection =
    search.assignment || search.assessment ? "today" : normalizeClassSection(search.tab);

  if (!authChecked) {
    return <RouteLoader label="Loading…" />;
  }

  return (
    <TeacherShell
      email={email}
      classes={dashboard?.classes ?? []}
      activeView={selectedClassId || selectedStudentId ? "class" : "home"}
      activeClassId={selectedClassId}
      activeSection={selectedStudentId ? "people" : selectedClassId ? effectiveSection : null}
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
                  // A student drill-down is opened FROM People (and from Today's live and
                  // waiting rows) — Back returns to the roster the student is listed in.
                  search: { tab: "people" },
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
                          signals={classSignals(
                            dashboard,
                            item.id,
                            teachesLessonFor(classLinksQuery.data, item.id, model.lessonsById),
                          )}
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
                            ? { tab: "today", assignment: row.itemId }
                            : { tab: "today", assessment: row.itemId },
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
                      onRemove={(studentId) => removeFromThisClass(selectedClass.id, studentId)}
                      onRosterChanged={() => void loadDashboard()}
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
