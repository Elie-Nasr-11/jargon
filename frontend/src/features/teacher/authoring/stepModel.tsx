/**
 * The step model: what kinds of step exist, what each learning mode means, and
 * how a draft becomes a saved step.
 *
 * The lesson editor, the step card and the AI panels all read from here, so the
 * tables live in one place rather than being re-derived per surface.
 */
import type { ReactNode } from "react";
import { BookOpen, ListChecks, NotebookPen, Sparkles } from "lucide-react";
import type {
  CurriculumStepDraft,
  CurriculumStepInput,
  CurriculumStepKind,
  LearningMode,
  LessonActivity,
} from "@/lib/types";
import type { ResponseMode } from "@/features/teacher/authoring/types";

export const STEP_KINDS: Array<{
  kind: CurriculumStepKind;
  label: string;
  stage: CurriculumStepInput["stage"];
  activityType: CurriculumStepInput["activity_type"];
  responseMode: ResponseMode;
  icon: ReactNode;
  promptLabel: string;
}> = [
  {
    kind: "teach",
    label: "Teach",
    stage: "teach",
    activityType: "discussion",
    responseMode: "text",
    icon: <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "What the mentor explains",
  },
  {
    kind: "practice",
    label: "Practice",
    stage: "practice",
    activityType: "discussion",
    responseMode: "text",
    icon: <NotebookPen className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "Practice prompt",
  },
  {
    kind: "checkpoint",
    label: "Checkpoint",
    stage: "assessment",
    activityType: "multiple_choice",
    responseMode: "multiple_choice",
    icon: <ListChecks className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "Question",
  },
  {
    kind: "reflect",
    label: "Reflect",
    stage: "review",
    activityType: "reflection",
    responseMode: "text",
    icon: <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />,
    promptLabel: "Reflection prompt",
  },
];

export function stepKindConfig(kind: CurriculumStepKind) {
  return STEP_KINDS.find((item) => item.kind === kind) || STEP_KINDS[1];
}

// v4 learning modes (docs/PLATFORM.md): the authoring vocabulary. Each mode maps onto the
// legacy kind system for icons/grouping; stage is a display label, gates live in mode.
export const MODE_META: Array<{
  mode: LearningMode;
  label: string;
  kind: CurriculumStepKind;
  stage: CurriculumStepInput["stage"];
  activityType: CurriculumStepInput["activity_type"];
  responseMode: ResponseMode;
  defaultType: string;
  promptLabel: string;
  defaultPrompt: string;
}> = [
  {
    mode: "explanation",
    label: "Explain",
    kind: "teach",
    stage: "teach",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "The material the mentor teaches (stated outright)",
    defaultPrompt: "Teach this idea plainly with one concrete example.",
  },
  {
    mode: "media",
    label: "Media",
    kind: "teach",
    stage: "teach",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "How to frame the attached resource(s)",
    defaultPrompt: "Study the attached material, then come back when you're ready.",
  },
  {
    mode: "reflection",
    label: "Reflect",
    kind: "reflect",
    stage: "practice",
    activityType: "reflection",
    responseMode: "text",
    defaultType: "",
    promptLabel: "Reflection prompt (student produces the conclusion)",
    defaultPrompt: "Explain the idea in your own words.",
  },
  {
    mode: "practice",
    label: "Practice",
    kind: "practice",
    stage: "practice",
    activityType: "code",
    responseMode: "code",
    defaultType: "code",
    promptLabel: "Practice prompt",
    defaultPrompt: "Try this, then explain your thinking.",
  },
  {
    mode: "assignment",
    label: "Assignment",
    kind: "teach",
    stage: "practice",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "How to frame the assigned task (lives in the work dock)",
    defaultPrompt: "Introduce the assigned task and point the student to it.",
  },
  {
    mode: "inquiry",
    label: "Inquiry",
    kind: "reflect",
    stage: "practice",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "",
    promptLabel: "Topic to invite questions about",
    defaultPrompt: "What questions do you have about this topic?",
  },
  {
    mode: "assessment",
    label: "Assess",
    kind: "checkpoint",
    stage: "assessment",
    activityType: "multiple_choice",
    responseMode: "multiple_choice",
    defaultType: "mcq",
    promptLabel: "Question",
    defaultPrompt: "Which option is correct?",
  },
  {
    mode: "revision",
    label: "Revise",
    kind: "reflect",
    stage: "review",
    activityType: "discussion",
    responseMode: "text",
    defaultType: "recall",
    promptLabel: "What to recall (prior skills; full behavior arrives in a later update)",
    defaultPrompt: "Let's revisit what you learned earlier.",
  },
];

