// Shared chrome for the signed-in consoles (teacher dashboard, curriculum, admin).
// AmbientCanvas + a sticky top header (Jargon link + optional Dashboard/Curriculum
// nav switcher + SettingsMenu) + a width-constrained <main>. Using one shell across
// the teacher dashboard and curriculum is what makes curriculum feel like part of the
// same console instead of a separate page.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { SettingsMenu } from "@/components/SettingsMenu";
import { cn } from "@/lib/utils";

export function ConsoleShell({
  email,
  children,
  activeNav,
  widthClass = "max-w-[1240px]",
  intensity = 0.24,
}: {
  email?: string;
  children: ReactNode;
  // When set, renders the teacher nav switcher with the given segment active.
  activeNav?: "dashboard" | "curriculum";
  widthClass?: string;
  intensity?: number;
}) {
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
            <div className="flex items-center gap-4">
              <Link to="/chat" className="font-serif text-[22px] tracking-tight text-foreground">
                Jargon
              </Link>
              {activeNav ? (
                <div className="hidden items-center gap-1 rounded-pill border border-border bg-surface-1 p-0.5 sm:flex">
                  <Link
                    to="/teacher"
                    className={cn(
                      "rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors",
                      activeNav === "dashboard"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/teacher/curriculum"
                    className={cn(
                      "rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors",
                      activeNav === "curriculum"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Curriculum
                  </Link>
                </div>
              ) : null}
            </div>
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
