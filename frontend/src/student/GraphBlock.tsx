import { useMemo } from "react";
import { parseExpression } from "@/lib/plotExpression";

// R29 — FUNCTION GRAPHS. A ```graph fenced block carries JSON that the mentor (or a lesson
// step) writes, and this draws it as themed SVG: axes with ticks, a light grid, one or more
// curves, optional plotted points, and optional vertical asymptote guides.
//
//   ```graph
//   {"functions":[{"expression":"sin(x)","label":"y = sin x"}],
//    "xRange":[-6.283,6.283],"yRange":[-2,2],"xStep":1.5708,
//    "points":[{"x":1.5708,"y":1,"label":"max"}],"asymptotes":[3.1416]}
//   ```
//
// Everything is optional except `functions` (or `points` alone, for a scatter). Ranges
// default to [-10,10]. Expressions run through the total parser in lib/plotExpression —
// no eval, and an unparseable formula shows its reason instead of breaking the transcript.
//
// Discontinuities (tan, 1/x) are handled by breaking the path wherever a sample is
// non-finite or the segment jumps more than half the visible height: without that, tan(x)
// draws a vertical line through its asymptote and reads as part of the curve.

type GraphFunctionSpec = { expression: string; label?: string; color?: string };
type GraphPointSpec = { x: number; y: number; label?: string; open?: boolean };

export type GraphSpec = {
  functions?: GraphFunctionSpec[];
  points?: GraphPointSpec[];
  xRange?: [number, number];
  yRange?: [number, number];
  xStep?: number;
  yStep?: number;
  xLabel?: string;
  yLabel?: string;
  title?: string;
  asymptotes?: number[];
};

const W = 520;
const H = 320;
const PAD = 26;
const SAMPLES = 480;

// The mode hues double as the series palette: the same six colors the rest of the app
// already uses to distinguish things, so a graph never introduces a new color language.
const SERIES = [
  "var(--mode-practice)",
  "var(--mode-discuss)",
  "var(--mode-lesson)",
  "var(--mode-quiz)",
  "var(--mode-assignment)",
  "var(--mode-open)",
];

function niceStep(span: number): number {
  const raw = span / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
}

