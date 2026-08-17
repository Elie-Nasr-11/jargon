import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";
import type { IdeaNode, Lesson, MyJargonWord, StudentLinkRow, VocabTerm } from "@/lib/types";

// THE BRAIN, v5 — an Obsidian-style knowledge graph, native to the app's design
// system (owner, 2026-08-16: "whatever style fits the ui of the platform properly.
// take full control").
//
// A flat force-directed network rendered with the APP'S OWN TOKENS — the palette is
// read from the CSS custom properties at mount and re-read when the theme flips, so
// the graph is a light graph in light mode and a dark graph in dark mode, never a
// hard-coded black window. Node colors speak the platform's existing progress
// language (the lesson tree's ProgressGlyph): accent = current, success = done,
// ink = in progress, faint ink = untouched. Canvas 2D, zero dependencies.
//
// The nodes are the student's real knowledge objects, the edges their real
// relations: word—lesson (the lesson that taught the word), idea—lesson, the
// student's earned idea—idea links, lesson—course hubs.
//
// LABELS (v5.1 — the density fix, after real-catalog testing produced label soup):
// a label is never nudged and never collides. Every candidate gets a PRIORITY
// (hovered > neighborhood > current > course > lesson-by-degree > idea > word) and
// a zoom gate; candidates claim screen rectangles in priority order and any label
// whose rectangle would overlap an already-claimed one simply does not draw at this
// zoom. Zooming in frees space and more names appear — Obsidian's exact feel.
//
// Interaction: hover lights the node's neighborhood while the rest dims; the info
// card is pinned top-right; drag space pans, scroll zooms toward the cursor,
// dragging a node tugs it (physics resumes on release), a still-click always opens
// something real; reset refits.

const REPULSION = 2600;
const SPRING = 0.045;
const REST_LEN: Record<string, number> = {
  "word-lesson": 64,
  "idea-lesson": 78,
  "idea-idea": 112,
  "lesson-course": 126,
};
const CENTER_PULL = 0.008;
const DAMPING = 0.86;
const SETTLE_TICKS = 260;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const PICK_RADIUS_PX = 14;
const DIM = 0.15;

// Emergent ideas wear the aurora in every rendering of the brain — one violet per
// theme, chosen for contrast against both backgrounds.
const STAR_EMERGENT = "#9b7bf5";
const STAR_EMERGENT_DARK = "#b49df8";

// Subject territories: the accent hue rotated per course, painted as a whisper-alpha
// wash behind each course's cluster. Hue does the grouping; alpha keeps it quiet.
function subjectHue(accent: string, rank: number): number {
  const hex = accent.startsWith("#") ? accent : "#4f6bfd";
  const n = parseInt(hex.slice(1, 7).padEnd(6, "0"), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h =
      max === r
        ? ((g - b) / d + (g < b ? 6 : 0)) / 6
        : max === g
          ? ((b - r) / d + 2) / 6
          : ((r - g) / d + 4) / 6;
  }
  return Math.round((h * 360 + rank * 67) % 360);
}

type Palette = {
  dark: boolean;
  bg: string;
  edge: string;
  edgeEarned: string;
  edgeLit: string;
  ink92: string;
  ink62: string;
  ink45: string;
  ink30: string;
  accent: string;
  success: string;
  emergent: string;
  fontSans: string;
  fontMono: string;
};

// The graph reads the live theme from the cascade — the same custom properties every
// other surface uses — so it can never drift from the platform's look.
function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const bg = v("--background", "#ffffff");
  // Perceived luminance of the background decides which emergent violet reads best.
  const hex = bg.startsWith("#") ? bg : "#ffffff";
  const n = parseInt(hex.slice(1, 7).padEnd(6, "f"), 16);
  const lum = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 255000;
  const dark = lum < 0.5;
  const accent = v("--accent-text", dark ? "#7d8ffd" : "#4f6bfd");
  return {
    dark,
    bg,
    edge: v("--ink-16", dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"),
    edgeEarned: accent,
    edgeLit: accent,
    ink92: v("--ink-92", dark ? "#e6e6e6" : "#2f2f33"),
    ink62: v("--ink-62", dark ? "#b3b3b3" : "#55555b"),
    ink45: v("--ink-45", dark ? "#8a8a8a" : "#7c7c83"),
    ink30: v("--ink-30", dark ? "#7c7c82" : "#a6a6ad"),
    accent,
    success: v("--success", "#2fbf71"),
    emergent: dark ? STAR_EMERGENT_DARK : STAR_EMERGENT,
    fontSans: v("--font-sans", "ui-sans-serif, system-ui, sans-serif"),
    fontMono: v("--font-mono", "ui-monospace, monospace"),
  };
}

