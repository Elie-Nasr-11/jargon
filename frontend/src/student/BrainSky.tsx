import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import type { IdeaNode, Lesson, MyJargonWord, StudentLinkRow } from "@/lib/types";

// THE BRAIN, v4 — "the night sky". A canvas scene, still zero dependencies.
//
// The metaphor (owner brief, 2026-08-16): everything the student has LEARNED — words
// and ideas — lies as background stars on a single plane, a galactic floor. The
// lessons hang ABOVE that plane as 3D constellations: each lesson is a small star
// pattern (deterministic per lesson id), its stars lighting up gold as the student
// progresses, fully lit when the lesson is done, the current lesson's constellation
// breathing. Courses set the sky sector and altitude band, so one subject's
// constellations hang together like a season's sky.
//
// v4.1 (owner feedback: "not very clear visually … orbiting not intuitive"):
// - CLARITY. A hard size/brightness hierarchy (constellations >> ideas > words),
//   constellation labels always on and plated for contrast, a ground mist + optional
//   plane grid separating the floor from the sky, and bloom concentrated on lessons.
// - ONE-AXIS ORBIT. Dragging spins the sky like a globe — yaw only, fixed pitch, so
//   there is no way to end up looking at the scene edge-on or upside down. Wheel
//   still zooms; reset restores home; a first-run hint names both gestures.
// - SKINS. The scene's whole look is a token table (SKY_SKINS) so restyling is a
//   data change. The pick persists in localStorage ("jargon.sky-skin").
//
// Interaction contract: hovering any meaningful star raises an info card pinned to
// the map's top-right; clicking always opens something real — a constellation (or an
// idea that belongs to a lesson) opens that lesson, a word star hands the term to
// the shell, which scrolls My Jargon to it.

const PLANE_RADIUS = 175;
const IDEA_RADIUS_MIN = 55;
const CONSTELLATION_ALT_BASE = 84;
const CONSTELLATION_ALT_BAND = 30;
const CONSTELLATION_SPREAD = 16;
const FOCAL = 480;
const CAMERA_BACK = 345;
const PITCH_FIXED = 0.58;
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.6;
const IDLE_YAW_PER_SEC = 0.04;
const PICK_RADIUS_PX = 16;
const BACKDROP_COUNT = 130;

// Kept as a named export of the palette contract: emergent ideas always wear their
// own hue, whatever the skin (tests + the hover card key off it).
const STAR_EMERGENT = "#c9a2ff";

export type SkySkinId = "minimal" | "observatory" | "neon" | "storybook";

type SkySkin = {
  title: string;
  sky: [string, string];
  nebulae: { x: number; y: number; r: number; color: string }[];
  ground: string;
  grid: "rings" | "synth" | "horizon" | "none";
  gridColor: string;
  starWord: string;
  starWordFaint: string;
  starIdea: string;
  lit: string;
  unlit: string;
  link: string;
  line: { color: string; width: number; dash: number[] | null; glow: string | null };
  label: {
    color: string;
    currentColor: string;
    plate: string | null;
    font: string;
    uppercase: boolean;
  };
  bloom: number;
};

