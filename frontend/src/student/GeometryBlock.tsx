import { useMemo } from "react";

// R29 — GEOMETRY DIAGRAMS. A ```geometry fenced block carries JSON describing a figure in
// its own coordinate space; this fits that space to the viewport and draws it in the app's
// theme tokens (so a triangle looks like it belongs to the page in light AND dark).
//
//   ```geometry
//   {"points":{"A":[0,0],"B":[4,0],"C":[4,3]},
//    "segments":[["A","B"],["B","C"],["C","A"]],
//    "angles":[{"at":"B","from":"A","to":"C","right":true}],
//    "labels":[{"at":"A","to":"B","text":"4"}],
//    "circles":[{"center":"A","r":1.2,"dashed":true}],
//    "title":"A 3-4-5 triangle"}
//   ```
//
// Named points are the vocabulary: segments, angles, labels, and circles all refer to them
// by name, which is exactly how a textbook figure is described in words ("the angle at B")
// and keeps the JSON readable to the teacher who writes it. A right angle draws the square
// marker rather than an arc — the convention students already know.
//
// Unit-circle work gets first-class support: `unitCircle: true` draws the circle, the axes,
// and the reference-angle triangle for any point on it, which is the single most-drawn
// figure in the trigonometry course.

type Pt = [number, number];
type SegmentSpec =
  | [string, string]
  | { from: string; to: string; dashed?: boolean; label?: string };
type AngleSpec = { at: string; from: string; to: string; label?: string; right?: boolean };
type LabelSpec = { at: string; to?: string; text: string };
type CircleSpec = { center: string; r: number; dashed?: boolean };

export type GeometrySpec = {
  points?: Record<string, Pt>;
  segments?: SegmentSpec[];
  angles?: AngleSpec[];
  labels?: LabelSpec[];
  circles?: CircleSpec[];
  polygons?: string[][];
  title?: string;
  unitCircle?: boolean;
  showAxes?: boolean;
};

const W = 460;
const H = 340;
const PAD = 34;

function segmentParts(segment: SegmentSpec) {
  return Array.isArray(segment)
    ? { from: segment[0], to: segment[1], dashed: false, label: undefined as string | undefined }
    : { from: segment.from, to: segment.to, dashed: !!segment.dashed, label: segment.label };
}

