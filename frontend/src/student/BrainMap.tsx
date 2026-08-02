import { useMemo } from "react";
import type { Lesson, StudentMemoryProfile } from "@/lib/types";

// THE BRAIN MAP v2: the student's whole second brain as one constellation.
//
//   center "you"  →  course hubs (monogram)  →  unit nodes  →  lesson dots
//
// plus a SATELLITE ring hugging the center: the general memory itself — every profile
// entry (strengths / struggles / preferences / notes / avoid) as a small hue-coded star,
// so coursework memory and system memory are both visible without pretending they share
// a hierarchy (the mentor reads them flat; this is presentation, not retrieval).
//
// Dot colors keep the app's progress language (accent-blue current, success-green done,
// ink started, hollow untouched); session-summary lessons wear the discuss-yellow memory
// halo. Flash, rationed: nodes pop in staggered on mount, glows breathe, and ONE live
// thread (an animated dash line center → course → unit → current lesson) carries the
// aurora's job of marking the live thing. All motion dies under prefers-reduced-motion.
//
// Layout stays a deterministic radial computation — no force sim, no dependency, no
// per-mount jitter. Native <title> tooltips; a lesson tap opens it.

const VIEW_W = 480;
const VIEW_H = 280;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const SATELLITE_RADIUS = 27;
const COURSE_RADIUS = 56;
const UNIT_RADIUS = 90;
const LESSON_RADIUS = 122;
// Alternate lesson dots between two radii so dense units don't collide.
const LESSON_STAGGER = 12;
// The card's viewport is wide and short — squash y so the rings fit as ellipses.
const SQUASH = 0.78;

// The general-memory kinds, each wearing its mode hue (same language as the tags).
const MEMORY_KINDS: { key: keyof StudentMemoryProfile; label: string; color: string }[] = [
  { key: "strengths", label: "Strength", color: "var(--mode-practice)" },
  { key: "struggles", label: "Working on", color: "var(--mode-open)" },
  { key: "preferences", label: "Preference", color: "var(--mode-quiz)" },
  { key: "notes", label: "Note", color: "var(--mode-discuss)" },
  { key: "avoid", label: "Steering around", color: "var(--mode-assignment)" },
];

type LessonNode = { lesson: Lesson; x: number; y: number };
type UnitNode = { unitId: string; title: string; x: number; y: number; lessons: LessonNode[] };
type CourseNode = { courseId: string; title: string; x: number; y: number; units: UnitNode[] };

function polar(radius: number, angle: number) {
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) * SQUASH };
}

