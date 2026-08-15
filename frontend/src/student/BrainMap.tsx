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
import type {
  CurriculumLinkRow,
  IdeaNode,
  Lesson,
  StudentLinkRow,
  StudentMemoryProfile,
} from "@/lib/types";

// THE BRAIN MAP v3 — the second brain as a 3D GALAXY, still plain SVG.
//
//   center "you"  →  course hubs (monogram)  →  unit nodes  →  lesson dots
//   + the general memory (strengths/struggles/preferences/notes/avoid) as hue-coded
//     satellite stars hugging the center.
//
// 3D without a 3D library: every node lives on a disc in world space (ring radius +
// angle + a small deterministic height so the disc sparkles instead of lying flat), and
// a yaw/pitch camera projects it to the SVG with perspective — nearer stars render
// bigger and brighter, farther ones smaller and dimmer (stable DOM order — see the
// note at the render list; strict painter sorting restarted CSS animations). The galaxy
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
  { key: "strengths", label: "Strength", color: "var(--map-strength)" },
  { key: "struggles", label: "Working on", color: "var(--map-struggle)" },
  { key: "preferences", label: "Preference", color: "var(--map-preference)" },
  { key: "notes", label: "Note", color: "var(--map-note)" },
  { key: "avoid", label: "Steering around", color: "var(--map-avoid)" },
];

// World-space node: a spherical position — ring radius, azimuth angle, and an ELEVATION
// angle above/below the equator. Elevations compose down the tree (course → unit →
// lesson, each offset from its parent) so branches stay short and the hierarchy reads
// while the stars fill the volume instead of lying on a disc.
type World = { radius: number; angle: number; el: number };
type LessonNode = World & { lesson: Lesson };
type UnitNode = World & { unitId: string; title: string; lessons: LessonNode[] };
type CourseNode = World & { courseId: string; title: string; units: UnitNode[] };
type Projected = { x: number; y: number; depth: number; f: number };

// Deterministic per-id elevation offset (radians) — volume without per-mount jitter.
function elevationFor(id: string, amplitude: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 17) / 8 - 1) * amplitude;
}

