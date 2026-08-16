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

// THE BRAIN, v5 — an Obsidian-style knowledge graph (owner pick, 2026-08-16, after
// the night-sky metaphor was rejected: "use the obsidian-style one").
//
// A flat force-directed network on near-black, exactly the graph-view language:
// nodes float and settle under spring/charge physics, edges are hairlines, labels
// sit under their nodes and fade with zoom, and HOVER lights a node's neighborhood
// while the rest of the graph dims away. Canvas 2D, zero dependencies.
//
// The nodes are the student's real knowledge objects, the edges their real
// relations:
//   word — lesson       the lesson that taught the word (vocab_terms.lesson_id)
//   idea — lesson       the lesson the idea belongs to
//   idea — idea         links the STUDENT earned (bright); curriculum's possible
//                       links are omitted — this graph shows what is真, not syllabus
//   lesson — course     course hubs give each subject its own cluster, so two
//                       subjects read as two galaxies bridged by traveled words
//
// Interaction contract (unchanged from v4): hovering raises an info card pinned
// top-right; clicking always opens something real — a lesson node opens the lesson,
// an idea with a home lesson opens that lesson, a word opens My Jargon scrolled to
// the term. New, from Obsidian: drag empty space to pan, scroll to zoom toward the
// cursor, drag a NODE to tug it around (physics resumes on release), reset restores
// the fitted view.

const REPULSION = 2600;
const SPRING = 0.045;
const REST_LEN: Record<string, number> = {
  "word-lesson": 64,
  "idea-lesson": 78,
  "idea-idea": 112,
  "lesson-course": 122,
};
const CENTER_PULL = 0.008;
const DAMPING = 0.86;
const SETTLE_TICKS = 240;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 3;
const PICK_RADIUS_PX = 14;

// Palette: Obsidian's graph on our indigo-black, one hue per node kind. Emergent
// ideas keep their aurora violet in every rendering of the brain.
const BG_TOP = "#090b13";
const BG_BOTTOM = "#0b0e1a";
const EDGE = "rgba(150, 163, 200, 0.14)";
const EDGE_LIT = "rgba(159, 212, 255, 0.55)";
const EDGE_EARNED = "rgba(159, 212, 255, 0.26)";
const NODE_WORD = "#9aa3c4";
const NODE_WORD_TRAVELED = "#c6cdea";
const NODE_IDEA = "#9fd4ff";
const STAR_EMERGENT = "#c9a2ff";
const NODE_LESSON = "#e8ecff";
const NODE_LESSON_DONE = "#ffd88a";
const NODE_COURSE = "#69719b";
const NODE_CURRENT = "#ffd88a";
const LABEL = "rgba(214, 222, 248, 0.92)";
const DIM = 0.13;

