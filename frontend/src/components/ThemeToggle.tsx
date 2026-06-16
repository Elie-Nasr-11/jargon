import { useEffect, useRef, useState } from "react";
import { Sun, Moon } from "lucide-react";
import gsap from "gsap";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({
  className = "",
  floating = false,
}: {
  className?: string;
  floating?: boolean;
}) {
  const { resolved, toggle } = useTheme();
  const iconRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onClick = () => {
    if (iconRef.current) {
      gsap.fromTo(
        iconRef.current,
        { rotate: -90, scale: 0.6, opacity: 0.4 },
        { rotate: 0, scale: 1, opacity: 1, duration: 0.45, ease: "power3.out" },
      );
    }
    toggle();
  };

  const isDark = resolved === "dark";

  if (floating) {
    if (!mounted) return null;
    return (
      <button
        onClick={onClick}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`fixed bottom-5 left-5 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground shadow-[0_6px_24px_rgba(0,0,0,0.06)] backdrop-blur-md transition-colors hover:text-foreground ${className}`}
        style={{ background: "color-mix(in oklab, var(--surface) 80%, transparent)" }}
      >
        <span ref={iconRef} className="inline-flex">
          {isDark ? (
            <Sun className="h-[18px] w-[18px]" strokeWidth={1.5} />
          ) : (
            <Moon className="h-[18px] w-[18px]" strokeWidth={1.5} />
          )}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${className}`}
    >
      <span ref={iconRef} className="inline-flex">
        {isDark ? (
          <Sun className="h-[18px] w-[18px]" strokeWidth={1.5} />
        ) : (
          <Moon className="h-[18px] w-[18px]" strokeWidth={1.5} />
        )}
      </span>
    </button>
  );
}