export function modeMeta(mode: LearningMode) {
  return MODE_META.find((item) => item.mode === mode) || MODE_META[3];
}

// Per-mode accent hue for the 8-mode StepCard picker and step rows — the --mode-* custom
// props from styles.css (the same family the student TurnMode skin reads; see
// src/student/turnModes.ts for that mapping). Authoring modes map onto the nearest student
// hue: explanation→lesson, assessment→quiz, revision→checkpoints, inquiry→open; media gets
// its own authoring-only --mode-media token.
export const MODE_ACCENT: Record<LearningMode, string> = {
  explanation: "--mode-lesson",
  media: "--mode-media",
  reflection: "--mode-discuss",
  practice: "--mode-practice",
  assignment: "--mode-assignment",
  inquiry: "--mode-open",
  assessment: "--mode-quiz",
  revision: "--mode-checkpoints",
};

export function modeAccentStyle(mode: LearningMode | "legacy" | null | undefined) {
  if (!mode || mode === "legacy") return undefined;
  return { ["--mode-accent" as string]: `var(${MODE_ACCENT[mode]})` };
}

// mode_type pinning mirrors the backend: practice code|applied, assessment mcq|open_ended.
export function pinnedShapeFor(mode: LearningMode, modeType: string) {
  const meta = modeMeta(mode);
  if (mode === "practice" && modeType === "applied") {
    return { ...meta, activityType: "discussion" as const, responseMode: "text" as const };
  }
  if (mode === "assessment" && modeType === "open_ended") {
    return {
      ...meta,
      activityType: "discussion" as const,
      responseMode: "text" as const,
      kind: "reflect" as const,
    };
  }
  return meta;
}

export function kindOfActivity(activity: LessonActivity): CurriculumStepKind {
  if (activity.mode) return pinnedShapeFor(activity.mode, activity.mode_type || "").kind;
  if (activity.response_mode === "multiple_choice") return "checkpoint";
  if (activity.stage === "teach" || activity.stage === "intro") return "teach";
  if (activity.stage === "review" || activity.activity_type === "reflection") return "reflect";
  return "practice";
}

export function defaultStepForMode(mode: LearningMode): CurriculumStepInput {
  const meta = modeMeta(mode);
  const base: CurriculumStepInput = {
    title: meta.label,
    stage: meta.stage,
    activity_type: meta.activityType,
    response_mode: meta.responseMode,
    prompt: meta.defaultPrompt,
    mode,
    mode_type: meta.defaultType || null,
  };
  if (mode === "assessment") {
    base.choices = [
      { id: "a", text: "Option A" },
      { id: "b", text: "Option B" },
    ];
    base.quiz = {
      prompt: "Which option is correct?",
      choices: [
        { id: "a", text: "Option A" },
        { id: "b", text: "Option B" },
      ],
      correct_choice_ids: ["a"],
    };
  }
  return base;
}

// R57: one queued lesson in a whole-course build, and the run that owns them.
export type CourseBuildItem = {
  unitId: string;
  unitTitle: string;
  lessonTitle: string;
  /** This lesson's slice of the upload (see sliceMaterialForLesson). */
  material: string;
  status: "queued" | "building" | "done" | "failed";
  error: string;
  /** The title the model actually gave the lesson — usually the outline's, not always. */
  builtTitle: string;
};

export type CourseBuild = {
  classId: string;
  courseId: string;
  items: CourseBuildItem[];
  includeQuiz: boolean;
  includeAssignment: boolean;
  running: boolean;
  canceled: boolean;
};

export function stepInputFromDraft(draft: CurriculumStepDraft): CurriculumStepInput {
  const draftMode: LearningMode =
    draft.mode ||
    (
      {
        teach: "explanation",
        practice: "practice",
        checkpoint: "assessment",
        reflect: "reflection",
      } as const
    )[draft.kind] ||
    "practice";
  const modeType = draft.mode_type || modeMeta(draftMode).defaultType;
  const shape = pinnedShapeFor(draftMode, modeType);
  const isMcq = draftMode === "assessment" && modeType !== "open_ended";
  const choices = (draft.choices || []).filter((choice) => choice.id && choice.text);
  return {
    title: draft.title || shape.label,
    stage: shape.stage,
    activity_type: shape.activityType,
    response_mode: shape.responseMode,
    prompt: draft.prompt || shape.label,
    mode: draftMode,
    mode_type: modeType || null,
    choices: isMcq ? choices : [],
    quiz: isMcq
      ? {
          prompt: draft.prompt || "Choose the best answer.",
          choices,
          correct_choice_ids: draft.correct_choice_id ? [draft.correct_choice_id] : [],
        }
      : undefined,
  };
}
