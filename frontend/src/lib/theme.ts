import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

const KEY = "jargon-theme";

function systemPref(): Resolved {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function apply(resolved: Resolved) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readMode());
  const [resolved, setResolved] = useState<Resolved>(() =>
    mode === "system" ? systemPref() : mode,
  );

  useEffect(() => {
    const r = mode === "system" ? systemPref() : mode;
    setResolved(r);
    apply(r);
    window.localStorage.setItem(KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => {
      const r: Resolved = mq.matches ? "dark" : "light";
      setResolved(r);
      apply(r);
    };
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const current = prev === "system" ? systemPref() : prev;
      return current === "dark" ? "light" : "dark";
    });
  }, []);

  const setTheme = useCallback((m: ThemeMode) => setMode(m), []);

  return { mode, resolved, setTheme, toggle };
}
