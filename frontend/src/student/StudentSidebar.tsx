import { useState, type ComponentType, type ReactNode } from "react";
import {
  ChevronsUpDown,
  House,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sliders,
  Sun,
  User,
} from "lucide-react";
import { Popover } from "@/components/Popover";
import { useTheme } from "@/lib/theme";
import { ClassAvatar } from "@/student/ClassList";
import { MENU_ITEMS, type StudentMenuItem, type StudentSection } from "@/student/navigation";
import type { StudentClass } from "@/lib/types";

// The student sidebar, deliberately slim: Home/Learn at the top, the lesson tree as the body,
// the account row at the bottom. Everything else (Resources, Checkpoints, Customize, Reports,
// Classes) is reached from where it's relevant — the chatbox pill, Home, or the account menu —
// not from a nav column. Purely presentational: it takes state and callbacks, never fetches.
//
// Two shapes, one column: the EXPANDED sidebar (this component) and the collapsed RAIL
// (StudentRail below) — a 64px icon strip with hover tooltips per icon and a hover flyout for
// the class cluster, the reference desktop-app mechanics. The shell owns which one renders.

const MENU_ICONS: Record<
  StudentMenuItem,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  profile: User,
  customize: Sliders,
  "sign-out": LogOut,
};

export type StudentSidebarProps = {
  email: string;
  section: StudentSection;
  onSelectSection: (section: StudentSection) => void;
  onSelectMenuItem: (item: StudentMenuItem) => void;
  // Present only where collapsing makes sense (the docked desktop column, not the drawer).
  onCollapse?: () => void;
  // Rendered as the sidebar body — the class/unit/lesson tree, supplied by the shell so
  // this component stays free of data concerns.
  children?: ReactNode;
};

