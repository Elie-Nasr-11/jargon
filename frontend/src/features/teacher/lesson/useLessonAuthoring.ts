/**
 * Everything one lesson needs, and every write that changes it.
 *
 * The Lesson screen is the HOME of a lesson (Law 1): it loads the authoring
 * payload itself rather than being handed props by whatever pane happened to
 * mount it. Edits apply to the cached payload first — the pure transforms in
 * authoring/localState.ts — so the screen responds at once, and only resync on
 * failure. Structural work that we cannot reconstruct locally (a bulk step
 * apply, a lesson move) runs and refetches.
 */
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createArtifactResource,
  deleteCurriculumNode,
  deleteCurriculumStep,
  generateCurriculumDraft,
  getSession,
  invokeCurriculumAdmin,
  moveCurriculumLesson,
  reorderCurriculumSteps,
  saveCurriculumLessonMeta,
  updateLessonResource,
  upsertCurriculumStep,
} from "@/lib/api";
import { notifyErr } from "@/lib/feedback";
import { useUndoable } from "@/hooks/useUndoable";
import { useAuthoringData } from "@/features/teacher/authoring/useAuthoringData";
import {
  insertStepLocal,
  patchResourceLocal,
  patchStepLocal,
  reorderStepsLocal,
  swapStepId,
} from "@/features/teacher/authoring/localState";
import { stepInputFromDraft } from "@/features/teacher/authoring/stepModel";
import type {
  ArtifactApprovePayload,
  ArtifactGenArgs,
  StepsGenArgs,
} from "@/features/teacher/authoring/types";
import type {
  CurriculumAdminResponse,
  CurriculumAuthoringData,
  CurriculumLessonMetaInput,
  CurriculumMilestoneInput,
  CurriculumStepDraft,
  CurriculumStepInput,
} from "@/lib/types";

export type LessonAuthoring = ReturnType<typeof useLessonAuthoring>;

