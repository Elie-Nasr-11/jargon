import { useEffect, useState } from "react";

import { fetchStudentReviewSessions } from "@/lib/api";
import { humanizeSkillKey } from "@/lib/review";
import type { ReviewSession } from "@/lib/types";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

// Post-v4.0 Phase 5: a compact, self-contained read of a student's ad-hoc guided-review sessions,
// for the teacher's student-detail view. RLS (review_sessions_teacher_read via can_view_student)
// scopes it to managed students; renders nothing until the student has done a review.
export function StudentReviewSessions({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<ReviewSession[]>([]);

  useEffect(() => {
    let active = true;
    setRows([]); // avoid briefly showing the previous student's reviews when switching students
    void fetchStudentReviewSessions(studentId)
      .then((data) => {
        if (active) setRows(data);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-background/45 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Spaced review
      </div>
      <ul className="mt-2 space-y-1.5">
        {rows.slice(0, 10).map((row) => (
          <li key={row.id} className="flex items-center gap-2.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-foreground">
              {humanizeSkillKey(row.skill_key)}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {row.question_count} {row.question_count === 1 ? "question" : "questions"}
            </span>
            {row.score != null ? (
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-foreground/70">
                {Math.round(row.score * 100)}%
              </span>
            ) : (
              <span className="w-9 shrink-0" />
            )}
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${
                row.status === "complete"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border text-muted-foreground"
              }`}
            >
              {row.status}
            </span>
            <span className="w-10 shrink-0 text-right text-[10.5px] text-muted-foreground">
              {formatWhen(row.updated_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
