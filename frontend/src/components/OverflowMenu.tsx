// A compact "⋯" overflow menu for secondary card actions. Action-heavy cards
// (resources, assignments, assessments) keep one or two primary buttons visible
// and tuck the rest behind a single trigger so the card doesn't sprawl.
import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type OverflowAction = {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Tints the item to signal a destructive/warning action. */
  tone?: "default" | "danger";
  /** Draw a divider above this item to group it. */
  separatorBefore?: boolean;
};

export function OverflowMenu({
  actions,
  label = "More actions",
  align = "end",
}: {
  actions: (OverflowAction | null | false | undefined)[];
  label?: string;
  align?: "start" | "center" | "end";
}) {
  const items = actions.filter(Boolean) as OverflowAction[];
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.7} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[12rem]">
        {items.map((action, index) => {
          const Icon = action.icon;
          return (
            <Fragment key={`${action.label}-${index}`}>
              {action.separatorBefore && index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={action.disabled}
                onSelect={(event) => {
                  event.preventDefault();
                  action.onClick();
                }}
                className={
                  action.tone === "danger"
                    ? "text-[12.5px] text-destructive focus:text-destructive"
                    : "text-[12.5px]"
                }
              >
                {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={1.6} /> : null}
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
