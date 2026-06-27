import { createFileRoute } from "@tanstack/react-router";
import { TeacherConsole } from "@/features/teacher/TeacherConsole";

// Student workspace within a class. Reads `classId` + `studentId` from the path
// and the active tab from `?tab=`.
export const Route = createFileRoute("/teacher/class/$classId/student/$studentId")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: TeacherConsole,
});
