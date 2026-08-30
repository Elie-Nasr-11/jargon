import { Suspense, lazy } from "react";
import { RouteLoader } from "@/components/RouteLoader";
import { createFileRoute } from "@tanstack/react-router";

// Student workspace within a class. Reads `classId` + `studentId` from the path,
// the active tab from `?tab=`, and an optional `?session=` to open a specific session
// (used by the class-view "Live now" strip to land on the live session).
// R82: the portal loads on demand. Every route module used to import its surface
// statically, so one 2.6 MB chunk held the student app, the teacher console and the
// admin window — and a teacher paid for all three before anything rendered.
const TeacherConsole = lazy(() =>
  import("@/features/teacher/TeacherConsole").then((module) => ({
    default: module.TeacherConsole,
  })),
);

export const Route = createFileRoute("/teacher/class/$classId/student/$studentId")({
  validateSearch: (search: Record<string, unknown>): { tab?: string; session?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  component: TeacherConsoleRoute,
});

function TeacherConsoleRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <TeacherConsole />
    </Suspense>
  );
}
