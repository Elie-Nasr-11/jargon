// The single role-gated nav control: a place indicator that opens a command
// palette ("jump to anything", also ⌘K / Ctrl+K) listing only the consoles the
// user can reach. Replaces scattered nav links across the shells.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { BookOpen, ChevronsUpDown, GraduationCap, Layers3, Shield } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useConsoleAccess } from "@/hooks/useConsoleAccess";

export type Place = "chat" | "teacher" | "curriculum" | "admin";

type Dest = {
  place: Place;
  to: "/chat" | "/teacher" | "/teacher/curriculum" | "/admin";
  label: string;
  icon: LucideIcon;
};

const DESTS: Dest[] = [
  { place: "chat", to: "/chat", label: "Student chat", icon: BookOpen },
  { place: "teacher", to: "/teacher", label: "Teacher dashboard", icon: GraduationCap },
  { place: "curriculum", to: "/teacher/curriculum", label: "Curriculum", icon: Layers3 },
  { place: "admin", to: "/admin", label: "Admin", icon: Shield },
];

export function PlaceSwitcher({ active }: { active?: Place }) {
  const navigate = useNavigate();
  const access = useConsoleAccess();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const visible = DESTS.filter((dest) => {
    if (dest.place === "chat") return access.student;
    if (dest.place === "admin") return access.admin;
    return access.teacher; // teacher dashboard + curriculum
  });

  const current = DESTS.find((dest) => dest.place === active);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-1 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        aria-label="Switch console (Cmd/Ctrl+K)"
      >
        {current ? <current.icon className="h-3.5 w-3.5" strokeWidth={1.7} /> : null}
        {current ? current.label : "Menu"}
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Go to">
            {visible.map((dest) => (
              <CommandItem
                key={dest.place}
                value={dest.label}
                onSelect={() => {
                  setOpen(false);
                  navigate({ to: dest.to });
                }}
              >
                <dest.icon className="mr-2 h-4 w-4" strokeWidth={1.7} />
                {dest.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