type GraphNode = {
  id: string;
  kind: "word" | "idea" | "lesson" | "course";
  label: string;
  // Physics state (world units).
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  // Payloads by kind (exactly one set).
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
    // Seeded scatter in a disc; physics does the real layout from here.
    const a = hash01(`${node.id}:a`) * Math.PI * 2;
    const d = 40 + hash01(`${node.id}:d`) * 190;
    node.x = Math.cos(a) * d;
    node.y = Math.sin(a) * d;
    index.set(node.id, nodes.length);
    nodes.push(node);
  };

  // Course hubs first (one per distinct course among the lessons).
  const courseTitles = new Map<string, string>();
  for (const lesson of input.lessons) {
    const key = lesson.course_id || lesson.course_title || "course";
    if (!courseTitles.has(key)) courseTitles.set(key, lesson.course_title || "Course");
  }
  const courseCount = new Map<string, number>();
  for (const [key, title] of courseTitles) {
    place({ id: `course:${key}`, kind: "course", label: title, x: 0, y: 0, vx: 0, vy: 0, r: 10 });
    courseCount.set(key, 0);
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
      r: 7,
      lesson,
      progress,
      current: lesson.id === input.currentLessonId,
    });
    const courseKey = lesson.course_id || lesson.course_title || "course";
    const hub = index.get(`course:${courseKey}`);
    if (hub != null) {
      edges.push({ a: hub, b: index.get(`lesson:${lesson.id}`)!, kind: "lesson-course" });
      courseCount.set(courseKey, (courseCount.get(courseKey) ?? 0) + 1);
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
      r: idea.origin === "emergent" ? 5.5 : 5,
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

  // Words connect to the lesson that taught them (via the published term's lesson_id).
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
      r: word.traveled ? 4 : 3.2,
      word,
    });
    const home = termLesson.get(word.term.toLowerCase());
    const homeIndex = home != null ? index.get(`lesson:${home}`) : undefined;
    if (homeIndex != null)
      edges.push({ a: index.get(`word:${word.term}`)!, b: homeIndex, kind: "word-lesson" });
  }

  // The student's earned idea links — the bridges between clusters.
  for (const link of input.studentLinks) {
    const a = ideaIndex.get(link.from_key);
    const b = ideaIndex.get(link.to_key);
    if (a != null && b != null) edges.push({ a, b, kind: "idea-idea", earned: true });
  }

  // Node size grows gently with degree, Obsidian-style.
  const degree = new Array(nodes.length).fill(0);
  for (const e of edges) {
    degree[e.a] += 1;
    degree[e.b] += 1;
  }
  nodes.forEach((n, i) => {
    n.r += Math.min(5, Math.sqrt(degree[i]) * 1.15);
  });

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
  const [hover, setHover] = useState<GraphHover | null>(null);
  const [hintSeen, setHintSeen] = useState(false);
  const hoverRef = useRef<number>(-1);

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
  // Adjacency for the hover neighborhood (node -> neighbor node indices).
  const adjacency = useMemo(() => {
    const adj: Set<number>[] = graph.nodes.map(() => new Set<number>());
    for (const e of graph.edges) {
      adj[e.a].add(e.b);
      adj[e.b].add(e.a);
    }
    return adj;
  }, [graph]);

  // Camera (world -> screen): screen = (world - cam) * zoom + viewport center.
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

    // One physics tick: charge repulsion + edge springs + weak centering.
    const tick = (alpha: number) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            // Coincident nodes: nudge apart deterministically.
            dx = hash01(`${a.id}:${b.id}`) - 0.5;
            dy = 0.5 - hash01(`${b.id}:${a.id}`);
            d2 = 1;
          }
          const f = (REPULSION * alpha) / d2;
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
      for (const n of nodes) {
        n.vx -= n.x * CENTER_PULL * alpha;
        n.vy -= n.y * CENTER_PULL * alpha;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        if (dragNode.current?.index !== nodes.indexOf(n)) {
          n.x += n.vx;
          n.y += n.vy;
        }
      }
    };

    // Settle the layout up front so the graph never opens mid-explosion; reduced
    // motion gets the fully settled state with no visible simulation at all.
    for (let i = 0; i < SETTLE_TICKS; i += 1) tick(1 - (i / SETTLE_TICKS) * 0.6);

    // Fit the settled graph into view once.
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
      Math.min(1.5, Math.min(width / (maxX - minX + 200), height / (maxY - minY + 260))),
    );
    const home = { ...cam.current };

    const toScreen = (n: { x: number; y: number }) => ({
      x: (n.x - cam.current.x) * cam.current.zoom + width / 2,
      y: (n.y - cam.current.y) * cam.current.zoom + height / 2,
    });

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!running || !visible || document.hidden) return;
      // The live graph keeps a gentle simmer (alpha small) so tugging a node feels
      // alive; reduced motion freezes physics after the pre-settle.
      if (!reduced) tick(0.06);

      ctx.clearRect(0, 0, width, height);
      const wash = ctx.createLinearGradient(0, 0, 0, height);
      wash.addColorStop(0, BG_TOP);
      wash.addColorStop(1, BG_BOTTOM);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      const zoom = cam.current.zoom;
      const hovered = hoverRef.current;
      const neighbors = hovered >= 0 ? adjacency[hovered] : null;
      const focusOn = hovered >= 0;

      // Edges first. On hover, only the neighborhood keeps its light.
      for (const e of edges) {
        const a = toScreen(nodes[e.a]);
        const b = toScreen(nodes[e.b]);
        const inFocus = focusOn && (e.a === hovered || e.b === hovered);
        ctx.strokeStyle = inFocus ? EDGE_LIT : e.earned ? EDGE_EARNED : EDGE;
        ctx.globalAlpha = focusOn && !inFocus ? DIM : 1;
        ctx.lineWidth = inFocus ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nodes.
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const p = toScreen(n);
        if (p.x < -40 || p.x > width + 40 || p.y < -40 || p.y > height + 40) continue;
        const inFocus = !focusOn || i === hovered || (neighbors?.has(i) ?? false);
        const r = n.r * Math.sqrt(zoom) * (i === hovered ? 1.25 : 1);
        const fill =
          n.kind === "course"
            ? NODE_COURSE
            : n.kind === "lesson"
              ? n.current
                ? NODE_CURRENT
                : (n.progress ?? 0) >= 1
                  ? NODE_LESSON_DONE
                  : NODE_LESSON
              : n.kind === "idea"
                ? n.idea?.origin === "emergent"
                  ? STAR_EMERGENT
                  : NODE_IDEA
                : n.word?.traveled
                  ? NODE_WORD_TRAVELED
                  : NODE_WORD;
        ctx.globalAlpha = inFocus ? 1 : DIM;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        // The current lesson wears a quiet ring, always.
        if (n.kind === "lesson" && n.current) {
          ctx.strokeStyle = NODE_CURRENT;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Labels: under the node, alpha by zoom + kind (lessons/courses first to
      // arrive, words need a closer zoom) — the Obsidian fade. The always-on labels
      // (lessons/courses) get a greedy vertical nudge so titles never overlap.
      const anchorY = new Map<number, number>();
      const placed: { x: number; y: number; halfW: number; size: number }[] = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        if (n.kind !== "lesson" && n.kind !== "course") continue;
        const p = toScreen(n);
        let y = p.y + n.r * Math.sqrt(zoom) + 13;
        ctx.font = `500 11.5px ui-sans-serif, system-ui, sans-serif`;
        const halfW = ctx.measureText(n.label).width / 2 + 6;
        for (const other of placed) {
          const overlapX = Math.abs(p.x - other.x) < halfW + other.halfW;
          if (overlapX && Math.abs(y - other.y) < other.size + 6) y = other.y + other.size + 7;
        }
        placed.push({ x: p.x, y, halfW, size: 12 });
        anchorY.set(i, y);
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const p = toScreen(n);
        if (p.x < -60 || p.x > width + 60 || p.y < -40 || p.y > height + 40) continue;
        const base =
          n.kind === "course" || n.kind === "lesson"
            ? Math.min(1, zoom * 1.2)
            : n.kind === "idea"
              ? Math.max(0, zoom - 0.95) * 1.7
              : Math.max(0, zoom - 1.25) * 1.7;
        const isHover = i === hoverRef.current;
        const inFocus = !focusOn || isHover || (neighbors?.has(i) ?? false);
        const neighborBoost = focusOn && inFocus ? Math.max(base, 0.85) : base;
        const alpha = isHover ? 1 : Math.min(inFocus ? 0.92 : DIM, neighborBoost);
        if (alpha <= 0.02) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = LABEL;
        ctx.font = `${n.kind === "course" ? 600 : 500} ${
          n.kind === "course" ? 12 : n.kind === "lesson" ? 11.5 : 10.5
        }px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(5, 7, 14, 0.95)";
        ctx.shadowBlur = 3;
        ctx.fillText(n.label, p.x, anchorY.get(i) ?? p.y + n.r * Math.sqrt(zoom) + 13);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
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
    hoverFor.current = toHover;

    const onMove = (event: PointerEvent) => {
      if (dragNode.current || panState.current) return;
      const index = pick(event.clientX, event.clientY);
      if (index !== hoverRef.current) {
        hoverRef.current = index;
        setHover(index >= 0 ? toHover(index) : null);
        canvas.style.cursor = index >= 0 ? "pointer" : "grab";
      }
    };
    canvas.addEventListener("pointermove", onMove);

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
      // Keep the point under the cursor fixed — zoom toward the pointer.
      cam.current.x = before.x - (mx - width / 2) / cam.current.zoom;
      cam.current.y = before.y - (my - height / 2) / cam.current.zoom;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    resetRef.current = () => {
      cam.current.x = home.x;
      cam.current.y = home.y;
      cam.current.zoom = home.zoom;
    };

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("wheel", onWheel);
    };
    // Physics state and camera live in refs; the scene rebinds when the graph changes.
  }, [graph, adjacency, lessons]);

  // Pointer gestures: drag a node to tug it, drag space to pan, still-click to open.
  const dragNode = useRef<{ index: number; moved: number } | null>(null);
  const panState = useRef<{ px: number; py: number; cx: number; cy: number; moved: number } | null>(
    null,
  );
  const pickRef = useRef<(x: number, y: number) => number>(() => -1);
  const worldRef = useRef<(x: number, y: number) => { x: number; y: number }>(() => ({
    x: 0,
    y: 0,
  }));
  const hoverFor = useRef<(index: number) => GraphHover | null>(() => null);
  const resetRef = useRef<() => void>(() => {});

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    const index = pickRef.current(event.clientX, event.clientY);
    if (index >= 0) {
      dragNode.current = { index, moved: 0 };
    } else {
      panState.current = {
        px: event.clientX,
        py: event.clientY,
        cx: cam.current.x,
        cy: cam.current.y,
        moved: 0,
      };
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragNode.current;
    const pan = panState.current;
    if (drag) {
      const w = worldRef.current(event.clientX, event.clientY);
      const node = graphRef.current.nodes[drag.index];
      drag.moved = Math.max(drag.moved, Math.hypot(node.x - w.x, node.y - w.y) * cam.current.zoom);
      node.x = w.x;
      node.y = w.y;
      node.vx = 0;
      node.vy = 0;
      if (drag.moved > 3) setHintSeen(true);
    } else if (pan) {
      const dx = event.clientX - pan.px;
      const dy = event.clientY - pan.py;
      pan.moved = Math.max(pan.moved, Math.abs(dx) + Math.abs(dy));
      if (pan.moved > 3) setHintSeen(true);
      cam.current.x = pan.cx - dx / cam.current.zoom;
      cam.current.y = pan.cy - dy / cam.current.zoom;
    }
  };
  const onPointerUp = () => {
    const drag = dragNode.current;
    dragNode.current = null;
    panState.current = null;
    if (!drag || drag.moved > 5) return;
    const node = graphRef.current.nodes[drag.index];
    if (!node) return;
    if (node.kind === "lesson" && node.lesson) onOpenLesson(node.lesson.id);
    else if (node.kind === "idea" && node.idea?.lesson_id) onOpenLesson(node.idea.lesson_id);
    else if (node.kind === "word" && node.word) onOpenWord(node.word.term);
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-[420px] w-full overflow-hidden rounded-card"
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
          dragNode.current = null;
          panState.current = null;
        }}
      />

      {/* Legend, bottom-left — the node hues. */}
      <div className="pointer-events-none absolute bottom-2.5 left-3 flex items-center gap-3 font-mono text-overline uppercase tracking-[0.14em] text-white/45">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_WORD_TRAVELED }} />{" "}
          words
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_IDEA }} /> ideas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_LESSON_DONE }} />{" "}
          lessons
        </span>
      </div>

      {!hintSeen ? (
        <div className="pointer-events-none absolute bottom-9 left-1/2 -translate-x-1/2 rounded-pill border border-white/12 bg-black/30 px-3 py-1 font-mono text-overline uppercase tracking-[0.14em] text-white/60 backdrop-blur-sm">
          drag to pan · scroll to zoom · grab a node
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => resetRef.current()}
        className="absolute bottom-2 right-2.5 flex items-center gap-1.5 rounded-pill border border-white/15 bg-white/10 px-2.5 py-1 font-mono text-overline uppercase tracking-[0.12em] text-white/70 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
        aria-label="Reset the graph view"
      >
        <RotateCcw className="h-3 w-3" strokeWidth={1.8} /> reset
      </button>

      {/* The info card: pinned top-right, content swaps per hovered node. */}
      {hover ? (
        <div
          className="pointer-events-none absolute right-2.5 top-2.5 w-[240px] rounded-card border border-white/15 bg-[#0b1026]/92 p-3 shadow-card backdrop-blur-sm"
          role="status"
        >
          {hover.kind === "lesson" ? (
            <>
              <div className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em] text-[#ffd88a]">
                {hover.current ? "Current lesson" : "Lesson"}
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
                  ? "Complete."
                  : `${Math.round(hover.progress * 100)}% done · click to open`}
              </div>
            </>
          ) : hover.kind === "idea" ? (
            <>
              <div
                className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em]"
                style={{ color: hover.idea.origin === "emergent" ? STAR_EMERGENT : NODE_IDEA }}
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
          ) : hover.kind === "word" ? (
            <>
              <div className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em] text-white/60">
                Collected word
              </div>
              <div className="text-body font-semibold text-white">{hover.word.term}</div>
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
            <>
              <div className="mb-0.5 font-mono text-overline uppercase tracking-[0.14em] text-white/60">
                Course
              </div>
              <div className="text-body font-semibold text-white">{hover.title}</div>
              <div className="mt-0.5 text-meta text-white/60">
                {hover.lessonCount} connection{hover.lessonCount === 1 ? "" : "s"}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
