/**
 * One lesson's editable fields, in one place.
 *
 * The header edits two of them (title, objective) and the settings dialog edits
 * the rest, but a lesson saves as ONE payload — so both read and write the same
 * state and there is exactly one Save. Nothing here talks to the server.
 */
import { useEffect, useMemo, useState } from "react";
import { parseLessonKind } from "@/features/teacher/authoring/localState";
import type { LessonKind, ResponseMode } from "@/features/teacher/authoring/types";
import type {
  CurriculumLessonMetaInput,
  CurriculumMilestone,
  CurriculumMilestoneInput,
  Lesson,
} from "@/lib/types";

export type LessonMetaFields = {
  title: string;
  objective: string;
  level: string;
  lessonType: LessonKind;
  tutorPrompt: string;
  skillKeys: string;
  allowedModes: ResponseMode[];
  helpCeiling: string;
  requireAttemptFirst: boolean;
  finalAnswerPolicy: string;
  tutorTone: string;
  tutorPace: string;
  gradeBand: string;
  allowLiveArtifacts: boolean;
};

function fieldsFrom(lesson: Lesson, milestone: CurriculumMilestone | null): LessonMetaFields {
  return {
    title: lesson.title,
    objective: milestone?.objective || "",
    level: lesson.level || "Any level",
    lessonType: parseLessonKind(lesson.curriculum_metadata?.lesson_type) || "discussion",
    tutorPrompt: lesson.tutor_prompt || "",
    skillKeys: (milestone?.skill_keys || []).join(", "),
    allowedModes: milestone?.allowed_response_modes?.length
      ? milestone.allowed_response_modes
      : ["text"],
    helpCeiling: lesson.help_ceiling || "guided",
    requireAttemptFirst: lesson.require_attempt_first !== false,
    finalAnswerPolicy: lesson.final_answer_policy || "after_attempt",
    tutorTone: lesson.tutor_tone || "",
    tutorPace: lesson.tutor_pace || "",
    gradeBand: lesson.grade_band || "",
    allowLiveArtifacts: lesson.allow_live_artifacts === true,
  };
}

export function metaPayload(fields: LessonMetaFields): {
  meta: CurriculumLessonMetaInput;
  milestone: CurriculumMilestoneInput;
} {
  return {
    meta: {
      title: fields.title.trim() || "Untitled lesson",
      level: fields.level.trim() || "Any level",
      lesson_type: fields.lessonType,
      tutor_prompt: fields.tutorPrompt.trim(),
      help_ceiling: fields.helpCeiling as CurriculumLessonMetaInput["help_ceiling"],
      require_attempt_first: fields.requireAttemptFirst,
      final_answer_policy:
        fields.finalAnswerPolicy as CurriculumLessonMetaInput["final_answer_policy"],
      tutor_tone: fields.tutorTone,
      tutor_pace: fields.tutorPace,
      grade_band: fields.gradeBand,
      allow_live_artifacts: fields.allowLiveArtifacts,
    },
    milestone: {
      objective: fields.objective.trim(),
      skill_keys: fields.skillKeys
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      allowed_response_modes: fields.allowedModes,
    },
  };
}

export function useLessonMeta(lesson: Lesson | null, milestone: CurriculumMilestone | null) {
  const initial = useMemo(
    () => (lesson ? fieldsFrom(lesson, milestone) : null),
    // Re-seed only when the lesson identity changes: a background refetch must not
    // overwrite what the teacher is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lesson?.id],
  );
  const [fields, setFields] = useState<LessonMetaFields | null>(initial);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setFields(initial);
    setDirty(false);
  }, [initial]);

  const set = <K extends keyof LessonMetaFields>(field: K, value: LessonMetaFields[K]) => {
    setFields((current) => (current ? { ...current, [field]: value } : current));
    setDirty(true);
  };

  return { fields, set, dirty, markSaved: () => setDirty(false) };
}
