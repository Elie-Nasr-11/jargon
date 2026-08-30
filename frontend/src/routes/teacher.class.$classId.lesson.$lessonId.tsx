import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RouteLoader } from "@/components/RouteLoader";

// R82: the editor loads on demand. A route module ships to every visitor in order
// to match a URL, so importing the screen here put the whole lesson editor — and
// the authoring modules behind it — in the chunk every student downloads.
const LessonScreen = lazy(() =>
  import("@/features/teacher/lesson/LessonScreen").then((module) => ({
    default: module.LessonScreen,
  })),
);

// R79: a lesson has its own address. The editor used to be a pane inside the
// class's Content room, reachable only by selecting a row, which meant a teacher
// could not link to a lesson, could not use Back, and could not tell where they
// were. The lesson is the object a teacher spends the day in — it gets a URL.
export const Route = createFileRoute("/teacher/class/$classId/lesson/$lessonId")({
  head: () => ({ meta: [{ title: "Lesson - Jargon" }] }),
  component: LessonRoute,
});

function LessonRoute() {
  const { classId, lessonId } = Route.useParams();
  return (
    <Suspense fallback={<RouteLoader />}>
      <LessonScreen classId={classId} lessonId={lessonId} />
    </Suspense>
  );
}
