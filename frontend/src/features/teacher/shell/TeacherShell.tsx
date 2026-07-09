import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, PanelLeft } from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { NotificationsMenu } from "@/components/NotificationsMenu";
import { TeacherSidebar } from "./TeacherSidebar";
import type { TeacherClassSummary } from "@/lib/types";

// The teacher portal's chromeless root — the teacher twin of the student /chat shell: one left
// column (TeacherSidebar) carries ALL navigation, the rest of the screen is whatever page is
// active. No sticky header: the mobile hamburger and the collapsed-reopen button float top-left,
// and the notifications bell floats top-right (mirroring the student resources launcher), so
// NotificationsMenu keeps its badge/realtime/deep-links with zero component changes. Hosts render
// exactly one PageShell page inside — the page owns its own scroll.

export function TeacherShell({
  email,
  classes,
  activeView,
  activeClassId = null,
  children,
}: {
  email: string;
  classes: TeacherClassSummary[];
  activeView: "home" | "class" | "curriculum";
  activeClassId?: string | null;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("jargon:teacher-sidebar-collapsed") === "1";
    } catch {
      return false; // storage denied (locked-down profiles) — just don't persist
    }
  });
  const toggleSidebar = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("jargon:teacher-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // private-mode storage failures just lose persistence
      }
      return next;
    });
  };

  // Collapse/reopen each unmount the button that was just pressed — hand keyboard focus to the
  // counterpart control so a keyboard user never falls back to <body>.
  const reopenBtnRef = useRef<HTMLButtonElement>(null);
  const skipFocusHandoffRef = useRef(true);
  useEffect(() => {
    if (skipFocusHandoffRef.current) {
      skipFocusHandoffRef.current = false;
      return;
    }
    if (collapsed) reopenBtnRef.current?.focus();
    else document.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')?.focus();
  }, [collapsed]);

  return (
    <div
      className="relative flex h-dvh overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.35} />

      <TeacherSidebar
        email={email}
        classes={classes}
        activeView={activeView}
        activeClassId={activeClassId}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleSidebar}
      />

      {/* Fixed launchers over the main area: the mobile hamburger, and the desktop reopen button
          when the sidebar is collapsed. */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        className="fixed left-3 top-3 z-[var(--z-header)] flex h-9 w-9 items-center justify-center rounded-full bg-depth-card text-muted-foreground shadow-card transition-opacity duration-(--dur) hover:text-foreground lg:hidden"
      >
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </button>
      {collapsed ? (
        <button
          ref={reopenBtnRef}
          type="button"
          onClick={toggleSidebar}
          aria-label="Show sidebar"
          className="fixed left-3 top-3 z-[var(--z-header)] hidden h-9 w-9 items-center justify-center rounded-full bg-depth-card text-muted-foreground shadow-card transition-opacity duration-(--dur) hover:text-foreground lg:flex"
        >
          <PanelLeft className="h-[16px] w-[16px]" strokeWidth={1.6} />
        </button>
      ) : null}

      {/* The notification bell floats top-right, above the page scroll. */}
      <div className="fixed right-3 top-3 z-[var(--z-header)]">
        <NotificationsMenu />
      </div>

      {/* The stage: hosts render exactly one PageShell page, which owns its own scroll. */}
      <div className="relative z-[var(--z-base)] flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
