import { createFileRoute } from "@tanstack/react-router";
import { TeacherConsole } from "@/features/teacher/TeacherConsole";

// Class workspace. Same console component as `/teacher`; it reads `classId`
// from the path and the active tab from `?tab=`, so the URL is the source of
// truth for the drill-down (deep-linkable, back/forward works). The Classwork
// tab's selected node (subject/course/unit/lesson) and open work item
// (assignment/assessment) ride the same URL, so lesson editing and grading
// inside a class are deep-linkable too.
export const Route = createFileRoute("/teacher/class/$classId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab?: string;
    subject?: string;
    course?: string;
    unit?: string;
    lesson?: string;
    assignment?: string;
    assessment?: string;
  } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    subject: typeof search.subject === "string" ? search.subject : undefined,
    course: typeof search.course === "string" ? search.course : undefined,
    unit: typeof search.unit === "string" ? search.unit : undefined,
    lesson: typeof search.lesson === "string" ? search.lesson : undefined,
    assignment: typeof search.assignment === "string" ? search.assignment : undefined,
    assessment: typeof search.assessment === "string" ? search.assessment : undefined,
  }),
  component: TeacherConsole,
});
