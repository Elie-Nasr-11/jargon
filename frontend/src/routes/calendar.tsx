import { createFileRoute } from "@tanstack/react-router";
import { StudentCalendar } from "@/features/student/StudentCalendar";

// v4.0 deferred (Phase 5) — the student's deadline/submission calendar.
export const Route = createFileRoute("/calendar")({
  component: StudentCalendar,
});
