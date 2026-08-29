/**
 * One student, read end to end.
 *
 * Where they are, what they have finished, what they got wrong, and the
 * teacher's own note on them - assembled from the same dashboard payload the
 * rooms read, so nothing here can disagree with the class view.
 */
import { useState } from "react";
import {
  Tabs,
  WorkspacePanel,
  WorkspaceTab,
  WorkspaceTabList,
} from "@/components/WorkspaceTabs";
import {
  displayName,
  formatDateTime,
  formatScore,
  lessonName,
} from "@/features/teacher/classShared";
import {
  EmptyInline,
  MiniMetric,
  Panel,
  SessionChipGroup,
} from "@/features/teacher/console/chrome";
import {
  formatPercent,
  inputModalityFromPayload,
  statusLabel,
  studentAnalyticsFor,
} from "@/features/teacher/console/derive";
import type { StudentSummary } from "@/features/teacher/console/derive";
import { lessonStatusClass, sessionProgressStatus } from "@/features/teacher/lessonStatus";
import type {
  LearningSession,
  Lesson,
  LiveSessionViewer,
  Profile,
  TeacherDashboardData,
  TeacherNote,
} from "@/lib/types";
import {
  BarChart3,
  Eye,
  EyeOff,
  GraduationCap,
  MessageSquare,
  NotebookText,
  Pause,
  Play,
  Send,
} from "lucide-react";

export function StudentDetail({
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

export function StudentAnalyticsPanel({
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
