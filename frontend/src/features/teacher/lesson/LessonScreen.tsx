/**
 * The Lesson screen: four sections, and nothing else.
 *
 * Rebuild brief, step 3. A lesson is what a teacher edits every day, so this
 * page holds exactly what that job needs — what the lesson is, its steps, the
 * work set on it, and the material it teaches from — and everything rarer sits
 * one deliberate click away in the header's menu.
 *
 * It is the HOME of a lesson: it loads its own data and owns its own writes, so
 * a lesson has one address, one editor, and one Save.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, Eye, Settings2, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell } from "@/components/PageShell";
import { RouteLoader } from "@/components/RouteLoader";
import { TeacherShell } from "@/features/teacher/shell/TeacherShell";
import { KnowledgeCard } from "@/features/teacher/KnowledgeCard";
import { AiStepsPanel } from "@/features/teacher/authoring/generatePanels";
import { SelectInput } from "@/features/teacher/authoring/fields";
import { bookSourceFor, bookSourceLabel } from "@/features/teacher/bookSource";
import { AssessmentManager } from "@/features/teacher/console/AssessmentManager";
import { AssignmentManager } from "@/features/teacher/console/AssignmentManager";
import { ResourceManager } from "@/features/teacher/console/ResourceManager";
import type { AssessmentFormValues } from "@/features/teacher/console/AssessmentManager";
import type { AssignmentFormValues } from "@/features/teacher/console/AssignmentManager";
import type { ResourceFormValues } from "@/features/teacher/console/ResourceManager";
import { LessonHeader } from "@/features/teacher/lesson/LessonHeader";
import { LessonMaterials } from "@/features/teacher/lesson/LessonMaterials";
import { LessonPreview } from "@/features/teacher/lesson/LessonPreview";
import { LessonSettings } from "@/features/teacher/lesson/LessonSettings";
import { LessonSteps } from "@/features/teacher/lesson/LessonSteps";
import { LessonWork } from "@/features/teacher/lesson/LessonWork";
import { lessonWorkRows } from "@/features/teacher/lesson/lessonWork";
import { metaPayload, useLessonMeta } from "@/features/teacher/lesson/lessonMeta";
import { useLessonAuthoring } from "@/features/teacher/lesson/useLessonAuthoring";
import {
  createAssessment,
  createAssignment,
  createLessonResource,
  fetchTeacherDashboard,
  getSession,
} from "@/lib/api";
import { notifyErr } from "@/lib/feedback";
import type { ClassworkItem } from "@/features/teacher/authoring/types";
import type { Profile } from "@/lib/types";

export function LessonScreen({ classId, lessonId }: { classId: string; lessonId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authoring = useLessonAuthoring(classId, lessonId);
  const { lesson, milestone, steps, materials } = authoring;

  const dashboardQuery = useQuery({
    queryKey: ["teacherDashboard", authoring.teacherId],
    queryFn: () => fetchTeacherDashboard(authoring.teacherId as string),
    enabled: Boolean(authoring.teacherId),
    staleTime: 5 * 60 * 1000,
  });
  const dashboard = dashboardQuery.data ?? null;
  const refreshDashboard = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["teacherDashboard", authoring.teacherId] }),
    [queryClient, authoring.teacherId],
  );

  const meta = useLessonMeta(lesson, milestone);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [createOpen, setCreateOpen] = useState<"assignment" | "assessment" | "material" | null>(
    null,
  );
  // R48: work can BE a step. When it is created from one, the step id rides into the
  // dialog — otherwise the quiz a teacher made on step 4 would come back unattached.
  const [createForStep, setCreateForStep] = useState<string | null>(null);

  // Steps register their own dirty state and a flush; the header's Save runs them
  // all, then the lesson's own fields. One Save, whatever is open.
  const flushers = useRef(new Map<string, () => void>());
  const [stepDirty, setStepDirty] = useState<ReadonlySet<string>>(new Set());
  const registerDirty = useCallback((id: string, dirty: boolean, flush: () => void) => {
    flushers.current.set(id, flush);
    setStepDirty((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const unregisterDirty = useCallback((id: string) => {
    flushers.current.delete(id);
    setStepDirty((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const unsaved = stepDirty.size + (meta.dirty ? 1 : 0);
  const saveAll = useCallback(() => {
    setSaving(true);
    for (const id of stepDirty) flushers.current.get(id)?.();
    if (meta.dirty && meta.fields) {
      const { meta: metaInput, milestone: milestoneInput } = metaPayload(meta.fields);
      authoring.saveMeta(metaInput, milestoneInput);
      meta.markSaved();
    }
    setSaving(false);
  }, [stepDirty, meta, authoring]);

  const workItems: ClassworkItem[] = useMemo(() => {
    if (!dashboard) return [];
    return [
      ...dashboard.assignments
        .filter((row) => row.lesson_id === lessonId && row.status !== "archived")
        .map((row) => ({
          kind: "assignment" as const,
          id: row.id,
          lessonId: row.lesson_id,
          activityId: row.activity_id ?? null,
          title: row.title || "Assignment",
          status: row.status,
          dueAt: row.due_at,
          needsReviewCount: 0,
          submittedCount: 0,
        })),
      ...dashboard.assessments
        .filter((row) => row.lesson_id === lessonId && row.status !== "archived")
        .map((row) => ({
          kind: "assessment" as const,
          id: row.id,
          lessonId: row.lesson_id,
          activityId: row.activity_id ?? null,
          title: row.title || "Quiz",
          status: row.status,
          dueAt: row.due_at,
          needsReviewCount: 0,
          submittedCount: 0,
        })),
    ];
  }, [dashboard, lessonId]);

  const profilesById = useMemo(
    () => new Map((dashboard?.profiles ?? []).map((profile: Profile) => [profile.id, profile])),
    [dashboard],
  );
  const workRows = useMemo(
    () =>
      dashboard
        ? lessonWorkRows({
            lessonId,
            steps,
            assignments: dashboard.assignments,
            assignmentRecipients: dashboard.assignmentRecipients,
            assignmentSubmissions: dashboard.assignmentSubmissions,
            assessments: dashboard.assessments,
            assessmentRecipients: dashboard.assessmentRecipients,
            assessmentAttempts: dashboard.assessmentAttempts,
            profilesById,
          })
        : [],
    [dashboard, lessonId, steps, profilesById],
  );

  const classSummaryRow = useMemo(
    () => dashboard?.classes.find((row) => row.id === classId) ?? null,
    [dashboard, classId],
  );
  const studentIds = useMemo(
    () =>
      (dashboard?.memberships ?? [])
        .filter((row) => row.class_id === classId && row.role === "student")
        .map((row) => row.user_id),
    [dashboard, classId],
  );
  const classLessons = useMemo(
    () => (authoring.data?.lessons ?? []).filter((row) => row.id === lessonId),
    [authoring.data, lessonId],
  );
  const unitOptions = useMemo(
    () => (authoring.data?.units ?? []).map((unit) => ({ id: unit.id, title: unit.title })),
    [authoring.data],
  );

  const openWork = useCallback(
    (kind: "assignment" | "assessment", id: string) => {
      void navigate({
        to: "/teacher/class/$classId",
        params: { classId },
        search:
          kind === "assignment"
            ? { tab: "today", assignment: id }
            : { tab: "today", assessment: id },
      });
    },
    [navigate, classId],
  );

  if (authoring.loading) return <RouteLoader label="Opening the lesson…" />;
  if (!lesson || !meta.fields) {
    return (
      <PageShell title="Lesson not found" ariaLabel="Lesson not found">
        <p className="text-meta text-muted-foreground">
          This lesson is not in one of your classes, or it was deleted.
        </p>
      </PageShell>
    );
  }

  const bookLabel = bookSourceLabel(bookSourceFor(lesson, authoring.bookPages, lesson.id));

  return (
    <TeacherShell
      email={authoring.email}
      classes={authoring.data?.classes ?? []}
      activeView="class"
      activeClassId={classId}
      activeSection="content"
    >
      <PageShell
        widthClass="max-w-[1040px]"
        ariaLabel={`Lesson: ${lesson.title}`}
        onBack={() =>
          void navigate({
            to: "/teacher/class/$classId",
            params: { classId },
            search: { tab: "content" },
          })
        }
        backLabel={authoring.unit?.title || "Back to the course"}
      >
        <div className="grid gap-4">
          {/* The header sticks, so the band behind it has to be opaque — otherwise the
              steps scroll through the gap between the header card and the next one. */}
          <div className="sticky top-0 z-20 -mt-2 bg-background pb-2 pt-2">
            <LessonHeader
              lesson={lesson}
              fields={meta.fields}
              onField={meta.set}
              bookPages={authoring.bookPages}
              busy={authoring.busy}
              unsaved={unsaved}
              saving={saving}
              onSave={saveAll}
              onPublish={() => {
                saveAll();
                authoring.setPublication("publish_lesson");
              }}
              actions={[
                {
                  label: "Lesson settings…",
                  icon: Settings2,
                  onClick: () => setSettingsOpen(true),
                },
                { label: "Preview as a student", icon: Eye, onClick: () => setPreviewOpen(true) },
                {
                  label: "Ideas & vocabulary",
                  icon: BookOpen,
                  onClick: () => setKnowledgeOpen(true),
                },
                {
                  label: "Draft steps from a brief…",
                  icon: Sparkles,
                  onClick: () => setBriefOpen(true),
                },
                {
                  label: "Move to another unit…",
                  separatorBefore: true,
                  disabled: authoring.busy,
                  onClick: () => setMoveOpen(true),
                },
                {
                  label: "Archive",
                  icon: Archive,
                  disabled: authoring.busy,
                  onClick: () => authoring.setPublication("archive_lesson"),
                },
                {
                  label: "Delete lesson",
                  icon: Trash2,
                  tone: "danger",
                  separatorBefore: true,
                  disabled: authoring.busy,
                  onClick: () => setConfirmDelete(true),
                },
              ]}
            />
          </div>

          <LessonSteps
            lesson={lesson}
            objective={meta.fields.objective}
            steps={steps}
            materials={materials}
            workItems={workItems}
            authoring={authoring}
            busy={authoring.busy}
            onRegisterDirty={registerDirty}
            onUnregisterDirty={unregisterDirty}
            onOpenItem={(kind, id) => {
              if (kind !== "material") openWork(kind, id);
            }}
            onCreateForStep={(kind, ctx) => {
              setCreateForStep(ctx.activityId);
              setCreateOpen(kind);
            }}
          />

          <LessonWork
            rows={workRows}
            busy={authoring.busy}
            onOpen={openWork}
            onCreate={(kind) => setCreateOpen(kind)}
          />

          <LessonMaterials
            lessonId={lessonId}
            materials={materials}
            steps={steps}
            bookLabel={bookLabel}
            busy={authoring.busy}
            onAdd={() => setCreateOpen("material")}
            onOpen={() => setCreateOpen("material")}
          />
        </div>

        {confirmDelete ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-destructive/30 bg-depth-sub px-4 py-3">
            <span className="min-w-0 flex-1 text-meta text-muted-foreground">
              Delete this lesson? Lessons with learner activity can be archived but not deleted.
            </span>
            <button
              type="button"
              onClick={() => {
                void authoring.deleteLesson().then(() =>
                  navigate({
                    to: "/teacher/class/$classId",
                    params: { classId },
                    search: { tab: "content" },
                  }),
                );
              }}
              disabled={authoring.busy}
              className="btn btn-danger btn-sm"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </PageShell>

      <LessonSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        lessonId={lessonId}
        fields={meta.fields}
        onField={meta.set}
        busy={authoring.busy}
      />

      <Dialog open={previewOpen} onOpenChange={(open) => (open ? null : setPreviewOpen(false))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>How a student meets this lesson</DialogTitle>
          </DialogHeader>
          <LessonPreview
            lesson={lesson}
            milestone={milestone}
            steps={steps}
            quizFor={authoring.quizFor}
            bookPages={authoring.bookPages}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={knowledgeOpen} onOpenChange={(open) => (open ? null : setKnowledgeOpen(false))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Ideas &amp; vocabulary</DialogTitle>
          </DialogHeader>
          <p className="mb-3 text-meta text-muted-foreground">
            Drafted from this lesson when it publishes, and read by the student&apos;s brain map.
            Nothing here is something you have to fill in.
          </p>
          <KnowledgeCard lessonId={lessonId} />
        </DialogContent>
      </Dialog>

      <Dialog open={briefOpen} onOpenChange={(open) => (open ? null : setBriefOpen(false))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Draft steps from a brief</DialogTitle>
          </DialogHeader>
          <AiStepsPanel
            busy={authoring.busy}
            resources={materials}
            onGenerate={authoring.generateSteps}
            onApply={(drafts) => {
              authoring.applySteps(drafts);
              setBriefOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={(open) => (open ? null : setMoveOpen(false))}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Move this lesson</DialogTitle>
          </DialogHeader>
          <SelectInput
            label="Unit"
            value={lesson.unit_id || ""}
            options={unitOptions.map((unit) => unit.id)}
            optionLabels={Object.fromEntries(unitOptions.map((unit) => [unit.id, unit.title]))}
            onChange={(value) => {
              setMoveOpen(false);
              if (value && value !== lesson.unit_id) void authoring.moveToUnit(value);
            }}
          />
        </DialogContent>
      </Dialog>

      {classSummaryRow ? (
        <>
          <Dialog
            open={createOpen === "assignment"}
            onOpenChange={(open) => {
              if (open) return;
              setCreateOpen(null);
              setCreateForStep(null);
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>New assignment on this lesson</DialogTitle>
              </DialogHeader>
              <AssignmentManager
                classSummary={classSummaryRow}
                lessons={classLessons}
                resources={materials}
                studentIds={studentIds}
                profilesById={profilesById}
                saving={authoring.busy}
                context={{ lessonId, activityId: createForStep }}
                onSaveAssignment={async (input: AssignmentFormValues) => {
                  try {
                    const session = await getSession();
                    if (!session) throw new Error("Sign in to set work.");
                    await createAssignment({
                      teacherId: session.user.id,
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
                    await refreshDashboard();
                    setCreateOpen(null);
                    setCreateForStep(null);
                  } catch (error) {
                    notifyErr(error, "Could not create the assignment.");
                  }
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog
            open={createOpen === "assessment"}
            onOpenChange={(open) => {
              if (open) return;
              setCreateOpen(null);
              setCreateForStep(null);
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>New quiz on this lesson</DialogTitle>
              </DialogHeader>
              <AssessmentManager
                classSummary={classSummaryRow}
                lessons={classLessons}
                quizItems={[]}
                studentIds={studentIds}
                profilesById={profilesById}
                saving={authoring.busy}
                context={{ lessonId, activityId: createForStep }}
                onSaveAssessment={async (input: AssessmentFormValues) => {
                  try {
                    if (!(await getSession())) throw new Error("Sign in to set work.");
                    await createAssessment({
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
                    await refreshDashboard();
                    setCreateOpen(null);
                    setCreateForStep(null);
                  } catch (error) {
                    notifyErr(error, "Could not create the quiz.");
                  }
                }}
              />
            </DialogContent>
          </Dialog>

          <ResourceManager
            classSummary={classSummaryRow}
            lessons={classLessons}
            saving={authoring.busy}
            open={createOpen === "material"}
            resource={null}
            onSaveResource={async (input: ResourceFormValues) => {
              try {
                const session = await getSession();
                if (!session) throw new Error("Sign in to add material.");
                await createLessonResource({
                  teacherId: session.user.id,
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
                await authoring.resync();
                setCreateOpen(null);
              } catch (error) {
                notifyErr(error, "Could not add the material.");
              }
            }}
            onUpdateResource={() => void authoring.resync()}
            onClose={() => setCreateOpen(null)}
          />
        </>
      ) : null}
    </TeacherShell>
  );
}
