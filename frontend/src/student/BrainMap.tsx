import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import type { Lesson, StudentMemoryProfile } from "@/lib/types";

// THE BRAIN MAP v3 — the second brain as a 3D GALAXY, still plain SVG.
//
//   center "you"  →  course hubs (monogram)  →  unit nodes  →  lesson dots
//   + the general memory (strengths/struggles/preferences/notes/avoid) as hue-coded
//     satellite stars hugging the center.
//
// 3D without a 3D library: every node lives on a disc in world space (ring radius +
// angle + a small deterministic height so the disc sparkles instead of lying flat), and
// a yaw/pitch camera projects it to the SVG with perspective — nearer stars render
// bigger and brighter, farther ones smaller and dimmer, painter-sorted. The galaxy
// idles in a slow spin (killed by prefers-reduced-motion and by the first touch);
// DRAGGING ORBITS the camera (yaw + pitch), the wheel still zooms 1-3x anchored on the
// cursor, and the reset chip restores home (orientation, zoom, and the idle spin).
//
// Everything else holds from v2: the app's progress color language, the discuss-yellow
// memory halos, the animated live thread center → course → unit → current lesson, the
// staggered pop-in, native <title> tooltips, and tap-to-open lessons. No dependencies,
// no per-mount jitter — the world layout is deterministic; only the camera moves.

const VIEW_W = 480;
const VIEW_H = 280;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const SATELLITE_RADIUS = 30;
const COURSE_RADIUS = 62;
const UNIT_RADIUS = 98;
const LESSON_RADIUS = 132;
// Alternate lesson dots between two radii so dense units don't collide.
const LESSON_STAGGER = 13;
// Camera: focal length for the perspective divide; pitch defaults to ~51° (the ellipse
// the 2D map used to fake), clamped so the disc can neither flatten to a line nor flip.
const FOCAL = 620;
const PITCH_DEFAULT = 0.9;
const PITCH_MIN = 0.35;
const PITCH_MAX = 1.35;
const ZOOM_MAX = 3;
const IDLE_SPIN_RAD_PER_TICK = 0.0035;

// The general-memory kinds, each wearing its mode hue (same language as the tags).
const MEMORY_KINDS: { key: keyof StudentMemoryProfile; label: string; color: string }[] = [
  { key: "strengths", label: "Strength", color: "var(--mode-practice)" },
  { key: "struggles", label: "Working on", color: "var(--mode-open)" },
  { key: "preferences", label: "Preference", color: "var(--mode-quiz)" },
  { key: "notes", label: "Note", color: "var(--mode-discuss)" },
  { key: "avoid", label: "Steering around", color: "var(--mode-assignment)" },
];

// World-space node: a ring position plus height above/below the disc.
type World = { radius: number; angle: number; h: number };
type LessonNode = World & { lesson: Lesson };
type UnitNode = World & { unitId: string; title: string; lessons: LessonNode[] };
type CourseNode = World & { courseId: string; title: string; units: UnitNode[] };
type Projected = { x: number; y: number; depth: number; f: number };

// Deterministic per-id height so the disc has depth texture without per-mount jitter.
function heightFor(id: string, amplitude: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 17) / 8 - 1) * amplitude;
}

