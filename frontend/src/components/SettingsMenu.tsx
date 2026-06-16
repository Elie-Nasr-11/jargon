import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { Settings, LogOut, Sun, Moon } from "lucide-react";
import { GradientCard } from "./GradientCard";
import { useTheme } from "@/lib/theme";
import { signOut } from "@/lib/api";

export function SettingsMenu({ email }: { email: string }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();

  const open = () => {
    setMounted(true);
    setVisible(true);
  };
  const close = () => setVisible(false);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const el = panelRef.current;
    if (!el) return;
    if (visible) {
      gsap.fromTo(
        el,
        { y: -8, opacity: 0, scale: 0.98 },
        { y: 0, opacity: 1, scale: 1, duration: 0.26, ease: "power3.out" },
      );
    } else {
      gsap.to(el, {
        y: -8,
        opacity: 0,
        scale: 0.98,
        duration: 0.18,
        ease: "power2.in",
        onComplete: () => setMounted(false),
      });
    }
  }, [visible, mounted]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (visible ? close() : open())}
        aria-label="Settings"
        className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
      >
        <Settings className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>
      {mounted && (
        <div
          ref={panelRef}
          className="absolute right-0 top-[calc(100%+10px)]"
          style={{ width: "min(280px, calc(100vw - 16px))" }}
        >
          <GradientCard>
            <div className="p-4">
              <div className="flex items-center gap-3 px-1 pb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[12px] text-muted-foreground">
                  {email.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-foreground">Signed in</div>
                  <div className="truncate text-[12px] text-muted-foreground">{email}</div>
                </div>
              </div>
              <div className="my-2 h-px bg-border" />
              <button
                type="button"
                onClick={toggle}
                className="flex w-full items-center justify-between gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
              >
                <span className="flex items-center gap-2.5">
                  {resolved === "dark" ? (
                    <Sun className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  ) : (
                    <Moon className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  )}
                  Appearance
                </span>
                <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
                  {resolved === "dark" ? "Dark" : "Light"}
                </span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/login" });
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
              >
                <LogOut className="h-[15px] w-[15px]" strokeWidth={1.5} /> Log out
              </button>
            </div>
          </GradientCard>
        </div>
      )}
    </div>
  );
}
