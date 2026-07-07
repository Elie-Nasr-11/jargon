import { relativeTime } from "@/lib/format";
import type { Notification } from "@/lib/types";

// The student's notifications, as the Settings → Notifications modal body. Content-only: the list +
// realtime + unread count live in useStudentNavData (so the drawer badge stays live while closed);
// this panel just renders them and marks read. A direct_message row deep-links into its DM thread.
export function StudentNotifications({
  notifications,
  onMarkRead,
  onMarkAll,
  onOpenDm,
}: {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
  onOpenDm?: (channelId: string) => void;
}) {
  const now = Date.now();
  const unread = notifications.filter((n) => !n.read_at).length;

  const openItem = (n: Notification) => {
    onMarkRead(n.id);
    if (onOpenDm && n.kind === "direct_message" && typeof n.ref?.channel_id === "string") {
      onOpenDm(n.ref.channel_id);
    }
  };

  return (
    <div>
      {unread ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onMarkAll}
            className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        </div>
      ) : null}
      {notifications.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          No notifications yet.
        </p>
      ) : (
        <div className="grid gap-1">
          {notifications.slice(0, 40).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openItem(n)}
              className={`flex items-start gap-2.5 rounded-xl border border-border px-3 py-2 text-left transition-colors hover:bg-muted ${
                n.read_at ? "bg-transparent" : "bg-depth-field"
              }`}
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  n.read_at ? "bg-transparent" : "bg-danger"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-foreground">{n.title}</span>
                {n.body ? (
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {n.body}
                  </span>
                ) : null}
                <span className="block text-[11px] text-muted-foreground">
                  {relativeTime(n.created_at, now)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
