import { useMemo } from "react";
import { groupByUnit } from "@/features/student/lessonGroups";
import type { Lesson } from "@/lib/types";

// THE BRAIN MAP: a mini constellation of the student's learning, mounted on the memory
// card. Deliberately NOT an Obsidian-style force graph — the memory itself is a handful
// of phrases with no cross-links, so the skeleton is the thing that genuinely IS a graph:
// units and lessons. Center = the student; ring 1 = units; ring 2 = lesson dots colored
// by the same progress language as everywhere else (blue current / green done / ink
// started / hollow untouched). Lessons that appear in the mentor's session summaries
// glow warm (discuss-yellow halo) — memory made visible on the map. The aurora stays
// rationed to the ONE live thing: the current lesson.
//
// Layout is a deterministic radial computation (no force simulation, no dependency, no
// per-mount jitter — calm and identical on every visit). Native <title> tooltips; a dot
// tap opens the lesson.

const VIEW_W = 480;
const VIEW_H = 264;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const UNIT_RADIUS = 58;
const LESSON_RADIUS = 102;
// Alternate lesson dots between two radii so dense units don't collide.
const LESSON_STAGGER = 13;

type MapNode = {
  lesson: Lesson;
  x: number;
  y: number;
};

type MapUnit = {
  unitId: string;
  unitTitle: string;
  x: number;
  y: number;
  lessons: MapNode[];
};

function polar(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export function BrainMap({
  lessons,
  progress,
  currentLessonId,
  memoryLessonIds,
  onOpenLesson,
}: {
  lessons: Lesson[];
  progress: Record<string, number>;
  currentLessonId: string | null;
  memoryLessonIds: Set<string>;
  onOpenLesson: (lessonId: string) => void;
}) {
  const units = useMemo<MapUnit[]>(() => {
    const groups = groupByUnit(lessons);
    if (!groups.length) return [];
    // Each unit owns an angular slice proportional to its lesson count (+2 keeps tiny
    // units from collapsing to slivers). Start at 12 o'clock.
    const weights = groups.map((group) => group.lessons.length + 2);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let cursor = -Math.PI / 2;
    return groups.map((group, index) => {
      const span = (weights[index] / total) * Math.PI * 2;
      const mid = cursor + span / 2;
      const unitPos = polar(CX, CY, UNIT_RADIUS, mid);
      // Lessons fan across the middle 78% of the slice; the vertical squash (0.82 on y)
      // fits the card's wide-short viewport without a second layout pass.
      const usable = span * 0.78;
      const start = mid - usable / 2;
      const nodes = group.lessons.map((lesson, li) => {
        const angle =
          group.lessons.length === 1 ? mid : start + (usable * li) / (group.lessons.length - 1);
        const radius = LESSON_RADIUS + (li % 2 === 0 ? 0 : LESSON_STAGGER);
        const raw = polar(CX, CY, radius, angle);
        return { lesson, x: raw.x, y: CY + (raw.y - CY) * 0.82 };
      });
      cursor += span;
      return {
        unitId: group.unitId,
        unitTitle: group.unitTitle,
        x: unitPos.x,
        y: CY + (unitPos.y - CY) * 0.82,
        lessons: nodes,
      };
    });
  }, [lessons]);

  if (!units.length) return null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="A map of your lessons — colored dots show your progress; glowing dots are in your mentor's memory"
      className="block w-full"
    >
      <defs>
        {/* The one aurora on this surface: the current lesson's halo. */}
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

      {/* Edges first (under everything): center→unit, unit→lesson hairlines. */}
      {units.map((unit) => (
        <g key={`edges-${unit.unitId}`} stroke="var(--ink-16)" strokeWidth="1">
          <line x1={CX} y1={CY} x2={unit.x} y2={unit.y} />
          {unit.lessons.map((node) => (
            <line
              key={node.lesson.id}
              x1={unit.x}
              y1={unit.y}
              x2={node.x}
              y2={node.y}
              strokeOpacity="0.6"
            />
          ))}
        </g>
      ))}

      {/* Center: the student. */}
      <circle cx={CX} cy={CY} r="16" fill="url(#brainmap-aurora)" opacity="0.5" />
      <circle cx={CX} cy={CY} r="6.5" fill="var(--foreground)" />
      <text
        x={CX}
        y={CY + 18}
        textAnchor="middle"
        className="fill-[var(--ink-45)] font-mono text-[8px] uppercase tracking-[0.14em]"
      >
        you
      </text>

      {units.map((unit) => (
        <g key={unit.unitId}>
          <circle cx={unit.x} cy={unit.y} r="4" fill="var(--ink-45)" />
          <title>{unit.unitTitle}</title>
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
                className="cursor-pointer"
              >
                <title>
                  {`${node.lesson.title}${current ? " — current" : value >= 1 ? " — done" : value > 0 ? " — in progress" : ""}${remembered ? " · in your mentor's memory" : ""}`}
                </title>
                {current ? (
                  <circle cx={node.x} cy={node.y} r="12" fill="url(#brainmap-aurora)" />
                ) : remembered ? (
                  <circle cx={node.x} cy={node.y} r="9" fill="url(#brainmap-memory)" />
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
    </svg>
  );
}
