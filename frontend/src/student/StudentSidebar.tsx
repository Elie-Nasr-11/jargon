import { useState, type ComponentType, type ReactNode } from "react";
import {
  ChevronsUpDown,
  House,
  LogOut,
  MessageCircle,
  Moon,
  Sliders,
  Sun,
  User,
} from "lucide-react";
import { Popover } from "@/components/Popover";
import { useTheme } from "@/lib/theme";
import { MENU_ITEMS, type StudentMenuItem, type StudentSection } from "@/student/navigation";

// The student sidebar, deliberately slim: Home/Learn at the top, the lesson tree as the body,
// the account row at the bottom. Everything else (Resources, Checkpoints, Customize, Reports,
// Classes) is reached from where it's relevant — the chatbox pill, Home, or the account menu —
// not from a nav column. Purely presentational: it takes state and callbacks, never fetches.
//
// Collapse/expand is entirely the shell's: ONE fixed button at the screen's top-left toggles
// the column (which slides its width to zero). This header just leaves that button a gutter
// (insetForToggle) so nothing ever sits under it.

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
  // The docked desktop column keeps a gutter at the header's left for the shell's fixed
  // collapse/expand toggle (the drawer has no toggle, so no gutter).
  insetForToggle?: boolean;
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
  insetForToggle,
  children,
}: StudentSidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col pt-3">
      {/* Primary: the two things the product is. A segmented control rather than two nav rows,
          so the choice reads as a mode switch and not as another destination. (No wordmark —
          the product doesn't need to introduce itself on every screen.) The desktop column
          leaves the header's left gutter free for the shell's fixed collapse toggle. */}
      <div
        className={`mb-2 flex shrink-0 items-center gap-1 ${
          insetForToggle ? "ml-11 mr-2" : "mx-2"
        }`}
      >
        <div
          role="tablist"
          aria-label="Section"
          className="flex min-w-0 flex-1 gap-1 rounded-control border border-border bg-depth-sub p-1"
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
