import { createFileRoute } from "@tanstack/react-router";
import { LessonScreen } from "@/features/teacher/lesson/LessonScreen";

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
  return <LessonScreen classId={classId} lessonId={lessonId} />;
}
