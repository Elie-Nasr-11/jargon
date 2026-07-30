import { useState, type ComponentType, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronsUpDown,
  ClipboardCheck,
  GraduationCap,
  House,
  LogOut,
  MessageCircle,
  Plus,
  Settings,
  Sliders,
  User,
} from "lucide-react";
import { Popover } from "@/components/Popover";
import { FlipNumber } from "@/student/FlipNumber";
import {
  DESTINATIONS,
  MENU_ITEMS,
  type StudentDestination,
  type StudentMenuItem,
  type StudentSection,
} from "@/student/navigation";

// The student sidebar. Purely presentational — it takes state and callbacks, never fetches.
// Layout follows the ChatGPT/Claude convention: a primary section switch at the top, a New
// action, then destinations, then the account row pinned to the bottom.

const DESTINATION_ICONS: Record<
  StudentDestination,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  classes: GraduationCap,
  resources: BookOpen,
  checkpoints: ClipboardCheck,
  customize: Sliders,
  reports: BarChart3,
};

const MENU_ICONS: Record<
  StudentMenuItem,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  profile: User,
  settings: Settings,
  "sign-out": LogOut,
};

function NavRow({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body transition-colors duration-(--dur-fast) ${
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 overflow-hidden rounded-pill bg-foreground px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-background">
          <FlipNumber value={badge} />
        </span>
      ) : null}
    </button>
  );
}

export type StudentSidebarProps = {
  email: string;
  section: StudentSection;
  destination?: StudentDestination;
  // Formal work waiting on the student (assigned/in-progress checkpoints) — badges the
  // Checkpoints row so due work is visible without opening it.
  workDue?: number;
  onSelectSection: (section: StudentSection) => void;
  onSelectDestination: (destination: StudentDestination) => void;
  onNewConversation: () => void;
  onSelectMenuItem: (item: StudentMenuItem) => void;
  // Rendered under the destinations — the class/unit/lesson tree, supplied by the shell so
  // this component stays free of data concerns.
  children?: ReactNode;
};

export function StudentSidebar({
  email,
  section,
  destination,
  workDue = 0,
  onSelectSection,
  onSelectDestination,
  onNewConversation,
  onSelectMenuItem,
  children,
}: StudentSidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <span className="font-serif text-[18px] tracking-tight text-foreground">Jargon</span>
      </div>

      {/* Primary: the two things the product is. A segmented control rather than two nav rows,
          so the choice reads as a mode switch and not as another destination. */}
      <div
        role="tablist"
        aria-label="Section"
        className="mx-2 mb-2 flex shrink-0 gap-1 rounded-control bg-depth-sub p-1"
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
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2 py-1.5 text-body transition-colors duration-(--dur-fast) ${
                active
                  ? "bg-depth-card font-medium text-foreground shadow-card"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
              {label}
            </button>
          );
        })}
      </div>

      <nav aria-label="Main" className="shrink-0 px-2">
        <NavRow icon={Plus} label="New" onClick={onNewConversation} />
        <div className="my-2 h-px bg-border/60" />
        {DESTINATIONS.map((d) => (
          <NavRow
            key={d.id}
            icon={DESTINATION_ICONS[d.id]}
            label={d.label}
            active={destination === d.id}
            badge={d.id === "checkpoints" ? workDue : undefined}
            onClick={() => onSelectDestination(d.id)}
          />
        ))}
      </nav>

      {/* The class/unit/lesson tree lives here, supplied by the shell. */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {children}
      </div>

      <div className="shrink-0 border-t border-border/60 p-2">
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement="top-start"
          panelClassName="w-[236px] rounded-card border border-border bg-depth-card p-1.5 shadow-raised"
          trigger={
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={`Account and settings — ${email || "signed in"}`}
              className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-depth-sub text-meta font-medium text-muted-foreground">
                {email ? email.slice(0, 1).toUpperCase() : <User className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{email}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          }
        >
          {MENU_ITEMS.map((item) => {
            const Icon = MENU_ICONS[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSelectMenuItem(item.id);
                }}
                className="flex w-full items-center justify-between gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  {item.label}
                </span>
              </button>
            );
          })}
        </Popover>
      </div>
    </div>
  );
}
