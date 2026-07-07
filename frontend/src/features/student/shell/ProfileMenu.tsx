import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { ArrowLeft, ExternalLink, LogOut, Moon, Sparkles, Sun, User } from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import { Popover } from "@/components/Popover";
import { MentorControls } from "@/features/student/MentorControls";
import { useTheme } from "@/lib/theme";
import { useCampusLiveLink } from "@/hooks/useCampusLiveLink";
import { prefersReducedMotion } from "@/lib/motion";
import { signOut } from "@/lib/api";
import type { MentorConfig, VoiceSettings } from "@/lib/jargon-store";

// The settings dot — the ONLY account surface on the v5 stage: an avatar in the top-right corner.
// Hover peeks who's signed in (the edge law: hover = slightly-more-desirable info); click opens
// the Settings mini-menu (Mentor · Appearance inline toggle · Campus Live · Log out); Mentor
// expands IN PLACE as an anchored card (a back chevron returns) — floating, not modal, so the
// stage stays live. Desktop anchors under the avatar (Popover); below lg the same content rides
// the house bottom-sheet pattern. Profile stats moved to Pulse → Performance; notifications live
// in the Pulse activity feed.

type Card = "menu" | "mentor";

const CARD_TITLES: Record<Exclude<Card, "menu">, string> = {
  mentor: "Mentor",
};

