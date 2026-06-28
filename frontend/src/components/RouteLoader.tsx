// Neutral full-screen loader shown while a route resolves the signed-in user's
// role. Renders NO portal chrome (no logo, nav, or switcher) so a wrong-role
// user never glimpses a portal that isn't theirs before the redirect fires.
import { AmbientCanvas } from "@/components/AmbientCanvas";

export function RouteLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.18} />
      <div className="relative z-10 text-[13px] text-muted-foreground">{label}</div>
    </div>
  );
}
