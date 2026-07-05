import { createFileRoute } from "@tanstack/react-router";
import { ClassDashboard } from "@/features/student/ClassViews";

// v4.0 Phase 3b — a class dashboard: unit cards scoped to the class's linked courses.
export const Route = createFileRoute("/classes/$classId")({
  component: ClassDashboard,
});
