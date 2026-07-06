import { useEffect, useMemo, useState } from "react";
import { ModalCard } from "@/components/ModalCard";
import {
  fetchNotifications,
  getSession,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/lib/types";

// The student's notifications, as a popup inside the Settings menu. Reuses the shared notifications
// table (RLS owner-read) + the realtime INSERT subscription. Student notifications are mostly
// direct_message (a teacher wrote to them); clicking marks read — replies happen from the Messages
// icon in the header, so there are no teacher-console deep-links here.

function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function StudentNotifications({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    fetchNotifications()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {});
    void getSession()
      .then((session) => {
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        channel = supabase
          .channel(`student-notifications-${uid}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `user_id=eq.${uid}`,
            },
            (payload) => {
              const row = payload.new as Notification | null;
              if (!row?.id) return;
              setItems((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev]));
            },
          )
          .subscribe();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [open]);

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const now = Date.now();

  const openItem = (n: Notification) => {
    if (!n.read_at) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      void markNotificationRead(n.id).catch(() => {});
    }
  };

  const markAll = () => {
    setItems((prev) =>
      prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })),
    );
    void markAllNotificationsRead().catch(() => {});
  };

  return (
    <ModalCard open={open} onOpenChange={onOpenChange} title="Notifications">
      {unread ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={markAll}
            className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          No notifications yet.
        </p>
      ) : (
        <div className="grid gap-1">
          {items.slice(0, 40).map((n) => (
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
                <span className="block text-[11px] text-muted-foreground">
                  {relativeTime(n.created_at, now)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </ModalCard>
  );
}
