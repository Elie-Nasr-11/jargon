import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, PanelLeft } from "lucide-react";
import { NotificationsMenu } from "@/components/NotificationsMenu";
import { TeacherSidebar } from "./TeacherSidebar";
import type { ClassSection } from "./teacherNav";
import type { TeacherClassSummary } from "@/lib/types";

// The teacher portal's chromeless root — the teacher twin of the student /learn shell: one left
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
  activeSection = null,
  assistant,
  children,
}: {
  email: string;
  classes: TeacherClassSummary[];
  activeView: "home" | "class";
  activeClassId?: string | null;
  activeSection?: ClassSection | null;
  // R87: the assistant is a SIBLING of the stage, not an overlay on it. Rendered here,
  // opening it shrinks the page the way a sidebar should, instead of covering the very
  // controls it is meant to help with. (It goes fixed on narrow screens, where there is
  // no width to give it.)
  assistant?: ReactNode;
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
      {/* DESIGN_V6 §6: the teacher console sits on a calm neutral ambient at 0.18, tinted
          toward the neutral ambient token (§2's "neutral teacher tint"). */}

      <TeacherSidebar
        email={email}
        classes={classes}
        activeView={activeView}
        activeClassId={activeClassId}
        activeSection={activeSection}
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

      {/* The stage: hosts render exactly one PageShell page, which owns its own scroll. When the
          sidebar is collapsed the reopen chip floats over the stage's top-left — unlike the 880px
          student column, the wide teacher columns (1240/1440) reach it, so the stage takes top
          clearance to keep the first content row (back pill, breadcrumb, sticky outline) out from
          under the chip. */}
      <div
        className={`relative z-[var(--z-base)] flex min-w-0 flex-1 flex-col ${
          collapsed ? "lg:pt-12" : ""
        }`}
      >
        {/* R87: the bell is absolute to the STAGE, not fixed to the viewport. While it
            was fixed it sat on top of whatever occupied the right edge — which, once
            the assistant became a right-hand panel, was the panel's own close button. */}
        <div className="absolute right-3 top-3 z-[var(--z-header)]">
          <NotificationsMenu />
        </div>
        {children}
      </div>

      {assistant}
    </div>
  );
}