// Three deliberate directions (style references for the owner to choose from):
// observatory = planetarium star atlas; neon = synthwave arcade; storybook = a
// child's paper star chart. One is the shipping default; the others stay one
// localStorage flip away.
export const SKY_SKINS: Record<SkySkinId, SkySkin> = {
  // The shipping default (owner pick, 2026-08-16): the original deep-space look,
  // refined rather than decorated — no plates, no grids, hairline constellations;
  // readability comes from type, spacing, contrast, and label de-collision.
  minimal: {
    title: "Minimal",
    sky: ["#070b1c", "#0d1330"],
    nebulae: [
      { x: 0.24, y: 0.3, r: 0.4, color: "rgba(88, 101, 242, 0.09)" },
      { x: 0.78, y: 0.62, r: 0.36, color: "rgba(190, 120, 255, 0.06)" },
    ],
    ground: "rgba(120, 140, 200, 0.045)",
    grid: "horizon",
    gridColor: "rgba(159, 212, 255, 0.16)",
    starWord: "#eef1ff",
    starWordFaint: "rgba(196, 205, 238, 0.36)",
    starIdea: "#9fd4ff",
    lit: "#ffd88a",
    unlit: "rgba(186, 198, 232, 0.62)",
    link: "rgba(159, 212, 255, 0.36)",
    line: { color: "rgba(222, 230, 255, 0.42)", width: 1.1, dash: null, glow: null },
    label: {
      color: "rgba(226, 232, 252, 0.92)",
      currentColor: "#ffd88a",
      plate: null,
      font: "600 11.5px ui-sans-serif, system-ui, sans-serif",
      uppercase: false,
    },
    bloom: 1,
  },
  observatory: {
    title: "Observatory",
    sky: ["#04060e", "#0a0f22"],
    nebulae: [{ x: 0.3, y: 0.32, r: 0.42, color: "rgba(88, 110, 220, 0.09)" }],
    ground: "rgba(130, 150, 210, 0.06)",
    grid: "rings",
    gridColor: "rgba(232, 220, 190, 0.12)",
    starWord: "#f2f4ff",
    starWordFaint: "rgba(196, 205, 238, 0.4)",
    starIdea: "#a8d8ff",
    lit: "#ffd88a",
    unlit: "rgba(190, 202, 235, 0.65)",
    link: "rgba(168, 216, 255, 0.4)",
    line: { color: "rgba(240, 222, 170, 0.62)", width: 1.3, dash: null, glow: null },
    label: {
      color: "#eadfc4",
      currentColor: "#ffd88a",
      plate: "rgba(6, 9, 20, 0.62)",
      font: "600 12px Georgia, 'Times New Roman', serif",
      uppercase: true,
    },
    bloom: 1.05,
  },
  neon: {
    title: "Neon arcade",
    sky: ["#0c0121", "#241257"],
    nebulae: [
      { x: 0.22, y: 0.3, r: 0.4, color: "rgba(255, 60, 190, 0.16)" },
      { x: 0.8, y: 0.55, r: 0.38, color: "rgba(53, 224, 255, 0.13)" },
    ],
    ground: "rgba(255, 60, 190, 0.09)",
    grid: "synth",
    gridColor: "rgba(255, 60, 190, 0.3)",
    starWord: "#ffffff",
    starWordFaint: "rgba(210, 190, 255, 0.42)",
    starIdea: "#35e0ff",
    lit: "#ffe066",
    unlit: "rgba(190, 190, 255, 0.65)",
    link: "rgba(53, 224, 255, 0.45)",
    line: { color: "#35e0ff", width: 2, dash: null, glow: "rgba(53, 224, 255, 0.55)" },
    label: {
      color: "#ffffff",
      currentColor: "#ff5ad1",
      plate: "rgba(22, 5, 48, 0.75)",
      font: "800 12px ui-sans-serif, system-ui, sans-serif",
      uppercase: true,
    },
    bloom: 1.7,
  },
  storybook: {
    title: "Storybook",
    sky: ["#0d2330", "#1e4152"],
    nebulae: [{ x: 0.7, y: 0.3, r: 0.45, color: "rgba(255, 214, 140, 0.08)" }],
    ground: "rgba(255, 240, 205, 0.06)",
    grid: "none",
    gridColor: "transparent",
    starWord: "#fff6dc",
    starWordFaint: "rgba(255, 244, 214, 0.38)",
    starIdea: "#9fe3d0",
    lit: "#ffd88a",
    unlit: "rgba(230, 235, 220, 0.6)",
    link: "rgba(159, 227, 208, 0.5)",
    line: { color: "rgba(255, 240, 205, 0.65)", width: 1.7, dash: [5, 4], glow: null },
    label: {
      color: "#fff3d6",
      currentColor: "#ffd88a",
      plate: "rgba(8, 26, 34, 0.7)",
      font: "700 12.5px ui-rounded, 'Segoe UI', system-ui, sans-serif",
      uppercase: false,
    },
    bloom: 1.3,
  },
};

