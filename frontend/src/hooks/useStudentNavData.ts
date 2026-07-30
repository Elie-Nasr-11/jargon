import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchNotifications,
  fetchStudentGrades,
  fetchStudentLessonProgress,
  getSession,
  markAllNotificationsRead as apiMarkAll,
  markNotificationRead as apiMarkRead,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Notification, StudentGradeRow } from "@/lib/types";

// The persistent data layer behind the student sidebar: it fetches + live-subscribes so the
// Pulse badge and the class summaries stay current while every page is closed. The notifications
// list + mark-read live here (one source of truth shared by the badge and the Pulse activity
// feed). Grades load once on mount and refresh via refreshGrades() when a page closes — the
// class cards read dueByClass / avgByClass without their own fetches.
export function useStudentNavData() {
  const [meId, setMeId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [grades, setGrades] = useState<StudentGradeRow[]>([]);
  // Per-lesson completion (0..1) across the student's whole catalog — powers the sidebar's
  // at-a-glance state dots. Load-once like grades; missing ids read as not-started.
  const [lessonProgress, setLessonProgress] = useState<Record<string, number>>({});

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
        void fetchStudentGrades()
          .then((rows) => !cancelled && setGrades(rows))
          .catch(() => {});
        void fetchStudentLessonProgress()
          .then((map) => !cancelled && setLessonProgress(map))
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

  // Called when a panel closes (work may have been submitted inside it) so the grade summaries
  // refresh. Lesson progress can also have advanced (a lesson finished mid-session), so refresh
  // it too.
  const refreshGrades = useCallback(() => {
    void fetchStudentGrades()
      .then((rows) => setGrades(rows))
      .catch(() => {});
    void fetchStudentLessonProgress()
      .then((map) => setLessonProgress(map))
      .catch(() => {});
  }, []);

  // Grade-derived summaries for the class cards: an item is OPEN while the student still owes work
  // on it (assigned/started); submitted-awaiting-grading is no longer "due".
  const { dueByClass, avgByClass } = useMemo(() => {
    const open = grades.filter(
      (g) => (g.status === "assigned" || g.status === "started") && g.due_at,
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
    return { dueByClass: byClass, avgByClass: avg };
  }, [grades]);

  return {
    notifications,
    notificationsUnread,
    grades,
    lessonProgress,
    dueByClass,
    avgByClass,
    markNotificationRead,
    markAllNotificationsRead,
    refreshGrades,
  };
}
