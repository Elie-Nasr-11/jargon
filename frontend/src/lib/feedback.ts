// One feedback channel for the app: Sonner toasts with distinct success/error
// styling, so a success and a failure can never look identical again. Pair with
// inline field errors for text capture. Mounted once via <Toaster/> in __root.
import { toast } from "sonner";

// How long an Undo affordance stays actionable (toast duration + deferred-commit
// window). The toast stays up the whole time unless the teacher dismisses it
// (close button / swipe), which the <Toaster/> in __root enables.
export const UNDO_WINDOW_MS = 60000;

export function notifyOk(message: string) {
  if (message) toast.success(message);
}

export function notifyErr(error: unknown, fallback = "Something went wrong.") {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  toast.error(message || fallback);
}

// Undo affordance for reversible mutations. The toast stays up for the whole
// undo window so the action button is reachable for as long as it's valid.
export function notifyUndo(message: string, onUndo: () => void, durationMs = UNDO_WINDOW_MS) {
  toast.success(message, {
    action: { label: "Undo", onClick: onUndo },
    duration: durationMs,
  });
}
