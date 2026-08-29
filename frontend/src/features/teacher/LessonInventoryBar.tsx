import { ClipboardList, FileText, HelpCircle, Layers3 } from "lucide-react";
import type { LessonInventory } from "@/features/teacher/lessonInventory";

// R74: what is actually inside this lesson, on the lesson itself.
//
// Build-from-material creates steps, a quiz, an assignment and materials in one action,
// so a teacher never watched the pieces appear and had no reason to think of them as
// separate, editable things. This bar is the answer to "what did it make?" — and every
// count is a place, not a statistic: clicking one takes you to that part of the lesson.
export function LessonInventoryBar({
  inventory,
  onJump,
}: {
  inventory: LessonInventory;
  onJump?: (part: "steps" | "quiz" | "assignments" | "materials") => void;
}) {
  const cells: {
    key: "steps" | "quiz" | "assignments" | "materials";
    icon: typeof Layers3;
    label: string;
    value: number;
    empty: string;
  }[] = [
    {
      key: "steps",
      icon: Layers3,
      label: inventory.steps === 1 ? "step" : "steps",
      value: inventory.steps,
      empty: "no steps yet",
    },
    {
      key: "quiz",
      icon: HelpCircle,
      label: inventory.quizSteps === 1 ? "quiz step" : "quiz steps",
      value: inventory.quizSteps,
      empty: "nothing checked",
    },
    {
      key: "assignments",
      icon: ClipboardList,
      label: inventory.assignments === 1 ? "assignment" : "assignments",
      value: inventory.assignments,
      empty: "no assignment",
    },
    {
      key: "materials",
      icon: FileText,
      label: inventory.materials === 1 ? "material" : "materials",
      value: inventory.materials,
      empty: "no materials",
    },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {cells.map((cell) => {
        const Icon = cell.icon;
        const has = cell.value > 0;
        return (
          <button
            key={cell.key}
            type="button"
            onClick={() => onJump?.(cell.key)}
            disabled={!onJump}
            className={`flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-meta transition-colors ${
              has
                ? "border-border bg-depth-sub text-foreground hover:border-primary"
                : "border-dashed border-border text-muted-foreground"
            } ${onJump ? "cursor-pointer" : "cursor-default"}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            {has ? (
              <span className="tabular-nums">
                {cell.value} {cell.label}
              </span>
            ) : (
              <span>{cell.empty}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
