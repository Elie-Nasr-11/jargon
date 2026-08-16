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
// progresses, fully lit and glowing when the lesson is done, the current lesson's
// constellation breathing. Courses set the sky sector and altitude band, so one
// subject's constellations hang together like a season's sky.
//
// Rendering is canvas 2D with a hand-rolled camera (yaw orbit + pitch, perspective
// divide) — no three.js: a few hundred stars is trivial for 2D canvas, and glow is
// cached radial-gradient sprites. The scene idles in a slow orbit; dragging orbits,
// the wheel zooms, the chip resets. prefers-reduced-motion freezes the orbit AND the
// twinkle (a static sky is still a sky). The canvas pauses entirely while offscreen
// or the tab is hidden.
//
// Interaction contract (owner brief): hovering ANY meaningful star raises an info
// card pinned to the map's top-right; clicking always opens something real — a
// constellation (or an idea that belongs to a lesson) opens that lesson, a word
// star hands the term to the shell, which scrolls My Jargon to it.

const PLANE_RADIUS = 175;
const IDEA_RADIUS_MIN = 55;
const CONSTELLATION_ALT_BASE = 62;
const CONSTELLATION_ALT_BAND = 26;
const CONSTELLATION_SPREAD = 13;
const FOCAL = 480;
const CAMERA_BACK = 335;
const PITCH_DEFAULT = 0.62;
const PITCH_MIN = 0.22;
const PITCH_MAX = 1.15;
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.6;
const IDLE_YAW_PER_SEC = 0.045;
const PICK_RADIUS_PX = 15;
const BACKDROP_COUNT = 150;

