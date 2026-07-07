import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ClassDashboard, ClassMenu, UnitView, type UnitGroup } from "@/features/student/ClassViews";
import type { StudentClass } from "@/lib/types";

// The Classes workspace view's content: the in-view drill-down — class list → dashboard (unit
// cards) → unit view (lessons). Content-only; the ViewShell provides the frame. `onOpenLesson`
// is handed down from ChatPage, which can actually LOAD the picked lesson in place (this closes
// the old "same-route navigate never reloads the lesson" gap from the modal era).
export function ClassesPanel({ onOpenLesson }: { onOpenLesson: (lessonId: string) => void }) {
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [unit, setUnit] = useState<UnitGroup | null>(null);

  const back = () => {
    if (unit) setUnit(null);
    else if (cls) setCls(null);
  };

  const drilledIn = unit !== null || cls !== null;

  return (
    <div>
      {drilledIn ? (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-depth-card px-3 py-1.5 text-meta font-medium text-muted-foreground shadow-card transition-colors duration-(--dur-fast) hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            {unit ? "Back to class" : "All classes"}
          </button>
          <h2 className="min-w-0 flex-1 truncate text-title font-medium text-foreground">
            {unit ? unit.unitTitle : cls?.name}
          </h2>
        </div>
      ) : null}

      {unit && cls ? (
        <UnitView classId={cls.id} unitId={unit.unitId} onOpenLesson={onOpenLesson} />
      ) : cls ? (
        <ClassDashboard classId={cls.id} onSelectUnit={setUnit} />
      ) : (
        <ClassMenu onSelectClass={setCls} />
      )}
    </div>
  );
}
