// Shared empty-state block: a dashed, centered panel with an icon so "nothing
// here yet" reads clearly and doesn't look like a data card.
import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon = Inbox,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-depth-sub px-4 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/60" strokeWidth={1.5} />
      <div className="text-[13px] text-muted-foreground">{children}</div>
    </div>
  );
}