export function readSkySkin(): SkySkinId {
  try {
    const raw = localStorage.getItem("jargon.sky-skin");
    if (raw === "minimal" || raw === "observatory" || raw === "neon" || raw === "storybook")
      return raw;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return "minimal";
}

type Vec3 = { x: number; y: number; z: number };
type SkyNode =
  | { kind: "word"; word: MyJargonWord; collected: boolean; pos: Vec3; size: number }
  | { kind: "idea"; idea: IdeaNode; mastery: number; pos: Vec3; size: number }
  | {
      kind: "lesson";
      lesson: Lesson;
      pos: Vec3; // constellation centroid (label + picking anchor)
      stars: Vec3[];
      edges: [number, number][];
      lit: number; // 0..1 progress → fraction of stars lit
      current: boolean;
      size: number;
    };

export type SkyHover =
  | { kind: "word"; word: MyJargonWord; collected: boolean }
  | { kind: "idea"; idea: IdeaNode; mastery: number; lessonTitle: string | null }
  | { kind: "lesson"; lesson: Lesson; progress: number; current: boolean };

// Deterministic hash → [0,1). Layout must be stable across mounts — a sky that
// rearranges itself on every visit reads as noise, not as YOUR sky.
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Golden-angle spiral over the plane disc: even coverage with zero collisions in
// practice, and each item's slot depends only on its own rank + id jitter.
function planeSpot(rank: number, count: number, id: string, rMin: number, rMax: number): Vec3 {
  const t = (rank + 0.5) / Math.max(1, count);
  const radius = rMin + (rMax - rMin) * Math.sqrt(t);
  const angle = rank * 2.39996 + hash01(id) * 0.55;
  return { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };
}

// A lesson's constellation: 4–7 stars scattered deterministically around its anchor,
// chained in rank order with one deterministic cross-brace so shapes read as figures
// (a zig-zag plus one closing stroke), never as a blob.
function constellationFor(
  lesson: Lesson,
  anchor: Vec3,
): { stars: Vec3[]; edges: [number, number][] } {
  const n = 4 + Math.floor(hash01(`${lesson.id}:n`) * 4);
  const stars: Vec3[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = hash01(`${lesson.id}:a${i}`) * Math.PI * 2;
    const r = CONSTELLATION_SPREAD * (0.5 + hash01(`${lesson.id}:r${i}`) * 0.95);
    stars.push({
      x: anchor.x + Math.cos(a) * r,
      y: anchor.y + (hash01(`${lesson.id}:y${i}`) - 0.5) * 16,
      z: anchor.z + Math.sin(a) * r,
    });
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < n - 1; i += 1) edges.push([i, i + 1]);
  if (n > 4) edges.push([0, Math.floor(hash01(`${lesson.id}:x`) * (n - 2)) + 1]);
  return { stars, edges };
}

// World layout. Courses split the compass into sectors; a course's constellations hang
// in its sector at a course-specific altitude band. Words fill the outer plane; ideas
// sit on an inner ring of the same plane (they are the floor the lessons rise from).
function buildSky(input: {
  lessons: Lesson[];
  words: MyJargonWord[];
  vocabTermsNotCollected: string[];
  ideas: IdeaNode[];
  progress: Record<string, number>;
  currentLessonId: string | null;
  mastery?: Map<string, number>;
}): { nodes: SkyNode[]; ideaIndex: Map<string, number> } {
  const nodes: SkyNode[] = [];
  const ideaIndex = new Map<string, number>();

  const ideas = input.ideas.slice(0, 80);
  ideas.forEach((idea, i) => {
    ideaIndex.set(idea.key, nodes.length);
    nodes.push({
      kind: "idea",
      idea,
      mastery: input.mastery?.get(idea.key) ?? 0,
      pos: planeSpot(i, ideas.length, idea.key, IDEA_RADIUS_MIN, PLANE_RADIUS * 0.62),
      size: idea.origin === "emergent" ? 3 : 2.6,
    });
  });

  const words = input.words.slice(0, 120);
  words.forEach((word, i) => {
    nodes.push({
      kind: "word",
      word,
      collected: true,
      pos: planeSpot(i, words.length, word.term, PLANE_RADIUS * 0.55, PLANE_RADIUS),
      size: word.traveled ? 2.5 : 2.1,
    });
  });
  // Words the curriculum will teach but the student hasn't met: the sky hints at how
  // much more there is to collect without stealing focus.
  const known = new Set(words.map((w) => w.term.toLowerCase()));
  const faint = input.vocabTermsNotCollected
    .filter((t) => !known.has(t.toLowerCase()))
    .slice(0, 80);
  faint.forEach((term, i) => {
    nodes.push({
      kind: "word",
      word: { term, definition: "", subject: "", first_seen_at: "", traveled: false },
      collected: false,
      pos: planeSpot(
        i + 7,
        faint.length + 7,
        `faint:${term}`,
        PLANE_RADIUS * 0.7,
        PLANE_RADIUS * 1.08,
      ),
      size: 1.4,
    });
  });

  // Courses → sectors; lessons → constellations above the plane.
  const courses = new Map<string, Lesson[]>();
  for (const lesson of input.lessons) {
    const key = lesson.course_id || lesson.course_title || "course";
    const list = courses.get(key);
    if (list) list.push(lesson);
    else courses.set(key, [lesson]);
  }
  const courseList = Array.from(courses.entries());
  const totalLessons = input.lessons.length || 1;
  let sectorStart = -Math.PI / 2;
  courseList.forEach(([courseKey, courseLessons], courseRank) => {
    const span = (courseLessons.length / totalLessons) * Math.PI * 2;
    const altitude =
      CONSTELLATION_ALT_BASE + (courseRank % 3) * CONSTELLATION_ALT_BAND + hash01(courseKey) * 10;
    courseLessons.forEach((lesson, i) => {
      const angle = sectorStart + span * ((i + 0.5) / courseLessons.length);
      const radius = 82 + (i % 2) * 36 + hash01(lesson.id) * 22;
      const anchor: Vec3 = {
        x: Math.cos(angle) * radius,
        y: altitude + (hash01(`${lesson.id}:alt`) - 0.5) * 18,
        z: Math.sin(angle) * radius,
      };
      const { stars, edges } = constellationFor(lesson, anchor);
      nodes.push({
        kind: "lesson",
        lesson,
        pos: anchor,
        stars,
        edges,
        lit: Math.max(0, Math.min(1, input.progress[lesson.id] ?? 0)),
        current: lesson.id === input.currentLessonId,
        size: 3.6,
      });
    });
    sectorStart += span;
  });

  return { nodes, ideaIndex };
}

// Cached glow sprite per (color, radius bucket): a radial gradient stamped once, then
// drawImage'd — hundreds of gradient fills per frame would be the slow path.
const spriteCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string, radius: number): HTMLCanvasElement {
  const r = Math.ceil(radius);
  const key = `${color}:${r}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = r * 6;
  const g = sprite.getContext("2d")!;
  const grad = g.createRadialGradient(r * 3, r * 3, 0, r * 3, r * 3, r * 3);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, r * 6, r * 6);
  spriteCache.set(key, sprite);
  return sprite;
}

type Projected = { x: number; y: number; scale: number; depth: number };

export function BrainSky({
  lessons,
  words,
  vocabTermsNotCollected,
  ideas,
  studentLinks,
  progress,
  currentLessonId,
  mastery,
  onOpenLesson,
  onOpenWord,
  skin: skinId,
}: {
  lessons: Lesson[];
  words: MyJargonWord[];
  vocabTermsNotCollected: string[];
  ideas: IdeaNode[];
  studentLinks: StudentLinkRow[];
  progress: Record<string, number>;
  currentLessonId: string | null;
  mastery?: Map<string, number>;
  onOpenLesson: (lessonId: string) => void;
  onOpenWord: (term: string) => void;
  // Style direction override; defaults to the stored pick (localStorage).
  skin?: SkySkinId;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<SkyHover | null>(null);
  const [hintSeen, setHintSeen] = useState(false);
  const hoverRef = useRef<{ nodeIndex: number } | null>(null);
  const skin = SKY_SKINS[skinId ?? readSkySkin()];

  const sky = useMemo(
    () =>
      buildSky({
        lessons,
        words,
        vocabTermsNotCollected,
        ideas,
        progress,
        currentLessonId,
        mastery,
      }),
    [lessons, words, vocabTermsNotCollected, ideas, progress, currentLessonId, mastery],
  );
  const links = useMemo(
    () =>
      (studentLinks ?? [])
        .map((link) => ({
          a: sky.ideaIndex.get(link.from_key),
          b: sky.ideaIndex.get(link.to_key),
        }))
        .filter((l): l is { a: number; b: number } => l.a != null && l.b != null),
    [studentLinks, sky],
  );
  // Deep-background decoration: fixed unit directions, projected with heavy parallax.
  const backdrop = useMemo(
    () =>
      Array.from({ length: BACKDROP_COUNT }, (_, i) => ({
        a: hash01(`bg:a${i}`) * Math.PI * 2,
        y: (hash01(`bg:y${i}`) - 0.32) * 2.2,
        tw: hash01(`bg:t${i}`) * Math.PI * 2,
        s: 0.6 + hash01(`bg:s${i}`) * 1.1,
      })),
    [],
  );

  // Camera state lives in refs — the render loop reads it directly; React re-renders
  // only for hover-card content. v4.1: yaw + zoom only. Pitch is FIXED — the one-axis
  // globe spin is what makes the orbit predictable.
  const cam = useRef({ yaw: 0.5, zoom: 1, idle: true });
  const lessonsRef = useRef(sky);
  lessonsRef.current = sky;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let visible = true;
    let width = 0;
    let height = 0;
    const reduced = prefersReducedMotion();

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(wrap);

    const cp = Math.cos(PITCH_FIXED);
    const sp = Math.sin(PITCH_FIXED);
    const project = (p: Vec3): Projected => {
      const { yaw, zoom } = cam.current;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const x1 = p.x * cy - p.z * sy;
      const z1 = p.x * sy + p.z * cy;
      const y2 = p.y * cp - z1 * sp;
      const z2 = p.y * sp + z1 * cp;
      const depth = z2 + CAMERA_BACK;
      const f = (FOCAL / Math.max(60, depth)) * zoom;
      return { x: width / 2 + x1 * f, y: height / 2 + 34 - y2 * f, scale: f, depth };
    };

    const planeCircle = (radius: number) => {
      ctx.beginPath();
      for (let a = 0; a <= 64; a += 1) {
        const p = project({
          x: Math.cos((a / 64) * Math.PI * 2) * radius,
          y: 0,
          z: Math.sin((a / 64) * Math.PI * 2) * radius,
        });
        if (a === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    };

    const projected: Projected[] = new Array(sky.nodes.length);
    let last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running || !visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduced && cam.current.idle) cam.current.yaw += IDLE_YAW_PER_SEC * dt;

      const nodes = lessonsRef.current.nodes;
      ctx.clearRect(0, 0, width, height);

      // Sky wash + skin nebulae (viewport-anchored atmosphere).
      const wash = ctx.createLinearGradient(0, 0, 0, height);
      wash.addColorStop(0, skin.sky[0]);
      wash.addColorStop(1, skin.sky[1]);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);
      for (const neb of skin.nebulae) {
        const grad = ctx.createRadialGradient(
          width * neb.x,
          height * neb.y,
          0,
          width * neb.x,
          height * neb.y,
          width * neb.r,
        );
        grad.addColorStop(0, neb.color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Backdrop stars: infinitely-far dust that only yaw moves, twinkling gently.
      const t = now / 1000;
      for (const star of backdrop) {
        const a = star.a + cam.current.yaw * 0.35;
        const x = width / 2 + Math.cos(a) * width * 0.62;
        const y = height * 0.5 + star.y * height * 0.5 - Math.sin(a) * 8;
        if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;
        const tw = reduced ? 0.55 : 0.38 + 0.34 * (0.5 + 0.5 * Math.sin(t * 1.7 + star.tw));
        ctx.globalAlpha = tw * 0.45;
        ctx.fillStyle = skin.starWord;
        ctx.fillRect(x, y, star.s, star.s);
      }
      ctx.globalAlpha = 1;

      // The floor, before anything that sits on it: ground mist, then the skin's grid.
      const center = project({ x: 0, y: 0, z: 0 });
      const mist = ctx.createRadialGradient(
        center.x,
        center.y,
        0,
        center.x,
        center.y,
        PLANE_RADIUS * center.scale * 1.15,
      );
      mist.addColorStop(0, skin.ground);
      mist.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = mist;
      planeCircle(PLANE_RADIUS * 1.12);
      ctx.fill();

      if (skin.grid === "horizon") {
        ctx.strokeStyle = skin.gridColor;
        ctx.lineWidth = 1;
        planeCircle(PLANE_RADIUS);
        ctx.stroke();
      } else if (skin.grid === "rings") {
        ctx.strokeStyle = skin.gridColor;
        ctx.lineWidth = 1;
        for (const r of [66, 120, PLANE_RADIUS]) {
          planeCircle(r);
          ctx.stroke();
        }
      } else if (skin.grid === "synth") {
        ctx.strokeStyle = skin.gridColor;
        ctx.lineWidth = 1;
        for (const r of [55, 95, 135, PLANE_RADIUS]) {
          planeCircle(r);
          ctx.stroke();
        }
        for (let s = 0; s < 12; s += 1) {
          const a = (s / 12) * Math.PI * 2;
          const inner = project({ x: Math.cos(a) * 40, y: 0, z: Math.sin(a) * 40 });
          const outer = project({
            x: Math.cos(a) * PLANE_RADIUS,
            y: 0,
            z: Math.sin(a) * PLANE_RADIUS,
          });
          ctx.beginPath();
          ctx.moveTo(inner.x, inner.y);
          ctx.lineTo(outer.x, outer.y);
          ctx.stroke();
        }
      }

      for (let i = 0; i < nodes.length; i += 1) projected[i] = project(nodes[i].pos);

      // Earned links: lines lying on the word/idea plane.
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = skin.link;
      for (const link of links) {
        const a = projected[link.a];
        const b = projected[link.b];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Painter order: far → near, so nearer stars overdraw farther ones.
      const order = nodes.map((_, i) => i).sort((a, b) => projected[b].depth - projected[a].depth);

      const hovered = hoverRef.current?.nodeIndex ?? -1;
      type LabelJob = {
        text: string;
        x: number;
        y: number;
        size: number;
        current: boolean;
        hover: boolean;
      };
      const labels: LabelJob[] = [];

      for (const i of order) {
        const node = nodes[i];
        const p = projected[i];
        if (p.depth < 70) continue;
        const isHover = i === hovered;
        if (node.kind === "lesson") {
          const pts = node.stars.map(project);
          // A soft halo patch behind the current (or hovered) constellation pulls the
          // eye before any label is read.
          if (node.current || isHover) {
            const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 46 * p.scale);
            halo.addColorStop(
              0,
              node.current ? "rgba(255, 216, 138, 0.14)" : "rgba(255,255,255,0.08)",
            );
            halo.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = halo;
            ctx.fillRect(p.x - 50 * p.scale, p.y - 50 * p.scale, 100 * p.scale, 100 * p.scale);
          }
          // Constellation strokes (skin-styled, optional glow pass), then member stars.
          if (skin.line.dash) ctx.setLineDash(skin.line.dash);
          if (skin.line.glow) {
            ctx.strokeStyle = skin.line.glow;
            ctx.lineWidth = skin.line.width + 2.5;
            for (const [a, b] of node.edges) {
              ctx.beginPath();
              ctx.moveTo(pts[a].x, pts[a].y);
              ctx.lineTo(pts[b].x, pts[b].y);
              ctx.stroke();
            }
          }
          ctx.strokeStyle = skin.line.color;
          ctx.lineWidth = isHover ? skin.line.width + 0.7 : skin.line.width;
          for (const [a, b] of node.edges) {
            ctx.beginPath();
            ctx.moveTo(pts[a].x, pts[a].y);
            ctx.lineTo(pts[b].x, pts[b].y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          const litCount = Math.round(node.lit * node.stars.length);
          const pulse = node.current && !reduced ? 1 + 0.16 * Math.sin(t * 2.1) : 1;
          pts.forEach((sp2, s) => {
            const lit = s < litCount || node.lit >= 1;
            const r = (lit ? 3.4 : 2.7) * sp2.scale * 2.3 * pulse * skin.bloom;
            const sprite = glowSprite(lit ? skin.lit : skin.unlit, 3);
            ctx.globalAlpha = lit ? 1 : 0.72;
            ctx.drawImage(sprite, sp2.x - r, sp2.y - r, r * 2, r * 2);
          });
          ctx.globalAlpha = 1;
          // Every constellation is labeled (catalogs are small) — queued so text
          // always paints over stars.
          labels.push({
            text: node.lesson.title,
            x: p.x,
            y: p.y + 30 * Math.min(1.5, p.scale),
            size: Math.min(13, 9.5 + p.scale * 2),
            current: node.current,
            hover: isHover,
          });
        } else {
          const color =
            node.kind === "idea"
              ? node.idea.origin === "emergent"
                ? STAR_EMERGENT
                : skin.starIdea
              : node.collected
                ? skin.starWord
                : skin.starWordFaint;
          const tw =
            reduced || node.kind === "idea"
              ? 1
              : 0.84 + 0.16 * Math.sin(t * 1.3 + hash01(node.word.term) * 6.28);
          const r = node.size * p.scale * 2.1 * tw * (isHover ? 1.35 : 1);
          const sprite = glowSprite(color, 3);
          ctx.globalAlpha = node.kind === "word" && !node.collected ? 0.5 : 0.95;
          ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
          // Mastery halo: a thin ring around ideas the student has evidence for.
          if (node.kind === "idea" && node.mastery > 0) {
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = skin.lit;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 3, -Math.PI / 2, -Math.PI / 2 + node.mastery * Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (isHover) {
          ctx.strokeStyle = "#ffffff";
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(9, node.size * p.scale * 2.8), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Label pass: drawn last so no star ever sits on the text. Overlapping labels
      // are nudged apart first (greedy, top-down) — colliding titles were the single
      // worst readability problem in v4.0.
      labels.sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i += 1) {
        const prev = labels[i - 1];
        const cur = labels[i];
        ctx.font = skin.label.font.replace(/\b\d+(\.\d+)?px\b/, `${cur.size}px`);
        const halfW =
          (ctx.measureText(skin.label.uppercase ? cur.text.toUpperCase() : cur.text).width + 14) /
          2;
        ctx.font = skin.label.font.replace(/\b\d+(\.\d+)?px\b/, `${prev.size}px`);
        const prevHalfW =
          (ctx.measureText(skin.label.uppercase ? prev.text.toUpperCase() : prev.text).width + 14) /
          2;
        const overlapX = Math.abs(cur.x - prev.x) < halfW + prevHalfW;
        const minGap = prev.size + 7;
        if (overlapX && cur.y - prev.y < minGap) cur.y = prev.y + minGap;
      }
      for (const job of labels) {
        const text = skin.label.uppercase ? job.text.toUpperCase() : job.text;
        ctx.font = skin.label.font.replace(/\b\d+(\.\d+)?px\b/, `${job.size}px`);
        ctx.textAlign = "center";
        const w = ctx.measureText(text).width;
        if (skin.label.plate) {
          ctx.fillStyle = skin.label.plate;
          const padX = 7;
          const padY = 4.5;
          const bx = job.x - w / 2 - padX;
          const by = job.y - job.size + 1 - padY;
          const bw = w + padX * 2;
          const bh = job.size + padY * 2;
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 6);
          ctx.fill();
        }
        ctx.fillStyle = job.current ? skin.label.currentColor : skin.label.color;
        ctx.globalAlpha = job.current || job.hover ? 1 : 0.85;
        if (!skin.label.plate) {
          // No plate: a tight dark halo keeps text readable over any star field
          // without drawing a box.
          ctx.shadowColor = "rgba(4, 6, 16, 0.9)";
          ctx.shadowBlur = 4;
          ctx.fillText(text, job.x, job.y);
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
        }
        ctx.fillText(text, job.x, job.y);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(frame);

    // Picking uses the same projection math on demand (pointer events are far rarer
    // than frames — recomputing beats caching screen positions across the ref).
    const pick = (clientX: number, clientY: number): number => {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      let best = -1;
      let bestDist = PICK_RADIUS_PX;
      lessonsRef.current.nodes.forEach((node, i) => {
        const p = project(node.pos);
        if (p.depth < 70) return;
        const d = Math.hypot(p.x - mx, p.y - my);
        // Lessons get a friendlier halo — a constellation is a bigger target.
        const slack = node.kind === "lesson" ? 12 : 0;
        if (d < bestDist + slack && d - slack < bestDist) {
          best = i;
          bestDist = Math.max(1, d - slack);
        }
      });
      return best;
    };

    const toHover = (index: number): SkyHover | null => {
      const node = lessonsRef.current.nodes[index];
      if (!node) return null;
      if (node.kind === "lesson")
        return { kind: "lesson", lesson: node.lesson, progress: node.lit, current: node.current };
      if (node.kind === "idea") {
        const lessonTitle = node.idea.lesson_id
          ? (lessons.find((l) => l.id === node.idea.lesson_id)?.title ?? null)
          : null;
        return { kind: "idea", idea: node.idea, mastery: node.mastery, lessonTitle };
      }
      return { kind: "word", word: node.word, collected: node.collected };
    };

    const onMove = (event: PointerEvent) => {
      if (dragState.current) return;
      const index = pick(event.clientX, event.clientY);
      const prev = hoverRef.current?.nodeIndex ?? -1;
      if (index !== prev) {
        hoverRef.current = index >= 0 ? { nodeIndex: index } : null;
        setHover(index >= 0 ? toHover(index) : null);
        canvas.style.cursor = index >= 0 ? "pointer" : "grab";
      }
    };
    canvas.addEventListener("pointermove", onMove);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cam.current.idle = false;
      setHintSeen(true);
      cam.current.zoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, cam.current.zoom * (event.deltaY > 0 ? 0.92 : 1.09)),
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("wheel", onWheel);
    };
    // The scene rebinds when the sky's node list or skin changes; camera/hover live in refs.
  }, [sky, links, backdrop, lessons, skin]);

  // Drag-to-spin + click routing share pointer handlers: a press that MOVES spins the
  // sky (yaw only — the globe gesture), a press that stays put is a click on whatever
  // was picked at pointerdown.
  const dragState = useRef<{
    px: number;
    yaw: number;
    moved: number;
    downIndex: number;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    dragState.current = {
      px: event.clientX,
      yaw: cam.current.yaw,
      moved: 0,
      downIndex: hoverRef.current?.nodeIndex ?? -1,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    if (drag.moved > 3) {
      cam.current.idle = false;
      setHintSeen(true);
      cam.current.yaw = drag.yaw + dx * 0.006;
    }
  };
  const onPointerUp = () => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.moved > 6) return;
    const node = sky.nodes[drag.downIndex];
    if (!node) return;
    if (node.kind === "lesson") onOpenLesson(node.lesson.id);
    else if (node.kind === "idea" && node.idea.lesson_id) onOpenLesson(node.idea.lesson_id);
    else if (node.kind === "word" && node.collected) onOpenWord(node.word.term);
  };

  const reset = () => {
    cam.current.yaw = 0.5;
    cam.current.zoom = 1;
    cam.current.idle = true;
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-[420px] w-full overflow-hidden rounded-card"
      data-testid="brain-sky"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        role="img"
        aria-label="Your night sky: collected words and ideas as stars, lessons as constellations above them. Hover a star for details; click to open."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragState.current = null)}
      />

      {/* Legend, bottom-left: three words that teach the whole scene. */}
      <div className="pointer-events-none absolute bottom-2.5 left-3 flex items-center gap-3 font-mono text-overline uppercase tracking-[0.14em] text-white/45">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: skin.starWord }} /> words
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: skin.starIdea }} /> ideas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: skin.lit }} /> lessons
        </span>
      </div>

      {/* First-run gesture hint, centered low; retires on the first spin or zoom. */}
      {!hintSeen ? (
        <div className="pointer-events-none absolute bottom-9 left-1/2 -translate-x-1/2 rounded-pill border border-white/12 bg-black/30 px-3 py-1 font-mono text-overline uppercase tracking-[0.14em] text-white/60 backdrop-blur-sm">
          drag to spin · scroll to zoom
        </div>
      ) : null}

      <button
        type="button"
        onClick={reset}
        className="absolute bottom-2 right-2.5 flex items-center gap-1.5 rounded-pill border border-white/15 bg-white/10 px-2.5 py-1 font-mono text-overline uppercase tracking-[0.12em] text-white/70 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
        aria-label="Reset the sky view"
      >
        <RotateCcw className="h-3 w-3" strokeWidth={1.8} /> reset
      </button>

      {/* The info card: pinned top-right (owner brief), content swaps per hovered star. */}
      {hover ? (
        <div
          className="pointer-events-none absolute right-2.5 top-2.5 w-[240px] rounded-card border border-white/15 bg-[#0b1026]/92 p-3 shadow-card backdrop-blur-sm"
          role="status"
        >
          {hover.kind === "lesson" ? (
            <>
              <div className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em] text-[#ffd88a]">
                {hover.current ? "Current lesson" : "Lesson constellation"}
              </div>
              <div className="text-body font-semibold text-white">{hover.lesson.title}</div>
              {hover.lesson.unit_title || hover.lesson.course_title ? (
                <div className="mt-0.5 text-meta text-white/60">
                  {[hover.lesson.unit_title, hover.lesson.course_title].filter(Boolean).join(" · ")}
                </div>
              ) : null}
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.round(hover.progress * 100)}%`, background: "#ffd88a" }}
                />
              </div>
              <div className="mt-1.5 text-meta text-white/70">
                {hover.progress >= 1
                  ? "Complete — every star lit."
                  : `${Math.round(hover.progress * 100)}% lit · click to open`}
              </div>
            </>
          ) : hover.kind === "idea" ? (
            <>
              <div
                className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em]"
                style={{
                  color: hover.idea.origin === "emergent" ? STAR_EMERGENT : "#9fd4ff",
                }}
              >
                {hover.idea.origin === "emergent" ? "Your idea" : "Idea"}
              </div>
              <div className="text-body font-semibold text-white">{hover.idea.title}</div>
              {hover.idea.one_liner ? (
                <div className="mt-0.5 text-meta leading-snug text-white/70">
                  {hover.idea.one_liner}
                </div>
              ) : null}
              <div className="mt-1.5 text-meta text-white/60">
                {hover.mastery > 0
                  ? `Mastery ${Math.round(hover.mastery * 100)}%`
                  : "Not practiced yet"}
                {hover.lessonTitle ? ` · from “${hover.lessonTitle}” — click to open` : ""}
              </div>
            </>
          ) : (
            <>
              <div className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em] text-white/60">
                {hover.collected ? "Collected word" : "Still out there"}
              </div>
              <div className="text-body font-semibold text-white">{hover.word.term}</div>
              {hover.collected ? (
                <>
                  {hover.word.definition ? (
                    <div className="mt-0.5 text-meta leading-snug text-white/70">
                      {hover.word.definition}
                    </div>
                  ) : null}
                  <div className="mt-1.5 text-meta text-white/60">
                    {hover.word.subject || "—"}
                    {hover.word.traveled ? " · seen in 2+ subjects" : ""} · click to find it in My
                    Jargon
                  </div>
                </>
              ) : (
                <div className="mt-0.5 text-meta text-white/60">
                  A word your lessons will teach you — it lights up when you meet it.
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