const clampEl = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

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
  ideas,
  studentLinks,
  curriculumLinks,
  mastery,
  onOpenLesson,
}: {
  lessons: Lesson[];
  progress: Record<string, number>;
  currentLessonId: string | null;
  memoryLessonIds: Set<string>;
  memoryProfile?: StudentMemoryProfile | null;
  // Learning framework (F4): the knowledge layer — authored + emergent ideas, the
  // student's earned links (bright, permanent), the curriculum's possible links (faint).
  ideas?: IdeaNode[];
  studentLinks?: StudentLinkRow[];
  curriculumLinks?: CurriculumLinkRow[];
  // Phase C blend: effective strength per idea_key — drives the star's strength halo.
  mastery?: Map<string, number>;
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
          el: 0,
          lessons: [],
        };
        course.units.set(unitId, unit);
      }
      unit.lessons.push({
        lesson,
        radius: LESSON_RADIUS,
        angle: 0,
        el: 0,
      });
    }

    const list = Array.from(courseMap, ([courseId, course]) => ({
      courseId,
      title: course.title,
      radius: COURSE_RADIUS,
      angle: 0,
      el: elevationFor(courseId, 0.3),
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
        unit.el = clampEl(course.el + elevationFor(unit.unitId, 0.3), 0.55);
        unit.lessons.forEach((node, index) => {
          node.angle =
            unit.lessons.length === 1
              ? unit.angle
              : unitCursor +
                unitSpan * 0.08 +
                (unitSpan * 0.84 * index) / (unit.lessons.length - 1);
          node.radius = LESSON_RADIUS + (index % 2 === 0 ? 0 : LESSON_STAGGER);
          node.el = clampEl(unit.el + elevationFor(node.lesson.id, 0.28), 0.7);
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
      el: index % 2 === 0 ? 0.42 : -0.42,
    }));
  }, [memoryProfile]);

  // LEARNING FRAMEWORK (F4): idea stars + knowledge arcs — the graph becomes real, and
  // the lexical topic links retire in its favor. Authored ideas ride just outside the
  // lesson that teaches them; pool ideas (no lesson) and EMERGENT ideas (grown from this
  // student's own thinking) orbit their subject's course hub — emergent ones wear the
  // aurora. Arcs connect idea worlds: curriculum links render FAINT (possible),
  // student links render BRIGHT (earned, permanent); a link made in the last few
  // minutes draws itself with the flow animation.
  type IdeaWorld = World & { idea: IdeaNode };
  const knowledge = useMemo(() => {
    const worlds = new Map<string, IdeaWorld>();
    const lessonWorld = new Map<string, World>();
    for (const course of courses) {
      for (const unit of course.units) {
        for (const node of unit.lessons) lessonWorld.set(node.lesson.id, node);
      }
    }
    const courseByTitle = new Map(courses.map((course) => [course.title, course]));
    for (const idea of ideas ?? []) {
      const anchor = idea.lesson_id ? lessonWorld.get(idea.lesson_id) : undefined;
      if (anchor && idea.origin === "authored") {
        worlds.set(idea.key, {
          idea,
          radius: anchor.radius + 15,
          angle: anchor.angle + elevationFor(`${idea.key}:a`, 0.06),
          el: clampEl(anchor.el + elevationFor(idea.key, 0.16), 0.8),
        });
        continue;
      }
      const hub = courseByTitle.get(idea.subject);
      worlds.set(idea.key, {
        idea,
        radius: COURSE_RADIUS + 18,
        angle: (hub ? hub.angle : -Math.PI / 2) + elevationFor(`${idea.key}:a`, 0.55),
        el: clampEl((hub ? hub.el : 0) + elevationFor(idea.key, 0.32), 0.7),
      });
    }
    const now = Date.now();
    const earnedPairs = new Set<string>();
    const arcs: {
      fromKey: string;
      toKey: string;
      from: IdeaWorld;
      to: IdeaWorld;
      earned: boolean;
      fresh: boolean;
      label: string;
    }[] = [];
    for (const link of studentLinks ?? []) {
      const from = worlds.get(link.from_key);
      const to = worlds.get(link.to_key);
      if (!from || !to) continue;
      earnedPairs.add(`${link.from_key}::${link.to_key}`);
      earnedPairs.add(`${link.to_key}::${link.from_key}`);
      arcs.push({
        fromKey: link.from_key,
        toKey: link.to_key,
        from,
        to,
        earned: true,
        fresh: now - Date.parse(link.created_at) < 10 * 60 * 1000,
        label: link.note || `${from.idea.title} ↔ ${to.idea.title}`,
      });
    }
    for (const link of curriculumLinks ?? []) {
      // An earned link outranks its faint curriculum twin — render once, bright.
      if (earnedPairs.has(`${link.from_key}::${link.to_key}`)) continue;
      const from = worlds.get(link.from_key);
      const to = worlds.get(link.to_key);
      if (!from || !to) continue;
      arcs.push({
        fromKey: link.from_key,
        toKey: link.to_key,
        from,
        to,
        earned: false,
        fresh: false,
        label: link.note || `${from.idea.title} ↔ ${to.idea.title}`,
      });
    }
    return { worlds, arcs };
  }, [courses, ideas, studentLinks, curriculumLinks]);

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
    const horizontal = world.radius * Math.cos(world.el);
    const wx = horizontal * Math.cos(world.angle);
    const wz = horizontal * Math.sin(world.angle);
    const wy = world.radius * Math.sin(world.el);
    const x1 = wx * cosYaw - wz * sinYaw;
    const z1 = wx * sinYaw + wz * cosYaw;
    const y2 = wy * cosPitch - z1 * sinPitch;
    const z2 = wy * sinPitch + z1 * cosPitch;
    const f = FOCAL / (FOCAL + z2);
    return { x: CX + x1 * f, y: CY + y2 * f, depth: z2, f };
  };
  // Depth cues: nearer = bigger + brighter. Normalized against the outer ring.
  const depthOpacity = (depth: number) =>
    0.72 + 0.28 * Math.min(1, Math.max(0, (LESSON_RADIUS - depth) / (2 * LESSON_RADIUS)));

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

  // Idea stars: authored ideas are small ringed dots by their lesson; emergent ideas
  // wear the aurora — the part of the brain that exists because THIS student thought.
  for (const world of knowledge.worlds.values()) {
    const p = project(world);
    const emergent = world.idea.origin === "emergent";
    // Phase C blend: the strength halo — a solid idea wears a firm practice-green ring,
    // a fading one a warm dashed discuss-yellow ring asking for a refresh.
    const strength = mastery?.get(world.idea.key);
    // R33b (tester, live): "the brain is cool but nothing happens when i click on a node."
    // Only lesson dots were clickable; the IDEA nodes — the actual concepts, the thing a
    // student wants to act on — were inert tooltips. An authored idea knows the lesson
    // that teaches it, so clicking one opens that lesson, exactly like its lesson dot.
    // Emergent ideas (the student's own, no lesson) stay non-interactive rather than
    // offering a click that goes nowhere.
    const ideaLessonId =
      typeof world.idea.lesson_id === "string" && world.idea.lesson_id
        ? world.idea.lesson_id
        : null;
    renderNodes.push({
      depth: p.depth,
      node: (
        <g
          key={`idea-${world.idea.key}`}
          className={`bmap-node${ideaLessonId ? " cursor-pointer" : ""}`}
          onClick={ideaLessonId ? () => onOpenLesson(ideaLessonId) : undefined}
          style={pop()}
          opacity={depthOpacity(p.depth)}
        >
          <title>
            {`${emergent ? "Your idea: " : "Idea: "}${world.idea.title}${world.idea.one_liner ? ` — ${world.idea.one_liner}` : ""}${typeof strength === "number" ? ` — strength ${Math.round(strength * 100)}%` : ""}${ideaLessonId ? " — click to open its lesson" : ""}`}
          </title>
          {typeof strength === "number" ? (
            <circle
              cx={p.x}
              cy={p.y}
              r={(3.8 + 3.2 * strength) * p.f}
              fill="none"
              stroke={strength >= 0.4 ? "var(--mode-practice)" : "var(--mode-discuss)"}
              strokeWidth="1"
              strokeOpacity={0.2 + 0.4 * strength}
              strokeDasharray={strength < 0.4 ? "2 2" : undefined}
            />
          ) : null}
          {emergent ? (
            <circle
              cx={p.x}
              cy={p.y}
              r={7 * p.f}
              fill="url(#brainmap-aurora)"
              className="bmap-glow"
            />
          ) : null}
          <circle
            cx={p.x}
            cy={p.y}
            r={2.6 * p.f}
            fill={emergent ? "var(--grad-1)" : "var(--depth-card)"}
            stroke={emergent ? "none" : "var(--grad-1)"}
            strokeWidth="1"
            strokeOpacity={emergent ? undefined : 0.55}
          />
        </g>
      ),
    });
  }

  const edges: React.ReactNode[] = [];
  const center = project({ radius: 0, angle: 0, el: 0 });
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
          ? "var(--map-current)"
          : value >= 1
            ? "var(--map-done)"
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

  // NO painter sort: reordering SVG children per frame moves DOM nodes, and a moved DOM
  // node RESTARTS its CSS animations — which made stars visibly re-pop on every spin
  // tick. Stable DOM order means the entrance runs once and the glow loops stay smooth;
  // depth still reads through per-node size and brightness, and 3.5px dots barely
  // overlap, so losing strict occlusion order is invisible in practice.

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
            <stop offset="0%" stopColor="var(--map-memory-halo)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--map-memory-halo)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {edges}

        {/* Knowledge arcs: curriculum links FAINT (what could connect), earned student
            links BRIGHT and permanent — a fresh one draws itself with the flow dash. */}
        {knowledge.arcs.map((arc) => {
          const a = project(arc.from);
          const b = project(arc.to);
          return (
            <line
              key={`arc-${arc.fromKey}-${arc.toKey}-${arc.earned ? "e" : "c"}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--grad-1)"
              strokeWidth={arc.earned ? 1.4 : 1}
              strokeOpacity={arc.earned ? 0.85 : 0.22}
              strokeDasharray={arc.earned ? undefined : "2 5"}
              strokeLinecap="round"
              className={arc.fresh ? "bmap-thread" : undefined}
            >
              <title>{arc.label}</title>
            </line>
          );
        })}

        {/* The live thread — the one moving line, tracing the path to the current lesson. */}
        {threadPoints ? (
          <polyline
            points={threadPoints}
            fill="none"
            stroke="var(--map-current)"
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
