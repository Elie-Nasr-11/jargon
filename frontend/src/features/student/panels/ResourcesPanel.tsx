import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

// v5.0 P1 — Resources is a navigable destination in the shell, but its catalog is not built yet.
// Lesson materials today reach the student ONLY as cards attached inside the conversation
// (lesson_resources → ResourceCard, placed by the mentor). A standalone browser needs a
// student-scoped listing endpoint that respects can_view_lesson_resource — including the
// student_private artifact rows — which is its own slice, not shell work.
//
// This renders an honest empty state rather than a fake list: the nav entry is real, the data
// layer is explicitly pending. See docs/OPEN_QUESTIONS.md.
export function ResourcesPanel() {
  return (
    <EmptyState icon={BookOpen}>
      Your lesson materials appear as cards in the conversation as you reach them. A single place to
      browse everything your teacher has shared is coming soon.
    </EmptyState>
  );
}
