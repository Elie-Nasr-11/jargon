import { createFileRoute } from "@tanstack/react-router";
import { TeacherConsole } from "@/features/teacher/TeacherConsole";

// Class workspace. Same console component as `/teacher`; it reads `classId`
// from the path and the active tab from `?tab=`, so the URL is the source of
// truth for the drill-down (deep-linkable, back/forward works).
export const Route = createFileRoute("/teacher/class/$classId")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: TeacherConsole,
});