function monogram(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

type MapView = { x: number; y: number; scale: number };

function clampView(view: MapView): MapView {
  const scale = Math.min(ZOOM_MAX, Math.max(1, view.scale));
  const visibleW = VIEW_W / scale;
  const visibleH = VIEW_H / scale;
  return {
    scale,
    x: Math.min(VIEW_W - visibleW, Math.max(0, view.x)),
    y: Math.min(VIEW_H - visibleH, Math.max(0, view.y)),
  };
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
  // World layout: course → unit → lesson, slices weighted by lesson count so dense
  // courses get the angular room they need. Stable catalog order, start at 12 o'clock.
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
        unit = {
          unitId,
          title: lesson.unit_title || "Lessons",
          radius: UNIT_RADIUS,
          angle: 0,
          h: heightFor(unitId, 6),
          lessons: [],
        };
        course.units.set(unitId, unit);
      }
      unit.lessons.push({
        lesson,
        radius: LESSON_RADIUS,
        angle: 0,
        h: heightFor(lesson.id, 11),
      });
    }

    const list = Array.from(courseMap, ([courseId, course]) => ({
      courseId,
      title: course.title,
      radius: COURSE_RADIUS,
      angle: 0,
      h: 0,
      units: Array.from(course.units.values()),
    }));
    const weight = (units: UnitNode[]) =>
      units.reduce((sum, unit) => sum + unit.lessons.length, 0) + 3;
    const total = list.reduce((sum, course) => sum + weight(course.units), 0);

    let cursor = -Math.PI / 2;
    for (const course of list) {
      const span = (weight(course.units) / total) * Math.PI * 2;
      course.angle = cursor + span / 2;
      const unitTotal = course.units.reduce((sum, unit) => sum + unit.lessons.length + 1, 0);
      let unitCursor = cursor + span * 0.06;
      const unitSpanBudget = span * 0.88;
      for (const unit of course.units) {
        const unitSpan = ((unit.lessons.length + 1) / unitTotal) * unitSpanBudget;
        unit.angle = unitCursor + unitSpan / 2;
        unit.lessons.forEach((node, index) => {
          node.angle =
            unit.lessons.length === 1
              ? unit.angle
              : unitCursor +
                unitSpan * 0.08 +
                (unitSpan * 0.84 * index) / (unit.lessons.length - 1);
          node.radius = LESSON_RADIUS + (index % 2 === 0 ? 0 : LESSON_STAGGER);
        });
        unitCursor += unitSpan;
      }
      cursor += span;
    }
    return list;
  }, [lessons]);

  // The general memory as satellites orbiting "you": up to 3 entries per kind,
  // hue-coded, alternating above/below the disc.
  const satellites = useMemo(() => {
    const entries: { text: string; label: string; color: string }[] = [];
    for (const kind of MEMORY_KINDS) {
      const values = memoryProfile?.[kind.key];
      if (!Array.isArray(values)) continue;
      for (const value of values.slice(0, 3)) {
        entries.push({ text: String(value), label: kind.label, color: kind.color });
      }
    }
    return entries.slice(0, 12).map((entry, index, all) => ({
      ...entry,
      radius: SATELLITE_RADIUS,
      angle: -Math.PI / 2 + (Math.PI * 2 * index) / all.length,
      h: index % 2 === 0 ? 8 : -8,
    }));
  }, [memoryProfile]);

  // --- Camera ----------------------------------------------------------------------
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  const [view, setView] = useState<MapView>({ x: 0, y: 0, scale: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ px: number; py: number; yaw: number; pitch: number } | null>(null);
  const movedRef = useRef(0);
  const interactedRef = useRef(false);

  // The idle spin: a gentle constant yaw until the student takes the wheel (or asks for
  // reduced motion). ~30fps is plenty for a slow drift.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      if (interactedRef.current || document.hidden) return;
      setYaw((value) => value + IDLE_SPIN_RAD_PER_TICK);
    }, 33);
    return () => window.clearInterval(timer);
  }, []);

  // Wheel zoom (native, passive: false — React's synthetic onWheel can't reliably
  // preventDefault, and the page must not scroll while the cursor zooms the map).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      interactedRef.current = true;
      const rect = el.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      setView((prev) => {
        const scale = Math.min(
          ZOOM_MAX,
          Math.max(1, prev.scale * Math.exp(-event.deltaY * 0.0018)),
        );
        const px = prev.x + fx * (VIEW_W / prev.scale);
        const py = prev.y + fy * (VIEW_H / prev.scale);
        return clampView({ x: px - fx * (VIEW_W / scale), y: py - fy * (VIEW_H / scale), scale });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag ORBITS: horizontal movement spins the galaxy, vertical tilts it.
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { px: event.clientX, py: event.clientY, yaw, pitch };
    movedRef.current = 0;
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    movedRef.current = Math.max(movedRef.current, Math.abs(dx) + Math.abs(dy));
    if (movedRef.current > 2) interactedRef.current = true;
    setYaw(drag.yaw + dx * 0.008);
    setPitch(Math.min(PITCH_MAX, Math.max(PITCH_MIN, drag.pitch + dy * 0.006)));
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  // A real orbit-drag must not fire the lesson-dot click it ends on.
  const onClickCapture = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (movedRef.current > 5) {
      event.stopPropagation();
      event.preventDefault();
    }
  };
  const resetCamera = () => {
    setYaw(0);
    setPitch(PITCH_DEFAULT);
    setView({ x: 0, y: 0, scale: 1 });
    interactedRef.current = false;
  };

  // --- Projection --------------------------------------------------------------------
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const project = (world: World): Projected => {
    const wx = world.radius * Math.cos(world.angle);
    const wz = world.radius * Math.sin(world.angle);
    const wy = world.h;
    const x1 = wx * cosYaw - wz * sinYaw;
    const z1 = wx * sinYaw + wz * cosYaw;
    const y2 = wy * cosPitch - z1 * sinPitch;
    const z2 = wy * sinPitch + z1 * cosPitch;
    const f = FOCAL / (FOCAL + z2);
    return { x: CX + x1 * f, y: CY + y2 * f, depth: z2, f };
  };
  // Depth cues: nearer = bigger + brighter. Normalized against the outer ring.
  const depthOpacity = (depth: number) =>
    0.55 + 0.45 * Math.min(1, Math.max(0, (LESSON_RADIUS - depth) / (2 * LESSON_RADIUS)));

  if (!courses.length) return null;

  const zoomed = view.scale > 1.01;
  const movedCamera = zoomed || Math.abs(yaw) > 0.02 || Math.abs(pitch - PITCH_DEFAULT) > 0.02;
  let popIndex = 0;
  const pop = () => ({ animationDelay: `${Math.min(popIndex++ * 16, 640)}ms` });

  // Project everything once per render, then paint back-to-front.
  const renderNodes: { depth: number; node: React.ReactNode }[] = [];

  for (const satellite of satellites) {
    const p = project(satellite);
    renderNodes.push({
      depth: p.depth,
      node: (
        <g
          key={`sat-${satellite.label}-${satellite.angle}`}
          className="bmap-node"
          style={pop()}
          opacity={depthOpacity(p.depth)}
        >
          <title>{`${satellite.label}: ${satellite.text}`}</title>
          <circle cx={p.x} cy={p.y} r={6 * p.f} fill={satellite.color} opacity="0.16" />
          <circle cx={p.x} cy={p.y} r={2.4 * p.f} fill={satellite.color} />
        </g>
      ),
    });
  }

  const edges: React.ReactNode[] = [];
  const center = project({ radius: 0, angle: 0, h: 0 });
  let threadPoints: string | null = null;

  for (const course of courses) {
    const cp = project(course);
    edges.push(
      <line
        key={`e-${course.courseId}`}
        x1={center.x}
        y1={center.y}
        x2={cp.x}
        y2={cp.y}
        stroke="var(--ink-16)"
        strokeWidth="1"
      />,
    );
    renderNodes.push({
      depth: cp.depth,
      node: (
        <g
          key={`c-${course.courseId}`}
          className="bmap-node"
          style={pop()}
          opacity={depthOpacity(cp.depth)}
        >
          <title>{course.title}</title>
          <circle
            cx={cp.x}
            cy={cp.y}
            r={9 * cp.f}
            fill="var(--depth-card)"
            stroke="var(--ink-30)"
            strokeWidth="1"
          />
          <text
            x={cp.x}
            y={cp.y + 2.6 * cp.f}
            textAnchor="middle"
            style={{ fontSize: `${7 * cp.f}px` }}
            className="fill-[var(--ink-62)] font-mono font-bold uppercase tracking-[0.06em]"
          >
            {monogram(course.title)}
          </text>
        </g>
      ),
    });

    for (const unit of course.units) {
      const up = project(unit);
      edges.push(
        <line
          key={`e-${unit.unitId}`}
          x1={cp.x}
          y1={cp.y}
          x2={up.x}
          y2={up.y}
          stroke="var(--ink-16)"
          strokeWidth="1"
          strokeOpacity="0.75"
        />,
      );
      renderNodes.push({
        depth: up.depth,
        node: (
          <g
            key={`u-${unit.unitId}`}
            className="bmap-node"
            style={pop()}
            opacity={depthOpacity(up.depth)}
          >
            <title>{unit.title}</title>
            <circle cx={up.x} cy={up.y} r={3.5 * up.f} fill="var(--ink-45)" />
          </g>
        ),
      });

      for (const node of unit.lessons) {
        const lp = project(node);
        edges.push(
          <line
            key={`e-${node.lesson.id}`}
            x1={up.x}
            y1={up.y}
            x2={lp.x}
            y2={lp.y}
            stroke="var(--ink-16)"
            strokeWidth="1"
            strokeOpacity="0.5"
          />,
        );
        const value = progress[node.lesson.id] ?? 0;
        const current = node.lesson.id === currentLessonId;
        const remembered = memoryLessonIds.has(node.lesson.id);
        if (current) {
          threadPoints = `${center.x},${center.y} ${cp.x},${cp.y} ${up.x},${up.y} ${lp.x},${lp.y}`;
        }
        const fill = current
          ? "var(--accent-text)"
          : value >= 1
            ? "var(--success)"
            : value > 0
              ? "var(--ink-45)"
              : "var(--depth-card)";
        renderNodes.push({
          depth: lp.depth,
          node: (
            <g
              key={node.lesson.id}
              onClick={() => onOpenLesson(node.lesson.id)}
              className="bmap-node cursor-pointer"
              style={pop()}
              opacity={depthOpacity(lp.depth)}
            >
              <title>
                {`${node.lesson.title}${current ? " — current" : value >= 1 ? " — done" : value > 0 ? " — in progress" : ""}${remembered ? " · in your mentor's memory" : ""}`}
              </title>
              {current ? (
                <circle
                  cx={lp.x}
                  cy={lp.y}
                  r={12 * lp.f}
                  fill="url(#brainmap-aurora)"
                  className="bmap-glow"
                />
              ) : remembered ? (
                <circle
                  cx={lp.x}
                  cy={lp.y}
                  r={9 * lp.f}
                  fill="url(#brainmap-memory)"
                  className="bmap-glow"
                />
              ) : null}
              {/* A generous invisible hit area so small dots stay tappable. */}
              <circle cx={lp.x} cy={lp.y} r={9 * lp.f} fill="transparent" />
              <circle
                cx={lp.x}
                cy={lp.y}
                r={3.5 * lp.f}
                fill={fill}
                stroke={value > 0 || current ? "none" : "var(--ink-30)"}
                strokeWidth="1"
              />
            </g>
          ),
        });
      }
    }
  }

  renderNodes.sort((a, b) => b.depth - a.depth);

  return (
    <div className="relative">
      {movedCamera ? (
        <button
          type="button"
          onClick={resetCamera}
          aria-label="Reset the map view"
          className="absolute right-1 top-1 z-[var(--z-base)] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
        </button>
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${VIEW_W / view.scale} ${VIEW_H / view.scale}`}
        role="img"
        aria-label="A 3D map of your brain — courses, units, and lessons colored by progress, with what your mentor remembers orbiting the center. Drag to spin, scroll to zoom."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        // Touch: a finger drag orbits the galaxy rather than scrolling the page.
        style={{ touchAction: "none" }}
        className="block w-full cursor-grab active:cursor-grabbing"
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

        {edges}

        {/* The live thread — the one moving line, tracing the path to the current lesson. */}
        {threadPoints ? (
          <polyline
            points={threadPoints}
            fill="none"
            stroke="var(--accent-text)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="bmap-thread"
          />
        ) : null}

        {/* Center: the student, breathing aurora — always painted with the stars. */}
        <circle
          cx={center.x}
          cy={center.y}
          r="18"
          fill="url(#brainmap-aurora)"
          className="bmap-glow"
        />
        <circle cx={center.x} cy={center.y} r="6.5" fill="var(--foreground)" />
        <text
          x={center.x}
          y={center.y + 17}
          textAnchor="middle"
          className="fill-[var(--ink-45)] font-mono text-[8px] uppercase tracking-[0.14em]"
        >
          you
        </text>

        {renderNodes.map((entry) => entry.node)}
      </svg>
    </div>
  );
}
