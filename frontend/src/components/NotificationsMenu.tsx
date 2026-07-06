import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "./GradientCard";
import {
  fetchNotifications,
  getSession,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/lib/types";

// v4.0 Phase 5 — the teacher/admin notification bell: unread badge + a dropdown of recent
// persistent notifications (RLS owner-read). Clicking an item navigates to the relevant
// student/class and marks it read. Additive to the derived hotlist (this is the persistent layer).

function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function NotificationsMenu() {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);

  const load = () => {
    fetchNotifications()
      .then(setItems)
      .catch(() => {});
  };

  useEffect(() => {
    load();
    // Light poll as the FALLBACK if the realtime socket drops (keeps today's behavior).
    const interval = window.setInterval(load, 90_000);
    return () => window.clearInterval(interval);
  }, []);

  // Realtime: light the badge/toast the instant a notification row is written for me, instead of
  // waiting up to 90s for the poll. RLS (user_id = auth.uid()) already scopes the realtime stream to
  // my own rows; the user_id filter is a redundant safety + noise reduction. The app-lifetime
  // realtime-auth owner in __root keeps this channel alive past the first token's ~1h expiry.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void getSession()
      .then((session) => {
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        channel = supabase
          .channel(`notifications-inbox-${uid}`)
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
              if (row.title) toast(row.title);
            },
          )
          .subscribe();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const now = Date.now();

  const openItem = (n: Notification) => {
    setOpen(false);
    if (!n.read_at) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      void markNotificationRead(n.id).catch(() => {});
    }
    // Deep-link each kind to the surface where the teacher can act on it:
    //  - assessment_to_review → the class Assessments tab (review/return controls live there)
    //  - submission_to_grade → the class Assignments tab (grading lives there)
    //  - mentor_recommendation → the student's transcript (to see where they're stuck)
    //  - direct_message → the student's Messages tab (reply to the DM)
    if (n.kind === "direct_message" && n.class_id && n.related_student_id) {
      navigate({
        to: "/teacher/class/$classId/student/$studentId",
        params: { classId: n.class_id, studentId: n.related_student_id },
        search: { tab: "messages" },
      });
    } else if (n.kind === "assessment_to_review" && n.class_id) {
      navigate({
        to: "/teacher/class/$classId",
        params: { classId: n.class_id },
        search: { tab: "assessments" },
      });
    } else if (n.kind === "submission_to_grade" && n.class_id) {
      navigate({
        to: "/teacher/class/$classId",
        params: { classId: n.class_id },
        search: { tab: "assignments" },
      });
    } else if (n.kind === "mentor_recommendation" && n.class_id && n.related_student_id) {
      navigate({
        to: "/teacher/class/$classId/student/$studentId",
        params: { classId: n.class_id, studentId: n.related_student_id },
        search: { tab: "transcript" },
      });
    } else if (n.class_id && n.related_student_id) {
      navigate({
        to: "/teacher/class/$classId/student/$studentId",
        params: { classId: n.class_id, studentId: n.related_student_id },
        search: { tab: "overview" },
      });
    } else if (n.class_id) {
      navigate({
        to: "/teacher/class/$classId",
        params: { classId: n.class_id },
        search: { tab: "overview" },
      });
    }
  };

  const markAll = () => {
    setItems((prev) =>
      prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })),
    );
    void markAllNotificationsRead().catch(() => {});
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.5} />
        {unread ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+10px)] z-[var(--z-menu)]"
          style={{ width: "min(340px, calc(100vw - 16px))" }}
        >
          <GradientCard>
            <div className="max-h-[calc(100dvh-84px)] overflow-y-auto overscroll-contain p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                  Notifications
                </div>
                {unread ? (
                  <button
                    type="button"
                    onClick={markAll}
                    className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-[12.5px] text-muted-foreground">
                  No notifications yet.
                </p>
              ) : (
                <div className="grid gap-1">
                  {items.slice(0, 30).map((n) => (
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
                        <span className="block truncate text-[12.5px] text-foreground">
                          {n.title}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {relativeTime(n.created_at, now)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </GradientCard>
        </div>
      ) : null}
    </div>
  );
}
