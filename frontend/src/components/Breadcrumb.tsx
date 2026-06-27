// Shared breadcrumb for the teacher & admin consoles. Segments render left to
// right separated by chevrons; a segment with `onClick` is a clickable link, the
// last segment is the current location (emphasized, not clickable).
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; onClick?: () => void };

export function Breadcrumb({ segments }: { segments: Crumb[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={index} className="flex items-center gap-1.5">
            {index > 0 ? (
              <ChevronRight className="h-3.5 w-3.5 opacity-50" strokeWidth={1.7} />
            ) : null}
            {segment.onClick && !isLast ? (
              <button
                type="button"
                onClick={segment.onClick}
                className="transition-colors hover:text-foreground"
              >
                {segment.label}
              </button>
            ) : (
              <span className={isLast ? "font-medium text-foreground" : undefined}>
                {segment.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
