import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronsUpDown,
  ExternalLink,
  Home,
  LogOut,
  Moon,
  NotebookPen,
  PanelLeftClose,
  Sun,
  User,
} from "lucide-react";
import { Popover } from "@/components/Popover";
import { Collapsible } from "@/components/Collapsible";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import { useCampusLiveLink } from "@/hooks/useCampusLiveLink";
import { signOut } from "@/lib/api";
import type { TeacherClassSummary } from "@/lib/types";
import { CLASS_SECTIONS, groupClassesByOrg, type ClassSection } from "./teacherNav";

// The teacher shell's left column — the teacher sibling of the student AppSidebar, same anatomy:
// wordmark, primary nav rows (Home / Curriculum), a scrollable classes list (grouped by org when
// the teacher spans several), and an account row at the bottom opening a minimal popover menu.
// Desktop: a docked aside at lg+ (hideable via collapse). Mobile: the same content in a left Sheet
// drawer. Fully controlled for layout state; navigation happens internally via useNavigate.
// NavRow/MenuRow are copied (not extracted) from AppSidebar so the live student file stays
// untouched.

function NavRow({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active: boolean;
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
        <span className="shrink-0 rounded-pill bg-foreground px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums leading-none text-background">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function MenuRow({
  icon: Icon,
  label,
  trailing,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  trailing?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.5} />
        {label}
      </span>
      {trailing ? (
        <span className="text-overline uppercase tracking-[0.08em] text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export type TeacherSidebarProps = {
  email: string;
  // [] while the host's dashboard/authoring fetch is still in flight — the list just fills in.
  classes: TeacherClassSummary[];
  activeView: "home" | "class" | "curriculum";
  activeClassId: string | null;
  // Which of the active class's sections is on screen; null outside the class routes.
  activeSection?: ClassSection | null;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// The whole column, shared by the desktop aside and the mobile drawer. Account-menu state is
// per-instance (each instance anchors its own popover to its own account row).
function SidebarContent({ props, inDrawer }: { props: TeacherSidebarProps; inDrawer: boolean }) {
  const {
    email,
    classes,
    activeView,
    activeClassId,
    activeSection,
    onCloseDrawer,
    onToggleCollapse,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [openOrgs, setOpenOrgs] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const campusLiveUrl = useCampusLiveLink();

  // Every nav action closes the mobile drawer; desktop is unaffected.
  const go = (fn: () => void) => () => {
    fn();
    if (inDrawer) onCloseDrawer();
  };

  const groups = useMemo(() => groupClassesByOrg(classes), [classes]);

  // Auto-open the org holding the active class — on load (classes arrive async) and each time the
  // class changes — while merging so orgs the teacher expanded themselves stay open.
  useEffect(() => {
    if (!activeClassId) return;
    const currentOrg = groups.find(([, list]) => list.some((c) => c.id === activeClassId))?.[0];
    if (currentOrg) setOpenOrgs((s) => (s[currentOrg] ? s : { ...s, [currentOrg]: true }));
  }, [activeClassId, groups]);

  // The flow spine: the active class expands into its three section rows (Overview / Students /
  // Structure) right in the list — always visible while you're in the class, no extra disclosure.
  // The class row itself stays a nav button (lands on the section you're already in, or Overview).
  const classRow = (cls: TeacherClassSummary) => {
    const active = cls.id === activeClassId;
    return (
      <div key={cls.id}>
        <button
          type="button"
          onClick={go(() =>
            navigate({
              to: "/teacher/class/$classId",
              params: { classId: cls.id },
              // Re-clicking the active class keeps the section you're on (also brings a
              // student drill-down back to Students); other classes open on Overview.
              search: active && activeSection ? { tab: activeSection } : undefined,
            }),
          )}
          aria-current={active ? "true" : undefined}
          className={`flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-body transition-colors duration-(--dur-fast) ${
            active
              ? "font-medium text-foreground hover:bg-muted/60"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{cls.name}</span>
        </button>
        {active ? (
          <div
            role="group"
            aria-label={`${cls.name} sections`}
            className="mb-1 ml-3 border-l border-border/60 pl-1.5"
          >
            {CLASS_SECTIONS.map((section) => (
              <button
                key={section.value}
                type="button"
                onClick={go(() =>
                  navigate({
                    to: "/teacher/class/$classId",
                    params: { classId: cls.id },
                    search: { tab: section.value },
                  }),
                )}
                aria-current={activeSection === section.value ? "page" : undefined}
                className={`flex w-full items-center rounded-control px-2.5 py-1.5 text-left text-body transition-colors duration-(--dur-fast) ${
                  activeSection === section.value
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-2">
        <button
          type="button"
          onClick={go(() => navigate({ to: "/teacher" }))}
          aria-label="Teacher home"
          className="font-serif text-[18px] tracking-tight text-foreground"
        >
          Jargon
        </button>
        {!inDrawer ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Hide sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="h-[16px] w-[16px]" strokeWidth={1.6} />
          </button>
        ) : null}
      </div>

      <nav aria-label="Main" className="shrink-0 px-2">
        <NavRow
          icon={Home}
          label="Home"
          active={activeView === "home"}
          onClick={go(() => navigate({ to: "/teacher" }))}
        />
        <NavRow
          icon={NotebookPen}
          label="Curriculum"
          active={activeView === "curriculum"}
          onClick={go(() => navigate({ to: "/teacher/curriculum" }))}
        />
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {classes.length ? (
          <div className="mb-1 px-2.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Classes
          </div>
        ) : null}
        {/* One org reads best as a flat list; multiple orgs each get their own collapsible so the
            list stays scannable and the active class's org is open. */}
        {groups.length > 1
          ? groups.map(([org, list]) => {
              // The org holding the active class stays open while you're inside it — otherwise
              // closing it would hide the only section switcher for the page you're on.
              const containsActive = list.some((c) => c.id === activeClassId);
              const open = containsActive || (openOrgs[org] ?? false);
              return (
                <Collapsible
                  key={org}
                  open={open}
                  onToggle={() => setOpenOrgs((s) => ({ ...s, [org]: !(s[org] ?? false) }))}
                  headerClassName="mt-0.5 rounded-control px-2 py-1.5 text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted/60"
                  title={<span className="truncate font-medium">{org}</span>}
                  meta={
                    <span className="shrink-0 pl-1 text-meta tabular-nums text-muted-foreground">
                      {list.length}
                    </span>
                  }
                  bodyClassName="pb-1 pl-1.5"
                >
                  {list.map((cls) => classRow(cls))}
                </Collapsible>
              );
            })
          : (groups[0]?.[1] ?? []).map((cls) => classRow(cls))}
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
              aria-haspopup="menu"
              aria-label={`Account and settings — ${email || "signed in"}`}
              className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-depth-sub text-meta font-medium text-muted-foreground">
                {email ? (
                  email.slice(0, 1).toUpperCase()
                ) : (
                  <User className="h-4 w-4" strokeWidth={1.6} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{email}</span>
              <ChevronsUpDown
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.7}
              />
            </button>
          }
        >
          <MenuRow
            icon={resolved === "dark" ? Sun : Moon}
            label="Appearance"
            trailing={resolved === "dark" ? "Dark" : "Light"}
            onClick={toggle}
          />
          {campusLiveUrl ? (
            <a
              href={campusLiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
            >
              <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.5} /> Campus Live
            </a>
          ) : null}
          <div className="my-1.5 h-px bg-border" />
          <MenuRow
            icon={LogOut}
            label="Log out"
            onClick={async () => {
              try {
                setLogoutError(false);
                await signOut();
                navigate({ to: "/login" });
              } catch {
                setLogoutError(true); // a silent failure would read as "logged out" on a shared machine
              }
            }}
          />
          {logoutError ? (
            <div className="px-2.5 pb-1 pt-0.5 text-meta text-danger">
              Could not log out. Check your connection and try again.
            </div>
          ) : null}
        </Popover>
      </div>
    </div>
  );
}

export function TeacherSidebar(props: TeacherSidebarProps) {
  const { drawerOpen, onCloseDrawer } = props;

  // Crossing into lg with the drawer open would display:none the panel while Radix's scrim,
  // scroll lock, and focus trap stay live — the app would look frozen. Close it at the boundary.
  useEffect(() => {
    if (!drawerOpen) return;
    const mq = window.matchMedia("(min-width: 64rem)");
    const closeIfDesktop = () => {
      if (mq.matches) onCloseDrawer();
    };
    closeIfDesktop();
    mq.addEventListener("change", closeIfDesktop);
    return () => mq.removeEventListener("change", closeIfDesktop);
  }, [drawerOpen, onCloseDrawer]);

  return (
    <>
      {/* Desktop: docked aside (lg+), hidden when collapsed. */}
      {!props.collapsed ? (
        <aside
          aria-label="Sidebar"
          className="relative z-[var(--z-base)] hidden h-full w-[260px] shrink-0 border-r border-border/60 bg-background/70 backdrop-blur-sm lg:block"
        >
          <SidebarContent props={props} inDrawer={false} />
        </aside>
      ) : null}

      {/* Mobile: the same content in a left drawer (Radix Sheet: focus trap, ESC, scrim). */}
      <Sheet open={drawerOpen} onOpenChange={(o) => !o && onCloseDrawer()}>
        <SheetContent
          side="left"
          className="w-[280px] border-border/60 bg-background p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent props={props} inDrawer />
        </SheetContent>
      </Sheet>
    </>
  );
}
