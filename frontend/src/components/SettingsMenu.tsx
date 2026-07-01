import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { ExternalLink, LogOut, Mic, Moon, Settings, Sun, Volume2 } from "lucide-react";
import { GradientCard } from "./GradientCard";
import type { VoiceSettings } from "@/lib/jargon-store";
import { useTheme } from "@/lib/theme";
import { useIsTouch } from "@/hooks/useIsTouch";
import { useCampusLiveLink } from "@/hooks/useCampusLiveLink";
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
  const isTouch = useIsTouch();
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const campusLiveUrl = useCampusLiveLink();

  const open = () => {
    setMounted(true);
    setVisible(true);
  };
  const close = () => setVisible(false);

  // Only listen for outside taps while open, and register AFTER the opening click settles, so
  // the tap that opens the menu can't also be read as an "outside" pointerdown and close it.
  useEffect(() => {
    if (!visible) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (sheetRef.current?.contains(t)) return; // taps inside the mobile sheet
      close();
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
  }, [visible]);

  // Open/close animation — a bottom sheet on touch (can't open off-screen), a dropdown on desktop.
  useEffect(() => {
    if (!mounted) return;
    if (isTouch) {
      const sheet = sheetRef.current;
      const backdrop = backdropRef.current;
      if (!sheet || !backdrop) return;
      gsap.killTweensOf([sheet, backdrop]);
      if (visible) {
        gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
        gsap.fromTo(sheet, { y: "100%" }, { y: "0%", duration: 0.32, ease: "power3.out" });
      } else {
        gsap.to(backdrop, { opacity: 0, duration: 0.18, ease: "power2.in" });
        gsap.to(sheet, {
          y: "100%",
          duration: 0.22,
          ease: "power2.in",
          onComplete: () => setMounted(false),
        });
      }
      return;
    }
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
  }, [visible, mounted, isTouch]);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!isTouch || !visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isTouch, visible]);

  const rowClass =
    "flex w-full items-center justify-between gap-2.5 rounded-md px-2 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:py-2";

  const content = (
    <>
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
      <button type="button" onClick={toggle} className={rowClass}>
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
            onClick={() => onVoiceChange({ ...voice, dictationEnabled: !voice.dictationEnabled })}
            className={rowClass}
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
            onClick={() => onVoiceChange({ ...voice, readAloudEnabled: !voice.readAloudEnabled })}
            className={rowClass}
          >
            <span className="flex items-center gap-2.5">
              <Volume2 className="h-[15px] w-[15px]" strokeWidth={1.5} />
              Read aloud
            </span>
            <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
              {voice.readAloudEnabled ? "On" : "Off"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onVoiceChange({ ...voice, realtimeEnabled: !voice.realtimeEnabled })}
            className={rowClass}
          >
            <span className="flex items-center gap-2.5">
              <Mic className="h-[15px] w-[15px]" strokeWidth={1.5} />
              Live voice
            </span>
            <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
              {voice.realtimeEnabled ? "On" : "Off"}
            </span>
          </button>
          <div className="px-2 pb-2 pt-1">
            <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Mentor voice
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(["marin", "cedar", "coral", "nova", "shimmer"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onVoiceChange({ ...voice, voiceName: option })}
                  className={`rounded-full border px-2 py-1.5 text-[11px] capitalize transition-colors ${
                    voice.voiceName === option
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
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
      {campusLiveUrl ? (
        <a
          href={campusLiveUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={close}
          className={rowClass}
        >
          <span className="flex items-center gap-2.5">
            <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.5} /> Campus Live
          </span>
        </a>
      ) : null}
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
    </>
  );

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

      {/* Desktop dropdown */}
      {mounted && !isTouch && (
        <div
          ref={panelRef}
          className="absolute right-0 top-[calc(100%+10px)] z-[var(--z-menu)]"
          style={{ width: "min(320px, calc(100vw - 16px))" }}
        >
          <GradientCard>
            <div className="max-h-[calc(100dvh-84px)] overflow-y-auto overscroll-contain p-4">
              {content}
            </div>
          </GradientCard>
        </div>
      )}

      {/* Mobile bottom sheet — fixed, so it can never open off-screen or get clipped. */}
      {mounted && isTouch && (
        <>
          <div
            ref={backdropRef}
            onClick={close}
            className="fixed inset-0 z-40"
            style={{
              background: "color-mix(in oklab, var(--background) 55%, rgba(0,0,0,0.45))",
              opacity: 0,
            }}
          />
          <div
            ref={sheetRef}
            className="fixed inset-x-0 bottom-0 z-50"
            style={{ transform: "translateY(100%)" }}
          >
            <div className="mx-auto w-full max-w-[640px] px-2 pb-[max(env(safe-area-inset-bottom),12px)]">
              <GradientCard>
                <div className="flex flex-col" style={{ maxHeight: "82vh" }}>
                  <div className="flex justify-center pt-2.5">
                    <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
                  </div>
                  <div className="min-h-0 overflow-y-auto overscroll-contain p-4">{content}</div>
                </div>
              </GradientCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
