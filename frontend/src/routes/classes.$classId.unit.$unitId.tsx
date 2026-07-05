import { createFileRoute } from "@tanstack/react-router";
import { UnitView } from "@/features/student/ClassViews";

// v4.0 Phase 3b — a unit's lessons with the student's real per-lesson progress.
export const Route = createFileRoute("/classes/$classId/unit/$unitId")({
  component: UnitView,
});