function fmt(value: number): string {
  if (Math.abs(value) < 1e-9) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

export function GraphBlock({ spec }: { spec: GraphSpec }) {
  const model = useMemo(() => {
    const [x0, x1] = spec.xRange && spec.xRange.length === 2 ? spec.xRange : [-10, 10];
    const [y0, y1] = spec.yRange && spec.yRange.length === 2 ? spec.yRange : [-10, 10];
    const xMin = Math.min(x0, x1);
    const xMax = Math.max(x0, x1);
    const yMin = Math.min(y0, y1);
    const yMax = Math.max(y0, y1);
    const sx = (x: number) => PAD + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
    const sy = (y: number) => H - PAD - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD * 2);
    const errors: string[] = [];
    const curves = (spec.functions || []).map((fn, index) => {
      let evaluate: ((x: number) => number) | null = null;
      try {
        evaluate = parseExpression(fn.expression);
      } catch (cause) {
        errors.push(`${fn.expression}: ${cause instanceof Error ? cause.message : "bad formula"}`);
      }
      const paths: string[] = [];
      if (evaluate) {
        let current = "";
        let prevY: number | null = null;
        const jumpLimit = (yMax - yMin) * 0.55;
        for (let i = 0; i <= SAMPLES; i += 1) {
          const x = xMin + ((xMax - xMin) * i) / SAMPLES;
          const y = evaluate(x);
          const broken =
            !Number.isFinite(y) ||
            y > yMax + jumpLimit ||
            y < yMin - jumpLimit ||
            (prevY !== null && Math.abs(y - prevY) > jumpLimit);
          if (broken) {
            if (current) paths.push(current);
            current = "";
            prevY = Number.isFinite(y) ? y : null;
            continue;
          }
          current += `${current ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
          prevY = y;
        }
        if (current) paths.push(current);
      }
      return {
        paths,
        label: fn.label || fn.expression,
        color:
          fn.color && /^var\(--[a-z-]+\)$/.test(fn.color)
            ? fn.color
            : SERIES[index % SERIES.length],
      };
    });
    const xStep = spec.xStep && spec.xStep > 0 ? spec.xStep : niceStep(xMax - xMin);
    const yStep = spec.yStep && spec.yStep > 0 ? spec.yStep : niceStep(yMax - yMin);
    const xTicks: number[] = [];
    for (let t = Math.ceil(xMin / xStep) * xStep; t <= xMax + 1e-9; t += xStep) xTicks.push(t);
    const yTicks: number[] = [];
    for (let t = Math.ceil(yMin / yStep) * yStep; t <= yMax + 1e-9; t += yStep) yTicks.push(t);
    return { xMin, xMax, yMin, yMax, sx, sy, curves, xTicks, yTicks, errors };
  }, [spec]);

  const { sx, sy, xMin, xMax, yMin, yMax } = model;
  const axisY = sy(Math.min(Math.max(0, yMin), yMax));
  const axisX = sx(Math.min(Math.max(0, xMin), xMax));

  return (
    <figure
      className="my-2 overflow-hidden rounded-[14px] border border-border bg-depth-card"
      style={{ boxShadow: "var(--inset-highlight)" }}
    >
      <figcaption className="border-b border-border bg-depth-sub px-3 py-1 font-mono text-overline uppercase tracking-[0.16em] text-muted-foreground">
        {spec.title || "Graph"}
      </figcaption>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[320px]"
          role="img"
          aria-label={
            spec.title ||
            `Graph of ${(spec.functions || []).map((f) => f.label || f.expression).join(", ")}`
          }
        >
          <g stroke="var(--border)" strokeWidth={1} opacity={0.5}>
            {model.xTicks.map((t) => (
              <line key={`gx${t}`} x1={sx(t)} y1={PAD} x2={sx(t)} y2={H - PAD} />
            ))}
            {model.yTicks.map((t) => (
              <line key={`gy${t}`} x1={PAD} y1={sy(t)} x2={W - PAD} y2={sy(t)} />
            ))}
          </g>
          {(spec.asymptotes || []).map((a, i) => (
            <line
              key={`as${i}`}
              x1={sx(a)}
              y1={PAD}
              x2={sx(a)}
              y2={H - PAD}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.7}
            />
          ))}
          <g stroke="var(--foreground)" strokeWidth={1.4}>
            <line x1={PAD} y1={axisY} x2={W - PAD} y2={axisY} />
            <line x1={axisX} y1={PAD} x2={axisX} y2={H - PAD} />
          </g>
          <g fill="var(--muted-foreground)" fontSize={9} fontFamily="var(--font-mono)">
            {model.xTicks.map((t) =>
              Math.abs(t) < 1e-9 ? null : (
                <text key={`tx${t}`} x={sx(t)} y={axisY + 12} textAnchor="middle">
                  {fmt(t)}
                </text>
              ),
            )}
            {model.yTicks.map((t) =>
              Math.abs(t) < 1e-9 ? null : (
                <text key={`ty${t}`} x={axisX - 5} y={sy(t) + 3} textAnchor="end">
                  {fmt(t)}
                </text>
              ),
            )}
            {spec.xLabel ? (
              <text x={W - PAD} y={axisY - 6} textAnchor="end" fill="var(--foreground)">
                {spec.xLabel}
              </text>
            ) : null}
            {spec.yLabel ? (
              <text x={axisX + 6} y={PAD + 4} fill="var(--foreground)">
                {spec.yLabel}
              </text>
            ) : null}
          </g>
          {model.curves.map((curve, i) =>
            curve.paths.map((d, j) => (
              <path
                key={`c${i}-${j}`}
                d={d}
                fill="none"
                stroke={curve.color}
                strokeWidth={2}
                strokeLinecap="round"
              />
            )),
          )}
          {(spec.points || []).map((p, i) => (
            <g key={`p${i}`}>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={3.5}
                fill={p.open ? "var(--background)" : "var(--foreground)"}
                stroke="var(--foreground)"
                strokeWidth={1.5}
              />
              {p.label ? (
                <text
                  x={sx(p.x) + 6}
                  y={sy(p.y) - 6}
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fill="var(--foreground)"
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      {model.curves.some((c) => c.label) ? (
        <div className="flex flex-wrap gap-3 border-t border-border px-3 py-1.5">
          {model.curves.map((curve, i) => (
            <span key={i} className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: curve.color }}
              />
              {curve.label}
            </span>
          ))}
        </div>
      ) : null}
      {model.errors.length ? (
        <p className="border-t border-border px-3 py-1.5 text-meta text-danger">
          {model.errors.join(" · ")}
        </p>
      ) : null}
    </figure>
  );
}