// The account/settings popover panel — one definition shared by the expanded footer row and
// the rail's avatar button so the two shapes can never drift.
function AccountMenuPanel({
  onSelectMenuItem,
  close,
}: {
  onSelectMenuItem: (item: StudentMenuItem) => void;
  close: () => void;
}) {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";
  return (
    <>
      {MENU_ITEMS.filter((item) => item.id !== "sign-out").map((item) => {
        const Icon = MENU_ICONS[item.id];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              close();
              onSelectMenuItem(item.id);
            }}
            className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.5} />
            {item.label}
          </button>
        );
      })}

      {/* Appearance: the design system's segmented pill (Dark | Light). Flips in place so
          the menu stays open — the student sees the theme change under the cursor. */}
      <div className="flex items-center justify-between gap-2.5 rounded-control px-2.5 py-2">
        <span className="flex items-center gap-2.5 text-body text-foreground">
          {isDark ? (
            <Moon className="h-[15px] w-[15px]" strokeWidth={1.5} />
          ) : (
            <Sun className="h-[15px] w-[15px]" strokeWidth={1.5} />
          )}
          Theme
        </span>
        <span className="flex rounded-pill border border-border bg-depth-sub p-[3px]">
          {(["dark", "light"] as const).map((mode) => {
            const active = (mode === "dark") === isDark;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => !active && toggle()}
                aria-pressed={active}
                className={`rounded-pill px-2.5 py-1 text-overline font-semibold capitalize transition-colors duration-(--dur-fast) ${
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                style={active ? { boxShadow: "var(--inset-highlight)" } : undefined}
              >
                {mode}
              </button>
            );
          })}
        </span>
      </div>

      <div className="my-1 h-px bg-border" />

      <button
        type="button"
        onClick={() => {
          close();
          onSelectMenuItem("sign-out");
        }}
        className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
      >
        <LogOut className="h-[15px] w-[15px]" strokeWidth={1.5} />
        Sign out
      </button>
    </>
  );
}

export function StudentSidebar({
  email,
  section,
  onSelectSection,
  onSelectMenuItem,
  onCollapse,
  children,
}: StudentSidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col pt-3">
      {/* Primary: the two things the product is. At rest the header just names the current
          section (icon + label); hovering it (or tabbing in) reveals the segmented Home|Learn
          toggle in place — the switch appears exactly where the cursor already is, with no
          layout shift (the toggle and the label overlay each other). */}
      <div className="mx-2 mb-2 flex shrink-0 items-center gap-1">
        <div className="group relative min-w-0 flex-1">
          <div
            role="tablist"
            aria-label="Section"
            className="flex min-w-0 gap-1 rounded-control border border-border bg-depth-sub p-1 opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {(
              [
                { id: "home" as const, label: "Home", icon: House },
                { id: "learn" as const, label: "Learn", icon: MessageCircle },
              ] satisfies { id: StudentSection; label: string; icon: typeof House }[]
            ).map(({ id, label, icon: Icon }) => {
              const active = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectSection(id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-3px)] px-2 py-1.5 text-body transition-colors duration-(--dur-fast) ${
                    active
                      ? "bg-background font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
                  {label}
                </button>
              );
            })}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center gap-1.5 px-3 opacity-100 transition-opacity duration-(--dur-fast) group-hover:opacity-0 group-focus-within:opacity-0"
          >
            {section === "home" ? (
              <House className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.6} />
            ) : (
              <MessageCircle
                className="h-[15px] w-[15px] text-muted-foreground"
                strokeWidth={1.6}
              />
            )}
            <span className="text-body font-medium text-foreground">
              {section === "home" ? "Home" : "Learn"}
            </span>
          </div>
        </div>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </button>
        ) : null}
      </div>

      {/* The class/unit/lesson tree lives here, supplied by the shell. */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {children}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement="top-start"
          panelClassName="w-[236px] rounded-card border border-border bg-background p-1.5"
          trigger={
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={`Account and settings — ${email || "signed in"}`}
              className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-depth-sub text-meta font-medium text-muted-foreground">
                {email ? email.slice(0, 1).toUpperCase() : <User className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{email}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          }
        >
          <AccountMenuPanel onSelectMenuItem={onSelectMenuItem} close={() => setMenuOpen(false)} />
        </Popover>
      </div>
    </div>
  );
}

// A rail button. Without a flyout it shows the reference tooltip — a solid label bubble
// beside the icon on hover/focus (pointer-events off so it never traps the cursor). With a
// flyout it instead opens a hover panel anchored to the icon (the pl-2 bridge keeps the
// hover unbroken across the gap), so the icon IS the menu.
function RailButton({
  label,
  active,
  onClick,
  flyout,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  flyout?: ReactNode;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={`${flyout ? "" : "group "}relative flex h-9 w-9 items-center justify-center rounded-control transition-colors duration-(--dur-fast) ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      {children}
      {!flyout ? (
        <span className="pointer-events-none absolute left-full top-1/2 z-[var(--z-menu)] ml-2 -translate-y-1/2 whitespace-nowrap rounded-control bg-foreground px-2.5 py-1 text-meta font-medium text-background opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100 group-focus-visible:opacity-100">
          {label}
        </span>
      ) : null}
    </button>
  );
  if (!flyout) return button;
  return (
    <div className="group relative">
      {button}
      <div className="pointer-events-none absolute left-full top-0 z-[var(--z-menu)] pl-2 opacity-0 transition-opacity duration-(--dur-fast) group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <div className="max-h-[72vh] w-[248px] overflow-y-auto overscroll-contain rounded-card border border-border bg-background p-1.5 shadow-[var(--elev-raised)]">
          <div className="mb-1 px-2.5 pt-1 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </div>
          {flyout}
        </div>
      </div>
    </div>
  );
}

export type StudentRailProps = {
  email: string;
  section: StudentSection;
  onSelectSection: (section: StudentSection) => void;
  onSelectMenuItem: (item: StudentMenuItem) => void;
  classes: StudentClass[];
  selectedClassId: string | null;
  dueByClass: Map<string, number>;
  onSelectClass: (classId: string | null) => void;
  onExpand: () => void;
  // The two section menus, supplied by the shell (the same bodies the expanded sidebar
  // shows): Home = Overview + class list, Learn = class switcher + lesson tree. Each renders
  // as its icon's hover flyout, so the rail is section-aware without owning any data.
  homeMenu: ReactNode;
  learnMenu: ReactNode;
};

// The collapsed sidebar: a 64px icon rail. Hovering the Home or Learn icon opens that
// section's full menu as a flyout; other icons show label bubbles; the class avatars are
// one-click shortcuts with name tooltips; the expand toggle restores the full column.
export function StudentRail({
  email,
  section,
  onSelectSection,
  onSelectMenuItem,
  classes,
  selectedClassId,
  dueByClass,
  onSelectClass,
  onExpand,
  homeMenu,
  learnMenu,
}: StudentRailProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-1 pb-2 pt-3">
      <RailButton label="Expand sidebar" onClick={onExpand}>
        <PanelLeftOpen className="h-[16px] w-[16px]" strokeWidth={1.6} />
      </RailButton>

      <div className="my-1.5 h-px w-8 shrink-0 bg-border" aria-hidden />

      <RailButton
        label="Home"
        active={section === "home"}
        onClick={() => onSelectSection("home")}
        flyout={homeMenu}
      >
        <House className="h-[16px] w-[16px]" strokeWidth={1.6} />
      </RailButton>
      <RailButton
        label="Learn"
        active={section === "learn"}
        onClick={() => onSelectSection("learn")}
        flyout={learnMenu}
      >
        <MessageCircle className="h-[16px] w-[16px]" strokeWidth={1.6} />
      </RailButton>
      {section === "home" ? (
        <RailButton
          label="Overview"
          active={selectedClassId === null}
          onClick={() => onSelectClass(null)}
        >
          <LayoutDashboard className="h-[16px] w-[16px]" strokeWidth={1.6} />
        </RailButton>
      ) : null}

      <div className="my-1.5 h-px w-8 shrink-0 bg-border" aria-hidden />

      {/* The class avatars: one-click shortcuts with name tooltips. The full rows live in
          the Home/Learn icon flyouts above, so the cluster stays a quick-switch strip. */}
      {classes.slice(0, 8).map((klass) => {
        const active = klass.id === selectedClassId;
        const due = dueByClass.get(klass.id) ?? 0;
        return (
          <span key={klass.id} className="group relative">
            <button
              type="button"
              onClick={() => onSelectClass(klass.id)}
              aria-label={klass.name}
              aria-current={active ? "true" : undefined}
              className={`relative rounded-full p-0.5 transition-colors duration-(--dur-fast) ${
                active ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <ClassAvatar name={klass.name} size={7} />
              {due > 0 ? (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--mode-open)" }}
                  aria-label={`${due} due`}
                />
              ) : null}
            </button>
            <span className="pointer-events-none absolute left-full top-1/2 z-[var(--z-menu)] ml-2 -translate-y-1/2 whitespace-nowrap rounded-control bg-foreground px-2.5 py-1 text-meta font-medium text-background opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100 group-focus-within:opacity-100">
              {klass.name}
            </span>
          </span>
        );
      })}

      <div className="flex-1" />

      <div className="shrink-0 border-t border-border pt-2">
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement="top-start"
          panelClassName="w-[236px] rounded-card border border-border bg-background p-1.5"
          trigger={
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={`Account and settings — ${email || "signed in"}`}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-depth-sub text-meta font-medium text-muted-foreground">
                {email ? email.slice(0, 1).toUpperCase() : <User className="h-4 w-4" />}
              </span>
            </button>
          }
        >
          <AccountMenuPanel onSelectMenuItem={onSelectMenuItem} close={() => setMenuOpen(false)} />
        </Popover>
      </div>
    </div>
  );
}
