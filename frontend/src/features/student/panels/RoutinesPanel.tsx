import { Repeat } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

// v5.0 P1 — Routines are the student's recurring, self-configured jobs: lesson updates, summaries,
// and spaced repetition.
//
// Only the third has a live backend today (`review_sessions` + the isolated review:true chat
// handler + the review-due chip — see DECISIONS 2026-07-06). Updates and summaries need a
// scheduled writer that does not exist yet, so the approved plan scopes P1 to the shell entry and
// the data model, with generation deferred to its own slice.
//
// Honest empty state over a fake list — the nav entry is real, the scheduler is not.
export function RoutinesPanel() {
  return (
    <EmptyState icon={Repeat}>
      Routines will let you set up recurring lesson updates, summaries, and spaced-repetition
      review. Review practice already runs today — it reaches you through the review chip when
      skills come due.
    </EmptyState>
  );
}
