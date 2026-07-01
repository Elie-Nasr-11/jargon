import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { ChevronDown, Menu, X } from "lucide-react";
import { GradientCard } from "./GradientCard";
import { useIsTouch } from "@/hooks/useIsTouch";
import { LESSONS, type Lesson, type MentorConfig } from "@/lib/jargon-store";

type MenuKey = "lessons" | "progress" | "mentor";

const WIDTHS: Record<MenuKey, number> = {
  lessons: 380,
  progress: 380,
  mentor: 380,
};

export function HeaderMenus({
  activeLessonId,
  lessons = LESSONS,
  onSelectLesson,
  mentor,
  onMentorChange,
}: {
  activeLessonId: string;
  lessons?: Lesson[];
  onSelectLesson: (id: string) => void;
  mentor: MentorConfig;
  onMentorChange: (m: MentorConfig) => void;
}) {
  const isTouch = useIsTouch();
  const [activeKey, setActiveKey] = useState<MenuKey | null>(null);
  const [contentKey, setContentKey] = useState<MenuKey | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerBackdropRef = useRef<HTMLDivElement>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const enter = (k: MenuKey) => {
    cancelClose();
    setActiveKey(k);
  };
  const leave = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setActiveKey(null), 110);
  };
  const close = () => {
    cancelClose();
    setActiveKey(null);
  };
  const toggle = (k: MenuKey) => {
    cancelClose();
    setActiveKey((prev) => (prev === k ? null : k));
  };
  const openDrawer = () => {
    setDrawerMounted(true);
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);

  // Outside tap + Escape close
  useEffect(() => {
    if (!activeKey) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [activeKey]);

  // Desktop dropdown open/close
  useEffect(() => {
    if (isTouch) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (activeKey) {
      if (!contentKey) {
        setContentKey(activeKey);
        return;
      }
      if (!isOpenRef.current) {
        isOpenRef.current = true;
        gsap.killTweensOf(panel);
        gsap.fromTo(
          panel,
          { y: -6, opacity: 0, scale: 0.985 },
          { y: 0, opacity: 1, scale: 1, duration: 0.24, ease: "power3.out" },
        );
      }
    } else if (isOpenRef.current) {
      isOpenRef.current = false;
      gsap.killTweensOf(panel);
      gsap.to(panel, {
        y: -4,
        opacity: 0,
        scale: 0.985,
        duration: 0.16,
        ease: "power2.in",
      });
    }
  }, [activeKey, contentKey, isTouch]);

  // Desktop crossfade + size morph
  useLayoutEffect(() => {
    if (isTouch) return;
    if (!activeKey || !panelRef.current || !innerRef.current) return;
    if (activeKey === contentKey) {
      const targetW = WIDTHS[activeKey];
      const h = sizerRef.current?.offsetHeight ?? innerRef.current.offsetHeight;
      gsap.set(panelRef.current, { width: targetW, height: h });
      return;
    }
    const targetW = WIDTHS[activeKey];
    const inner = innerRef.current;
    gsap.killTweensOf(inner);
    gsap.to(inner, {
      opacity: 0,
      y: 4,
      duration: 0.12,
      ease: "power2.in",
      onComplete: () => {
        setContentKey(activeKey);
        requestAnimationFrame(() => {
          const h = sizerRef.current?.offsetHeight ?? inner.offsetHeight;
          gsap.to(panelRef.current, {
            width: targetW,
            height: h,
            duration: 0.32,
            ease: "power3.out",
          });
          gsap.fromTo(
            inner,
            { opacity: 0, y: 4 },
            { opacity: 1, y: 0, duration: 0.22, ease: "power2.out", delay: 0.04 },
          );
        });
      },
    });
  }, [activeKey, contentKey, isTouch]);

  // Mobile drawer: slide in/out from the right.
  useEffect(() => {
    if (!drawerMounted) return;
    const drawer = drawerRef.current;
    const backdrop = drawerBackdropRef.current;
    if (!drawer || !backdrop) return;
    gsap.killTweensOf([drawer, backdrop]);
    if (drawerOpen) {
      gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
      gsap.fromTo(drawer, { x: "100%" }, { x: "0%", duration: 0.34, ease: "power3.out" });
    } else {
      gsap.to(backdrop, { opacity: 0, duration: 0.18, ease: "power2.in" });
      gsap.to(drawer, {
        x: "100%",
        duration: 0.24,
        ease: "power2.in",
        onComplete: () => setDrawerMounted(false),
      });
    }
  }, [drawerOpen, drawerMounted]);

  // Escape closes the drawer; lock body scroll while it's open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  const items: { key: MenuKey; label: string }[] = [
    { key: "lessons", label: "Lessons" },
    { key: "progress", label: "Progress" },
    { key: "mentor", label: "Mentor" },
  ];

  const renderPanelBody = (k: MenuKey | null) => (
    <>
      {k === "lessons" && (
        <LessonsPanel
          activeId={activeLessonId}
          lessons={lessons}
          onSelect={(id) => {
            onSelectLesson(id);
            if (isTouch) close();
          }}
        />
      )}
      {k === "progress" && <ProgressPanel activeId={activeLessonId} lessons={lessons} />}
      {k === "mentor" && <MentorPanel mentor={mentor} onChange={onMentorChange} />}
    </>
  );

  return (
    <nav
      ref={wrapRef}
      className="relative flex items-center gap-0.5 sm:gap-1"
      onMouseLeave={isTouch ? undefined : leave}
      onMouseEnter={isTouch ? undefined : cancelClose}
    >
      {/* Desktop: three hover buttons. Mobile: a single drawer trigger. */}
      {!isTouch &&
        items.map((it) => (
          <button
            key={it.key}
            type="button"
            onMouseEnter={() => enter(it.key)}
            onFocus={() => enter(it.key)}
            onClick={() => toggle(it.key)}
            className={`relative inline-flex items-center rounded-full px-3.5 py-1.5 text-[13.5px] tracking-tight transition-colors ${
              activeKey === it.key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {it.label}
          </button>
        ))}
      {isTouch && (
        <button
          type="button"
          aria-label="Open menu"
          onClick={openDrawer}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
        >
          <Menu className="h-[20px] w-[20px]" strokeWidth={1.6} />
        </button>
      )}

      {/* Desktop dropdown */}
      {!isTouch && (
        <div
          ref={panelRef}
          onMouseEnter={cancelClose}
          onMouseLeave={leave}
          className="absolute left-1/2 top-[calc(100%+10px)] z-[var(--z-menu)] -translate-x-1/2"
          style={{
            width: contentKey ? WIDTHS[contentKey] : 380,
            maxWidth: "calc(100vw - 24px)",
            opacity: 0,
            // Closed panel must not intercept clicks: it stays display:block
            // (contentKey persists for the morph), so gate pointer events on open.
            pointerEvents: activeKey ? "auto" : "none",
            willChange: "transform, opacity, width, height",
            transform: "translateZ(0)",
            display: contentKey ? "block" : "none",
          }}
        >
          <div ref={sizerRef}>
            <GradientCard>
              <div ref={innerRef} style={{ willChange: "transform, opacity" }}>
                <div className="p-5">{renderPanelBody(contentKey)}</div>
              </div>
            </GradientCard>
          </div>
        </div>
      )}

      {/* Mobile drawer — one panel with all three titled sections. Portaled to <body> so it
          escapes the header's backdrop-filter, which would otherwise be the fixed drawer's
          containing block and collapse it to the header's height. */}
      {isTouch &&
        drawerMounted &&
        createPortal(
          <>
            <div
              ref={drawerBackdropRef}
              onClick={closeDrawer}
              className="fixed inset-0 z-[100]"
              style={{
                background: "color-mix(in oklab, var(--background) 55%, rgba(0,0,0,0.45))",
                opacity: 0,
              }}
            />
            <div
              ref={drawerRef}
              className="fixed inset-y-0 right-0 z-[101] w-[min(90vw,390px)] p-2 pb-[max(env(safe-area-inset-bottom),8px)]"
              style={{ transform: "translateX(100%)" }}
            >
              <GradientCard
                className="h-full"
                innerClassName="flex h-full flex-col overflow-hidden"
              >
                <div className="flex items-center justify-end px-3 pt-3">
                  <button
                    type="button"
                    onClick={closeDrawer}
                    aria-label="Close menu"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-[18px] w-[18px]" strokeWidth={1.6} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-1">
                  <CollapsibleSection title="Lessons">
                    <LessonsPanel
                      bare
                      activeId={activeLessonId}
                      lessons={lessons}
                      onSelect={(id) => {
                        onSelectLesson(id);
                        closeDrawer();
                      }}
                    />
                  </CollapsibleSection>
                  <CollapsibleSection title="Progress">
                    <ProgressPanel bare activeId={activeLessonId} lessons={lessons} />
                  </CollapsibleSection>
                  <CollapsibleSection title="Mentor">
                    <MentorPanel bare mentor={mentor} onChange={onMentorChange} />
                  </CollapsibleSection>
                </div>
              </GradientCard>
            </div>
          </>,
          document.body,
        )}
    </nav>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-4 text-left"
      >
        <span className="font-serif text-[22px] leading-tight tracking-tight">{title}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.6}
        />
      </button>
      {/* CSS-only collapse: grid rows 0fr -> 1fr animates height with the content clipped. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pb-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function LessonsPanel({
  activeId,
  lessons,
  onSelect,
  bare,
}: {
  activeId: string;
  lessons: Lesson[];
  onSelect: (id: string) => void;
  bare?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const didMount = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const ind = indicatorRef.current;
    if (!list || !ind) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>("[data-lesson-id]")).find(
      (item) => item.dataset.lessonId === activeId,
    );
    if (!row) return;
    const props = {
      y: row.offsetTop + 6,
      height: row.offsetHeight - 12,
    };
    if (!didMount.current) {
      gsap.set(ind, props);
      didMount.current = true;
    } else {
      gsap.to(ind, { ...props, duration: 0.38, ease: "power3.out" });
    }
  }, [activeId, lessons]);

  return (
    <div>
      {!bare && <h3 className="font-serif text-[22px] leading-tight tracking-tight">Lessons</h3>}
      <p className="mt-1 text-[13px] text-muted-foreground">Pick the thread to follow.</p>
      <div ref={listRef} className="relative mt-5">
        <div
          ref={indicatorRef}
          aria-hidden
          className="pointer-events-none absolute left-1 top-0 w-[3px] rounded-full bg-foreground"
          style={{
            height: 24,
            willChange: "transform, height",
          }}
        />
        {groupLessons(lessons).map((group) => (
          <div key={group.name} className="mt-2 first:mt-0">
            <div className="pb-1 pl-5 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              {group.name}
            </div>
            {group.items.map((l) => {
              const active = l.id === activeId;
              return (
                <button
                  key={l.id}
                  type="button"
                  data-lesson-id={l.id}
                  onClick={() => onSelect(l.id)}
                  className="group relative flex w-full items-start gap-3 rounded-md py-3 pl-5 pr-1 text-left transition-colors hover:bg-muted/60 sm:py-2"
                >
                  <span className="flex-1">
                    <span
                      className={`block text-[14.5px] font-medium tracking-tight transition-colors ${
                        active ? "text-foreground" : "text-foreground/85"
                      }`}
                    >
                      {l.title}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
                      {l.subtitle}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function groupLessons(lessons: Lesson[]) {
  const groups = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key = lesson.group || lesson.subtitle.split(" · ")[0] || "Lessons";
    groups.set(key, [...(groups.get(key) || []), lesson]);
  }
  return Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
}

function ProgressPanel({
  activeId,
  lessons,
  bare,
}: {
  activeId: string;
  lessons: Lesson[];
  bare?: boolean;
}) {
  const active = lessons.find((l) => l.id === activeId) ?? lessons[0] ?? LESSONS[0];
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!barRef.current) return;
    gsap.fromTo(
      barRef.current,
      { width: 0 },
      { width: `${Math.round(active.progress * 100)}%`, duration: 0.9, ease: "power3.out" },
    );
  }, [active.id, active.progress]);
  return (
    <div>
      {!bare && <h3 className="font-serif text-[22px] leading-tight tracking-tight">Progress</h3>}
      <p className="mt-1 text-[13px] text-muted-foreground">{active.title}</p>
      <div className="mt-4 h-[5px] w-full overflow-hidden rounded-full bg-muted">
        <div ref={barRef} className="h-full rounded-full bg-foreground" />
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{Math.round(active.progress * 100)}% complete</span>
        <span>{Math.max(0, Math.round((1 - active.progress) * 24))} min left</span>
      </div>

      <div className="mt-5 space-y-2">
        {lessons
          .filter((l) => l.id !== active.id)
          .map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-1">
              <span className="flex-1 truncate text-[13px] text-foreground">{l.title}</span>
              <span className="h-[3px] w-20 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-foreground"
                  style={{
                    width: `${Math.round(l.progress * 100)}%`,
                  }}
                />
              </span>
              <span className="w-8 text-right text-[11.5px] tabular-nums text-muted-foreground">
                {Math.round(l.progress * 100)}%
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function MentorPanel({
  mentor,
  onChange,
  bare,
}: {
  mentor: MentorConfig;
  onChange: (m: MentorConfig) => void;
  bare?: boolean;
}) {
  const groups: {
    key: keyof MentorConfig;
    label: string;
    options: MentorConfig[keyof MentorConfig][];
  }[] = [
    { key: "tone", label: "Tone", options: ["Friendly", "Direct", "Socratic"] },
    { key: "verbosity", label: "Verbosity", options: ["Concise", "Balanced", "Detailed"] },
    { key: "difficulty", label: "Difficulty", options: ["Gentle", "Standard", "Challenging"] },
  ];
  return (
    <div>
      {!bare && <h3 className="font-serif text-[22px] leading-tight tracking-tight">Mentor</h3>}
      <p className="mt-1 text-[13px] text-muted-foreground">Shape how the tutor talks back.</p>
      <div className="mt-5 space-y-4">
        {groups.map((g) => (
          <MentorGroup
            key={g.key as string}
            label={g.label}
            options={g.options as string[]}
            value={mentor[g.key] as string}
            onSelect={(opt) => onChange({ ...mentor, [g.key]: opt } as MentorConfig)}
          />
        ))}
      </div>
    </div>
  );
}

function MentorGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (opt: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const didMount = useRef(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const pill = pillRef.current;
    if (!row || !pill) return;
    const idx = options.indexOf(value);
    const btn = btnRefs.current[idx];
    if (!btn) return;
    const props = { x: btn.offsetLeft, width: btn.offsetWidth };
    if (!didMount.current) {
      gsap.set(pill, props);
      didMount.current = true;
    } else {
      gsap.to(pill, { ...props, duration: 0.34, ease: "power3.out" });
    }
  }, [value, options]);

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div ref={rowRef} className="relative flex gap-1.5 rounded-full border border-border p-[3px]">
        <div
          ref={pillRef}
          aria-hidden
          className="absolute left-0 top-[3px] h-[calc(100%-6px)] rounded-full bg-foreground"
          style={{ width: 0, willChange: "transform, width" }}
        />
        {options.map((opt, i) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              onClick={() => onSelect(opt)}
              className={`relative z-10 flex-1 rounded-full px-2.5 py-2.5 text-[13px] transition-colors sm:py-1.5 sm:text-[12.5px] ${
                active ? "text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Silence unused-import warning for ReactNode in some configs
export type _R = ReactNode;
