import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchNotifications,
  fetchReviewDue,
  fetchStudentGrades,
  getSession,
  markAllNotificationsRead as apiMarkAll,
  markNotificationRead as apiMarkRead,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Notification, StudentGradeRow } from "@/lib/types";

// The persistent data layer behind the student edge chrome: it fetches + live-subscribes so the
// edge badges and peeks (Classes due counts / Pulse next-deadline / Review / unread) stay current
// even while every panel is closed. The notifications list + mark-read live here (one source of
// truth shared by the badges and the Pulse activity feed); DM threads fetch on open, and this hook
// only tracks the DM unread flag. Grades load once on mount and refresh via refreshGrades() when a
// panel closes — the peeks read nextDue / dueByClass / avgByClass without their own fetches.
export function useStudentNavData() {
  const [meId, setMeId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [reviewDueCount, setReviewDueCount] = useState(0);
  const [dmUnread, setDmUnread] = useState(false);
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        setMeId(uid);
        void fetchNotifications()
          .then((rows) => {
            if (cancelled) return;
            setNotifications(rows);
            // Seed the Messages dot from any unread direct_message notification (a DM insert writes
            // one), so the badge reflects DMs unread from before load — not only live arrivals.
            if (rows.some((n) => n.kind === "direct_message" && !n.read_at)) setDmUnread(true);
          })
          .catch(() => {});
        void fetchReviewDue()
          .then((rows) => !cancelled && setReviewDueCount(rows.length))
          .catch(() => {});
        void fetchStudentGrades()
          .then((rows) => !cancelled && setGrades(rows))
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

  // Called when a panel closes (work may have been submitted inside it) so the edge peeks refresh.
  const refreshGrades = useCallback(() => {
    void fetchStudentGrades()
      .then((rows) => setGrades(rows))
      .catch(() => {});
  }, []);

  // Grade-derived summaries for the edge peeks: an item is OPEN while the student still owes work
  // on it (assigned/started); submitted-awaiting-grading is no longer "due".
  const { nextDue, dueByClass, avgByClass } = useMemo(() => {
    const open = grades.filter(
      (g) => (g.status === "assigned" || g.status === "started") && g.due_at,
    );
    const now = Date.now();
    const upcoming = open
      .filter((g) => new Date(g.due_at as string).getTime() >= now)
      .sort(
        (a, b) => new Date(a.due_at as string).getTime() - new Date(b.due_at as string).getTime(),
      );
    const byClass: Record<string, number> = {};
    for (const g of open) {
      if (g.class_id) byClass[g.class_id] = (byClass[g.class_id] ?? 0) + 1;
    }
    const sums: Record<string, { total: number; count: number }> = {};
    for (const g of grades) {
      if (g.class_id && g.score != null) {
        const s = (sums[g.class_id] ??= { total: 0, count: 0 });
        s.total += g.score;
        s.count += 1;
      }
    }
    const avg: Record<string, number> = {};
    for (const [classId, s] of Object.entries(sums)) avg[classId] = s.total / s.count;
    return { nextDue: upcoming[0] ?? null, dueByClass: byClass, avgByClass: avg };
  }, [grades]);

  return {
    notifications,
    notificationsUnread,
    reviewDueCount,
    dmUnread,
    grades,
    nextDue,
    dueByClass,
    avgByClass,
    markNotificationRead,
    markAllNotificationsRead,
    clearDmUnread,
    refreshReviewCount,
    refreshGrades,
  };
}
