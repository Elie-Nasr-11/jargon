import type { PropsWithChildren } from "react";

export function GradientCard({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={className}
      style={{
        borderRadius: "26px",
        border: "1px solid var(--border)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 50px rgba(0,0,0,0.22)",
        backdropFilter: "blur(20px)",
      }}
    >
      {children}
    </div>
  );
}
