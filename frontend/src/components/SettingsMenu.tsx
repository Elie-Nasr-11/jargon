import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import {
  BookOpen,
  GraduationCap,
  LogOut,
  Mic,
  Moon,
  Settings,
  Shield,
  Sun,
  Volume2,
} from "lucide-react";
import { GradientCard } from "./GradientCard";
import type { VoiceSettings } from "@/lib/jargon-store";
import { useTheme } from "@/lib/theme";
import { signOut } from "@/lib/api";

export function SettingsMenu({
  email,
  voice,
  onVoiceChange,
}: {
  email: string;
  voice?: VoiceSettings;
  onVoiceChange?: (voice: VoiceSettings) => void;
}) {
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
          style={{ width: "min(320px, calc(100vw - 16px))" }}
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
              {voice && onVoiceChange ? (
                <>
                  <div className="my-2 h-px bg-border" />
                  <button
                    type="button"
                    onClick={() =>
                      onVoiceChange({ ...voice, dictationEnabled: !voice.dictationEnabled })
                    }
                    className="flex w-full items-center justify-between gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
                  >
                    <span className="flex items-center gap-2.5">
                      <Mic className="h-[15px] w-[15px]" strokeWidth={1.5} />
                      Dictation
                    </span>
                    <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      {voice.dictationEnabled ? "On" : "Off"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onVoiceChange({ ...voice, readAloudEnabled: !voice.readAloudEnabled })
                    }
                    className="flex w-full items-center justify-between gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
                  >
                    <span className="flex items-center gap-2.5">
                      <Volume2 className="h-[15px] w-[15px]" strokeWidth={1.5} />
                      Read aloud
                    </span>
                    <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      {voice.readAloudEnabled ? "On" : "Off"}
                    </span>
                  </button>
                  <div className="px-2 pb-2 pt-1">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      Reading speed
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: "Slow", value: 0.85 },
                        { label: "Normal", value: 1 },
                        { label: "Fast", value: 1.2 },
                      ].map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() =>
                            onVoiceChange({
                              ...voice,
                              readAloudRate: option.value as VoiceSettings["readAloudRate"],
                            })
                          }
                          className={`rounded-full border px-2 py-1.5 text-[11.5px] transition-colors ${
                            voice.readAloudRate === option.value
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  close();
                  navigate({ to: "/chat" });
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
              >
                <BookOpen className="h-[15px] w-[15px]" strokeWidth={1.5} /> Student chat
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  navigate({ to: "/teacher" });
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
              >
                <GraduationCap className="h-[15px] w-[15px]" strokeWidth={1.5} /> Teacher
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  navigate({ to: "/admin" });
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2"
              >
                <Shield className="h-[15px] w-[15px]" strokeWidth={1.5} /> Admin
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
