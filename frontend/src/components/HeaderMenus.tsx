import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import gsap from "gsap";
import { Check, ChevronDown, LayoutGrid, Menu, X } from "lucide-react";
import { GradientCard } from "./GradientCard";
import { ProfilePanel } from "@/features/student/ProfilePanel";
import { useIsTouch } from "@/hooks/useIsTouch";
import { LESSONS, type Lesson, type MentorConfig, type VoiceSettings } from "@/lib/jargon-store";
import type { LessonActivity, LessonArc } from "@/lib/types";

type MenuKey = "lessons" | "progress" | "mentor" | "profile";

const WIDTHS: Record<MenuKey, number> = {
  lessons: 380,
  progress: 380,
  mentor: 380,
  profile: 380,
};

export function HeaderMenus({
  activeLessonId,
  lessons = LESSONS,
  lessonArc = null,
  activities = [],
  onSelectLesson,
  mentor,
  onMentorChange,
  voice,
  onVoiceChange,
}: {
  activeLessonId: string;
  lessons?: Lesson[];
  lessonArc?: LessonArc | null;
  activities?: LessonActivity[];
  onSelectLesson: (id: string) => void;
  mentor: MentorConfig;
  onMentorChange: (m: MentorConfig) => void;
  voice?: VoiceSettings;
  onVoiceChange?: (v: VoiceSettings) => void;
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
    { key: "profile", label: "Profile" },
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
      {k === "progress" && (
        <ProgressPanel
          activeId={activeLessonId}
          lessons={lessons}
          lessonArc={lessonArc}
          activities={activities}
        />
      )}
      {k === "mentor" && (
        <MentorPanel
          mentor={mentor}
          onChange={onMentorChange}
          voice={voice}
          onVoiceChange={onVoiceChange}
        />
      )}
      {k === "profile" && <ProfilePanel mentor={mentor} />}
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
                    <ProgressPanel
                      bare
                      activeId={activeLessonId}
                      lessons={lessons}
                      lessonArc={lessonArc}
                      activities={activities}
                    />
                  </CollapsibleSection>
                  <CollapsibleSection title="Mentor">
                    <MentorPanel
                      bare
                      mentor={mentor}
                      onChange={onMentorChange}
                      voice={voice}
                      onVoiceChange={onVoiceChange}
                    />
                  </CollapsibleSection>
                  <CollapsibleSection title="Profile">
                    <ProfilePanel bare mentor={mentor} />
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
    const unitKey = l.unitTitle || " nounit";
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
      <Link
        to="/classes"
        className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-depth-field px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
      >
        <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        Open class view
      </Link>
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

// Friendly label for a lesson step, derived from its stage (falling back to activity type).
const STAGE_LABELS: Record<string, string> = {
  intro: "Warm-up",
  teach: "Teach",
  practice: "Practice",
  assessment: "Checkpoint",
  review: "Review",
  complete: "Wrap-up",
};
const TYPE_LABELS: Record<string, string> = {
  discussion: "Discuss",
  code: "Code",
  multiple_choice: "Quiz",
  reflection: "Reflect",
  file: "Upload",
};
function stepKind(activity?: LessonActivity): string | null {
  if (!activity) return null;
  return STAGE_LABELS[activity.stage] || TYPE_LABELS[activity.activity_type] || null;
}
function clampOneLine(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// The step-by-step milestone list for the current lesson (done / current / upcoming), the primary
// content of the Progress panel. Enriched per step from the lesson's activities: a stage/type chip
// and a one-line description, so every milestone shows what it actually is.
function LessonMilestones({
  arc,
  activities = [],
}: {
  arc: LessonArc;
  activities?: LessonActivity[];
}) {
  const sorted = [...activities].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  // Match an arc step to its activity: prefer a unique title match, else fall back to position index
  // (deriveLessonArc and the backend both number steps in position order).
  const titleCounts = new Map<string, number>();
  for (const a of sorted) titleCounts.set(a.title, (titleCounts.get(a.title) ?? 0) + 1);
  const activityForStep = (step: number, title: string): LessonActivity | undefined => {
    if (title && titleCounts.get(title) === 1) {
      const byTitle = sorted.find((a) => a.title === title);
      if (byTitle) return byTitle;
    }
    return sorted[step - 1];
  };

  const steps: { step: number; title: string; state: "done" | "current" | "upcoming" }[] = [
    ...arc.completed.map((s) => ({ ...s, state: "done" as const })),
    ...(arc.current
      ? [{ step: arc.step, title: arc.current.title, state: "current" as const }]
      : []),
    ...arc.upcoming.map((s) => ({ ...s, state: "upcoming" as const })),
  ];
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1" aria-hidden>
        {Array.from({ length: arc.total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i < arc.step - 1
                ? "bg-foreground/35"
                : i === arc.step - 1
                  ? "bg-foreground"
                  : "bg-border"
            }`}
          />
        ))}
      </div>
      <div className="mb-3 text-[11.5px] text-foreground">
        Step {arc.step} of {arc.total}
      </div>
      <ol className="space-y-1.5">
        {steps.map((s) => {
          const activity = activityForStep(s.step, s.title);
          const kind = stepKind(activity);
          // Show the current step's live prompt from the arc; otherwise the activity's prompt.
          const desc =
            s.state === "current" && arc.current?.prompt
              ? arc.current.prompt
              : activity?.prompt || "";
          return (
            <li key={s.step} className="flex items-start gap-2.5 text-[13px]">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                  s.state === "done"
                    ? "bg-success/15 text-success"
                    : s.state === "current"
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {s.state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : s.step}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 text-foreground ${
                      s.state === "current" ? "font-medium" : ""
                    }`}
                  >
                    {s.title}
                  </span>
                  {kind ? <span className={`shrink-0 text-[10px] ${ACCENT}`}>{kind}</span> : null}
                </span>
                {desc ? (
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-foreground/70">
                    {clampOneLine(desc)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Fallback when there's no multi-step arc (single-activity lesson): a simple progress bar.
function SimpleProgress({ progress }: { progress: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!barRef.current) return;
    gsap.fromTo(
      barRef.current,
      { width: 0 },
      { width: `${Math.round(progress * 100)}%`, duration: 0.9, ease: "power3.out" },
    );
  }, [progress]);
  return (
    <>
      <div className="mt-4 h-[5px] w-full overflow-hidden rounded-full bg-muted">
        <div ref={barRef} className="h-full rounded-full bg-foreground" />
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-foreground/70">
        <span>{Math.round(progress * 100)}% complete</span>
      </div>
    </>
  );
}

function ProgressPanel({
  activeId,
  lessons,
  lessonArc,
  activities = [],
  bare,
}: {
  activeId: string;
  lessons: Lesson[];
  lessonArc?: LessonArc | null;
  activities?: LessonActivity[];
  bare?: boolean;
}) {
  const active = lessons.find((l) => l.id === activeId) ?? lessons[0] ?? LESSONS[0];
  const others = lessons.filter((l) => l.id !== active?.id);
  return (
    <div>
      {!bare && <h3 className="font-serif text-[22px] leading-tight tracking-tight">Progress</h3>}
      <p className="mt-1 text-[13px] text-foreground">{active?.title}</p>

      {lessonArc && lessonArc.total > 1 ? (
        <LessonMilestones arc={lessonArc} activities={activities} />
      ) : (
        <SimpleProgress progress={active?.progress ?? 0} />
      )}

      {others.length > 0 && (
        <div className="mt-5 border-t border-border pt-2">
          <Disclosure plain label={`Other lessons (${others.length})`}>
            <div className="mt-1 space-y-2">
              {others.map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-1">
                  <span className="flex-1 truncate text-[13px] text-foreground">{l.title}</span>
                  <span className="h-[3px] w-20 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full bg-foreground"
                      style={{ width: `${Math.round(l.progress * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 text-right text-[11.5px] tabular-nums text-foreground/70">
                    {Math.round(l.progress * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

const VOICE_OPTIONS: { label: string; value: VoiceSettings["voiceName"] }[] = [
  { label: "Marin", value: "marin" },
  { label: "Cedar", value: "cedar" },
  { label: "Coral", value: "coral" },
  { label: "Nova", value: "nova" },
  { label: "Shimmer", value: "shimmer" },
];
const SPEED_OPTIONS: { label: string; value: VoiceSettings["readAloudRate"] }[] = [
  { label: "Slow", value: 0.85 },
  { label: "Normal", value: 1 },
  { label: "Fast", value: 1.2 },
];

function MentorPanel({
  mentor,
  onChange,
  voice,
  onVoiceChange,
  bare,
}: {
  mentor: MentorConfig;
  onChange: (m: MentorConfig) => void;
  voice?: VoiceSettings;
  onVoiceChange?: (v: VoiceSettings) => void;
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
  const voiceLabel = VOICE_OPTIONS.find((o) => o.value === voice?.voiceName)?.label ?? "Marin";
  const speedLabel = SPEED_OPTIONS.find((o) => o.value === voice?.readAloudRate)?.label ?? "Normal";
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
        {voice && onVoiceChange ? (
          <>
            <MentorGroup
              label="Voice"
              options={VOICE_OPTIONS.map((o) => o.label)}
              value={voiceLabel}
              onSelect={(opt) => {
                const match = VOICE_OPTIONS.find((o) => o.label === opt);
                if (match) onVoiceChange({ ...voice, voiceName: match.value });
              }}
            />
            <MentorGroup
              label="Reading speed"
              options={SPEED_OPTIONS.map((o) => o.label)}
              value={speedLabel}
              onSelect={(opt) => {
                const match = SPEED_OPTIONS.find((o) => o.label === opt);
                if (match) onVoiceChange({ ...voice, readAloudRate: match.value });
              }}
            />
          </>
        ) : null}
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
