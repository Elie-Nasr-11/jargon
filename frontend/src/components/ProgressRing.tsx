// A tiny circular progress ring: a faint full-circle track under a foreground arc that fills to
// `value` (0..1), starting at 12 o'clock and sweeping clockwise. Purely decorative (aria-hidden) —
// it marks a lesson as "in progress"; the surrounding text already carries the state for a11y.
// NOTE: per-lesson progress is currently tri-state (0.5 while in progress), so the arc reads as a
// consistent half-ring rather than a precise percentage.
export function ProgressRing({
  value,
  size = 14,
  strokeWidth = 2,
  className,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const center = size / 2;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      className={className}
    >
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/30"
      />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        transform={`rotate(-90 ${center} ${center})`}
        className="text-foreground"
      />
    </svg>
  );
}
