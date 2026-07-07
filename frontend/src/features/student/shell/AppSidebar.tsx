import { useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ChevronsUpDown,
  ExternalLink,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Moon,
  PanelLeftClose,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { Popover } from "@/components/Popover";
import { ModalCard } from "@/components/ModalCard";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MentorControls } from "@/features/student/MentorControls";
import { groupByUnit } from "@/features/student/lessonGroups";
import { useTheme } from "@/lib/theme";
import { useCampusLiveLink } from "@/hooks/useCampusLiveLink";
import { signOut } from "@/lib/api";
import type { MentorConfig, VoiceSettings } from "@/lib/jargon-store";
import type { Lesson } from "@/lib/types";
import type { StudentView } from "@/features/student/shell/studentViews";

// The v6 shell: ONE left column carries all navigation, ChatGPT-style — wordmark, the three
// primary views (Tutor chat / Classes / Pulse), a scrollable lessons list (the boot-time catalog,
// current lesson highlighted), and an account row at the bottom opening a MINIMAL popover menu
// (plain depth-card — no gradient chrome, no hover peeks, no motion beyond color). Mentor settings
// open as a centered modal card that blurs the whole background. Desktop: a docked aside at lg+
// (hideable via collapse). Mobile: the same content in a left Sheet drawer.

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

export type AppSidebarProps = {
  email: string;
  mentor: MentorConfig;
  onMentorChange: (m: MentorConfig) => void;
  voice: VoiceSettings;
  onVoiceChange: (v: VoiceSettings) => void;
  view: StudentView | undefined;
  lessons: Lesson[];
  currentLessonId: string;
  // Lesson switching is refused while a turn is in flight — disable the rows so the refusal
  // never reads as a broken click.
  switchBlocked: boolean;
  onOpenLesson: (lessonId: string) => void;
  onGoChat: () => void;
  onOpenClasses: () => void;
  onOpenPulse: () => void;
  pulseBadge: number;
  locked: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// The whole column, shared by the desktop aside and the mobile drawer. Account-menu state is
// per-instance (each instance anchors its own popover to its own account row); the Mentor modal
// is hoisted to AppSidebar so exactly one dialog exists.
function SidebarContent({
  props,
  inDrawer,
  onOpenMentor,
}: {
  props: AppSidebarProps;
  inDrawer: boolean;
  onOpenMentor: () => void;
}) {
  const {
    email,
    view,
    lessons,
    currentLessonId,
    switchBlocked,
    onOpenLesson,
    onGoChat,
    onOpenClasses,
    onOpenPulse,
    pulseBadge,
    onCloseDrawer,
    onToggleCollapse,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const campusLiveUrl = useCampusLiveLink();

  // Every nav action closes the mobile drawer; desktop is unaffected.
  const go = (fn: () => void) => () => {
    fn();
    if (inDrawer) onCloseDrawer();
  };

  const groups = groupByUnit(lessons);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-2">
        <button
          type="button"
          onClick={go(onGoChat)}
          aria-label="Back to the conversation"
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
        <NavRow icon={MessageCircle} label="Tutor chat" active={!view} onClick={go(onGoChat)} />
        <NavRow
          icon={LayoutGrid}
          label="Classes"
          active={view === "classes"}
          onClick={go(onOpenClasses)}
        />
        <NavRow
          icon={Activity}
          label="Pulse"
          active={view === "pulse"}
          badge={pulseBadge}
          onClick={go(onOpenPulse)}
        />
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {groups.length ? (
          <div className="mb-1 px-2.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Lessons
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.unitId} className="mb-2">
            {groups.length > 1 ? (
              <div className="truncate px-2.5 py-1 text-meta text-muted-foreground/80">
                {group.unitTitle}
              </div>
            ) : null}
            {group.lessons.map((lesson) => {
              const current = lesson.id === currentLessonId;
              return (
                <button
                  key={lesson.id}
                  type="button"
                  onClick={go(() => onOpenLesson(lesson.id))}
                  disabled={switchBlocked && !current}
                  aria-current={current ? "true" : undefined}
                  className={`w-full truncate rounded-control px-2.5 py-1.5 text-left text-body transition-colors duration-(--dur-fast) disabled:opacity-40 ${
                    current
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {lesson.title}
                </button>
              );
            })}
          </div>
        ))}
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
            icon={Sparkles}
            label="Mentor"
            onClick={() => {
              setMenuOpen(false);
              // The modal must not stack over the open drawer (double dialog, broken focus
              // restore on close) — the drawer closes first.
              if (inDrawer) onCloseDrawer();
              onOpenMentor();
            }}
          />
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

export function AppSidebar(props: AppSidebarProps) {
  const { mentor, onMentorChange, voice, onVoiceChange, locked, drawerOpen, onCloseDrawer } = props;
  const [mentorOpen, setMentorOpen] = useState(false);

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
      {/* Desktop: docked aside (lg+), hidden when collapsed; inert + dimmed under lockdown. */}
      {!props.collapsed ? (
        <aside
          aria-label="Sidebar"
          inert={locked ? true : undefined}
          className={`relative z-[var(--z-base)] hidden h-full w-[260px] shrink-0 border-r border-border/60 bg-background/70 backdrop-blur-sm transition-opacity duration-(--dur) lg:block ${
            locked ? "pointer-events-none opacity-40" : ""
          }`}
        >
          <SidebarContent props={props} inDrawer={false} onOpenMentor={() => setMentorOpen(true)} />
        </aside>
      ) : null}

      {/* Mobile: the same content in a left drawer (Radix Sheet: focus trap, ESC, scrim). */}
      <Sheet open={drawerOpen} onOpenChange={(o) => !o && onCloseDrawer()}>
        <SheetContent
          side="left"
          className="w-[280px] border-border/60 bg-background p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent props={props} inDrawer onOpenMentor={() => setMentorOpen(true)} />
        </SheetContent>
      </Sheet>

      <ModalCard
        open={mentorOpen}
        onOpenChange={(o) => {
          if (!o) setMentorOpen(false);
        }}
        title="Mentor"
        overlayClassName="bg-black/30 backdrop-blur-md"
      >
        <MentorControls
          mentor={mentor}
          onChange={onMentorChange}
          voice={voice}
          onVoiceChange={onVoiceChange}
        />
      </ModalCard>
    </>
  );
}
