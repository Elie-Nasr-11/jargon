import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { ChevronDown, Menu, X } from "lucide-react";
import { GradientCard } from "./GradientCard";
import { useIsTouch } from "@/hooks/useIsTouch";
import { LESSONS, type Lesson } from "@/lib/jargon-store";

// The header "Lessons" menu: the Subject > Unit > Lesson tree. Progress moved to the floating pill,
// and Mentor/Profile/Grades/Notifications moved to the Settings gear, so this is now a single menu.
type MenuKey = "lessons";

const PANEL_WIDTH = 380;

export function HeaderMenus({
  activeLessonId,
  lessons = LESSONS,
  onSelectLesson,
}: {
  activeLessonId: string;
  lessons?: Lesson[];
  onSelectLesson: (id: string) => void;
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
      const targetW = PANEL_WIDTH;
      const h = sizerRef.current?.offsetHeight ?? innerRef.current.offsetHeight;
      gsap.set(panelRef.current, { width: targetW, height: h });
      return;
    }
    const targetW = PANEL_WIDTH;
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

  const items: { key: MenuKey; label: string }[] = [{ key: "lessons", label: "Lessons" }];

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
            width: PANEL_WIDTH,
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
                <div className="max-h-[68vh] overflow-y-auto overscroll-contain p-5">
                  {renderPanelBody(contentKey)}
                </div>
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
                  <CollapsibleSection title="Lessons" defaultOpen>
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

// Accent color used to mark the current lesson / unit / subject (the only cue — no bars, dots,
// tags, indentation, or weight changes).
const ACCENT = "text-[color:var(--accent-text)]";

// Indentation ladder for the Subject > Unit > Lesson tree: each level steps in by 18px.
const INDENT_PER_LEVEL = 18;

// A flat, nestable disclosure. Every row is styled the same; `active` (this section holds the
// current lesson) simply recolors the label to the accent. `depth` only indents the row.
// `plain` uses full-strength foreground (for the Progress "Other lessons" header) instead of
// the slightly-muted default.
function Disclosure({
  label,
  right,
  active = false,
  plain = false,
  depth = 0,
  defaultOpen = false,
  children,
}: {
  label: ReactNode;
  right?: ReactNode;
  active?: boolean;
  plain?: boolean;
  depth?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const labelColor = active ? ACCENT : plain ? "text-foreground" : "text-foreground/70";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md py-2 pr-1.5 text-left transition-colors hover:bg-muted/40"
        style={{ paddingLeft: 6 + depth * INDENT_PER_LEVEL }}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          } ${active ? ACCENT : "text-muted-foreground"}`}
          strokeWidth={1.8}
        />
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-tight ${labelColor}`}
        >
          {label}
        </span>
        {right}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pb-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

type LessonTree = { name: string; units: { name: string | null; items: Lesson[] }[] }[];

// Group the flat lessons into Subject > Unit > Lesson, preserving first-seen subject order and
// sorting units by unit_position and lessons by position. A missing unit title yields a null-named
// unit so the renderer can flatten it.
function buildLessonTree(lessons: Lesson[]): LessonTree {
  const subjects: {
    name: string;
    order: number;
    units: Map<string, { name: string | null; pos: number; items: Lesson[] }>;
  }[] = [];
  const subjectIndex = new Map<string, number>();
  for (const l of lessons) {
    const subjectName = l.subjectTitle || l.group || "Lessons";
    const unitKey = l.unitTitle || "__nounit";
    let si = subjectIndex.get(subjectName);
    if (si === undefined) {
      si = subjects.length;
      subjectIndex.set(subjectName, si);
      subjects.push({ name: subjectName, order: si, units: new Map() });
    }
    const subj = subjects[si];
    let unit = subj.units.get(unitKey);
    if (!unit) {
      unit = { name: l.unitTitle || null, pos: l.unitPosition ?? subj.units.size, items: [] };
      subj.units.set(unitKey, unit);
    }
    unit.items.push(l);
  }
  return subjects.map((s) => ({
    name: s.name,
    units: Array.from(s.units.values())
      .sort((a, b) => a.pos - b.pos)
      .map((u) => ({
        name: u.name,
        items: [...u.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      })),
  }));
}

function LessonRow({
  lesson,
  active,
  depth = 1,
  onSelect,
}: {
  lesson: Lesson;
  active: boolean;
  depth?: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-lesson-id={lesson.id}
      onClick={() => onSelect(lesson.id)}
      className="flex w-full items-center rounded-md py-2 pr-1.5 text-left transition-colors hover:bg-muted/40"
      // 28px baseline clears the parent disclosure's chevron; each depth steps in from there.
      style={{ paddingLeft: 28 + depth * INDENT_PER_LEVEL }}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-tight ${
          active ? ACCENT : "text-foreground/70"
        }`}
      >
        {lesson.title}
      </span>
    </button>
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
  const tree = buildLessonTree(lessons);
  // The subject/unit that hold the active lesson (so we open + highlight a path straight to it).
  let activeSubject: string | null = null;
  let activeUnit: string | null = null;
  for (const subject of tree) {
    for (const unit of subject.units) {
      if (unit.items.some((l) => l.id === activeId)) {
        activeSubject = subject.name;
        activeUnit = unit.name;
      }
    }
  }
  const singleSubject = tree.length <= 1;

  // baseDepth: 0 when units render at the top level (single subject), 1 when nested under a
  // subject disclosure. Lessons sit one level deeper than their parent.
  const renderUnits = (subject: LessonTree[number], baseDepth: number) => {
    const hasRealUnits = subject.units.some((u) => u.name !== null);
    const isActiveSubject = subject.name === activeSubject;
    if (!hasRealUnits) {
      // No unit structure — list the lessons directly under the subject.
      return (
        <div className="space-y-0.5">
          {subject.units
            .flatMap((u) => u.items)
            .map((l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                active={l.id === activeId}
                depth={baseDepth}
                onSelect={onSelect}
              />
            ))}
        </div>
      );
    }
    return (
      <div className="space-y-0.5">
        {subject.units.map((unit) => {
          const isActiveUnit = isActiveSubject && unit.name === activeUnit;
          return (
            <Disclosure
              key={unit.name ?? "__nounit__"}
              label={unit.name ?? "Lessons"}
              active={isActiveUnit}
              depth={baseDepth}
              right={
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {unit.items.length}
                </span>
              }
              defaultOpen={isActiveUnit}
            >
              <div className="space-y-0.5">
                {unit.items.map((l) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    active={l.id === activeId}
                    depth={baseDepth + 1}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </Disclosure>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {!bare && <h3 className="font-serif text-[22px] leading-tight tracking-tight">Lessons</h3>}
      <p className="mt-1 text-[13px] text-muted-foreground">Browse subjects, units, and lessons.</p>
      <div className="mt-4 space-y-0.5">
        {singleSubject
          ? tree[0] && renderUnits(tree[0], 0)
          : tree.map((subject) => (
              <Disclosure
                key={subject.name}
                label={subject.name}
                active={subject.name === activeSubject}
                depth={0}
                defaultOpen={subject.name === activeSubject}
              >
                {renderUnits(subject, 1)}
              </Disclosure>
            ))}
      </div>
    </div>
  );
}
