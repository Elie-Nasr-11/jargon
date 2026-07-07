import { useNavigate } from "@tanstack/react-router";
import type { ComponentType } from "react";
import {
  Bell,
  CalendarDays,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import { useCampusLiveLink } from "@/hooks/useCampusLiveLink";
import { signOut } from "@/lib/api";

// The student's whole navigation, as a right-hand slide-in drawer (replaces the old header icon
// cluster + gear). Grouped Learning / Messages / Settings; each item opens its own clean modal via
// onSelect. Appearance toggles inline; Campus Live + Log out act inline. Per-item counts surface the
// same unread/due state that the menu-trigger dot summarizes.

export type NavKey =
  | "overview"
  | "classes"
  | "calendar"
  | "grades"
  | "review"
  | "messages"
  | "profile"
  | "mentor"
  | "notifications";

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-3 px-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

function Count({ n, dot }: { n?: number; dot?: boolean }) {
  if (dot) return <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />;
  if (!n) return null;
  return (
    <span className="shrink-0 rounded-full bg-danger px-1.5 text-[10.5px] font-medium leading-[17px] text-background">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function NavRow({
  icon: Icon,
  label,
  onClick,
  count,
  dot,
  trailing,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  count?: number;
  dot?: boolean;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2.5 rounded-md px-2 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.5} />
        {label}
      </span>
      <span className="flex items-center gap-2">
        {trailing ? (
          <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
            {trailing}
          </span>
        ) : null}
        <Count n={count} dot={dot} />
      </span>
    </button>
  );
}

export function StudentNav({
  open,
  onOpenChange,
  email,
  reviewDueCount,
  messagesUnread,
  notificationsUnread,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  reviewDueCount: number;
  messagesUnread: boolean;
  notificationsUnread: number;
  onSelect: (key: NavKey) => void;
}) {
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const campusLiveUrl = useCampusLiveLink();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(340px,86vw)] flex-col gap-0 border-l border-border bg-background p-0"
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SheetDescription className="sr-only">
          Navigate your classes, messages, and settings.
        </SheetDescription>

        <div className="flex items-center gap-3 border-b border-border px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[12px] text-muted-foreground">
            {email.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-foreground">Signed in</div>
            <div className="truncate text-[12px] text-muted-foreground">{email}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <SectionLabel>Learning</SectionLabel>
          <NavRow icon={LayoutDashboard} label="Overview" onClick={() => onSelect("overview")} />
          <NavRow icon={LayoutGrid} label="Classes" onClick={() => onSelect("classes")} />
          <NavRow icon={CalendarDays} label="Calendar" onClick={() => onSelect("calendar")} />
          <NavRow icon={GraduationCap} label="Grades" onClick={() => onSelect("grades")} />
          <NavRow
            icon={RotateCcw}
            label="Review"
            count={reviewDueCount}
            onClick={() => onSelect("review")}
          />

          <SectionLabel>Messages</SectionLabel>
          <NavRow
            icon={MessageCircle}
            label="Messages"
            dot={messagesUnread}
            onClick={() => onSelect("messages")}
          />

          <SectionLabel>Settings</SectionLabel>
          <NavRow icon={User} label="Profile" onClick={() => onSelect("profile")} />
          <NavRow icon={Sparkles} label="Mentor" onClick={() => onSelect("mentor")} />
          <NavRow
            icon={resolved === "dark" ? Sun : Moon}
            label="Appearance"
            trailing={resolved === "dark" ? "Dark" : "Light"}
            onClick={toggle}
          />
          <NavRow
            icon={Bell}
            label="Notifications"
            count={notificationsUnread}
            onClick={() => onSelect("notifications")}
          />
          {campusLiveUrl ? (
            <a
              href={campusLiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenChange(false)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.5} /> Campus Live
            </a>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
          >
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.5} /> Log out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
