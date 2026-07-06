import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { fetchReviewDue } from "@/lib/api";
import { humanizeSkillKey, practicedAgo } from "@/lib/review";
import type { ReviewDueSkill } from "@/lib/types";

const TIER_LABEL: Record<string, string> = {
  emerging: "Emerging",
  developing: "Developing",
  secure: "Secure",
};

// Post-v4.0 Phase 4: a self-contained header chip surfacing skills due for spaced review.
// Renders nothing when nothing is due; a tap opens a compact list of the fading skills.
export function ReviewDueChip() {
  const [due, setDue] = useState<ReviewDueSkill[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void fetchReviewDue()
      .then((rows) => {
        if (active) setDue(rows);
      })
      .catch(() => {
        if (active) setDue([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (due.length === 0) return null;

  const shown = due.slice(0, 8);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${due.length} skills due for review`}
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/12 px-3 py-1.5 text-[12.5px] text-warning transition-colors hover:bg-warning/20"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
        Review · {due.length}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-border bg-background p-3 shadow-lg">
          <p className="text-[13px] font-medium text-foreground">Due for review</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            These skills are fading — ask your mentor to quiz you on them to keep them sharp.
          </p>
          <ul className="mt-2 space-y-1.5">
            {shown.map((skill) => (
              <li key={skill.skill_key} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                  {humanizeSkillKey(skill.skill_key)}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {TIER_LABEL[skill.level] ?? skill.level} · {practicedAgo(skill.last_practiced_at)}
                </span>
              </li>
            ))}
          </ul>
          {due.length > shown.length ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              +{due.length - shown.length} more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
