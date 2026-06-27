// One feedback channel for the app: Sonner toasts with distinct success/error
// styling, so a success and a failure can never look identical again. Pair with
// inline field errors for text capture. Mounted once via <Toaster/> in __root.
import { toast } from "sonner";

export function notifyOk(message: string) {
  if (message) toast.success(message);
}

export function notifyErr(error: unknown, fallback = "Something went wrong.") {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  toast.error(message || fallback);
}

// Optional undo affordance for reversible mutations (e.g. status changes).
export function notifyUndo(message: string, onUndo: () => void) {
  toast.success(message, { action: { label: "Undo", onClick: onUndo } });
}
