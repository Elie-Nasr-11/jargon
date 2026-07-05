import { createFileRoute } from "@tanstack/react-router";
import { TeacherConsole } from "@/features/teacher/TeacherConsole";

// Student workspace within a class. Reads `classId` + `studentId` from the path,
// the active tab from `?tab=`, and an optional `?session=` to open a specific session
// (used by the class-view "Live now" strip to land on the live session).
export const Route = createFileRoute("/teacher/class/$classId/student/$studentId")({
  validateSearch: (search: Record<string, unknown>): { tab?: string; session?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  component: TeacherConsole,
});
