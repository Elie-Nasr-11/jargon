// Shared tabbed-workspace primitives for the teacher & admin consoles.
//
// Thin styling layer over the shadcn/Radix Tabs primitive. Panels use
// `forceMount` so every section stays mounted (form state + on-mount effects
// behave exactly as a single scrolling page) — only visibility is tab-gated.
// Style matches the app: a segmented pill bar using the shared tokens, and the
// tab strip scrolls horizontally on narrow viewports instead of wrapping.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  ClipboardList,
  DollarSign,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Table2,
  UserPlus,
  Users,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export { Tabs };

// Icon per known tab value, so both the teacher and admin tab bars are scannable
// and consistent without each call site passing an icon.
const TAB_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  lessons: BookOpen,
  gradebook: Table2,
  roster: Users,
  resources: FolderOpen,
  assignments: ClipboardList,
  assessments: GraduationCap,
  transcript: MessageSquare,
  records: FileText,
  readiness: Activity,
  school: FileSpreadsheet,
  google: BookOpen,
  cost: DollarSign,
  ops: Settings,
  seeding: UserPlus,
};

export function WorkspaceTabList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="no-scrollbar -mx-1 mb-1 overflow-x-auto px-1">
      <TabsList
        className={cn(
          "inline-flex h-auto w-max flex-nowrap items-center gap-1 rounded-pill border border-border bg-surface-1 p-1 backdrop-blur-md",
          className,
        )}
      >
        {children}
      </TabsList>
    </div>
  );
}

export function WorkspaceTab({ value, children }: { value: string; children: ReactNode }) {
  const Icon = TAB_ICONS[value];
  return (
    <TabsTrigger
      value={value}
      className="inline-flex items-center gap-1.5 rounded-pill whitespace-nowrap px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none"
    >
      {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={1.7} /> : null}
      {children}
    </TabsTrigger>
  );
}

export function WorkspacePanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsContent
      value={value}
      forceMount
      className={cn("mt-4 data-[state=inactive]:hidden", className)}
    >
      {children}
    </TabsContent>
  );
}
