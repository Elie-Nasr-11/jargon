import type { Assignment, LessonActivity, LessonResource } from "@/lib/types";

// R74: the teacher could not answer three questions about a lesson the machine built —
// what is in it, where does each piece live, and how do I change one. Build-from-material
// makes steps, a quiz, an assignment and materials in a single action, so the teacher
// never watched the pieces appear and had no reason to believe they were separate things
// at all. This module gives the lesson an INVENTORY: the pieces, counted, each one a
// place you can click.

export type LessonInventory = {
  steps: number;
  quizSteps: number;
  assignments: number;
  materials: number;
};

export function inventoryFor(
  lessonId: string,
  steps: LessonActivity[],
  assignments: Assignment[],
  resources: LessonResource[],
): LessonInventory {
  const own = steps.filter((step) => step.lesson_id === lessonId);
  return {
    steps: own.length,
    quizSteps: own.filter((step) => step.response_mode === "multiple_choice").length,
    assignments: assignments.filter((row) => row.lesson_id === lessonId).length,
    materials: resources.filter(
      (resource) => resource.lesson_id === lessonId && resource.status !== "archived",
    ).length,
  };
}

// R74: RANKED MATERIALS.
//
// Every resource is attached to a lesson, so nothing is orphaned — but the book import
// staples the whole chapter PDF and every page image to each lesson, which in production
// means ~11 images and ~8 PDFs per lesson in one flat list. The attachment is real and
// the ranking is what was missing: a teacher needs to see what THIS STEP shows before
// what the chapter happens to contain.
//
// Three tiers, most specific first. The book tier is collapsed by default in the UI —
// it is context, not curriculum, and it is the tier that made the page feel like junk.
export type ResourceTier = "step" | "lesson" | "book";

export function tierOf(
  resource: LessonResource,
  activityId: string | null,
  bookImportKeys: Set<string>,
): ResourceTier {
  if (activityId && resource.activity_id === activityId) return "step";
  // Imported book material announces itself: the importer stamps the resource with the
  // book's key. Everything a teacher attached by hand outranks it.
  const importKey = String(
    (resource.metadata as { import_key?: unknown } | null | undefined)?.import_key ?? "",
  );
  if (importKey && bookImportKeys.has(importKey)) return "book";
  return "lesson";
}

export function groupResources(
  resources: LessonResource[],
  activityId: string | null,
  bookImportKeys: Set<string>,
): Record<ResourceTier, LessonResource[]> {
  const out: Record<ResourceTier, LessonResource[]> = { step: [], lesson: [], book: [] };
  for (const resource of resources) {
    if (resource.status === "archived") continue;
    out[tierOf(resource, activityId, bookImportKeys)].push(resource);
  }
  return out;
}
