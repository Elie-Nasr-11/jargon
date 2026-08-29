/**
 * Shared shapes for the authoring surface.
 *
 * These crossed module boundaries the moment the 6k-line route was split, so
 * they live here instead of in whichever component happened to declare them
 * first. Types only - nothing in this file has behaviour.
 */
import type {
  CurriculumLessonMetaInput,
  CurriculumNodeType,
  CurriculumOutlineDraft,
  CurriculumStepDraft,
  LessonActivity,
} from "@/lib/types";
import type { DeckSpec } from "@/lib/artifact-schema";

export type ResponseMode = LessonActivity["response_mode"];

export type LessonKind = CurriculumLessonMetaInput["lesson_type"];

export type Selection = { type: CurriculumNodeType; id: string } | null;

// AI generation request shapes (initial generate + per-item refine).
export type OutlineGenArgs = {
  prompt: string;
  referenceText: string;
  current?: CurriculumOutlineDraft;
  feedback?: string;
  target?: string;
};

export type StepsGenArgs = {
  prompt: string;
  referenceText: string;
  current?: CurriculumStepDraft[];
  feedback?: string;
  target?: string;
};

// P7 artifact authoring.
export type ArtifactGenArgs = {
  kind: "html_sim" | "deck";
  brief: string;
  feedback?: string;
  current?: Record<string, unknown>;
};

export type ArtifactApprovePayload = {
  kind: "html_sim" | "deck";
  title: string;
  posterText?: string;
  html?: string;
  deck?: DeckSpec;
};

export type CurriculumSearch = {
  subject?: string;
  course?: string;
  unit?: string;
  lesson?: string;
};

// R47: a work item as the console hands it to the Classwork list — assignments, quizzes,
// and materials render as rows under their lesson's unit heading, next to the lessons.
export type ClassworkItem = {
  kind: "assignment" | "assessment" | "material";
  id: string;
  lessonId: string | null;
  // R48: the lesson step this item IS (created from the step editor); null = standalone.
  activityId: string | null;
  title: string;
  status: string;
  dueAt: string | null;
  needsReviewCount: number;
  submittedCount: number;
};