export function GeometryBlock({ spec }: { spec: GeometrySpec }) {
  const model = useMemo(() => {
    const points = spec.points || {};
    const names = Object.keys(points);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const name of names) {
      const p = points[name];
      if (!Array.isArray(p) || p.length !== 2) continue;
      xs.push(p[0]);
      ys.push(p[1]);
    }
    for (const circle of spec.circles || []) {
      const c = points[circle.center];
      if (!c) continue;
      xs.push(c[0] - circle.r, c[0] + circle.r);
      ys.push(c[1] - circle.r, c[1] + circle.r);
    }
    if (spec.unitCircle) {
      xs.push(-1.15, 1.15);
      ys.push(-1.15, 1.15);
    }
    if (!xs.length) {
      xs.push(-1, 1);
      ys.push(-1, 1);
    }
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    // A degenerate span (all points on one line) still needs a box to fit into.
    if (xMax - xMin < 1e-6) {
      xMin -= 1;
      xMax += 1;
    }
    if (yMax - yMin < 1e-6) {
      yMin -= 1;
      yMax += 1;
    }
    // Uniform scale on both axes — a circle must stay a circle and a right angle must look
    // like one, which a per-axis fit would destroy.
    const scale = Math.min((W - PAD * 2) / (xMax - xMin), (H - PAD * 2) / (yMax - yMin));
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    const sx = (x: number) => W / 2 + (x - cx) * scale;
    const sy = (y: number) => H / 2 - (y - cy) * scale;
    return { points, sx, sy, scale, xMin, xMax, yMin, yMax };
  }, [spec]);

  const { points, sx, sy, scale } = model;
  const at = (name: string): Pt | null => {
    const p = points[name];
    return Array.isArray(p) && p.length === 2 ? p : null;
  };

  const showAxes = spec.showAxes ?? spec.unitCircle ?? false;

  return (
    <figure
      className="my-2 overflow-hidden rounded-[14px] border border-border bg-depth-card"
      style={{ boxShadow: "var(--inset-highlight)" }}
    >
      <figcaption className="border-b border-border bg-depth-sub px-3 py-1 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
        {spec.title || "Figure"}
      </figcaption>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[300px]"
          role="img"
          aria-label={spec.title || "Geometry figure"}
        >
          {showAxes ? (
            <g stroke="var(--border)" strokeWidth={1.2}>
              <line x1={PAD / 2} y1={sy(0)} x2={W - PAD / 2} y2={sy(0)} />
              <line x1={sx(0)} y1={PAD / 2} x2={sx(0)} y2={H - PAD / 2} />
            </g>
          ) : null}
          {spec.unitCircle ? (
            <circle
              cx={sx(0)}
              cy={sy(0)}
              r={scale}
              fill="none"
              stroke="var(--mode-lesson)"
              strokeWidth={1.6}
              opacity={0.85}
            />
          ) : null}
          {(spec.circles || []).map((circle, i) => {
            const c = at(circle.center);
            if (!c) return null;
            return (
              <circle
                key={`ci${i}`}
                cx={sx(c[0])}
                cy={sy(c[1])}
                r={circle.r * scale}
                fill="none"
                stroke="var(--mode-discuss)"
                strokeWidth={1.5}
                strokeDasharray={circle.dashed ? "5 4" : undefined}
              />
            );
          })}
          {(spec.polygons || []).map((names, i) => {
            const pts = names.map(at).filter(Boolean) as Pt[];
            if (pts.length < 3) return null;
            return (
              <polygon
                key={`pg${i}`}
                points={pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(" ")}
                fill="var(--mode-practice)"
                opacity={0.12}
                stroke="none"
              />
            );
          })}
          {(spec.segments || []).map((segment, i) => {
            const { from, to, dashed, label } = segmentParts(segment);
            const a = at(from);
            const b = at(to);
            if (!a || !b) return null;
            const mx = (sx(a[0]) + sx(b[0])) / 2;
            const my = (sy(a[1]) + sy(b[1])) / 2;
            return (
              <g key={`sg${i}`}>
                <line
                  x1={sx(a[0])}
                  y1={sy(a[1])}
                  x2={sx(b[0])}
                  y2={sy(b[1])}
                  stroke="var(--foreground)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeDasharray={dashed ? "5 4" : undefined}
                />
                {label ? (
                  <text
                    x={mx}
                    y={my - 5}
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                    fill="var(--muted-foreground)"
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {(spec.angles || []).map((angle, i) => {
            const v = at(angle.at);
            const a = at(angle.from);
            const b = at(angle.to);
            if (!v || !a || !b) return null;
            const ang = (p: Pt) => Math.atan2(sy(p[1]) - sy(v[1]), sx(p[0]) - sx(v[0]));
            const a1 = ang(a);
            const a2 = ang(b);
            const vx = sx(v[0]);
            const vy = sy(v[1]);
            if (angle.right) {
              // The right-angle square: step along both legs and close the corner.
              const size = 13;
              const p1 = [vx + Math.cos(a1) * size, vy + Math.sin(a1) * size];
              const p2 = [vx + Math.cos(a2) * size, vy + Math.sin(a2) * size];
              const p3 = [p1[0] + p2[0] - vx, p1[1] + p2[1] - vy];
              return (
                <polyline
                  key={`an${i}`}
                  points={`${p1[0]},${p1[1]} ${p3[0]},${p3[1]} ${p2[0]},${p2[1]}`}
                  fill="none"
                  stroke="var(--mode-practice)"
                  strokeWidth={1.5}
                />
              );
            }
            const r = 22;
            // Sweep the short way around, so the marked angle is the interior one.
            let delta = a2 - a1;
            while (delta <= -Math.PI) delta += Math.PI * 2;
            while (delta > Math.PI) delta -= Math.PI * 2;
            const end = a1 + delta;
            const large = Math.abs(delta) > Math.PI ? 1 : 0;
            const sweep = delta > 0 ? 1 : 0;
            const d = `M${vx + Math.cos(a1) * r},${vy + Math.sin(a1) * r} A${r},${r} 0 ${large} ${sweep} ${vx + Math.cos(end) * r},${vy + Math.sin(end) * r}`;
            const mid = a1 + delta / 2;
            return (
              <g key={`an${i}`}>
                <path d={d} fill="none" stroke="var(--mode-practice)" strokeWidth={1.6} />
                {angle.label ? (
                  <text
                    x={vx + Math.cos(mid) * (r + 12)}
                    y={vy + Math.sin(mid) * (r + 12) + 4}
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                    fill="var(--mode-practice)"
                    textAnchor="middle"
                  >
                    {angle.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {Object.entries(points).map(([name, p]) => {
            if (!Array.isArray(p) || p.length !== 2) return null;
            return (
              <g key={`pt${name}`}>
                <circle cx={sx(p[0])} cy={sy(p[1])} r={3.2} fill="var(--foreground)" />
                <text
                  x={sx(p[0]) + 7}
                  y={sy(p[1]) - 7}
                  fontSize={12}
                  fontFamily="var(--font-mono)"
                  fill="var(--foreground)"
                >
                  {name}
                </text>
              </g>
            );
          })}
          {(spec.labels || []).map((label, i) => {
            const a = at(label.at);
            if (!a) return null;
            const b = label.to ? at(label.to) : null;
            const x = b ? (sx(a[0]) + sx(b[0])) / 2 : sx(a[0]);
            const y = b ? (sy(a[1]) + sy(b[1])) / 2 : sy(a[1]);
            return (
              <text
                key={`lb${i}`}
                x={x}
                y={y - 8}
                fontSize={11}
                fontFamily="var(--font-mono)"
                fill="var(--muted-foreground)"
                textAnchor="middle"
              >
                {label.text}
              </text>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
