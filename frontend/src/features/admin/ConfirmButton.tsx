import { useEffect, useState } from "react";

// Two-click inline confirm (no window.confirm — R47 retired browser prompts from
// admin/teacher surfaces). First click arms for 4s and relabels; second click fires.
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
  tone = "danger",
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: "danger" | "neutral";
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const toneClass = armed
    ? "border-danger/60 bg-danger/10 text-danger"
    : tone === "danger"
      ? "border-border text-danger hover:bg-danger/10"
      : "border-border text-foreground hover:bg-muted";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={`rounded-full border px-3 py-1.5 text-meta transition-colors disabled:opacity-50 ${toneClass}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
