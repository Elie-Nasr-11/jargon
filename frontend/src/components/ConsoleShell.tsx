// Shared chrome for the signed-in consoles (teacher dashboard, curriculum, admin).
// AmbientCanvas + a sticky top header (just the Jargon logo + SettingsMenu) + a
// width-constrained <main>. Using one shell across the teacher dashboard and
// curriculum is what makes curriculum feel like part of the same console.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { SettingsMenu } from "@/components/SettingsMenu";
import { useConsoleAccess } from "@/hooks/useConsoleAccess";
import { cn } from "@/lib/utils";

export function ConsoleShell({
  email,
  children,
  widthClass = "max-w-[1240px]",
  intensity = 0.24,
}: {
  email?: string;
  children: ReactNode;
  widthClass?: string;
  intensity?: number;
}) {
  const access = useConsoleAccess();
  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={intensity} />
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div
            className={cn(
              "mx-auto flex h-[60px] items-center justify-between gap-2 px-3 sm:px-6",
              widthClass,
            )}
          >
            <Link
              to={access.home ?? "/chat"}
              className="font-serif text-[22px] tracking-tight text-foreground"
            >
              Jargon
            </Link>
            {email ? <SettingsMenu email={email} /> : null}
          </div>
        </div>
      </header>

      <main
        className={cn(
          "relative z-10 mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6",
          widthClass,
        )}
      >
        {children}
      </main>
    </div>
  );
}
