import { Suspense, lazy } from "react";
import { RouteLoader } from "@/components/RouteLoader";
import { createFileRoute } from "@tanstack/react-router";

// R82: the portal loads on demand. Every route module used to import its surface
// statically, so one 2.6 MB chunk held the student app, the teacher console and the
// admin window — and a teacher paid for all three before anything rendered.
const TeacherConsole = lazy(() =>
  import("@/features/teacher/TeacherConsole").then((module) => ({
    default: module.TeacherConsole,
  })),
);

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Teacher - Jargon" },
      {
        name: "description",
        content: "Teacher dashboard for Jargon classes, transcripts, evidence, and notes.",
      },
    ],
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
