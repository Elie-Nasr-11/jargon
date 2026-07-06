import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ModalCard } from "@/components/ModalCard";
import { ClassDashboard, ClassMenu, UnitView, type UnitGroup } from "@/features/student/ClassViews";
import { StudentCalendarBody } from "@/features/student/StudentCalendar";
import { store } from "@/lib/jargon-store";
import type { StudentClass } from "@/lib/types";

// The student LMS as a centered popup, launched from the Classes header icon. Two tabs — Classes
// (with an in-modal drill-down: class list → dashboard → unit view) and Calendar. Opening a lesson
// hands off to the chat surface and closes the modal.

type Tab = "classes" | "calendar";

export function ClassesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("classes");
  const [cls, setCls] = useState<StudentClass | null>(null);
  const [unit, setUnit] = useState<UnitGroup | null>(null);

  // Start fresh each time the modal opens.
  useEffect(() => {
    if (open) {
      setTab("classes");
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

  const drilledIn = tab === "classes" && (unit !== null || cls !== null);
  const title =
    tab === "calendar" ? "Calendar" : unit ? unit.unitTitle : cls ? cls.name : "Classes";

  return (
    <ModalCard open={open} onOpenChange={onOpenChange} title={title} className="sm:max-w-xl">
      <div className="mb-3">
        {drilledIn ? (
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
            {unit ? "Back to class" : "All classes"}
          </button>
        ) : (
          <div className="inline-flex rounded-full border border-border p-[3px] text-[12.5px]">
            {(["classes", "calendar"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1 capitalize transition-colors ${
                  tab === t ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "calendar" ? (
        <StudentCalendarBody />
      ) : unit && cls ? (
        <UnitView classId={cls.id} unitId={unit.unitId} onOpenLesson={openLesson} />
      ) : cls ? (
        <ClassDashboard classId={cls.id} onSelectUnit={setUnit} />
      ) : (
        <ClassMenu onSelectClass={setCls} />
      )}
    </ModalCard>
  );
}