type GraphNode = {
  id: string;
  kind: "word" | "idea" | "lesson" | "course";
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  degree: number;
  // Course rank for the subject tint; lessons inherit their course's.
  tint?: number;
  word?: MyJargonWord;
  idea?: IdeaNode;
  mastery?: number;
  lesson?: Lesson;
  progress?: number;
  current?: boolean;
};
type GraphEdge = { a: number; b: number; kind: keyof typeof REST_LEN; earned?: boolean };

export type GraphHover =
  | { kind: "word"; word: MyJargonWord }
  | { kind: "idea"; idea: IdeaNode; mastery: number; lessonTitle: string | null }
  | { kind: "lesson"; lesson: Lesson; progress: number; current: boolean }
  | { kind: "course"; title: string; lessonCount: number };

// Deterministic hash → [0,1). The initial scatter is seeded per node id, so the
// settled layout is stable across visits instead of reshuffling every mount.
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function buildGraph(input: {
  lessons: Lesson[];
  words: MyJargonWord[];
  vocabTerms: VocabTerm[];
  ideas: IdeaNode[];
  studentLinks: StudentLinkRow[];
  progress: Record<string, number>;
  currentLessonId: string | null;
  mastery?: Map<string, number>;
}): { nodes: GraphNode[]; edges: GraphEdge[]; ideaIndex: Map<string, number> } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const index = new Map<string, number>();
  const ideaIndex = new Map<string, number>();

  const place = (node: GraphNode) => {
    const a = hash01(`${node.id}:a`) * Math.PI * 2;
    const d = 40 + hash01(`${node.id}:d`) * 220;
    node.x = Math.cos(a) * d;
    node.y = Math.sin(a) * d;
    index.set(node.id, nodes.length);
    nodes.push(node);
  };

  const courseTitles = new Map<string, string>();
  for (const lesson of input.lessons) {
    const key = lesson.course_id || lesson.course_title || "course";
    if (!courseTitles.has(key)) courseTitles.set(key, lesson.course_title || "Course");
  }
  let courseRank = 0;
  for (const [key, title] of courseTitles) {
    place({
      id: `course:${key}`,
      kind: "course",
      label: title,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 15,
      degree: 0,
      tint: courseRank,
    });
    courseRank += 1;
  }

  for (const lesson of input.lessons) {
    const progress = Math.max(0, Math.min(1, input.progress[lesson.id] ?? 0));
    place({
      id: `lesson:${lesson.id}`,
      kind: "lesson",
      label: lesson.title,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 8,
      degree: 0,
      lesson,
      progress,
      current: lesson.id === input.currentLessonId,
    });
    const courseKey = lesson.course_id || lesson.course_title || "course";
    const hub = index.get(`course:${courseKey}`);
    if (hub != null) {
      edges.push({ a: hub, b: index.get(`lesson:${lesson.id}`)!, kind: "lesson-course" });
      nodes[index.get(`lesson:${lesson.id}`)!].tint = nodes[hub].tint;
    }
  }

  for (const idea of input.ideas.slice(0, 90)) {
    place({
      id: `idea:${idea.key}`,
      kind: "idea",
      label: idea.title,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: idea.origin === "emergent" ? 4.6 : 4.2,
      degree: 0,
      idea,
      mastery: input.mastery?.get(idea.key) ?? 0,
    });
    ideaIndex.set(idea.key, index.get(`idea:${idea.key}`)!);
    if (idea.lesson_id) {
      const home = index.get(`lesson:${idea.lesson_id}`);
      if (home != null)
        edges.push({ a: index.get(`idea:${idea.key}`)!, b: home, kind: "idea-lesson" });
    }
  }

  const termLesson = new Map<string, string>();
  for (const term of input.vocabTerms) {
    if (term.lesson_id) termLesson.set(term.term.toLowerCase(), term.lesson_id);
  }
  for (const word of input.words.slice(0, 140)) {
    place({
      id: `word:${word.term}`,
      kind: "word",
      label: word.term,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: word.traveled ? 3.2 : 2.7,
      degree: 0,
      word,
    });
    const home = termLesson.get(word.term.toLowerCase());
    const homeIndex = home != null ? index.get(`lesson:${home}`) : undefined;
    if (homeIndex != null)
      edges.push({ a: index.get(`word:${word.term}`)!, b: homeIndex, kind: "word-lesson" });
  }

  for (const link of input.studentLinks) {
    const a = ideaIndex.get(link.from_key);
    const b = ideaIndex.get(link.to_key);
    if (a != null && b != null) edges.push({ a, b, kind: "idea-idea", earned: true });
  }

  for (const e of edges) {
    nodes[e.a].degree += 1;
    nodes[e.b].degree += 1;
  }
  // Degree still grows a node, but the KIND ladder stays unmistakable: a busy word
  // may never outgrow a quiet lesson, nor a lesson its course.
  for (const n of nodes) {
    const cap = n.kind === "course" ? 5 : n.kind === "lesson" ? 2.5 : 1;
    n.r += Math.min(cap, Math.sqrt(n.degree) * (n.kind === "course" ? 1.1 : 0.7));
  }

  return { nodes, edges, ideaIndex };
}

