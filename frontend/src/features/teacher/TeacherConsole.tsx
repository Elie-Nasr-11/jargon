import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FileSearch,
  GraduationCap,
  MessageSquare,
  NotebookText,
  Paperclip,
  Send,
  Trash2,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import { Tabs, WorkspaceTab, WorkspaceTabList, WorkspacePanel } from "@/components/WorkspaceTabs";
import { Breadcrumb } from "@/components/Breadcrumb";
import { ConsoleShell } from "@/components/ConsoleShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createAssignment,
  createAssessment,
  createLessonResource,
  createTeacherNote,
  approveResourceChunks,
  deleteResourceChunks,
  fetchTeacherDashboard,
  fetchResourceTextChunks,
  getResourcePageAssetSignedUrl,
  getSubmissionFileSignedUrl,
  gradeAssignmentSubmission,
  getLessonResourceSignedUrl,
  getSession,
  heartbeatLiveSessionViewer,
  ocrPdfPages,
  sendTeacherLiveComment,
  startLiveSessionViewer,
  stopLiveSessionViewer,
  rejectResourceChunks,
  saveExtractedPdfChunks,
  saveResourceChunkEdits,
  transcribeMediaResource,
  updateAssignmentStatus,
  updateAssessmentStatus,
  reviewAssessmentItem,
  returnAssessment,
  updateInterventionAlertStatus,
  updateLessonResource,
  uploadPdfPageAssets,
} from "@/lib/api";
import { extractPdfTextChunksFromUrl, renderPdfPageAssetsFromUrl } from "@/lib/pdf-extract";
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
  InterventionAlert,
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
  ResourcePageAsset,
  ResourceTextChunk,
  ResourceTextChunkStatus,
  StudentMastery,
  TeacherClassSummary,
  TeacherDashboardData,
  TeacherLiveComment,
  TeacherNote,
} from "@/lib/types";