export function useLessonAuthoring(classId: string, lessonId: string) {
  const queryClient = useQueryClient();
  const undoable = useUndoable();
  const authoring = useAuthoringData(classId);
  const { data, patch, resync, optimistic, classSummary } = authoring;
  const key = useMemo(
    () => ["curriculumAuthoring", authoring.teacherId] as const,
    [authoring.teacherId],
  );
  // The lesson's own writes report through the shared runner.
  const reloading = useCallback(
    (run: (accessToken: string) => Promise<unknown>, failure: string) =>
      authoring.reloading(run, failure),
    [authoring],
  );

  const lesson = useMemo(
    () => data?.lessons.find((row) => row.id === lessonId) ?? null,
    [data, lessonId],
  );
  const milestone = useMemo(
    () => data?.milestones.find((row) => row.lesson_id === lessonId) ?? null,
    [data, lessonId],
  );
  const steps = useMemo(
    () =>
      (data?.activities ?? [])
        .filter((activity) => activity.lesson_id === lessonId)
        .sort((a, b) => a.position - b.position),
    [data, lessonId],
  );
  const materials = useMemo(
    () =>
      (data?.resources ?? []).filter(
        (resource) => resource.lesson_id === lessonId && resource.status !== "archived",
      ),
    [data, lessonId],
  );
  const unit = useMemo(
    () => data?.units.find((row) => row.id === lesson?.unit_id) ?? null,
    [data, lesson],
  );
  const bookPages = useMemo(
    () => new Map(Object.entries(data?.bookPages || {})),
    [data?.bookPages],
  );
  const quizFor = useCallback(
    (activityId: string) =>
      data?.quizzes.find((quiz) => quiz.activity_id === activityId && quiz.status !== "archived") ??
      null,
    [data],
  );

  const saveMeta = useCallback(
    (meta: CurriculumLessonMetaInput, milestoneInput: CurriculumMilestoneInput) => {
      const existing = milestone;
      const run = (accessToken: string) =>
        saveCurriculumLessonMeta({
          accessToken,
          classId,
          lessonId,
          meta,
          milestone: milestoneInput,
        });
      // A FIRST save has no milestone row yet — the server assigns its id, so that one
      // takes the refetch path. Every later save is a pure patch and stays instant.
      if (!existing) {
        void reloading(run, "Could not save the lesson.");
        return;
      }
      optimistic(
        (current) => ({
          ...current,
          lessons: current.lessons.map((row) =>
            row.id === lessonId
              ? {
                  ...row,
                  title: meta.title,
                  level: meta.level,
                  tutor_prompt: meta.tutor_prompt,
                  help_ceiling: meta.help_ceiling ?? row.help_ceiling,
                  require_attempt_first: meta.require_attempt_first,
                  final_answer_policy: meta.final_answer_policy ?? row.final_answer_policy,
                  tutor_tone: meta.tutor_tone,
                  tutor_pace: meta.tutor_pace,
                  grade_band: meta.grade_band,
                  allow_live_artifacts: meta.allow_live_artifacts,
                }
              : row,
          ),
          milestones: current.milestones.map((row) =>
            row.id === existing.id
              ? {
                  ...row,
                  title: meta.title,
                  objective: milestoneInput.objective,
                  level: meta.level,
                  skill_keys: milestoneInput.skill_keys,
                  allowed_response_modes: milestoneInput.allowed_response_modes,
                }
              : row,
          ),
        }),
        run,
        { failure: "Could not save the lesson." },
      );
    },
    [milestone, classId, lessonId, optimistic, reloading],
  );

  const upsertStep = useCallback(
    (step: CurriculumStepInput) => {
      const run = (accessToken: string) =>
        upsertCurriculumStep({ accessToken, classId, lessonId, step });
      if (step.id) {
        optimistic((current) => patchStepLocal(current, lessonId, step), run, {
          failure: "Could not save the step.",
        });
        return;
      }
      // A new step appears at once under a temporary id, then takes the id the server
      // assigns so the next edit targets the right row.
      const tempId = `temp-step-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      optimistic((current) => insertStepLocal(current, lessonId, step, tempId), run, {
        failure: "Could not add the step.",
        onSuccess: (result) => {
          const realId = (result as { id?: string } | null)?.id;
          if (realId && realId !== tempId) patch((current) => swapStepId(current, tempId, realId));
        },
      });
    },
    [classId, lessonId, optimistic, patch],
  );

  const reorderSteps = useCallback(
    (orderedIds: string[]) =>
      optimistic(
        (current) => reorderStepsLocal(current, orderedIds),
        (accessToken) => reorderCurriculumSteps({ accessToken, classId, lessonId, orderedIds }),
        { failure: "Could not reorder the steps." },
      ),
    [classId, lessonId, optimistic],
  );

  const deleteStep = useCallback(
    (activityId: string) => {
      const remove = (current: CurriculumAuthoringData) => ({
        ...current,
        activities: current.activities.filter((row) => row.id !== activityId),
        quizzes: current.quizzes.filter((row) => row.activity_id !== activityId),
      });
      const snapshot = data;
      undoable({
        key: `delete-step:${activityId}`,
        message: "Step deleted.",
        optimistic: () => patch(remove),
        revert: () => {
          if (snapshot) queryClient.setQueryData<CurriculumAuthoringData>(key, snapshot);
        },
        commit: () => {
          void (async () => {
            try {
              const session = await getSession();
              if (!session) throw new Error("Sign in to edit this lesson.");
              await deleteCurriculumStep({
                accessToken: session.access_token,
                classId,
                lessonId,
                activityId,
              });
            } catch (error) {
              notifyErr(error, "Could not delete the step.");
              await resync();
            }
          })();
        },
      });
    },
    [data, undoable, patch, queryClient, key, classId, lessonId, resync],
  );

  const setPublication = useCallback(
    (action: "publish_lesson" | "archive_lesson") => {
      if (!classSummary || !lesson) return;
      const previous = lesson.publication_status ?? "draft";
      const next = action === "publish_lesson" ? "published" : "archived";
      const status = (value: typeof previous) => (current: CurriculumAuthoringData) => ({
        ...current,
        lessons: current.lessons.map((row) =>
          row.id === lessonId ? { ...row, publication_status: value } : row,
        ),
      });
      undoable({
        key: `publish:${lessonId}`,
        message: action === "publish_lesson" ? "Lesson published." : "Lesson archived.",
        optimistic: () => patch(status(next)),
        revert: () => patch(status(previous)),
        commit: () => {
          void (async () => {
            try {
              const session = await getSession();
              if (!session) throw new Error("Sign in to update publishing.");
              await invokeCurriculumAdmin({
                accessToken: session.access_token,
                action,
                organizationId: classSummary.organization_id,
                classId,
                lessonId,
              });
            } catch (error) {
              notifyErr(error, "Could not update publication status.");
              await resync();
            }
          })();
        },
      });
    },
    [classSummary, lesson, lessonId, classId, undoable, patch, resync],
  );

  const moveToUnit = useCallback(
    (targetUnitId: string) =>
      reloading(
        (accessToken) =>
          moveCurriculumLesson({ accessToken, classId, lessonId, targetUnitId }),
        "Could not move the lesson.",
      ),
    [classId, lessonId, reloading],
  );

  const deleteLesson = useCallback(
    () =>
      reloading(
        (accessToken) =>
          deleteCurriculumNode({ accessToken, classId, nodeType: "lesson", id: lessonId }),
        "Could not delete the lesson.",
      ),
    [classId, lessonId, reloading],
  );

  const bindMaterial = useCallback(
    (resourceId: string, activityId: string | null) =>
      optimistic(
        (current) => patchResourceLocal(current, resourceId, activityId),
        () => updateLessonResource(resourceId, { activity_id: activityId }),
        { failure: "Could not attach the material." },
      ),
    [optimistic],
  );

  const shareMaterial = useCallback(
    (resourceId: string) =>
      reloading(
        () => updateLessonResource(resourceId, { visibility: "class_private", student_id: null }),
        "Could not share the activity.",
      ),
    [reloading],
  );

  const generateSteps = useCallback(
    async (args: StepsGenArgs): Promise<CurriculumStepDraft[] | null> => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to use AI authoring.");
        const result = await generateCurriculumDraft({
          accessToken: session.access_token,
          classId,
          mode: "lesson_steps",
          lessonId,
          prompt: args.prompt,
          referenceText: args.referenceText,
          current: args.current ? { steps: args.current } : undefined,
          feedback: args.feedback,
          target: args.target,
        });
        return result.steps || [];
      } catch (error) {
        notifyErr(error, "Could not draft the steps.");
        return null;
      }
    },
    [classId, lessonId],
  );

  const applySteps = useCallback(
    (drafts: CurriculumStepDraft[]) =>
      reloading(async (accessToken) => {
        for (const draft of drafts) {
          await upsertCurriculumStep({
            accessToken,
            classId,
            lessonId,
            step: stepInputFromDraft(draft),
          });
        }
      }, "Could not add the drafted steps."),
    [classId, lessonId, reloading],
  );

  const generateArtifact = useCallback(
    async (args: ArtifactGenArgs): Promise<CurriculumAdminResponse | null> => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to use AI authoring.");
        return await generateCurriculumDraft({
          accessToken: session.access_token,
          classId,
          mode: "artifact",
          lessonId,
          artifactKind: args.kind,
          brief: args.brief,
          feedback: args.feedback,
          current: args.current,
        });
      } catch (error) {
        notifyErr(error, "Could not generate the activity.");
        return null;
      }
    },
    [classId, lessonId],
  );

  const approveArtifact = useCallback(
    (activityId: string, payload: ArtifactApprovePayload) =>
      reloading(async () => {
        const session = await getSession();
        if (!session) throw new Error("Sign in to add an activity.");
        if (!classSummary) throw new Error("This lesson is not in one of your classes.");
        await createArtifactResource({
          teacherId: session.user.id,
          organizationId: classSummary.organization_id,
          classId,
          lessonId,
          activityId,
          title: payload.title,
          posterText: payload.posterText,
          kind: payload.kind,
          html: payload.html,
          deck: payload.deck,
        });
      }, "Could not add the activity."),
    [classSummary, classId, lessonId, reloading],
  );

  return {
    loading: authoring.loading,
    missing: Boolean(data) && !lesson,
    busy: authoring.busy,
    teacherId: authoring.teacherId,
    data,
    lesson,
    milestone,
    steps,
    materials,
    unit,
    classSummary,
    bookPages,
    quizFor,
    saveMeta,
    upsertStep,
    reorderSteps,
    deleteStep,
    setPublication,
    moveToUnit,
    deleteLesson,
    bindMaterial,
    shareMaterial,
    generateSteps,
    applySteps,
    generateArtifact,
    approveArtifact,
    resync,
  };
}