export function BrainGraph({
  lessons,
  words,
  vocabTerms,
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
  vocabTerms: VocabTerm[];
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
  // R38: the card belongs to SELECTION (click), never hover — sweeping the pointer
  // across the graph must not flip through cards. Hover only changes the cursor and
  // draws a quiet ring on the node under the pointer.
  const [selected, setSelected] = useState<GraphHover | null>(null);
  const [hintSeen, setHintSeen] = useState(false);
  const hoverRef = useRef<number>(-1);
  const selectedRef = useRef<number>(-1);

  const graph = useMemo(
    () =>
      buildGraph({
        lessons,
        words,
        vocabTerms,
        ideas,
        studentLinks,
        progress,
        currentLessonId,
        mastery,
      }),
    [lessons, words, vocabTerms, ideas, studentLinks, progress, currentLessonId, mastery],
  );
  const adjacency = useMemo(() => {
    const adj: Set<number>[] = graph.nodes.map(() => new Set<number>());
    for (const e of graph.edges) {
      adj[e.a].add(e.b);
      adj[e.b].add(e.a);
    }
    return adj;
  }, [graph]);

  const cam = useRef({ x: 0, y: 0, zoom: 1 });
  const graphRef = useRef(graph);
  graphRef.current = graph;

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
    const { nodes, edges } = graphRef.current;
    const textWidths = new Map<string, number>();
    dirty.current = true;
    // A selection from a previous data shape must not survive a rebuild.
    selectedRef.current = -1;
    setSelected(null);

    let pal = readPalette(wrap);
    // Theme flips re-read the cascade — the graph follows the app instantly.
    const themeWatch = new MutationObserver(() => {
      pal = readPalette(wrap);
      dirty.current = true;
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) dirty.current = true;
    });
    io.observe(wrap);

    // Warm start: nodes seen before resume their remembered positions; a mostly
    // warm graph needs only a short settle instead of a fresh explosion.
    let warm = 0;
    for (const n of nodes) {
      const remembered = posMemory.current.get(n.id);
      if (remembered) {
        n.x = remembered.x;
        n.y = remembered.y;
        warm += 1;
      }
    }
    const settleTicks = warm > nodes.length * 0.5 ? 80 : SETTLE_TICKS;

    // One physics tick. Charge scales with node size so hubs shoulder their
    // clusters apart instead of piling into one blob.
    const tick = (alpha: number) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = hash01(`${a.id}:${b.id}`) - 0.5;
            dy = 0.5 - hash01(`${b.id}:${a.id}`);
            d2 = 1;
          }
          const charge = (a.r / 6.5) * (b.r / 6.5);
          const f = (REPULSION * charge * alpha) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const stretch = (d - REST_LEN[e.kind]) * SPRING * alpha;
        const fx = (dx / d) * stretch;
        const fy = (dy / d) * stretch;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        n.vx -= n.x * CENTER_PULL * alpha;
        n.vy -= n.y * CENTER_PULL * alpha;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
      }
    };
    for (let i = 0; i < settleTicks; i += 1) tick(1 - (i / settleTicks) * 0.6);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    cam.current.x = (minX + maxX) / 2;
    cam.current.y = (minY + maxY) / 2;
    cam.current.zoom = Math.max(
      ZOOM_MIN,
      Math.min(1.4, Math.min(width / (maxX - minX + 220), height / (maxY - minY + 240))),
    );
    const home = { ...cam.current };

    const toScreen = (n: { x: number; y: number }) => ({
      x: (n.x - cam.current.x) * cam.current.zoom + width / 2,
      y: (n.y - cam.current.y) * cam.current.zoom + height / 2,
    });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running || !visible || document.hidden) return;
      // R39: no dragging means no post-settle physics at all — the graph is a
      // still picture that only the camera moves.
      // Camera glide: ease toward the tween target (selection zoom-in, click-away
      // zoom-out). Reduced motion jumps instantly.
      const target = camTarget.current;
      if (target) {
        if (reduced) {
          cam.current.x = target.x;
          cam.current.y = target.y;
          cam.current.zoom = target.zoom;
          camTarget.current = null;
        } else {
          const k = 0.16;
          cam.current.x += (target.x - cam.current.x) * k;
          cam.current.y += (target.y - cam.current.y) * k;
          cam.current.zoom += (target.zoom - cam.current.zoom) * k;
          if (
            Math.abs(target.x - cam.current.x) < 0.4 &&
            Math.abs(target.y - cam.current.y) < 0.4 &&
            Math.abs(target.zoom - cam.current.zoom) < 0.004
          ) {
            cam.current.x = target.x;
            cam.current.y = target.y;
            cam.current.zoom = target.zoom;
            camTarget.current = null;
          }
        }
        dirty.current = true;
      }
      if (!dirty.current) return;
      dirty.current = false;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);

      const zoom = cam.current.zoom;
      const hovered = hoverRef.current;
      const picked = selectedRef.current;
      const neighbors = picked >= 0 ? adjacency[picked] : null;
      const focusOn = picked >= 0;

      // SUBJECT TERRITORIES first, under everything: one soft hue-rotated wash per
      // course, sized to reach its lessons. This is what makes subjects legible at a
      // glance without any 3D — each cluster owns a region.
      for (let i = 0; i < nodes.length; i += 1) {
        const hub = nodes[i];
        if (hub.kind !== "course") continue;
        const hp = toScreen(hub);
        let reach = 60;
        for (const other of adjacency[i]) {
          const n = nodes[other];
          reach = Math.max(reach, Math.hypot(n.x - hub.x, n.y - hub.y) + 42);
        }
        const rr = reach * zoom;
        if (hp.x < -rr || hp.x > width + rr || hp.y < -rr || hp.y > height + rr) continue;
        const hue = subjectHue(pal.accent, hub.tint ?? 0);
        const wash = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, rr);
        wash.addColorStop(
          0,
          `hsla(${hue}, 70%, ${pal.dark ? 62 : 48}%, ${pal.dark ? 0.085 : 0.06})`,
        );
        wash.addColorStop(
          0.75,
          `hsla(${hue}, 70%, ${pal.dark ? 62 : 48}%, ${pal.dark ? 0.04 : 0.028})`,
        );
        wash.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        ctx.globalAlpha = focusOn ? 0.4 : 1;
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Edges. Structural trunk (lesson—course) draws heavier than leaf twigs; on
      // hover, only the neighborhood keeps its light.
      for (const e of edges) {
        const a = toScreen(nodes[e.a]);
        const b = toScreen(nodes[e.b]);
        const inFocus = focusOn && (e.a === picked || e.b === picked);
        if (inFocus) {
          ctx.strokeStyle = pal.edgeLit;
          ctx.globalAlpha = 0.75;
          ctx.lineWidth = 1.4;
        } else {
          ctx.strokeStyle = e.earned ? pal.edgeEarned : pal.edge;
          const trunk = e.kind === "lesson-course";
          ctx.globalAlpha = focusOn ? DIM : e.earned ? 0.45 : trunk ? 1 : 0.62;
          ctx.lineWidth = trunk ? 1.6 : 1;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nodes, in the platform's progress language: accent = current, success =
      // done, ink = touched, faint ink = untouched. Course hubs are donuts.
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const p = toScreen(n);
        if (p.x < -40 || p.x > width + 40 || p.y < -40 || p.y > height + 40) continue;
        const inFocus = !focusOn || i === picked || (neighbors?.has(i) ?? false);
        const r = n.r * Math.sqrt(zoom) * (i === picked ? 1.22 : 1);
        ctx.globalAlpha = inFocus ? 1 : DIM;
        if (n.kind === "course") {
          // The apex tier: a heavy filled anchor in the strongest ink, ringed in its
          // subject hue — unmistakably not a lesson.
          const hue = subjectHue(pal.accent, n.tint ?? 0);
          ctx.fillStyle = pal.ink92;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `hsla(${hue}, 60%, ${pal.dark ? 68 : 50}%, 0.72)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const fill =
            n.kind === "lesson"
              ? n.current
                ? pal.accent
                : (n.progress ?? 0) >= 1
                  ? pal.success
                  : (n.progress ?? 0) > 0
                    ? pal.ink62
                    : pal.ink45
              : n.kind === "idea"
                ? n.idea?.origin === "emergent"
                  ? pal.emergent
                  : pal.accent
                : pal.ink30;
          ctx.fillStyle = fill;
          if (n.kind === "idea" && n.idea?.origin !== "emergent") ctx.globalAlpha *= 0.8;
          if (n.kind === "word") ctx.globalAlpha *= 0.75;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = inFocus ? 1 : DIM;
          // Lessons wear a background keyline — coins on the table, while words stay
          // dust. Reads as a middle tier even in a monochrome squint test.
          if (n.kind === "lesson") {
            ctx.strokeStyle = pal.bg;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (n.kind === "lesson" && n.current) {
            ctx.strokeStyle = pal.accent;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if (i === picked) {
          ctx.strokeStyle = pal.accent;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (i === hovered && !focusOn) {
          ctx.strokeStyle = pal.ink45;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // LABELS — priority + occupancy grid. Candidates claim screen rectangles in
      // priority order; a label that would overlap an already-claimed rectangle
      // does not draw at this zoom. No nudging, no soup.
      type Job = {
        text: string;
        x: number;
        y: number;
        size: number;
        weight: number;
        mono: boolean;
        color: string;
        priority: number;
        alpha: number;
      };
      const jobs: Job[] = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const p = toScreen(n);
        if (p.x < -80 || p.x > width + 80 || p.y < -40 || p.y > height + 40) continue;
        const isHover = i === picked;
        const isNeighbor = focusOn && (neighbors?.has(i) ?? false);
        // A dimmed graph shows only the selection's names.
        if (focusOn && !isHover && !isNeighbor) continue;
        // Zoom gates by kind — course hubs and the current lesson always qualify.
        const gate =
          n.kind === "course" || (n.kind === "lesson" && n.current)
            ? 1
            : n.kind === "lesson"
              ? Math.min(1, Math.max(0, (zoom - 0.7) * 2.4))
              : n.kind === "idea"
                ? Math.min(1, Math.max(0, (zoom - 1.05) * 2.2))
                : Math.min(1, Math.max(0, (zoom - 1.4) * 2.2));
        if (!isHover && !isNeighbor && gate <= 0.05) continue;
        const priority = isHover
          ? 6
          : isNeighbor
            ? 5
            : n.kind === "lesson" && n.current
              ? 4
              : n.kind === "course"
                ? 3
                : n.kind === "lesson"
                  ? 2 + Math.min(0.9, n.degree / 40)
                  : n.kind === "idea"
                    ? 1
                    : 0.5;
        jobs.push({
          text: n.label,
          x: p.x,
          y: p.y + n.r * Math.sqrt(zoom) + 12.5,
          size: n.kind === "course" ? 12.5 : n.kind === "lesson" ? 11.5 : 10.5,
          weight: n.kind === "lesson" && (n.current || isHover) ? 600 : 500,
          mono: n.kind === "course",
          color:
            n.kind === "course"
              ? pal.ink92
              : n.kind === "lesson"
                ? n.current
                  ? pal.accent
                  : pal.ink62
                : pal.ink45,
          priority,
          alpha: isHover || isNeighbor ? 1 : Math.min(0.95, gate),
        });
      }
      jobs.sort((a, b) => b.priority - a.priority);
      const claimed: { x1: number; y1: number; x2: number; y2: number }[] = [];
      for (const job of jobs) {
        const text = job.mono ? job.text.toUpperCase() : job.text;
        ctx.font = `${job.weight} ${job.size}px ${job.mono ? pal.fontMono : pal.fontSans}`;
        const measureKey = `${text}|${ctx.font}`;
        let w = textWidths.get(measureKey);
        if (w == null) {
          w = ctx.measureText(text).width;
          textWidths.set(measureKey, w);
        }
        const rect = {
          x1: job.x - w / 2 - 4,
          y1: job.y - job.size - 2,
          x2: job.x + w / 2 + 4,
          y2: job.y + 4,
        };
        if (
          claimed.some((c) => rect.x1 < c.x2 && rect.x2 > c.x1 && rect.y1 < c.y2 && rect.y2 > c.y1)
        )
          continue;
        claimed.push(rect);
        ctx.textAlign = "center";
        ctx.globalAlpha = job.alpha;
        ctx.fillStyle = job.color;
        ctx.fillText(text, job.x, job.y);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(frame);

    const pick = (clientX: number, clientY: number): number => {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      let best = -1;
      let bestDist = PICK_RADIUS_PX;
      for (let i = 0; i < nodes.length; i += 1) {
        const p = toScreen(nodes[i]);
        const d = Math.hypot(p.x - mx, p.y - my) - nodes[i].r * Math.sqrt(cam.current.zoom);
        if (d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
      return best;
    };
    pickRef.current = pick;
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - width / 2) / cam.current.zoom + cam.current.x,
        y: (clientY - rect.top - height / 2) / cam.current.zoom + cam.current.y,
      };
    };
    worldRef.current = toWorld;

    const toHover = (index: number): GraphHover | null => {
      const n = nodes[index];
      if (!n) return null;
      if (n.kind === "lesson" && n.lesson)
        return {
          kind: "lesson",
          lesson: n.lesson,
          progress: n.progress ?? 0,
          current: n.current ?? false,
        };
      if (n.kind === "idea" && n.idea) {
        const lessonTitle = n.idea.lesson_id
          ? (lessons.find((l) => l.id === n.idea!.lesson_id)?.title ?? null)
          : null;
        return { kind: "idea", idea: n.idea, mastery: n.mastery ?? 0, lessonTitle };
      }
      if (n.kind === "word" && n.word) return { kind: "word", word: n.word };
      if (n.kind === "course")
        return { kind: "course", title: n.label, lessonCount: adjacency[index].size };
      return null;
    };

    const onMove = (event: PointerEvent) => {
      if (panState.current) return;
      const index = pick(event.clientX, event.clientY);
      if (index !== hoverRef.current) {
        hoverRef.current = index;
        canvas.style.cursor = index >= 0 ? "pointer" : "grab";
        dirty.current = true;
      }
    };
    canvas.addEventListener("pointermove", onMove);
    selectApi.current = {
      select: (index: number) => {
        selectedRef.current = index;
        selectedAt.current = performance.now();
        const node = nodes[index];
        if (node) {
          setSelected(toHover(index));
          camTarget.current = {
            x: node.x,
            y: node.y,
            zoom: Math.min(2.2, Math.max(cam.current.zoom, home.zoom * 1.55)),
          };
        }
        dirty.current = true;
      },
      clear: (zoomHome: boolean) => {
        selectedRef.current = -1;
        setSelected(null);
        if (zoomHome) camTarget.current = { ...home };
        dirty.current = true;
      },
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setHintSeen(true);
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const before = {
        x: (mx - width / 2) / cam.current.zoom + cam.current.x,
        y: (my - height / 2) / cam.current.zoom + cam.current.y,
      };
      cam.current.zoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, cam.current.zoom * (event.deltaY > 0 ? 0.9 : 1.11)),
      );
      cam.current.x = before.x - (mx - width / 2) / cam.current.zoom;
      cam.current.y = before.y - (my - height / 2) / cam.current.zoom;
      dirty.current = true;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    resetRef.current = () => {
      selectedRef.current = -1;
      setSelected(null);
      camTarget.current = { ...home };
      dirty.current = true;
    };

    return () => {
      running = false;
      for (const n of nodes) posMemory.current.set(n.id, { x: n.x, y: n.y });
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("wheel", onWheel);
    };
    // Physics state and camera live in refs; the scene rebinds when the graph changes.
  }, [graph, adjacency, lessons]);

  const panState = useRef<{
    px: number;
    py: number;
    cx: number;
    cy: number;
    moved: number;
    downIndex: number;
  } | null>(null);
  const pickRef = useRef<(x: number, y: number) => number>(() => -1);
  const worldRef = useRef<(x: number, y: number) => { x: number; y: number }>(() => ({
    x: 0,
    y: 0,
  }));
  const resetRef = useRef<() => void>(() => {});
  const selectApi = useRef<{
    select: (index: number) => void;
    clear: (zoomHome: boolean) => void;
  } | null>(null);
  // Render-on-demand flags: the rAF loop paints only when dirty. camTarget drives
  // the selection zoom glide; posMemory keeps layouts stable across data arrivals
  // and revisits.
  const dirty = useRef(true);
  const camTarget = useRef<{ x: number; y: number; zoom: number } | null>(null);
  // Card arming: ignore action presses for the first beat after the card appears —
  // a double-click's second press must never land on a button that just showed up.
  const selectedAt = useRef(0);
  const armed = () => performance.now() - selectedAt.current > 400;
  const posMemory = useRef(new Map<string, { x: number; y: number }>());

  // R39: node dragging is gone (owner call) — a press-drag anywhere pans the view,
  // which also means physics never needs to run after the initial settle. A still
  // release picks: on the node it started over, SELECT; on empty space, CLEAR.
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    panState.current = {
      px: event.clientX,
      py: event.clientY,
      cx: cam.current.x,
      cy: cam.current.y,
      moved: 0,
      downIndex: pickRef.current(event.clientX, event.clientY),
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panState.current;
    if (!pan) return;
    const dx = event.clientX - pan.px;
    const dy = event.clientY - pan.py;
    pan.moved = Math.max(pan.moved, Math.abs(dx) + Math.abs(dy));
    if (pan.moved > 3) setHintSeen(true);
    cam.current.x = pan.cx - dx / cam.current.zoom;
    cam.current.y = pan.cy - dy / cam.current.zoom;
    dirty.current = true;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panState.current;
    panState.current = null;
    if (!pan || pan.moved > 4) return;
    // Still click. On a node (same one the press started over): SELECT — the camera
    // glides in and the card with its explicit button appears top-right. On empty
    // space: clear the selection and glide home. Navigation lives ONLY on the card.
    const upIndex = pickRef.current(event.clientX, event.clientY);
    if (pan.downIndex >= 0 && upIndex === pan.downIndex) {
      selectApi.current?.select(pan.downIndex);
    } else if (pan.downIndex < 0 && upIndex < 0) {
      selectApi.current?.clear(true);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-[420px] w-full overflow-hidden rounded-card border border-border bg-background"
      data-testid="brain-graph"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        role="img"
        aria-label="Your knowledge graph: lessons, ideas, and collected words as connected nodes. Hover a node to see its connections; click to open."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          panState.current = null;
        }}
      />

      {/* Legend, bottom-left — the platform's progress language, in its own tokens. */}
      <div className="pointer-events-none absolute bottom-2.5 left-3 flex items-center gap-3 font-mono text-overline uppercase tracking-[0.14em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ink-30)" }} />{" "}
          words
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent-text)" }} />{" "}
          ideas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--success)" }} />{" "}
          done
        </span>
      </div>

      {!hintSeen ? (
        <div className="pointer-events-none absolute bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-pill border border-border bg-depth-card/85 px-3 py-1 font-mono text-overline uppercase tracking-[0.14em] text-muted-foreground backdrop-blur-sm">
          drag · scroll · click a node
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => resetRef.current()}
        className="absolute bottom-2 right-2.5 flex items-center gap-1.5 rounded-pill border border-border bg-depth-card/85 px-2.5 py-1 font-mono text-overline uppercase tracking-[0.12em] text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        aria-label="Reset the graph view"
      >
        <RotateCcw className="h-3 w-3" strokeWidth={1.8} /> reset
      </button>

      {/* R38: the SELECTION card — interactive, pinned top-right. Its button is the
          ONLY way to open anything from the graph; clicking a node just selects. */}
      {selected ? (
        <div
          className="absolute right-2.5 top-2.5 w-[248px] rounded-card border border-border bg-depth-card/95 p-3 shadow-card backdrop-blur-sm"
          role="dialog"
          aria-label="Selected node"
        >
          <button
            type="button"
            onClick={() => selectApi.current?.clear(true)}
            className="absolute right-2 top-2 rounded-control px-1.5 py-0.5 text-meta text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close and zoom out"
          >
            ✕
          </button>
          {selected.kind === "lesson" ? (
            <>
              <div
                className="mb-0.5 pr-6 font-mono text-overline uppercase tracking-[0.14em]"
                style={{ color: "var(--accent-text)" }}
              >
                {selected.current ? "Current lesson" : "Lesson"}
              </div>
              <div className="pr-4 text-body font-semibold text-foreground">
                {selected.lesson.title}
              </div>
              {selected.lesson.unit_title || selected.lesson.course_title ? (
                <div className="mt-0.5 text-meta text-muted-foreground">
                  {[selected.lesson.unit_title, selected.lesson.course_title]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              ) : null}
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(selected.progress * 100)}%`,
                    background: selected.progress >= 1 ? "var(--success)" : "var(--accent-text)",
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => armed() && onOpenLesson(selected.lesson.id)}
                className="mt-2.5 w-full rounded-control px-3 py-1.5 text-meta font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--accent-text)" }}
              >
                {selected.progress >= 1 ? "Revisit lesson" : "Open lesson"}
              </button>
            </>
          ) : selected.kind === "idea" ? (
            <>
              <div
                className="mb-0.5 pr-6 font-mono text-overline uppercase tracking-[0.14em]"
                style={{
                  color: selected.idea.origin === "emergent" ? STAR_EMERGENT : "var(--accent-text)",
                }}
              >
                {selected.idea.origin === "emergent" ? "Your idea" : "Idea"}
              </div>
              <div className="pr-4 text-body font-semibold text-foreground">
                {selected.idea.title}
              </div>
              {selected.idea.one_liner ? (
                <div className="mt-0.5 text-meta leading-snug text-muted-foreground">
                  {selected.idea.one_liner}
                </div>
              ) : null}
              <div className="mt-1.5 text-meta text-muted-foreground">
                {selected.mastery > 0
                  ? `Mastery ${Math.round(selected.mastery * 100)}%`
                  : "Not practiced yet"}
              </div>
              {selected.idea.lesson_id ? (
                <button
                  type="button"
                  onClick={() => armed() && onOpenLesson(selected.idea.lesson_id!)}
                  className="mt-2.5 w-full rounded-control px-3 py-1.5 text-meta font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent-text)" }}
                >
                  Open “{selected.lessonTitle ?? "its lesson"}”
                </button>
              ) : null}
            </>
          ) : selected.kind === "word" ? (
            <>
              <div className="mb-0.5 pr-6 font-mono text-overline uppercase tracking-[0.14em] text-muted-foreground">
                Collected word
              </div>
              <div className="pr-4 text-body font-semibold text-foreground">
                {selected.word.term}
              </div>
              {selected.word.definition ? (
                <div className="mt-0.5 text-meta leading-snug text-muted-foreground">
                  {selected.word.definition}
                </div>
              ) : null}
              <div className="mt-1.5 text-meta text-muted-foreground">
                {selected.word.subject || "—"}
                {selected.word.traveled ? " · seen in 2+ subjects" : ""}
              </div>
              <button
                type="button"
                onClick={() => armed() && onOpenWord(selected.word.term)}
                className="mt-2.5 w-full rounded-control border border-border px-3 py-1.5 text-meta font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Find in My Jargon
              </button>
            </>
          ) : (
            <>
              <div className="mb-0.5 pr-6 font-mono text-overline uppercase tracking-[0.14em] text-muted-foreground">
                Course
              </div>
              <div className="pr-4 text-body font-semibold text-foreground">{selected.title}</div>
              <div className="mt-0.5 text-meta text-muted-foreground">
                {selected.lessonCount} connection{selected.lessonCount === 1 ? "" : "s"}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