// Fixed palette: the sky is deliberately a window into space in BOTH themes — the
// panel commits to one look rather than re-skinning per theme. Accents stay in the
// app's language (gold = progress, aurora = emergent thought).
const SKY_TOP = "#070b1c";
const SKY_BOTTOM = "#0d1330";
const NEBULA_A = "rgba(88, 101, 242, 0.10)";
const NEBULA_B = "rgba(190, 120, 255, 0.07)";
const STAR_WORD = "#e8ecff";
const STAR_WORD_FAINT = "rgba(190, 200, 235, 0.38)";
const STAR_IDEA = "#9fd4ff";
const STAR_EMERGENT = "#c9a2ff";
const STAR_LIT = "#ffd88a";
const STAR_UNLIT = "rgba(160, 175, 215, 0.5)";
const LINK_EARNED = "rgba(159, 212, 255, 0.34)";
const LINE_CONSTELLATION = "rgba(214, 224, 255, 0.28)";
const LABEL_COLOR = "rgba(214, 222, 250, 0.82)";

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
    const r = CONSTELLATION_SPREAD * (0.45 + hash01(`${lesson.id}:r${i}`) * 0.9);
    stars.push({
      x: anchor.x + Math.cos(a) * r,
      y: anchor.y + (hash01(`${lesson.id}:y${i}`) - 0.5) * 14,
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
      size: idea.origin === "emergent" ? 2.6 : 2.2,
    });
  });

  const words = input.words.slice(0, 120);
  words.forEach((word, i) => {
    nodes.push({
      kind: "word",
      word,
      collected: true,
      pos: planeSpot(i, words.length, word.term, PLANE_RADIUS * 0.55, PLANE_RADIUS),
      size: word.traveled ? 2.4 : 1.9,
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
      size: 1.3,
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
      const radius = 78 + (i % 2) * 34 + hash01(lesson.id) * 22;
      const anchor: Vec3 = {
        x: Math.cos(angle) * radius,
        y: altitude + (hash01(`${lesson.id}:alt`) - 0.5) * 16,
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
        size: 3,
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<SkyHover | null>(null);
  const hoverRef = useRef<{ nodeIndex: number } | null>(null);

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
  // only for hover-card content.
  const cam = useRef({ yaw: 0.5, pitch: PITCH_DEFAULT, zoom: 1, idle: true });
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

    const project = (p: Vec3): Projected => {
      const { yaw, pitch, zoom } = cam.current;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const x1 = p.x * cy - p.z * sy;
      const z1 = p.x * sy + p.z * cy;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const y2 = p.y * cp - z1 * sp;
      const z2 = p.y * sp + z1 * cp;
      const depth = z2 + CAMERA_BACK;
      const f = (FOCAL / Math.max(60, depth)) * zoom;
      return { x: width / 2 + x1 * f, y: height / 2 + 26 - y2 * f, scale: f, depth };
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

      // Sky wash + two soft nebulae, anchored to the viewport (they're atmosphere,
      // not world objects).
      const wash = ctx.createLinearGradient(0, 0, 0, height);
      wash.addColorStop(0, SKY_TOP);
      wash.addColorStop(1, SKY_BOTTOM);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);
      const neb1 = ctx.createRadialGradient(
        width * 0.24,
        height * 0.3,
        0,
        width * 0.24,
        height * 0.3,
        width * 0.4,
      );
      neb1.addColorStop(0, NEBULA_A);
      neb1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb1;
      ctx.fillRect(0, 0, width, height);
      const neb2 = ctx.createRadialGradient(
        width * 0.78,
        height * 0.62,
        0,
        width * 0.78,
        height * 0.62,
        width * 0.36,
      );
      neb2.addColorStop(0, NEBULA_B);
      neb2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb2;
      ctx.fillRect(0, 0, width, height);

      // Backdrop stars: infinitely-far dust that only yaw moves, twinkling gently.
      const t = now / 1000;
      for (const star of backdrop) {
        const a = star.a + cam.current.yaw * 0.35;
        const x = width / 2 + Math.cos(a) * width * 0.62;
        const y = height * 0.5 + star.y * height * 0.5 - Math.sin(a) * 8;
        if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;
        const tw = reduced ? 0.55 : 0.38 + 0.34 * (0.5 + 0.5 * Math.sin(t * 1.7 + star.tw));
        ctx.globalAlpha = tw * 0.5;
        ctx.fillStyle = STAR_WORD;
        ctx.fillRect(x, y, star.s, star.s);
      }
      ctx.globalAlpha = 1;

      for (let i = 0; i < nodes.length; i += 1) projected[i] = project(nodes[i].pos);

      // The horizon hint: a faint ellipse where the word plane lies, drawn FIRST so
      // stars sit on top of it, never under it.
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = STAR_IDEA;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const e1 = project({ x: PLANE_RADIUS, y: 0, z: 0 });
      for (let a = 0; a <= 64; a += 1) {
        const p = project({
          x: Math.cos((a / 64) * Math.PI * 2) * PLANE_RADIUS,
          y: 0,
          z: Math.sin((a / 64) * Math.PI * 2) * PLANE_RADIUS,
        });
        if (a === 0) ctx.moveTo(e1.x, e1.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Earned links: lines lying on the word/idea plane.
      ctx.lineWidth = 1;
      ctx.strokeStyle = LINK_EARNED;
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
      for (const i of order) {
        const node = nodes[i];
        const p = projected[i];
        if (p.depth < 70) continue;
        const isHover = i === hovered;
        if (node.kind === "lesson") {
          // Constellation strokes first, then member stars.
          const pts = node.stars.map(project);
          ctx.lineWidth = isHover ? 1.4 : 0.9;
          ctx.strokeStyle = LINE_CONSTELLATION;
          for (const [a, b] of node.edges) {
            ctx.beginPath();
            ctx.moveTo(pts[a].x, pts[a].y);
            ctx.lineTo(pts[b].x, pts[b].y);
            ctx.stroke();
          }
          const litCount = Math.round(node.lit * node.stars.length);
          const pulse = node.current && !reduced ? 1 + 0.18 * Math.sin(t * 2.1) : 1;
          pts.forEach((sp, s) => {
            const lit = s < litCount || node.lit >= 1;
            const r = (lit ? 2.6 : 2.0) * sp.scale * 2.4 * pulse;
            const sprite = glowSprite(lit ? STAR_LIT : STAR_UNLIT, 3);
            ctx.globalAlpha = lit ? 0.95 : 0.6;
            ctx.drawImage(sprite, sp.x - r, sp.y - r, r * 2, r * 2);
          });
          ctx.globalAlpha = 1;
          // Label near constellations that are close, current, or hovered.
          if (isHover || node.current || p.scale > 1.35) {
            ctx.font = `600 ${Math.min(12, 8 + p.scale * 2)}px ui-sans-serif, system-ui`;
            ctx.textAlign = "center";
            ctx.fillStyle = isHover || node.current ? "#fff" : LABEL_COLOR;
            ctx.globalAlpha = isHover || node.current ? 0.95 : 0.65;
            ctx.fillText(node.lesson.title, p.x, p.y + 26 * Math.min(1.4, p.scale));
            ctx.globalAlpha = 1;
          }
        } else {
          const color =
            node.kind === "idea"
              ? node.idea.origin === "emergent"
                ? STAR_EMERGENT
                : STAR_IDEA
              : node.collected
                ? STAR_WORD
                : STAR_WORD_FAINT;
          const tw =
            reduced || node.kind === "idea"
              ? 1
              : 0.82 + 0.18 * Math.sin(t * 1.3 + hash01(node.word.term) * 6.28);
          const r = node.size * p.scale * 2.2 * tw;
          const sprite = glowSprite(color, 3);
          ctx.globalAlpha = node.kind === "word" && !node.collected ? 0.5 : 0.9;
          ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
          // Mastery halo: a thin ring around ideas the student has evidence for.
          if (node.kind === "idea" && node.mastery > 0) {
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = STAR_LIT;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 2.5, -Math.PI / 2, -Math.PI / 2 + node.mastery * Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (isHover) {
          ctx.strokeStyle = "#ffffff";
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(7, node.size * p.scale * 2.6), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
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
        const slack = node.kind === "lesson" ? 10 : 0;
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
      if (!node.collected && !node.word.definition) {
        return { kind: "word", word: node.word, collected: false };
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
    // The scene rebinds when the sky's node list changes; camera/hover live in refs.
  }, [sky, links, backdrop, lessons]);

  // Drag-to-orbit + click routing share pointer handlers: a press that MOVES orbits,
  // a press that stays put is a click on whatever was picked at pointerdown.
  const dragState = useRef<{
    px: number;
    py: number;
    yaw: number;
    pitch: number;
    moved: number;
    downIndex: number;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    dragState.current = {
      px: event.clientX,
      py: event.clientY,
      yaw: cam.current.yaw,
      pitch: cam.current.pitch,
      moved: 0,
      downIndex: hoverRef.current?.nodeIndex ?? -1,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (drag.moved > 3) {
      cam.current.idle = false;
      cam.current.yaw = drag.yaw + dx * 0.006;
      cam.current.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, drag.pitch + dy * 0.005));
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
    cam.current.pitch = PITCH_DEFAULT;
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
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAR_WORD }} /> words
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAR_IDEA }} /> ideas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAR_LIT }} /> lessons
        </span>
      </div>

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
                style={{ color: hover.idea.origin === "emergent" ? STAR_EMERGENT : STAR_IDEA }}
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