function MenuRow({
  icon: Icon,
  label,
  onClick,
  count,
  trailing,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  count?: number;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2.5 rounded-control px-2.5 py-2.5 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.5} />
        {label}
      </span>
      <span className="flex items-center gap-2">
        {trailing ? (
          <span className="text-overline uppercase tracking-[0.08em] text-muted-foreground">
            {trailing}
          </span>
        ) : null}
        {count ? (
          <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
            · {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// Tracks the lg breakpoint (1024px) — the same line where the persistent sidebar docks.
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export function ProfileMenu({
  email,
  mentor,
  onMentorChange,
  voice,
  onVoiceChange,
}: {
  email: string;
  mentor: MentorConfig;
  onMentorChange: (m: MentorConfig) => void;
  voice: VoiceSettings;
  onVoiceChange: (v: VoiceSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Card>("menu");
  // Hover peek (fine pointers): who's signed in, after a 120ms intent pause; never while open.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();
  const campusLiveUrl = useCampusLiveLink();
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [sheetMounted, setSheetMounted] = useState(false);

  // Crossing the lg breakpoint while open would strand open=true with nothing rendered (and
  // the mobile scroll lock engaged) — reset on either crossing.
  useEffect(() => {
    setOpen(false);
    setSheetMounted(false);
  }, [desktop]);

  const openMenu = () => {
    setCard("menu");
    if (desktop) setOpen(true);
    else {
      setSheetMounted(true);
      setOpen(true);
    }
  };
  const close = () => setOpen(false);

  // Desktop panel entrance — crisp drop-in on open and on card switches; no exit tween.
  useEffect(() => {
    if (!desktop || !open || prefersReducedMotion() || !panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: 0, y: -4, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: "power2.out" },
    );
  }, [open, card, desktop]);

  // Mobile bottom sheet open/close (the SettingsMenu house pattern).
  useEffect(() => {
    if (desktop || !sheetMounted) return;
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (!sheet || !backdrop) return;
    gsap.killTweensOf([sheet, backdrop]);
    if (prefersReducedMotion()) {
      if (open) {
        gsap.set(backdrop, { opacity: 1 });
        gsap.set(sheet, { y: "0%" });
      } else {
        gsap.set(backdrop, { opacity: 0 });
        gsap.set(sheet, { y: "100%" });
        setSheetMounted(false);
      }
      return;
    }
    if (open) {
      gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
      gsap.fromTo(sheet, { y: "100%" }, { y: "0%", duration: 0.32, ease: "power3.out" });
    } else {
      gsap.to(backdrop, { opacity: 0, duration: 0.18, ease: "power2.in" });
      gsap.to(sheet, {
        y: "100%",
        duration: 0.22,
        ease: "power2.in",
        onComplete: () => setSheetMounted(false),
      });
    }
  }, [open, sheetMounted, desktop]);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (desktop || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, desktop]);

  // ESC closes the sheet (the desktop Popover already handles its own ESC/outside-tap).
  useEffect(() => {
    if (desktop || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, desktop]);

  const menuContent = (
    <div className="p-1.5">
      <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-depth-sub text-meta font-medium text-muted-foreground">
          {email.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-meta font-medium text-foreground">Signed in</div>
          <div className="truncate text-meta text-muted-foreground">{email}</div>
        </div>
      </div>
      <div className="mb-1 px-2.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Settings
      </div>
      <MenuRow icon={Sparkles} label="Mentor" onClick={() => setCard("mentor")} />
      <MenuRow
        icon={resolved === "dark" ? Sun : Moon}
        label="Appearance"
        trailing={resolved === "dark" ? "Dark" : "Light"}
        onClick={toggle}
      />
      {campusLiveUrl ? (
        <a
          href={campusLiveUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={close}
          className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2.5 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.5} /> Campus Live
        </a>
      ) : null}
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={async () => {
          await signOut();
          navigate({ to: "/login" });
        }}
        className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2.5 text-left text-body text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
      >
        <LogOut className="h-[15px] w-[15px]" strokeWidth={1.5} /> Log out
      </button>
    </div>
  );

  const cardContent = (activeCard: Exclude<Card, "menu">) => (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <button
          type="button"
          onClick={() => setCard("menu")}
          aria-label="Back to settings"
          className="text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {CARD_TITLES[activeCard]}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        <MentorControls
          mentor={mentor}
          onChange={onMentorChange}
          voice={voice}
          onVoiceChange={onVoiceChange}
        />
      </div>
    </div>
  );

  const panel = (
    <GradientCard>
      <div ref={panelRef}>{card === "menu" ? menuContent : cardContent(card)}</div>
    </GradientCard>
  );

  const trigger = (
    <>
      <button
        type="button"
        onClick={() => {
          if (peekTimer.current) clearTimeout(peekTimer.current);
          setPeek(false);
          if (open) close();
          else openMenu();
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse" || open) return;
          peekTimer.current = setTimeout(() => setPeek(true), 120);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          if (peekTimer.current) clearTimeout(peekTimer.current);
          setPeek(false);
        }}
        aria-label={`Account and settings — ${email || "signed in"}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-depth-card text-meta font-medium text-foreground shadow-card transition-colors duration-(--dur-fast) hover:bg-muted"
      >
        {email ? email.slice(0, 1).toUpperCase() : <User className="h-4 w-4" strokeWidth={1.6} />}
      </button>
      {peek && !open ? (
        <span
          aria-hidden
          className="absolute right-0 top-[calc(100%+6px)] z-[var(--z-menu)] whitespace-nowrap rounded-pill border border-border bg-depth-card px-3 py-1.5 text-meta text-muted-foreground shadow-raised"
        >
          Signed in as <span className="font-medium text-foreground">{email}</span>
        </span>
      ) : null}
    </>
  );

  if (desktop) {
    return (
      <Popover
        open={open}
        onClose={close}
        trigger={trigger}
        panelStyle={{ width: card === "menu" ? 260 : "min(400px, calc(100vw - 16px))" }}
      >
        {panel}
      </Popover>
    );
  }

  return (
    <div className="relative">
      {trigger}
      {sheetMounted &&
        createPortal(
          <>
            <div
              ref={backdropRef}
              onClick={close}
              className="fixed inset-0 z-[var(--z-overlay)]"
              style={{
                background: "color-mix(in oklab, var(--background) 55%, rgba(0,0,0,0.45))",
                opacity: 0,
              }}
            />
            <div
              ref={sheetRef}
              className="fixed inset-x-0 bottom-0 z-[var(--z-overlay)]"
              style={{ transform: "translateY(100%)" }}
            >
              <div className="mx-auto w-full max-w-[640px] px-2 pb-[max(env(safe-area-inset-bottom),12px)]">
                <GradientCard>
                  <div className="flex flex-col" style={{ maxHeight: "82vh" }}>
                    <div className="flex justify-center pt-2.5">
                      <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
                    </div>
                    <div className="min-h-0 overflow-y-auto overscroll-contain">
                      {card === "menu" ? menuContent : cardContent(card)}
                    </div>
                  </div>
                </GradientCard>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