function monogram(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

export function BrainMap({
  lessons,
  progress,
  currentLessonId,
  memoryLessonIds,
  memoryProfile,
  onOpenLesson,
}: {
  lessons: Lesson[];
  progress: Record<string, number>;
  currentLessonId: string | null;
  memoryLessonIds: Set<string>;
  memoryProfile?: StudentMemoryProfile | null;
  onOpenLesson: (lessonId: string) => void;
}) {
  // course → unit → lesson, all slices weighted by lesson count so dense courses get
  // the angular room they need. Order is stable (catalog order), start at 12 o'clock.
  const courses = useMemo<CourseNode[]>(() => {
    const courseMap = new Map<string, { title: string; units: Map<string, UnitNode> }>();
    for (const lesson of lessons) {
      const courseId = lesson.course_id || lesson.course_title || "course";
      let course = courseMap.get(courseId);
      if (!course) {
        course = { title: lesson.course_title || "Course", units: new Map() };
        courseMap.set(courseId, course);
      }
      const unitId = lesson.unit_id || "__none__";
      let unit = course.units.get(unitId);
      if (!unit) {
        unit = { unitId, title: lesson.unit_title || "Lessons", x: 0, y: 0, lessons: [] };
        course.units.set(unitId, unit);
      }
      unit.lessons.push({ lesson, x: 0, y: 0 });
    }

    const list = Array.from(courseMap, ([courseId, course]) => ({
      courseId,
      title: course.title,
      x: 0,
      y: 0,
      units: Array.from(course.units.values()),
    }));
    const weight = (units: UnitNode[]) =>
      units.reduce((sum, unit) => sum + unit.lessons.length, 0) + 3;
    const total = list.reduce((sum, course) => sum + weight(course.units), 0);

    let cursor = -Math.PI / 2;
    for (const course of list) {
      const span = (weight(course.units) / total) * Math.PI * 2;
      const coursePos = polar(COURSE_RADIUS, cursor + span / 2);
      course.x = coursePos.x;
      course.y = coursePos.y;
      // Units subdivide the course slice; lessons fan across their unit's slice.
      const unitTotal = course.units.reduce((sum, unit) => sum + unit.lessons.length + 1, 0);
      let unitCursor = cursor + span * 0.06;
      const unitSpanBudget = span * 0.88;
      for (const unit of course.units) {
        const unitSpan = ((unit.lessons.length + 1) / unitTotal) * unitSpanBudget;
        const unitMid = unitCursor + unitSpan / 2;
        const unitPos = polar(UNIT_RADIUS, unitMid);
        unit.x = unitPos.x;
        unit.y = unitPos.y;
        unit.lessons.forEach((node, index) => {
          const angle =
            unit.lessons.length === 1
              ? unitMid
              : unitCursor +
                unitSpan * 0.08 +
                (unitSpan * 0.84 * index) / (unit.lessons.length - 1);
          const pos = polar(LESSON_RADIUS + (index % 2 === 0 ? 0 : LESSON_STAGGER), angle);
          node.x = pos.x;
          node.y = pos.y;
        });
        unitCursor += unitSpan;
      }
      cursor += span;
    }
    return list;
  }, [lessons]);

  // The general memory as satellites orbiting "you": up to 3 entries per kind, evenly
  // spaced, hue-coded by kind.
  const satellites = useMemo(() => {
    const entries: { text: string; label: string; color: string }[] = [];
    for (const kind of MEMORY_KINDS) {
      const values = memoryProfile?.[kind.key];
      if (!Array.isArray(values)) continue;
      for (const value of values.slice(0, 3)) {
        entries.push({ text: String(value), label: kind.label, color: kind.color });
      }
    }
    return entries.slice(0, 12).map((entry, index, all) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / all.length;
      return { ...entry, ...polar(SATELLITE_RADIUS, angle) };
    });
  }, [memoryProfile]);

  // The live thread: center → course → unit → current lesson, one animated dash line.
  const thread = useMemo(() => {
    if (!currentLessonId) return null;
    for (const course of courses) {
      for (const unit of course.units) {
        const node = unit.lessons.find((entry) => entry.lesson.id === currentLessonId);
        if (node) {
          return `${CX},${CY} ${course.x},${course.y} ${unit.x},${unit.y} ${node.x},${node.y}`;
        }
      }
    }
    return null;
  }, [courses, currentLessonId]);

  if (!courses.length) return null;

  let popIndex = 0;
  const pop = () => ({ animationDelay: `${Math.min(popIndex++ * 16, 640)}ms` });

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="A map of your brain — courses, units, and lessons colored by progress, with what your mentor remembers orbiting the center"
      className="block w-full"
    >
      <defs>
        <radialGradient id="brainmap-aurora">
          <stop offset="0%" stopColor="var(--aurora-2)" stopOpacity="0.55" />
          <stop offset="55%" stopColor="var(--aurora-1)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--aurora-3)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="brainmap-memory">
          <stop offset="0%" stopColor="var(--mode-discuss)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--mode-discuss)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Edges under everything: center→course→unit→lesson hairlines, fading outward. */}
      {courses.map((course) => (
        <g key={`edges-${course.courseId}`} stroke="var(--ink-16)" strokeWidth="1">
          <line x1={CX} y1={CY} x2={course.x} y2={course.y} />
          {course.units.map((unit) => (
            <g key={unit.unitId}>
              <line x1={course.x} y1={course.y} x2={unit.x} y2={unit.y} strokeOpacity="0.75" />
              {unit.lessons.map((node) => (
                <line
                  key={node.lesson.id}
                  x1={unit.x}
                  y1={unit.y}
                  x2={node.x}
                  y2={node.y}
                  strokeOpacity="0.5"
                />
              ))}
            </g>
          ))}
        </g>
      ))}

      {/* The live thread — the one moving line, tracing the path to the current lesson. */}
      {thread ? (
        <polyline
          points={thread}
          fill="none"
          stroke="var(--accent-text)"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="bmap-thread"
        />
      ) : null}

      {/* Center: the student, breathing aurora. */}
      <circle cx={CX} cy={CY} r="18" fill="url(#brainmap-aurora)" className="bmap-glow" />
      <circle cx={CX} cy={CY} r="6.5" fill="var(--foreground)" className="bmap-node" />
      <text
        x={CX}
        y={CY + 17}
        textAnchor="middle"
        className="fill-[var(--ink-45)] font-mono text-[8px] uppercase tracking-[0.14em]"
      >
        you
      </text>

      {/* The general memory: hue-coded satellites orbiting the center. */}
      {satellites.map((satellite, index) => (
        <g key={`${satellite.label}-${index}`} className="bmap-node" style={pop()}>
          <title>{`${satellite.label}: ${satellite.text}`}</title>
          <circle cx={satellite.x} cy={satellite.y} r="6" fill={satellite.color} opacity="0.16" />
          <circle cx={satellite.x} cy={satellite.y} r="2.4" fill={satellite.color} />
        </g>
      ))}

      {courses.map((course) => (
        <g key={course.courseId}>
          {/* Course hub: monogram in a ring — the class-level anchor. */}
          <g className="bmap-node" style={pop()}>
            <title>{course.title}</title>
            <circle
              cx={course.x}
              cy={course.y}
              r="9"
              fill="var(--depth-card)"
              stroke="var(--ink-30)"
              strokeWidth="1"
            />
            <text
              x={course.x}
              y={course.y + 2.6}
              textAnchor="middle"
              className="fill-[var(--ink-62)] font-mono text-[7px] font-bold uppercase tracking-[0.06em]"
            >
              {monogram(course.title)}
            </text>
          </g>

          {course.units.map((unit) => (
            <g key={unit.unitId}>
              <g className="bmap-node" style={pop()}>
                <title>{unit.title}</title>
                <circle cx={unit.x} cy={unit.y} r="3.5" fill="var(--ink-45)" />
              </g>
              {unit.lessons.map((node) => {
                const value = progress[node.lesson.id] ?? 0;
                const current = node.lesson.id === currentLessonId;
                const remembered = memoryLessonIds.has(node.lesson.id);
                const fill = current
                  ? "var(--accent-text)"
                  : value >= 1
                    ? "var(--success)"
                    : value > 0
                      ? "var(--ink-45)"
                      : "var(--depth-card)";
                return (
                  <g
                    key={node.lesson.id}
                    onClick={() => onOpenLesson(node.lesson.id)}
                    className="bmap-node cursor-pointer"
                    style={pop()}
                  >
                    <title>
                      {`${node.lesson.title}${current ? " — current" : value >= 1 ? " — done" : value > 0 ? " — in progress" : ""}${remembered ? " · in your mentor's memory" : ""}`}
                    </title>
                    {current ? (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r="12"
                        fill="url(#brainmap-aurora)"
                        className="bmap-glow"
                      />
                    ) : remembered ? (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r="9"
                        fill="url(#brainmap-memory)"
                        className="bmap-glow"
                      />
                    ) : null}
                    {/* A generous invisible hit area so 3.5px dots are actually tappable. */}
                    <circle cx={node.x} cy={node.y} r="9" fill="transparent" />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="3.5"
                      fill={fill}
                      stroke={value > 0 || current ? "none" : "var(--ink-30)"}
                      strokeWidth="1"
                    />
                  </g>
                );
              })}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}
