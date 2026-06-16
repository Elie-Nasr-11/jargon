import { useCallback, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Resolved = "light" | "dark";
type ThemeSnapshot = { mode: ThemeMode; resolved: Resolved };

const KEY = "jargon-theme";
const listeners = new Set<() => void>();
let runtimeReady = false;
const SERVER_SNAPSHOT: ThemeSnapshot = { mode: "system", resolved: "light" };

function systemPref(): Resolved {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function resolveMode(mode: ThemeMode): Resolved {
  return mode === "system" ? systemPref() : mode;
}

function apply(resolved: Resolved) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

function writeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, mode);
}

function makeSnapshot(mode: ThemeMode): ThemeSnapshot {
  return { mode, resolved: resolveMode(mode) };
}

let snapshot: ThemeSnapshot = makeSnapshot(readMode());

function emit() {
  listeners.forEach((listener) => listener());
}

function publish(mode: ThemeMode, persist = true) {
  const next = makeSnapshot(mode);
  const changed = next.mode !== snapshot.mode || next.resolved !== snapshot.resolved;
  snapshot = next;
  if (persist) writeMode(mode);
  apply(next.resolved);
  if (changed) emit();
}

function normalizeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function ensureRuntime() {
  if (runtimeReady || typeof window === "undefined") return;
  runtimeReady = true;

  publish(readMode(), false);

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (snapshot.mode === "system") publish("system", false);
  });

  window.addEventListener("storage", (event) => {
    if (event.key === KEY) publish(normalizeMode(event.newValue), false);
  });
}

function subscribe(listener: () => void) {
  ensureRuntime();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return SERVER_SNAPSHOT;
}

export function useTheme() {
  const { mode, resolved } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    publish(snapshot.resolved === "dark" ? "light" : "dark");
  }, []);

  const setTheme = useCallback((m: ThemeMode) => publish(m), []);

  return { mode, resolved, setTheme, toggle };
}
