import { useEffect, useRef, type ComponentType } from "react";
import {
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import gsap from "gsap";
import { prefersReducedMotion } from "@/lib/motion";
import type { StudentView } from "@/features/student/shell/studentViews";

// The persistent desktop sidebar (lg+): the student's whole navigation, always visible and always
// live — switching sections never passes through a modal. Grouped Learning / Messages with a
// pinned "Tutor chat" row on top (the return affordance). Active row reads raised (depth-card +
// shadow); a single notch on the left edge SLIDES between rows (the MentorControls pill mechanic)
// — no translate on hover, nav feels bolted down.

type RowKey = StudentView | "chat";

const ROWS: Array<
  | {
      kind: "row";
      key: RowKey;
      label: string;
      icon: ComponentType<{ className?: string; strokeWidth?: number }>;
    }
  | { kind: "label"; text: string }
> = [
  { kind: "row", key: "chat", label: "Tutor chat", icon: Sparkles },
  { kind: "label", text: "Learning" },
  { kind: "row", key: "overview", label: "Overview", icon: LayoutDashboard },
  { kind: "row", key: "classes", label: "Classes", icon: LayoutGrid },
  { kind: "row", key: "calendar", label: "Calendar", icon: CalendarDays },
  { kind: "row", key: "grades", label: "Grades", icon: GraduationCap },
  { kind: "row", key: "review", label: "Review", icon: RotateCcw },
  { kind: "label", text: "Messages" },
  { kind: "row", key: "messages", label: "Messages", icon: MessageCircle },
];

export function Sidebar({
  activeKey,
  reviewDueCount,
  messagesUnread,
  onSelect,
}: {
  activeKey: RowKey;
  reviewDueCount: number;
  messagesUnread: boolean;
  onSelect: (key: RowKey) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const notchRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef(new Map<RowKey, HTMLButtonElement>());
  const didMount = useRef(false);

  // Slide the left-edge notch to the active row (gsap.set on first paint, tween after).
  useEffect(() => {
    const notch = notchRef.current;
    const row = rowRefs.current.get(activeKey);
    const list = listRef.current;
    if (!notch || !row || !list) return;
    const y = row.offsetTop + (row.offsetHeight - 18) / 2;
    if (!didMount.current || prefersReducedMotion()) {
      gsap.set(notch, { y, opacity: 1 });
      didMount.current = true;
    } else {
      gsap.to(notch, { y, duration: 0.34, ease: "power3.out" });
    }
  }, [activeKey]);

  return (
    <nav
      aria-label="Sections"
      className="flex h-full w-full flex-col overflow-y-auto overscroll-contain"
    >
      <div ref={listRef} className="relative flex-1 px-3 pb-6 pt-5">
        <span
          ref={notchRef}
          aria-hidden
          className="absolute left-0 top-0 h-[18px] w-[3px] rounded-pill bg-foreground opacity-0"
        />
        {ROWS.map((item) =>
          item.kind === "label" ? (
            <div
              key={`label-${item.text}`}
              className="mb-1 mt-5 px-2.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground"
            >
              {item.text}
            </div>
          ) : (
            <button
              key={item.key}
              type="button"
              ref={(el) => {
                if (el) rowRefs.current.set(item.key, el);
                else rowRefs.current.delete(item.key);
              }}
              onClick={() => onSelect(item.key)}
              aria-current={activeKey === item.key ? "page" : undefined}
              className={`flex w-full items-center justify-between gap-2.5 rounded-control px-3 py-2 text-left text-body transition-colors duration-(--dur-fast) ${
                activeKey === item.key
                  ? "bg-depth-card text-foreground shadow-card"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <item.icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.5} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.key === "review" && reviewDueCount > 0 ? (
                <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                  · {reviewDueCount > 99 ? "99+" : reviewDueCount}
                </span>
              ) : item.key === "messages" && messagesUnread ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
              ) : null}
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