export function TeacherConsole() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as {
    classId?: string;
    studentId?: string;
  };
  const search = useSearch({ strict: false }) as { tab?: string };
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
  const [sendingLiveComment, setSendingLiveComment] = useState(false);
  const [updatingAlertId, setUpdatingAlertId] = useState<string | null>(null);

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
        setAuth({ id: session.user.id, email: session.user.email || "" });
      } finally {
        if (alive) setAuthChecked(true);
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
    const studentIds = unique(
      dashboard.memberships
        .filter((membership) => membership.role === "student" && membership.status === "active")
        .map((membership) => membership.user_id),
    );
    return { profilesById, lessonsById, classesById, studentIds };
  }, [dashboard]);

  // Org -> classes, so the picker mirrors the real hierarchy.
  const classesByOrg = useMemo(() => {
    const groups = new Map<string, TeacherClassSummary[]>();
    for (const item of dashboard?.classes ?? []) {
      const org = organizationName(item);
      const list = groups.get(org) ?? [];
      list.push(item);
      groups.set(org, list);
    }
    return Array.from(groups.entries());
  }, [dashboard]);

  // Cross-class "needs attention" counts for the home action queue.
  const pendingGrading = dashboard
    ? dashboard.assignmentSubmissions.filter((submission) => submission.status === "submitted")
        .length
    : 0;
  const pendingReviews = dashboard
    ? dashboard.assessmentAttempts.filter((attempt) => attempt.status === "submitted").length
    : 0;
  const openAlertCount = dashboard
    ? dashboard.interventionAlerts.filter(
        (alert) => alert.status === "open" || alert.status === "acknowledged",
      ).length
    : 0;

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
  const liveViewerId = liveViewer?.id || null;

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

  const saveAssessment = async (input: AssessmentFormValues) => {
    setSavingAssessment(true);
    try {
      const created = await createAssessment({
        organizationId: input.organizationId,
        classId: input.classId,
        lessonId: input.lessonId,
        title: input.title,
        instructions: input.instructions,
        dueAt: input.dueAt || null,
        status: input.status,
        gradingMode: input.gradingMode,
        resultReleasePolicy: input.resultReleasePolicy,
        attemptLimit: input.attemptLimit,
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

  const setAssessmentStatus = async (assessmentId: string, status: AssessmentStatus) => {
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

  const updateAlertStatus = async (alertId: string, status: InterventionAlert["status"]) => {
    setUpdatingAlertId(alertId);
    try {
      const updated = await updateInterventionAlertStatus(alertId, status);
      setDashboard((current) =>
        current
          ? {
              ...current,
              interventionAlerts: current.interventionAlerts.map((alert) =>
                alert.id === updated.id ? updated : alert,
              ),
            }
          : current,
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not update intervention alert.");
    } finally {
      setUpdatingAlertId(null);
    }
  };

  return (
    <ConsoleShell email={email} activeNav="dashboard">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
            Teacher dashboard
          </div>
          <h1 className="font-serif mt-2 text-[38px] leading-tight tracking-tight text-foreground sm:text-[48px]">
            Classroom evidence.
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            Inspect roster progress, learning attempts, chat transcripts, quiz checks, mastery, and
            notes for students in your assigned pilot classes.
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

          <div className="flex flex-col gap-4">
            {!selectedClassId ? (
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
                  <div className="flex flex-col gap-4">
                    {classesByOrg.map(([org, items]) => (
                      <div key={org}>
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                          {org}
                          <span className="text-muted-foreground/60">· {items.length}</span>
                        </div>
                        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                          {items.map((item) => {
                            const attention = classAttention(dashboard, item.id);
                            return (
                              <div key={item.id} className="w-[240px] shrink-0">
                                <ClassButton
                                  item={item}
                                  active={item.id === selectedClassId}
                                  stats={summarizeClass(dashboard, item.id)}
                                  attention={attention}
                                  onClick={() =>
                                    navigate({
                                      to: "/teacher/class/$classId",
                                      params: { classId: item.id },
                                      search:
                                        attention.tone === "warning"
                                          ? { tab: "gradebook" }
                                          : undefined,
                                    })
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </GradientCard>
            ) : (
              <Breadcrumb
                segments={[
                  { label: "Teacher", onClick: () => navigate({ to: "/teacher" }) },
                  ...(selectedClass
                    ? [
                        { label: organizationName(selectedClass) },
                        {
                          label: selectedClass.name,
                          onClick: () =>
                            navigate({
                              to: "/teacher/class/$classId",
                              params: { classId: selectedClass.id },
                            }),
                        },
                      ]
                    : []),
                  ...(selectedStudentId
                    ? [{ label: displayName(selectedStudent, selectedStudentId) }]
                    : []),
                ]}
              />
            )}

            <div className="grid gap-4">
              {selectedStudentId ? null : selectedClass && classStats ? (
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
                  tab={search.tab ?? "overview"}
                  onTabChange={(value) =>
                    navigate({
                      to: "/teacher/class/$classId",
                      params: { classId: selectedClass.id },
                      search: { tab: value },
                    })
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
                  updatingAlertId={updatingAlertId}
                  onUpdateAlertStatus={(alertId, status) => void updateAlertStatus(alertId, status)}
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
                <GradientCard>
                  <div className="p-4 sm:p-5">
                    <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                      Needs attention
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <MetricCard label="Submissions to grade" value={String(pendingGrading)} />
                      <MetricCard label="Assessments to review" value={String(pendingReviews)} />
                      <MetricCard label="Open alerts" value={String(openAlertCount)} />
                    </div>
                    <p className="mt-4 text-[12.5px] text-muted-foreground">
                      Pick a class above to open its roster, gradebook, resources, assignments, and
                      assessments.
                    </p>
                  </div>
                </GradientCard>
              )}

              {selectedStudentId && studentStats ? (
                <StudentDetail
                  studentId={selectedStudentId}
                  classLabel={selectedClass?.name ?? ""}
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
                  onBack={() =>
                    navigate({
                      to: "/teacher/class/$classId",
                      params: { classId: selectedClassId ?? "" },
                    })
                  }
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </ConsoleShell>
  );
}

function ClassButton({
  item,
  active,
  stats,
  onClick,
  attention,
}: {
  item: TeacherClassSummary;
  active: boolean;
  stats: ClassSummary;
  onClick: () => void;
  attention?: ClassAttention;
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
      {attention ? (
        <div className="mt-3">
          {attention.tone === "danger" ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-danger/40 bg-danger/12 px-2.5 py-1 text-[11px] text-danger">
              <AlertTriangle className="h-3 w-3" strokeWidth={2} /> {attention.alerts} alert
              {attention.alerts === 1 ? "" : "s"}
            </span>
          ) : attention.tone === "warning" ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-warning/40 bg-warning/12 px-2.5 py-1 text-[11px] text-warning">
              <ClipboardList className="h-3 w-3" strokeWidth={2} /> {attention.pendingGrading} to
              grade
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-success/40 bg-success/12 px-2.5 py-1 text-[11px] text-success">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Clear
            </span>
          )}
        </div>
      ) : null}
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
  updatingAlertId,
  onUpdateAlertStatus,
  onUpdateResource,
  tab,
  onTabChange,
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
  updatingAlertId: string | null;
  onUpdateAlertStatus: (alertId: string, status: InterventionAlert["status"]) => void;
  onUpdateResource: (resource: LessonResource) => void;
  tab?: string;
  onTabChange?: (value: string) => void;
}) {
  const [localTab, setLocalTab] = useState("overview");
  const classTab = tab ?? localTab;
  const setClassTab = (value: string) => (onTabChange ? onTabChange(value) : setLocalTab(value));
  const navigate = useNavigate();
  const studentSet = useMemo(() => new Set(studentIds), [studentIds]);
  const openAlerts = dashboard.interventionAlerts.filter(
    (alert) =>
      alert.class_id === item.id && (alert.status === "open" || alert.status === "acknowledged"),
  );
  const activeAssignments = assignments.filter((assignment) => assignment.status === "assigned");
  const recentCompletions = dashboard.sessions.filter(
    (session) =>
      studentSet.has(session.user_id) &&
      session.status === "complete" &&
      Date.now() - new Date(session.updated_at).getTime() < 1000 * 60 * 60 * 24 * 14,
  ).length;
  const runtimeErrors = dashboard.runtimeEvents.filter(
    (event) =>
      event.status === "error" &&
      (event.class_id === item.id || (event.user_id && studentSet.has(event.user_id))),
  ).length;

  return (
    <GradientCard>
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {organizationName(item)} · {item.status}
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

        <Tabs value={classTab} onValueChange={setClassTab}>
          <WorkspaceTabList>
            <WorkspaceTab value="overview">Overview</WorkspaceTab>
            <WorkspaceTab value="lessons">Lessons</WorkspaceTab>
            <WorkspaceTab value="gradebook">Gradebook</WorkspaceTab>
            <WorkspaceTab value="roster">Roster</WorkspaceTab>
            <WorkspaceTab value="resources">Resources</WorkspaceTab>
            <WorkspaceTab value="assignments">Assignments</WorkspaceTab>
            <WorkspaceTab value="assessments">Assessments</WorkspaceTab>
          </WorkspaceTabList>

          <WorkspacePanel value="overview">
            <div className="mt-5 rounded-3xl border border-border bg-background/35 p-4">
              <div className="mb-3 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                Pilot readiness
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <MiniMetric label="Roster" value={`${stats.students} students`} />
                <MiniMetric label="Open work" value={String(activeAssignments.length)} />
                <MiniMetric label="Recent complete" value={String(recentCompletions)} />
                <MiniMetric label="Open alerts" value={String(openAlerts.length)} />
                <MiniMetric label="Runtime errors" value={String(runtimeErrors)} />
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                {openAlerts.length || runtimeErrors
                  ? "This class has support signals to review before launch."
                  : "No open intervention or runtime-error signals for this class."}
              </p>
            </div>

            <ClassAnalyticsPanel
              dashboard={dashboard}
              studentIds={studentIds}
              lessonsById={lessonsById}
              onSelectStudent={onSelectStudent}
              updatingAlertId={updatingAlertId}
              onUpdateAlertStatus={onUpdateAlertStatus}
            />
          </WorkspacePanel>

          <WorkspacePanel value="lessons">
            <div className="mt-5">
              <div className="mb-3">
                <h3 className="text-[15px] font-medium text-foreground">Lessons in this class</h3>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Every lesson with student activity or attached work — its resources, assignments,
                  assessments, and progress in one place.
                </p>
              </div>
              {(() => {
                const studentSetLocal = new Set(studentIds);
                const activeLessonIds = new Set<string>();
                for (const r of resources) if (r.lesson_id) activeLessonIds.add(r.lesson_id);
                for (const a of assignments) if (a.lesson_id) activeLessonIds.add(a.lesson_id);
                for (const a of assessments) if (a.lesson_id) activeLessonIds.add(a.lesson_id);
                for (const s of dashboard.sessions)
                  if (studentSetLocal.has(s.user_id)) activeLessonIds.add(s.lesson_id);
                const rows = lessons.filter((lesson) => activeLessonIds.has(lesson.id));
                if (!rows.length) {
                  return (
                    <div className="rounded-3xl border border-border bg-background/35 p-6 text-[13px] text-muted-foreground">
                      No lessons have resources, assignments, assessments, or student activity in
                      this class yet.
                    </div>
                  );
                }
                return (
                  <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
                    {rows.map((lesson) => {
                      const lessonResources = resources.filter((r) => r.lesson_id === lesson.id);
                      const lessonAssignments = assignments.filter(
                        (a) => a.lesson_id === lesson.id,
                      );
                      const lessonAssessments = assessments.filter(
                        (a) => a.lesson_id === lesson.id,
                      );
                      const lessonSessions = dashboard.sessions.filter(
                        (s) => s.lesson_id === lesson.id && studentSetLocal.has(s.user_id),
                      );
                      const completed = lessonSessions.filter(
                        (s) => s.status === "complete",
                      ).length;
                      return (
                        <div
                          key={lesson.id}
                          className="rounded-2xl border border-border bg-background/35 p-3.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[14px] font-medium text-foreground">
                                {lesson.title}
                              </div>
                              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                {lesson.module ? `${lesson.module} · ` : ""}
                                {lesson.level || "Lesson"}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectLesson(lesson.id);
                                  setClassTab("gradebook");
                                }}
                                className="rounded-full border border-border px-3 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
                              >
                                Open in gradebook
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  navigate({
                                    to: "/teacher/curriculum",
                                    search: { lesson: lesson.id },
                                  })
                                }
                                className="rounded-full border border-border px-3 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
                              >
                                Edit in curriculum
                              </button>
                            </div>
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11.5px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
                              <FileText className="h-3 w-3" strokeWidth={1.7} />{" "}
                              {lessonResources.length} resources
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
                              <ClipboardList className="h-3 w-3" strokeWidth={1.7} />{" "}
                              {lessonAssignments.length} assignments
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
                              <GraduationCap className="h-3 w-3" strokeWidth={1.7} />{" "}
                              {lessonAssessments.length} assessments
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
                              <CheckCircle2 className="h-3 w-3" strokeWidth={1.7} /> {completed}/
                              {lessonSessions.length} complete
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </WorkspacePanel>

          <WorkspacePanel value="gradebook">
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
          </WorkspacePanel>

          <WorkspacePanel value="resources">
            <ResourceManager
              classSummary={item}
              lessons={lessons}
              resources={resources}
              saving={savingResource}
              onSaveResource={onSaveResource}
              onUpdateResource={onUpdateResource}
            />
          </WorkspacePanel>

          <WorkspacePanel value="assessments">
            <AssessmentManager
              classSummary={item}
              lessons={lessons}
              quizItems={quizItems}
              assessments={assessments}
              assessmentItems={assessmentItems}
              assessmentRecipients={assessmentRecipients}
              assessmentAttempts={assessmentAttempts}
              assessmentItemAttempts={assessmentItemAttempts}
              studentIds={studentIds}
              profilesById={profilesById}
              saving={savingAssessment}
              onSaveAssessment={onSaveAssessment}
              onSetAssessmentStatus={onSetAssessmentStatus}
              onReviewAssessmentItem={onReviewAssessmentItem}
              onReturnAssessment={onReturnAssessment}
            />
          </WorkspacePanel>

          <WorkspacePanel value="assignments">
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
          </WorkspacePanel>

          <WorkspacePanel value="roster">
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
          </WorkspacePanel>
        </Tabs>
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

function formatSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function chunkLocationLabel(chunk: ResourceTextChunk) {
  if (chunk.source_kind === "audio" || chunk.source_kind === "video") {
    const start = formatSeconds(chunk.start_seconds);
    const end = formatSeconds(chunk.end_seconds);
    if (start && end) return `${chunk.source_kind === "video" ? "Video" : "Audio"} ${start}-${end}`;
    if (start) return `${chunk.source_kind === "video" ? "Video" : "Audio"} ${start}`;
    return `${chunk.source_kind === "video" ? "Video" : "Audio"} transcript`;
  }
  const generatedFrom =
    chunk.metadata && typeof chunk.metadata.generated_from === "string"
      ? chunk.metadata.generated_from
      : "";
  return generatedFrom === "openai_vision_ocr"
    ? `Page ${chunk.page_number} OCR`
    : `Page ${chunk.page_number}`;
}

function ResourcePageThumbnail({ asset }: { asset: ResourcePageAsset }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getResourcePageAssetSignedUrl(asset)
      .then((signedUrl) => {
        if (!cancelled) setUrl(signedUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  return (
    <div
      className="h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/35"
      title={`Page ${asset.page_number} preview`}
    >
      {url ? (
        <img src={url} alt={`Page ${asset.page_number}`} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          p{asset.page_number}
        </div>
      )}
    </div>
  );
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
  const [processingId, setProcessingId] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const [chunkBusyId, setChunkBusyId] = useState("");
  const [chunksByResource, setChunksByResource] = useState<Record<string, ResourceTextChunk[]>>({});
  const [assetsByResource, setAssetsByResource] = useState<Record<string, ResourcePageAsset[]>>({});
  const [chunkDrafts, setChunkDrafts] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);

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
    setFormOpen(true);
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
      setFormOpen(false);
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

  const loadChunks = async (resource: LessonResource, openPanel = true) => {
    try {
      setChunkBusyId(resource.id);
      const data = await fetchResourceTextChunks(resource.id);
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: data.chunks,
      }));
      setAssetsByResource((current) => ({
        ...current,
        [resource.id]: data.assets,
      }));
      setChunkDrafts((current) => ({
        ...current,
        ...Object.fromEntries(data.chunks.map((chunk) => [chunk.id, chunk.chunk_text])),
      }));
      if (openPanel) setReviewingId(resource.id);
      if (!data.chunks.length) setResourceMessage("No extracted text chunks yet.");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not load extracted text.");
    } finally {
      setChunkBusyId("");
    }
  };

  const extractChunks = async (resource: LessonResource) => {
    try {
      setProcessingId(resource.id);
      setResourceMessage("Opening PDF and extracting text in this browser...");
      const url = await getLessonResourceSignedUrl(resource);
      if (!url) throw new Error("This resource does not have an openable PDF URL.");
      const chunks = await extractPdfTextChunksFromUrl(url);
      if (!chunks.length) {
        throw new Error("No selectable text was found in this PDF.");
      }
      const saved = await saveExtractedPdfChunks(resource.id, chunks, {
        extracted_in: "browser",
        extracted_at: new Date().toISOString(),
      });
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: saved,
      }));
      setChunkDrafts((current) => ({
        ...current,
        ...Object.fromEntries(saved.map((chunk) => [chunk.id, chunk.chunk_text])),
      }));
      setReviewingId(resource.id);
      setResourceMessage(
        `Extracted ${saved.length} draft chunk${saved.length === 1 ? "" : "s"}. Review and approve before Mentor can use them.`,
      );
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not extract PDF text.");
    } finally {
      setProcessingId("");
    }
  };

  const generatePagePreviews = async (resource: LessonResource) => {
    try {
      setProcessingId(resource.id);
      setResourceMessage("Rendering PDF page previews in this browser...");
      const url = await getLessonResourceSignedUrl(resource);
      if (!url) throw new Error("This resource does not have an openable PDF URL.");
      const pageAssets = await renderPdfPageAssetsFromUrl(url);
      if (!pageAssets.length) {
        throw new Error("No PDF pages were rendered.");
      }
      const saved = await uploadPdfPageAssets(resource, pageAssets);
      setAssetsByResource((current) => ({
        ...current,
        [resource.id]: saved,
      }));
      setReviewingId(resource.id);
      const pageCount = new Set(saved.map((asset) => asset.page_number)).size;
      setResourceMessage(
        `Generated previews for ${pageCount} page${pageCount === 1 ? "" : "s"}. Scanned pages can now be OCR processed.`,
      );
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not generate page previews.");
    } finally {
      setProcessingId("");
    }
  };

  const ocrPdfResource = async (resource: LessonResource) => {
    try {
      setProcessingId(resource.id);
      setResourceMessage("Running OCR on scanned PDF page images...");
      const assets = assetsByResource[resource.id] || [];
      const pageNumbers = Array.from(
        new Set(
          assets
            .filter((asset) => asset.asset_type === "ocr_image")
            .map((asset) => asset.page_number),
        ),
      ).sort((a, b) => a - b);
      const saved = await ocrPdfPages(resource.id, pageNumbers);
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: [...(current[resource.id] || []), ...saved],
      }));
      setChunkDrafts((current) => ({
        ...current,
        ...Object.fromEntries(saved.map((chunk) => [chunk.id, chunk.chunk_text])),
      }));
      setReviewingId(resource.id);
      setResourceMessage(
        `Created ${saved.length} draft OCR chunk${saved.length === 1 ? "" : "s"}. Review and approve before Mentor can use them.`,
      );
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not OCR PDF pages.");
    } finally {
      setProcessingId("");
    }
  };

  const transcribeResource = async (resource: LessonResource) => {
    try {
      setProcessingId(resource.id);
      setResourceMessage("Transcribing uploaded media. This can take a little while...");
      const saved = await transcribeMediaResource(resource.id);
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: saved,
      }));
      setChunkDrafts((current) => ({
        ...current,
        ...Object.fromEntries(saved.map((chunk) => [chunk.id, chunk.chunk_text])),
      }));
      setReviewingId(resource.id);
      setResourceMessage(
        `Created ${saved.length} draft transcript chunk${saved.length === 1 ? "" : "s"}. Review and approve before Mentor can use them.`,
      );
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not transcribe media.");
    } finally {
      setProcessingId("");
    }
  };

  const saveChunk = async (resource: LessonResource, chunk: ResourceTextChunk) => {
    try {
      setChunkBusyId(chunk.id);
      const saved = await saveResourceChunkEdits(resource.id, [
        {
          id: chunk.id,
          page_number: chunk.page_number,
          chunk_index: chunk.chunk_index,
          chunk_text: chunkDrafts[chunk.id] ?? chunk.chunk_text,
        },
      ]);
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: (current[resource.id] || []).map((existing) =>
          existing.id === chunk.id ? saved[0] || existing : existing,
        ),
      }));
      setResourceMessage("Chunk saved.");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not save chunk.");
    } finally {
      setChunkBusyId("");
    }
  };

  const setChunkStatus = async (
    resource: LessonResource,
    chunk: ResourceTextChunk,
    status: Extract<ResourceTextChunkStatus, "approved" | "rejected">,
  ) => {
    try {
      setChunkBusyId(chunk.id);
      const updated =
        status === "approved"
          ? await approveResourceChunks(resource.id, [chunk.id])
          : await rejectResourceChunks(resource.id, [chunk.id]);
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: (current[resource.id] || []).map((existing) =>
          existing.id === chunk.id ? updated[0] || existing : existing,
        ),
      }));
      setResourceMessage(status === "approved" ? "Chunk approved." : "Chunk rejected.");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not update chunk status.");
    } finally {
      setChunkBusyId("");
    }
  };

  const removeChunk = async (resource: LessonResource, chunk: ResourceTextChunk) => {
    try {
      setChunkBusyId(chunk.id);
      await deleteResourceChunks(resource.id, [chunk.id]);
      setChunksByResource((current) => ({
        ...current,
        [resource.id]: (current[resource.id] || []).filter((existing) => existing.id !== chunk.id),
      }));
      setResourceMessage("Chunk deleted.");
    } catch (error) {
      setResourceMessage((error as Error).message || "Could not delete chunk.");
    } finally {
      setChunkBusyId("");
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
        <div className="flex items-center gap-3">
          <span className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
            {resources.length} resource{resources.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => {
              cancelEdit();
              setFormOpen(true);
            }}
            className="rounded-full bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90"
          >
            New resource
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) cancelEdit();
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{draft.resourceId ? "Edit resource" : "New resource"}</DialogTitle>
            </DialogHeader>

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
          </DialogContent>
        </Dialog>

        <div className="grid content-start gap-2">
          {resources.length ? (
            resources.map((resource) => {
              const chunks = chunksByResource[resource.id] || [];
              const assets = assetsByResource[resource.id] || [];
              const draftCount = chunks.filter((chunk) => chunk.status === "draft").length;
              const approvedCount = chunks.filter((chunk) => chunk.status === "approved").length;
              const rejectedCount = chunks.filter((chunk) => chunk.status === "rejected").length;
              const canExtractPdf =
                resource.resource_type === "pdf" && resource.source_type === "upload";
              const pdfPageCount = new Set(assets.map((asset) => asset.page_number)).size;
              const thumbnailAssets = assets.filter((asset) => asset.asset_type === "thumbnail");
              const ocrAssetCount = assets.filter(
                (asset) => asset.asset_type === "ocr_image",
              ).length;
              const canTranscribeMedia =
                (resource.resource_type === "audio" || resource.resource_type === "video") &&
                resource.source_type === "upload";
              const reviewOpen = reviewingId === resource.id;

              return (
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
                      {chunks.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded-full border border-border bg-background/45 px-2 py-1 text-muted-foreground">
                            {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
                          </span>
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-success">
                            {approvedCount} approved
                          </span>
                          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-warning">
                            {draftCount} draft
                          </span>
                          <span className="rounded-full border border-border bg-background/45 px-2 py-1 text-muted-foreground">
                            {rejectedCount} rejected
                          </span>
                        </div>
                      ) : null}
                      {assets.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded-full border border-border bg-background/45 px-2 py-1 text-muted-foreground">
                            {pdfPageCount} rendered page{pdfPageCount === 1 ? "" : "s"}
                          </span>
                          <span className="rounded-full border border-info/30 bg-info/10 px-2 py-1 text-info">
                            {ocrAssetCount} OCR image{ocrAssetCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      ) : null}
                      {thumbnailAssets.length ? (
                        <div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1">
                          {thumbnailAssets.slice(0, 6).map((asset) => (
                            <ResourcePageThumbnail key={asset.id} asset={asset} />
                          ))}
                          {thumbnailAssets.length > 6 ? (
                            <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/35 text-[10px] text-muted-foreground">
                              +{thumbnailAssets.length - 6}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
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
                      className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
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
                    {canExtractPdf ? (
                      <button
                        type="button"
                        onClick={() => void generatePagePreviews(resource)}
                        disabled={processingId === resource.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/35 px-3 py-1.5 text-[11.5px] text-cyan-500 transition-colors hover:bg-cyan-500/10 disabled:opacity-45"
                      >
                        <FileText className="h-3.5 w-3.5" strokeWidth={1.6} />
                        {processingId === resource.id ? "Rendering..." : "Generate page previews"}
                      </button>
                    ) : null}
                    {canExtractPdf ? (
                      <button
                        type="button"
                        onClick={() => void extractChunks(resource)}
                        disabled={processingId === resource.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-info/35 px-3 py-1.5 text-[11.5px] text-info transition-colors hover:bg-info/10 disabled:opacity-45"
                      >
                        <FileSearch className="h-3.5 w-3.5" strokeWidth={1.6} />
                        {processingId === resource.id ? "Extracting..." : "Extract PDF text"}
                      </button>
                    ) : null}
                    {canExtractPdf ? (
                      <button
                        type="button"
                        onClick={() => void ocrPdfResource(resource)}
                        disabled={processingId === resource.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/35 px-3 py-1.5 text-[11.5px] text-purple-500 transition-colors hover:bg-purple-500/10 disabled:opacity-45"
                      >
                        <FileSearch className="h-3.5 w-3.5" strokeWidth={1.6} />
                        {processingId === resource.id ? "Running OCR..." : "OCR scanned pages"}
                      </button>
                    ) : null}
                    {canTranscribeMedia ? (
                      <button
                        type="button"
                        onClick={() => void transcribeResource(resource)}
                        disabled={processingId === resource.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-info/35 px-3 py-1.5 text-[11.5px] text-info transition-colors hover:bg-info/10 disabled:opacity-45"
                      >
                        <FileSearch className="h-3.5 w-3.5" strokeWidth={1.6} />
                        {processingId === resource.id
                          ? "Transcribing..."
                          : resource.resource_type === "video"
                            ? "Transcribe video"
                            : "Transcribe audio"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        reviewOpen ? setReviewingId("") : void loadChunks(resource, true)
                      }
                      className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted"
                    >
                      {reviewOpen
                        ? "Hide review"
                        : chunkBusyId === resource.id
                          ? "Loading..."
                          : "Review text"}
                    </button>
                  </div>

                  {reviewOpen ? (
                    <div className="mt-4 rounded-2xl border border-border bg-background/45 p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="text-[12.5px] font-medium text-foreground">
                            Extracted text / transcript review
                          </div>
                          <div className="text-[11.5px] text-muted-foreground">
                            Draft and rejected chunks are teacher-only. Mentor can use approved
                            chunks.
                          </div>
                        </div>
                        {chunks.length ? (
                          <button
                            type="button"
                            onClick={() =>
                              void approveResourceChunks(
                                resource.id,
                                chunks
                                  .filter((chunk) => chunk.status === "draft")
                                  .map((chunk) => chunk.id),
                              ).then((updated) => {
                                setChunksByResource((current) => ({
                                  ...current,
                                  [resource.id]: (current[resource.id] || []).map(
                                    (existing) =>
                                      updated.find((chunk) => chunk.id === existing.id) || existing,
                                  ),
                                }));
                                setResourceMessage("Draft chunks approved.");
                              })
                            }
                            disabled={!draftCount}
                            className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                          >
                            Approve drafts
                          </button>
                        ) : null}
                      </div>
                      {chunks.length ? (
                        <div className="grid max-h-[520px] gap-3 overflow-auto pr-1">
                          {chunks.map((chunk) => (
                            <div
                              key={chunk.id}
                              className="rounded-2xl border border-border bg-background/55 p-3"
                            >
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                                  <span>{chunkLocationLabel(chunk)}</span>
                                  <span>Chunk {chunk.chunk_index + 1}</span>
                                  <ResourceChunkStatusChip status={chunk.status} />
                                </div>
                                <button
                                  type="button"
                                  title="Delete chunk"
                                  onClick={() => void removeChunk(resource, chunk)}
                                  disabled={chunkBusyId === chunk.id}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                                </button>
                              </div>
                              <textarea
                                value={chunkDrafts[chunk.id] ?? chunk.chunk_text}
                                onChange={(event) =>
                                  setChunkDrafts((current) => ({
                                    ...current,
                                    [chunk.id]: event.target.value,
                                  }))
                                }
                                className="min-h-[120px] w-full rounded-2xl border border-border bg-background/80 px-3 py-2 text-[12.5px] leading-relaxed text-foreground outline-none"
                              />
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void saveChunk(resource, chunk)}
                                  disabled={chunkBusyId === chunk.id}
                                  className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void setChunkStatus(resource, chunk, "approved")}
                                  disabled={chunk.status === "approved" || chunkBusyId === chunk.id}
                                  className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void setChunkStatus(resource, chunk, "rejected")}
                                  disabled={chunk.status === "rejected" || chunkBusyId === chunk.id}
                                  className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-border bg-background/55 p-4 text-[12.5px] text-muted-foreground">
                          No chunks yet. Extract selectable PDF text, OCR scanned PDF pages, or
                          transcribe uploaded audio/video to begin review.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
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
  title: string;
  instructions: string;
  dueAt: string;
  status: Extract<AssessmentStatus, "draft" | "published">;
  gradingMode: AssessmentGradingMode;
  resultReleasePolicy: AssessmentResultReleasePolicy;
  attemptLimit: number;
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
    lessonId: lessons[0]?.id || "lesson1",
    title: "",
    instructions: "",
    dueAt: "",
    status: "published",
    gradingMode: "mixed",
    resultReleasePolicy: "after_review",
    attemptLimit: 1,
    recipientIds: studentIds,
    items: [defaultAssessmentQuestion(), { ...defaultAssessmentQuestion() }],
  };
}

function AssessmentManager({
  classSummary,
  lessons,
  quizItems,
  assessments,
  assessmentItems,
  assessmentRecipients,
  assessmentAttempts,
  assessmentItemAttempts,
  studentIds,
  profilesById,
  saving,
  onSaveAssessment,
  onSetAssessmentStatus,
  onReviewAssessmentItem,
  onReturnAssessment,
}: {
  classSummary: TeacherClassSummary;
  lessons: Lesson[];
  quizItems: CurriculumQuizItem[];
  assessments: Assessment[];
  assessmentItems: AssessmentItem[];
  assessmentRecipients: AssessmentRecipient[];
  assessmentAttempts: AssessmentAttempt[];
  assessmentItemAttempts: AssessmentItemAttempt[];
  studentIds: string[];
  profilesById: Map<string, Profile>;
  saving: boolean;
  onSaveAssessment: (input: AssessmentFormValues) => Promise<void>;
  onSetAssessmentStatus: (assessmentId: string, status: AssessmentStatus) => void;
  onReviewAssessmentItem: (input: {
    itemAttemptId: string;
    scorePercent: number;
    feedback: string;
  }) => Promise<void>;
  onReturnAssessment: (input: { attemptId: string; feedback: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AssessmentFormValues>(() =>
    defaultAssessmentForm(classSummary, lessons, studentIds),
  );
  const [assessmentMessage, setAssessmentMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; feedback: string; saving: boolean }>
  >({});
  const quizItemsById = useMemo(
    () => new Map(quizItems.map((quiz) => [quiz.id, quiz])),
    [quizItems],
  );
  const lessonQuizItems = quizItems.filter(
    (quiz) => quiz.lesson_id === draft.lessonId && quiz.status !== "archived",
  );

  useEffect(() => {
    setDraft(defaultAssessmentForm(classSummary, lessons, studentIds));
    setAssessmentMessage("");
    setReviewDrafts({});
  }, [classSummary, lessons, studentIds]);

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

  const updateReviewDraft = (
    itemAttemptId: string,
    patch: Partial<{ score: string; feedback: string; saving: boolean }>,
  ) => {
    setReviewDrafts((current) => ({
      ...current,
      [itemAttemptId]: {
        score: current[itemAttemptId]?.score || "",
        feedback: current[itemAttemptId]?.feedback || "",
        saving: current[itemAttemptId]?.saving || false,
        ...patch,
      },
    }));
  };

  const reviewItem = async (itemAttempt: AssessmentItemAttempt) => {
    const draft = reviewDrafts[itemAttempt.id] || { score: "", feedback: "", saving: false };
    const score = Number(draft.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setAssessmentMessage("Enter a score from 0 to 100 before reviewing the question.");
      return;
    }
    updateReviewDraft(itemAttempt.id, { saving: true });
    try {
      await onReviewAssessmentItem({
        itemAttemptId: itemAttempt.id,
        scorePercent: score,
        feedback: draft.feedback.trim(),
      });
      setAssessmentMessage("Question reviewed.");
    } catch (error) {
      setAssessmentMessage((error as Error).message || "Could not review question.");
    } finally {
      updateReviewDraft(itemAttempt.id, { saving: false });
    }
  };

  const returnAttempt = async (attempt: AssessmentAttempt) => {
    const feedback = window.prompt("Final feedback for the student", attempt.feedback || "") || "";
    try {
      await onReturnAssessment({ attemptId: attempt.id, feedback });
      setAssessmentMessage("Quiz result returned.");
    } catch (error) {
      setAssessmentMessage((error as Error).message || "Could not return quiz result.");
    }
  };

  return (
    <div className="mt-6 rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">Lesson quizzes</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Assign multi-question quizzes, auto-grade MCQ items, and review written answers.
          </p>
        </div>
        <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
          {assessments.length} quiz{assessments.length === 1 ? "" : "zes"}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-2xl border border-border bg-background/35 p-4">
          <div className="text-[13px] font-medium text-foreground">Create quiz</div>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Lesson
              <select
                value={draft.lessonId}
                onChange={(event) => setField("lessonId", event.target.value)}
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
                placeholder="Clear reasons checkpoint"
                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Instructions
              <textarea
                value={draft.instructions}
                onChange={(event) => setField("instructions", event.target.value)}
                placeholder="Answer each question carefully. Written answers will be reviewed by your teacher."
                className="min-h-[76px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case leading-relaxed tracking-normal text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Due
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
                      event.target.value as Extract<AssessmentStatus, "draft" | "published">,
                    )
                  }
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
              <label className="grid gap-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Attempts
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.attemptLimit}
                  onChange={(event) => setField("attemptLimit", Number(event.target.value) || 1)}
                  className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] normal-case tracking-normal text-foreground outline-none"
                />
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

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Questions
                </div>
                <button
                  type="button"
                  onClick={() => setField("items", [...draft.items, defaultAssessmentQuestion()])}
                  className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted"
                >
                  Add question
                </button>
              </div>
              {draft.items.map((question, index) => (
                <div key={index} className="rounded-2xl border border-border bg-background/45 p-3">
                  <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <select
                      value={question.quizItemId || ""}
                      onChange={(event) =>
                        updateQuestion(index, {
                          quizItemId: event.target.value || undefined,
                          prompt: event.target.value ? "" : question.prompt,
                        })
                      }
                      className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
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
                      className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
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
                        className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none"
                      >
                        <option value="multiple_choice">Multiple choice</option>
                        <option value="text">Text response</option>
                        <option value="code">Code response</option>
                      </select>
                      <textarea
                        value={question.prompt || ""}
                        onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                        placeholder="Question prompt"
                        className="min-h-[72px] rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                      />
                      {question.questionType === "multiple_choice" ? (
                        <div className="grid gap-2">
                          {(question.choices || []).map((choice) => (
                            <div
                              key={choice.id}
                              className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)]"
                            >
                              <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
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
                                className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
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
                        className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                  ) : (
                    <div className="text-[12px] text-muted-foreground">
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
                      className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
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
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
              {saving ? "Saving..." : draft.status === "published" ? "Assign quiz" : "Save draft"}
            </button>
            {assessmentMessage ? (
              <div className="text-[12px] leading-relaxed text-muted-foreground">
                {assessmentMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid content-start gap-3">
          {assessments.length ? (
            assessments.map((assessment) => {
              const items = assessmentItems
                .filter((item) => item.assessment_id === assessment.id)
                .sort((a, b) => a.position - b.position);
              const recipients = assessmentRecipients.filter(
                (recipient) => recipient.assessment_id === assessment.id,
              );
              const attempts = assessmentAttempts.filter(
                (attempt) => attempt.assessment_id === assessment.id,
              );
              return (
                <div
                  key={assessment.id}
                  className="rounded-2xl border border-border bg-background/35 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-foreground">
                          {assessment.title}
                        </span>
                        <AssessmentStatusChip status={assessment.status} />
                      </div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {lessonTitle(lessons, assessment.lesson_id)} · {items.length} questions ·{" "}
                        {recipients.length} recipients
                      </div>
                      {assessment.due_at ? (
                        <div className="mt-1 text-[11.5px] text-muted-foreground">
                          Due {formatDateTime(assessment.due_at)}
                        </div>
                      ) : null}
                      <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                        {assessment.instructions || "No instructions."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onSetAssessmentStatus(assessment.id, "published")}
                        disabled={assessment.status === "published"}
                        className="inline-flex items-center gap-1.5 rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Publish
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetAssessmentStatus(assessment.id, "draft")}
                        disabled={assessment.status === "draft"}
                        className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                      >
                        Draft
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetAssessmentStatus(assessment.id, "archived")}
                        disabled={assessment.status === "archived"}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                      >
                        <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Archive
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    {recipients.map((recipient) => {
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
                            <AssessmentRecipientChip status={recipient.status} />
                            <span className="text-[11.5px] text-muted-foreground">
                              {recipient.final_score === null
                                ? "ungraded"
                                : formatScore(recipient.final_score)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-3">
                    {attempts.length ? (
                      attempts.map((attempt) => {
                        const profile = profilesById.get(attempt.user_id) || null;
                        const itemAttempts = assessmentItemAttempts.filter(
                          (item) => item.assessment_attempt_id === attempt.id,
                        );
                        const pending = itemAttempts.some(
                          (item) => item.review_state === "pending_review",
                        );
                        return (
                          <div
                            key={attempt.id}
                            className="rounded-2xl border border-border bg-background/45 p-3"
                          >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-[12.5px] font-medium text-foreground">
                                  {displayName(profile, attempt.user_id)}
                                </div>
                                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                  {attempt.status} · {formatDateTime(attempt.created_at)}
                                </div>
                              </div>
                              <span className="text-[11.5px] text-muted-foreground">
                                {attempt.final_score === null
                                  ? "pending"
                                  : formatScore(attempt.final_score)}
                              </span>
                            </div>
                            <div className="grid gap-2">
                              {itemAttempts.map((itemAttempt) => {
                                const quiz = quizItemsById.get(itemAttempt.quiz_item_id);
                                const draft = reviewDrafts[itemAttempt.id] || {
                                  score:
                                    itemAttempt.score === null || itemAttempt.score === undefined
                                      ? ""
                                      : String(
                                          Math.round(
                                            (Number(itemAttempt.score || 0) /
                                              Number(itemAttempt.max_score || 1)) *
                                              100,
                                          ),
                                        ),
                                  feedback: itemAttempt.feedback || "",
                                  saving: false,
                                };
                                return (
                                  <div
                                    key={itemAttempt.id}
                                    className="rounded-2xl border border-border bg-background/45 p-3"
                                  >
                                    <div className="text-[12.5px] font-medium text-foreground">
                                      {quiz?.prompt || "Question"}
                                    </div>
                                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                                      {itemAttempt.review_state.replace("_", " ")} · score{" "}
                                      {itemAttempt.score === null
                                        ? "pending"
                                        : `${itemAttempt.score}/${itemAttempt.max_score}`}
                                    </div>
                                    {itemAttempt.answer_text ? (
                                      <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                                        {itemAttempt.answer_text}
                                      </p>
                                    ) : null}
                                    {itemAttempt.answer_code ? (
                                      <pre
                                        className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-[var(--code-background)] p-3 text-[12px] leading-relaxed text-[var(--code-foreground)]"
                                        style={{
                                          fontFamily:
                                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                                        }}
                                      >
                                        {itemAttempt.answer_code}
                                      </pre>
                                    ) : null}
                                    {itemAttempt.review_state === "pending_review" ? (
                                      <div className="mt-3 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_auto]">
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          value={draft.score}
                                          onChange={(event) =>
                                            updateReviewDraft(itemAttempt.id, {
                                              score: event.target.value,
                                            })
                                          }
                                          placeholder="Score"
                                          className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                                        />
                                        <input
                                          value={draft.feedback}
                                          onChange={(event) =>
                                            updateReviewDraft(itemAttempt.id, {
                                              feedback: event.target.value,
                                            })
                                          }
                                          placeholder="Feedback"
                                          className="rounded-2xl border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => void reviewItem(itemAttempt)}
                                          disabled={draft.saving}
                                          className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                                        >
                                          Review
                                        </button>
                                      </div>
                                    ) : itemAttempt.feedback ? (
                                      <p className="mt-2 text-[12.5px] text-muted-foreground">
                                        {itemAttempt.feedback}
                                      </p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 flex justify-end">
                              <button
                                type="button"
                                onClick={() => void returnAttempt(attempt)}
                                disabled={pending || attempt.status === "returned"}
                                className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                              >
                                Return result
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-border bg-background/35 p-4 text-[12.5px] text-muted-foreground">
                        No attempts yet.
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-border bg-background/35 p-5 text-[13px] text-muted-foreground">
              No lesson quizzes yet. Create one when you need a larger checkpoint.
            </div>
          )}
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

      <div className="grid gap-4">
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
                        className="inline-flex items-center gap-1.5 rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
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
                                className="rounded-full border border-success/35 px-3 py-1.5 text-[11.5px] text-success transition-colors hover:bg-success/10 disabled:opacity-45"
                              >
                                Mark complete
                              </button>
                              <button
                                type="button"
                                onClick={() => void review(assignment, submission, "returned")}
                                disabled={draft.saving}
                                className="rounded-full border border-warning/35 px-3 py-1.5 text-[11.5px] text-warning transition-colors hover:bg-warning/10 disabled:opacity-45"
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

function ClassAnalyticsPanel({
  dashboard,
  studentIds,
  lessonsById,
  onSelectStudent,
  updatingAlertId,
  onUpdateAlertStatus,
}: {
  dashboard: TeacherDashboardData;
  studentIds: string[];
  lessonsById: Map<string, Lesson>;
  onSelectStudent: (studentId: string) => void;
  updatingAlertId: string | null;
  onUpdateAlertStatus: (alertId: string, status: InterventionAlert["status"]) => void;
}) {
  const analytics = classAnalyticsFor(dashboard, studentIds);
  const signals = riskSignalsForClass(dashboard, studentIds, lessonsById);
  const masteryRows = masteryRowsForClass(dashboard, studentIds);
  const profilesById = new Map(dashboard.profiles.map((profile) => [profile.id, profile]));

  return (
    <div className="mt-6 grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AnalyticsMetric
          label="Completion rate"
          value={formatPercent(analytics.completionRate)}
          detail={`${analytics.completedSessions}/${analytics.startedSessions} started sessions complete`}
        />
        <AnalyticsMetric
          label="Average quiz score"
          value={formatPercent(analytics.averageQuizScore)}
          detail={`${analytics.quizAttempts} quiz attempt${analytics.quizAttempts === 1 ? "" : "s"}`}
        />
        <AnalyticsMetric
          label="Assignment submissions"
          value={formatPercent(analytics.assignmentSubmissionRate)}
          detail={`${analytics.submittedAssignments}/${analytics.assignedAssignments} assigned work items submitted`}
        />
        <AnalyticsMetric
          label="Resource engagement"
          value={formatPercent(analytics.resourceEngagementRate)}
          detail={`${analytics.resourceOpened} opened / ${analytics.resourceShown} shown`}
        />
      </div>

      <div className="grid gap-4">
        <Panel title="Mastery heatmap" icon={<TrendingUp className="h-4 w-4" strokeWidth={1.6} />}>
          {masteryRows.length ? (
            <div className="grid gap-2">
              {masteryRows.map((row) => (
                <div
                  key={row.skill}
                  className="rounded-2xl border border-border bg-background/45 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px] font-medium text-foreground">{row.skill}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {row.students} student{row.students === 1 ? "" : "s"} - {row.evidence}{" "}
                      evidence
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${masteryBarClass(row.averageScore)}`}
                      style={{ width: `${Math.max(4, Math.round(row.averageScore * 100))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11.5px] text-muted-foreground">
                    <span>Avg {formatPercent(row.averageScore)}</span>
                    <span>{row.secure} secure</span>
                    <span>{row.developing} developing</span>
                    <span>{row.emerging} emerging</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyInline
              title="No mastery yet"
              body="Mastery signals appear after assessed student work."
            />
          )}
        </Panel>

        <Panel
          title="Needs Attention"
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.6} />}
        >
          {signals.length ? (
            <div className="space-y-2">
              {signals.slice(0, 8).map((signal) => {
                const profile = profilesById.get(signal.studentId) || null;
                return (
                  <div
                    key={`${signal.studentId}-${signal.kind}-${signal.sourceId}`}
                    className="rounded-2xl border border-border bg-background/45 p-3"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectStudent(signal.studentId)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-foreground">
                          {displayName(profile, signal.studentId)}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${severityClass(
                            signal.severity,
                          )}`}
                        >
                          {signal.severity}
                        </span>
                      </div>
                      <div className="mt-1 text-[12.5px] text-foreground">{signal.title}</div>
                      <div className="mt-1 text-[11.5px] text-muted-foreground">
                        {signal.detail}
                      </div>
                    </button>
                    {signal.kind === "intervention" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(["acknowledged", "resolved", "dismissed"] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => onUpdateAlertStatus(signal.sourceId, status)}
                            disabled={updatingAlertId === signal.sourceId}
                            className="rounded-full border border-border px-2.5 py-1 text-[11px] capitalize text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyInline
              title="No deterministic alerts"
              body="Risk signals appear only from real attempts, quiz misses, mastery, assignments, or teacher alerts."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function AnalyticsMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-border bg-background/30 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.6} />
        {label}
      </div>
      <div className="mt-2 font-serif text-[28px] leading-none text-foreground">{value}</div>
      <div className="mt-2 text-[12px] text-muted-foreground">{detail}</div>
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
        <div className="max-h-[58vh] overflow-auto pb-1">
          <table className="min-w-[920px] w-full border-separate border-spacing-y-2 text-left">
            <thead className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-[1] bg-background px-3 py-1 font-medium">Student</th>
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
                    onClick={() => onSelectStudent(row.studentId)}
                    className={`cursor-pointer rounded-2xl border border-border bg-background/35 transition-colors hover:bg-muted ${
                      selectedStudentId === row.studentId
                        ? "outline outline-1 outline-foreground/20"
                        : ""
                    }`}
                  >
                    <td className="sticky left-0 z-[1] rounded-l-2xl border-y border-l border-border bg-background px-3 py-3">
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
                          <span className="rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 text-[11.5px] text-warning">
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
  classLabel,
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
  onBack,
  tab,
  onTabChange,
}: {
  studentId: string;
  classLabel: string;
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
  onBack: () => void;
  tab?: string;
  onTabChange?: (value: string) => void;
}) {
  const [localTab, setLocalTab] = useState("overview");
  const studentTab = tab ?? localTab;
  const setStudentTab = (value: string) => (onTabChange ? onTabChange(value) : setLocalTab(value));
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
    <GradientCard>
      <div className="p-4 sm:p-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.6} /> Back to {classLabel || "class"}
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
              <button
                type="button"
                onClick={watchingSelectedSession ? onStopWatching : onStartWatching}
                disabled={!canWatchSelectedSession}
                className="inline-flex w-fit items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
              >
                {watchingSelectedSession ? (
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} />
                ) : (
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.7} />
                )}
                {watchingSelectedSession ? "Stop watching" : "Watch live"}
              </button>
            </div>
            {watchingSelectedSession ? (
              <div className="mt-3 rounded-2xl border border-info/35 bg-info/10 px-3 py-2 text-[12px] text-info">
                You are watching live. The student will see a teacher-viewing indicator while your
                heartbeat is active.
              </div>
            ) : null}
          </div>
        ) : null}

        <Tabs value={studentTab} onValueChange={setStudentTab}>
          <WorkspaceTabList>
            <WorkspaceTab value="overview">Overview</WorkspaceTab>
            <WorkspaceTab value="transcript">Transcript &amp; notes</WorkspaceTab>
            <WorkspaceTab value="records">Records</WorkspaceTab>
          </WorkspaceTabList>

          <WorkspacePanel value="overview">
            <StudentAnalyticsPanel
              dashboard={dashboard}
              studentId={studentId}
              lessonsById={lessonsById}
            />
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
                  <div className="mb-3 rounded-2xl border border-border bg-background/45 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[12px] font-medium text-foreground">
                          Live teacher tip
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          Visible in the student chat as a Teacher message.
                        </div>
                      </div>
                      {watchingSelectedSession ? (
                        <span className="rounded-full border border-info/35 bg-info/10 px-2.5 py-1 text-[11px] text-info">
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
                        className="min-w-0 flex-1 rounded-full border border-border bg-background/70 px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-55"
                      />
                      <button
                        type="button"
                        onClick={onSendLiveComment}
                        disabled={
                          !watchingSelectedSession || !liveCommentDraft.trim() || sendingLiveComment
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Send className="h-3.5 w-3.5" strokeWidth={1.7} />
                        {sendingLiveComment ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {transcriptItems.length ? (
                  <div className="max-h-[440px] space-y-3 overflow-auto pr-1">
                    {transcriptItems.map((item) => {
                      if (item.kind === "live_comment") {
                        return (
                          <div
                            key={item.id}
                            className="rounded-3xl border border-info/35 bg-info/10 p-4"
                          >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[12px] uppercase tracking-[0.1em] text-info">
                                Teacher live
                              </span>
                              <span className="text-[11.5px] text-muted-foreground">
                                {formatDateTime(item.comment.created_at)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                              {item.comment.content}
                            </p>
                          </div>
                        );
                      }
                      const modality = inputModalityFromPayload(item.turn.payload);
                      return (
                        <div
                          key={item.id}
                          className="rounded-3xl border border-border bg-background/45 p-4"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                              {item.turn.role} - {item.turn.stage}
                              {modality === "dictated" || modality === "audio_session" ? (
                                <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] tracking-[0.08em] text-muted-foreground">
                                  {modality === "audio_session" ? "Voice" : "Dictated"}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[11.5px] text-muted-foreground">
                              {formatDateTime(item.turn.created_at)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                            {item.turn.content || "[Empty turn]"}
                          </p>
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
                              {note.visibility === "student_visible"
                                ? "Student visible"
                                : "Private"}
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

                <Panel
                  title="Mastery"
                  icon={<GraduationCap className="h-4 w-4" strokeWidth={1.6} />}
                >
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
          </WorkspacePanel>

          <WorkspacePanel value="records">
            <div className="mt-4 grid gap-4">
              <Panel
                title="Lesson attempts"
                icon={<ClipboardList className="h-4 w-4" strokeWidth={1.6} />}
              >
                {attempts.length ? (
                  <RecordList
                    items={attempts.slice(0, 8).map((item) => ({
                      id: item.id,
                      title: `${lessonName(lessonsById, item.lesson_id)} - ${item.answer_mode}`,
                      meta: `${modalityLabel(item.input_modality)}${formatPass(item.passed)} - score ${formatScore(
                        item.score,
                      )}`,
                      body:
                        item.feedback ||
                        item.answer_text ||
                        item.answer_code ||
                        "No feedback text.",
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
                  <EmptyInline
                    title="No evidence"
                    body="Evidence appears after rubric-backed work."
                  />
                )}
              </Panel>
            </div>
          </WorkspacePanel>
        </Tabs>
      </div>
    </GradientCard>
  );
}

function StudentAnalyticsPanel({
  dashboard,
  studentId,
  lessonsById,
}: {
  dashboard: TeacherDashboardData;
  studentId: string;
  lessonsById: Map<string, Lesson>;
}) {
  const analytics = studentAnalyticsFor(dashboard, studentId);
  const signals = riskSignalsForClass(dashboard, [studentId], lessonsById);
  const strongest = dashboard.mastery
    .filter((item) => item.user_id === studentId)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const weakest = dashboard.mastery
    .filter((item) => item.user_id === studentId)
    .sort((a, b) => Number(a.score || 0) - Number(b.score || 0))[0];

  return (
    <div className="mt-5 rounded-3xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
        <BarChart3 className="h-4 w-4" strokeWidth={1.6} />
        Student analytics
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <MiniMetric label="Completion" value={formatPercent(analytics.completionRate)} />
        <MiniMetric label="Quiz avg" value={formatPercent(analytics.averageQuizScore)} />
        <MiniMetric label="Resources" value={String(analytics.resourceOpened)} />
        <MiniMetric label="Alerts" value={String(signals.length)} />
      </div>
      <div className="mt-3 grid gap-3">
        <div className="rounded-2xl border border-border bg-background/45 p-3">
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Strongest skill
          </div>
          <div className="mt-1 text-[13px] text-foreground">
            {strongest ? strongest.skill_key : "No mastery yet"}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {strongest
              ? `${formatPercent(strongest.score)} · ${strongest.evidence_count} evidence`
              : "Complete assessed work to populate this."}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-background/45 p-3">
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Weakest skill
          </div>
          <div className="mt-1 text-[13px] text-foreground">
            {weakest ? weakest.skill_key : "No mastery yet"}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {weakest
              ? `${formatPercent(weakest.score)} · ${weakest.evidence_count} evidence`
              : "No weak signal recorded."}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-background/45 p-3">
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Latest signal
          </div>
          <div className="mt-1 text-[13px] text-foreground">
            {signals[0]?.title || "No attention signal"}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {signals[0]?.detail || "Signals are derived from records, not AI guesses."}
          </div>
        </div>
      </div>
    </div>
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
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

function ResourceChunkStatusChip({ status }: { status: ResourceTextChunkStatus }) {
  const classes =
    status === "approved"
      ? "border-success/40 bg-success/12 text-success"
      : status === "rejected"
        ? "border-border bg-background/45 text-muted-foreground"
        : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  const classes =
    status === "assigned"
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : status === "recommended"
          ? "border-info/40 bg-info/12 text-info"
          : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function AssignmentRecipientChip({ status }: { status: AssignmentRecipient["status"] }) {
  const classes =
    status === "complete"
      ? "border-success/40 bg-success/12 text-success"
      : status === "submitted"
        ? "border-info/40 bg-info/12 text-info"
        : status === "returned"
          ? "border-warning/40 bg-warning/12 text-warning"
          : "border-border bg-background/45 text-muted-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

function AssessmentStatusChip({ status }: { status: AssessmentStatus }) {
  const classes =
    status === "published"
      ? "border-success/40 bg-success/12 text-success"
      : status === "archived"
        ? "border-border bg-background/45 text-muted-foreground"
        : "border-warning/40 bg-warning/12 text-warning";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status}
    </span>
  );
}

function AssessmentRecipientChip({ status }: { status: AssessmentRecipient["status"] }) {
  const classes =
    status === "complete"
      ? "border-success/40 bg-success/12 text-success"
      : status === "submitted"
        ? "border-info/40 bg-info/12 text-info"
        : status === "started"
          ? "border-info/40 bg-info/12 text-info"
          : status === "returned"
            ? "border-warning/40 bg-warning/12 text-warning"
            : "border-border bg-background/45 text-muted-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${classes}`}>
      {status.replace("_", " ")}
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

type ClassAnalytics = {
  startedSessions: number;
  completedSessions: number;
  completionRate: number | null;
  quizAttempts: number;
  averageQuizScore: number | null;
  assignedAssignments: number;
  submittedAssignments: number;
  assignmentSubmissionRate: number | null;
  resourceShown: number;
  resourceOpened: number;
  resourceEngagementRate: number | null;
};

type StudentAnalytics = {
  completionRate: number | null;
  averageQuizScore: number | null;
  resourceOpened: number;
};

type MasteryHeatmapRow = {
  skill: string;
  averageScore: number;
  students: number;
  evidence: number;
  secure: number;
  developing: number;
  emerging: number;
};

type RiskSignal = {
  studentId: string;
  kind:
    | "intervention"
    | "quiz_miss"
    | "failed_attempt"
    | "retry"
    | "low_mastery"
    | "assignment"
    | "no_activity";
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
  sourceId: string;
};

function classAnalyticsFor(dashboard: TeacherDashboardData, studentIds: string[]): ClassAnalytics {
  const students = new Set(studentIds);
  const sessions = dashboard.sessions.filter((session) => students.has(session.user_id));
  const completedSessions = sessions.filter((session) => session.status === "complete");
  const quizAttempts = dashboard.quizAttempts.filter((attempt) => students.has(attempt.user_id));
  const scoredQuizAttempts = quizAttempts.filter((attempt) => typeof attempt.score === "number");
  const recipients = dashboard.assignmentRecipients.filter((recipient) =>
    students.has(recipient.user_id),
  );
  const submittedAssignments = recipients.filter((recipient) => {
    const hasSubmission = dashboard.assignmentSubmissions.some(
      (submission) =>
        submission.assignment_id === recipient.assignment_id &&
        submission.user_id === recipient.user_id,
    );
    return hasSubmission || recipient.status === "submitted" || recipient.status === "complete";
  });
  const resourceInteractions = dashboard.resourceInteractions.filter((interaction) =>
    students.has(interaction.user_id),
  );
  const shown = resourceInteractions.filter((interaction) => interaction.event_type === "shown");
  const opened = resourceInteractions.filter((interaction) =>
    ["opened", "played", "completed", "downloaded"].includes(interaction.event_type),
  );

  return {
    startedSessions: sessions.length,
    completedSessions: completedSessions.length,
    completionRate: ratio(completedSessions.length, sessions.length),
    quizAttempts: quizAttempts.length,
    averageQuizScore: scoredQuizAttempts.length
      ? scoredQuizAttempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) /
        scoredQuizAttempts.length
      : null,
    assignedAssignments: recipients.length,
    submittedAssignments: submittedAssignments.length,
    assignmentSubmissionRate: ratio(submittedAssignments.length, recipients.length),
    resourceShown: shown.length,
    resourceOpened: opened.length,
    resourceEngagementRate: ratio(opened.length, shown.length),
  };
}

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

function masteryRowsForClass(
  dashboard: TeacherDashboardData,
  studentIds: string[],
): MasteryHeatmapRow[] {
  const students = new Set(studentIds);
  const bySkill = new Map<string, StudentMastery[]>();
  dashboard.mastery
    .filter((item) => students.has(item.user_id))
    .forEach((item) => {
      const rows = bySkill.get(item.skill_key) || [];
      rows.push(item);
      bySkill.set(item.skill_key, rows);
    });

  return Array.from(bySkill.entries())
    .map(([skill, rows]) => {
      const averageScore = rows.reduce((sum, row) => sum + Number(row.score || 0), 0) / rows.length;
      return {
        skill,
        averageScore,
        students: rows.length,
        evidence: rows.reduce((sum, row) => sum + Number(row.evidence_count || 0), 0),
        secure: rows.filter((row) => Number(row.score || 0) >= 0.85).length,
        developing: rows.filter((row) => {
          const score = Number(row.score || 0);
          return score >= 0.55 && score < 0.85;
        }).length,
        emerging: rows.filter((row) => Number(row.score || 0) < 0.55).length,
      };
    })
    .sort((a, b) => a.averageScore - b.averageScore || b.evidence - a.evidence)
    .slice(0, 8);
}

function riskSignalsForClass(
  dashboard: TeacherDashboardData,
  studentIds: string[],
  lessonsById: Map<string, Lesson>,
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const seen = new Set<string>();
  const add = (signal: RiskSignal) => {
    const key = `${signal.studentId}-${signal.kind}-${signal.sourceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(signal);
  };

  for (const studentId of studentIds) {
    const sessions = dashboard.sessions.filter((session) => session.user_id === studentId);
    if (!sessions.length) {
      add({
        studentId,
        kind: "no_activity",
        title: "No lesson activity yet",
        detail: "Student has not started a tracked lesson.",
        severity: "low",
        sourceId: "no-session",
      });
    }

    dashboard.interventionAlerts
      .filter(
        (alert) =>
          alert.student_id === studentId &&
          (alert.status === "open" || alert.status === "acknowledged"),
      )
      .forEach((alert) => add(interventionSignal(alert)));

    sessions
      .filter((session) => session.status === "needs_retry" || session.status === "needs_rescue")
      .forEach((session) =>
        add({
          studentId,
          kind: "retry",
          title: session.status === "needs_rescue" ? "Rescue path active" : "Retry path active",
          detail: `${lessonName(lessonsById, session.lesson_id)} is ${session.stage}.`,
          severity: session.status === "needs_rescue" ? "high" : "medium",
          sourceId: session.id,
        }),
      );

    dashboard.quizAttempts
      .filter((attempt) => attempt.user_id === studentId && attempt.passed === false)
      .slice(0, 2)
      .forEach((attempt) =>
        add({
          studentId,
          kind: "quiz_miss",
          title: "Quiz checkpoint missed",
          detail: `${lessonName(lessonsById, attempt.lesson_id)} · score ${formatScore(
            attempt.score,
          )}`,
          severity: "medium",
          sourceId: attempt.id,
        }),
      );

    dashboard.attempts
      .filter((attempt) => attempt.user_id === studentId && attempt.passed === false)
      .slice(0, 2)
      .forEach((attempt) =>
        add({
          studentId,
          kind: "failed_attempt",
          title: "Lesson attempt did not pass",
          detail: `${lessonName(lessonsById, attempt.lesson_id)} · ${attempt.answer_mode}`,
          severity: attempt.answer_mode === "code" ? "medium" : "low",
          sourceId: attempt.id,
        }),
      );

    dashboard.mastery
      .filter((item) => item.user_id === studentId && Number(item.score || 0) < 0.55)
      .slice(0, 2)
      .forEach((item) =>
        add({
          studentId,
          kind: "low_mastery",
          title: "Low skill mastery",
          detail: `${item.skill_key} · ${formatPercent(Number(item.score || 0))}`,
          severity: "medium",
          sourceId: item.skill_key,
        }),
      );

    dashboard.assignmentRecipients
      .filter((recipient) => {
        if (recipient.user_id !== studentId) return false;
        if (recipient.status === "submitted" || recipient.status === "complete") return false;
        return dashboard.assignments.some((assignment) => {
          return assignment.id === recipient.assignment_id && assignment.status === "assigned";
        });
      })
      .slice(0, 2)
      .forEach((recipient) => {
        const assignment = dashboard.assignments.find(
          (item) => item.id === recipient.assignment_id,
        );
        add({
          studentId,
          kind: "assignment",
          title: "Assigned work not submitted",
          detail: assignment?.title || "Assignment is still open.",
          severity: "low",
          sourceId: recipient.id,
        });
      });
  }

  return signals.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function interventionSignal(alert: InterventionAlert): RiskSignal {
  return {
    studentId: alert.student_id,
    kind: "intervention",
    title: alert.title || "Teacher intervention alert",
    detail: alert.message || `${alert.alert_type} · ${alert.status}`,
    severity: alert.severity || "medium",
    sourceId: alert.id,
  };
}

type ClassAttention = {
  alerts: number;
  pendingGrading: number;
  tone: "danger" | "warning" | "ok";
};

// Per-class "what needs me" signal for the card health badge: open intervention
// alerts (worst), then submissions waiting to be graded, else clear.
function classAttention(dashboard: TeacherDashboardData, classId: string): ClassAttention {
  const alerts = dashboard.interventionAlerts.filter(
    (alert) =>
      alert.class_id === classId && (alert.status === "open" || alert.status === "acknowledged"),
  ).length;
  const classAssignmentIds = new Set(
    dashboard.assignments.filter((a) => a.class_id === classId).map((a) => a.id),
  );
  const pendingGrading = dashboard.assignmentSubmissions.filter(
    (s) => s.status === "submitted" && classAssignmentIds.has(s.assignment_id),
  ).length;
  const tone = alerts > 0 ? "danger" : pendingGrading > 0 ? "warning" : "ok";
  return { alerts, pendingGrading, tone };
}

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
        ? "border-success/40 bg-success/12 text-success"
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
    return "border-success/40 bg-success/12 text-success";
  }
  if (status === "Active") {
    return "border-info/40 bg-info/12 text-info";
  }
  if (status === "Retry") {
    return "border-warning/40 bg-warning/12 text-warning";
  }
  return "border-border bg-background/45 text-muted-foreground";
}

function severityClass(severity: "low" | "medium" | "high") {
  if (severity === "high") return "border-danger/35 bg-danger/10 text-danger";
  if (severity === "medium") return "border-warning/40 bg-warning/12 text-warning";
  return "border-info/40 bg-info/12 text-info";
}

function severityRank(severity: "low" | "medium" | "high") {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function masteryBarClass(score: number) {
  if (score >= 0.85) return "bg-success";
  if (score >= 0.55) return "bg-warning";
  return "bg-danger";
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

function inputModalityFromPayload(
  payload: Record<string, unknown> | null | undefined,
): ChatInputModality | null {
  const modality = payload?.input_modality;
  return modality === "typed" || modality === "dictated" || modality === "audio_session"
    ? modality
    : null;
}

function modalityLabel(modality: ChatInputModality | null | undefined) {
  if (modality === "dictated") return "Dictated - ";
  if (modality === "audio_session") return "Voice - ";
  return "";
}

function statusLabel(session: LearningSession) {
  return `${session.status} - ${session.stage} - score ${formatScore(session.score)}`;
}

function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) return "n/a";
  if (score <= 1) return `${Math.round(score * 100)}%`;
  return `${Math.round(score)}%`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return null;
  return numerator / denominator;
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
