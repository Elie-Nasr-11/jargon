import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchNotifications,
  fetchReviewDue,
  getSession,
  markAllNotificationsRead as apiMarkAll,
  markNotificationRead as apiMarkRead,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/lib/types";

// The persistent data layer behind the student nav drawer: it fetches + live-subscribes so the
// menu-trigger dot and the per-item counts (Messages / Review / Notifications) stay current even
// while the drawer and its modals are closed. The notifications list + mark-read live here (one
// source of truth shared by the badge and the Notifications modal); the Messages panel fetches its
// own threads on open, and this hook only tracks the DM unread flag for its badge.
export function useStudentNavData() {
  const [meId, setMeId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [reviewDueCount, setReviewDueCount] = useState(0);
  const [dmUnread, setDmUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        setMeId(uid);
        void fetchNotifications()
          .then((rows) => !cancelled && setNotifications(rows))
          .catch(() => {});
        void fetchReviewDue()
          .then((rows) => !cancelled && setReviewDueCount(rows.length))
          .catch(() => {});
      } catch {
        // best-effort: nav badges degrade to nothing, never break the chat
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live notifications — new rows land at the top and light the badge even while closed.
  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`nav-notifs-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${meId}` },
        (payload) => {
          const row = payload.new as Notification | null;
          if (!row?.id) return;
          setNotifications((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev]));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId]);

  // Live DM unread — a message in any of my channels (RLS-scoped) from someone else lights it.
  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`nav-dm-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages" },
        (payload) => {
          const row = payload.new as { sender_id?: string } | null;
          if (!row || row.sender_id === meId) return;
          setDmUnread(true);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId]);

  const notificationsUnread = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications],
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)),
    );
    void apiMarkRead(id).catch(() => {});
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) =>
      prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })),
    );
    void apiMarkAll().catch(() => {});
  }, []);

  const clearDmUnread = useCallback(() => setDmUnread(false), []);

  // Called after a guided review completes so the badge reflects the freshly-refreshed queue.
  const refreshReviewCount = useCallback(() => {
    void fetchReviewDue()
      .then((rows) => setReviewDueCount(rows.length))
      .catch(() => {});
  }, []);

  return {
    notifications,
    notificationsUnread,
    reviewDueCount,
    dmUnread,
    markNotificationRead,
    markAllNotificationsRead,
    clearDmUnread,
    refreshReviewCount,
  };
}
