import { createFileRoute } from "@tanstack/react-router";
import { ClassMenu } from "@/features/student/ClassViews";

// v4.0 Phase 3b — the student's class menu (all classes they're enrolled in).
export const Route = createFileRoute("/classes")({
  component: ClassMenu,
});
