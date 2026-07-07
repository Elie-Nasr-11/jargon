import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ModalCard } from "@/components/ModalCard";
import { ClassDashboard, ClassMenu, UnitView, type UnitGroup } from "@/features/student/ClassViews";
import { store } from "@/lib/jargon-store";
import type { StudentClass } from "@/lib/types";

// The Classes modal (opened from the nav drawer): an in-modal drill-down — class list → dashboard
// (unit cards) → unit view (lessons). Opening a lesson hands off to the chat surface and closes.
// Calendar / Grades / Review / Overview are now their own drawer modals, so this is Classes only.
export function ClassesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [unit, setUnit] = useState<UnitGroup | null>(null);

  // Start at the class list each open.
  useEffect(() => {
    if (open) {
      setCls(null);
      setUnit(null);
    }
  }, [open]);

  const openLesson = (lessonId: string) => {
    store.setLessonId(lessonId);
    onOpenChange(false);
    navigate({ to: "/chat" });
  };

  const back = () => {
    if (unit) setUnit(null);
    else if (cls) setCls(null);
  };

  const drilledIn = unit !== null || cls !== null;
  const title = unit ? unit.unitTitle : cls ? cls.name : "Classes";

  return (
    <ModalCard open={open} onOpenChange={onOpenChange} title={title} className="sm:max-w-xl">
      {drilledIn ? (
        <div className="mb-3">
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
            {unit ? "Back to class" : "All classes"}
          </button>
        </div>
      ) : null}

      {unit && cls ? (
        <UnitView classId={cls.id} unitId={unit.unitId} onOpenLesson={openLesson} />
      ) : cls ? (
        <ClassDashboard classId={cls.id} onSelectUnit={setUnit} />
      ) : (
        <ClassMenu onSelectClass={setCls} />
      )}
    </ModalCard>
  );
}
