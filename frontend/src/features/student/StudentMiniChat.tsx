import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import { DmThread } from "@/features/comms/DmThread";
import {
  COMMS_MINI_CHAT_FLAG,
  fetchCommsEnabledClassIds,
  fetchDmChannels,
  fetchNotifications,
  fetchStudentClasses,
  getSession,
  listMyTeachers,
  markAllNotificationsRead,
  markNotificationRead,
  openDmChannel,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { notifyErr } from "@/lib/feedback";
import type { DmChannel, MyTeacher, Notification } from "@/lib/types";

// The student's inbox: ONE header surface for teacher messages AND notifications. DM threads show
// when the student has a class with messaging enabled (per-class feature flag); the notifications
// list shows always. A direct_message notification deep-links into its thread (ref.channel_id).
// One unread badge fed by both realtime pipes (dm_messages + notifications).

function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function StudentMiniChat() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<MyTeacher[]>([]);
  const [channels, setChannels] = useState<DmChannel[]>([]);
  const [enabledClassIds, setEnabledClassIds] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<DmChannel | null>(null);
  const [activeTeacherName, setActiveTeacherName] = useState<string>("");
  const [opening, setOpening] = useState(false);
  const [dmUnread, setDmUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        setMeId(uid);
        // Notifications load regardless of the messaging flag — the inbox always carries them.
        void fetchNotifications()
          .then((rows) => !cancelled && setNotifications(rows))
          .catch(() => {});
        const classes = await fetchStudentClasses();
        const classIds = classes.map((c) => c.id);
        const enabled = await fetchCommsEnabledClassIds(classIds, COMMS_MINI_CHAT_FLAG);
        if (cancelled) return;
        setEnabledClassIds(enabled);
        if (enabled.size === 0) return; // messaging not enabled for any of the student's classes
        const [t, ch] = await Promise.all([listMyTeachers(), fetchDmChannels()]);
        if (cancelled) return;
        setTeachers(t.filter((row) => enabled.has(row.class_id)));
        setChannels(ch);
      } catch {
        // the inbox degrades to notifications-only on any error — never breaks the chat header
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live unread dot for DMs: a new message in ANY of my channels (RLS scopes the stream) from
  // someone other than me lights the icon, unless I already have that conversation open.
  useEffect(() => {
    if (!meId || enabledClassIds.size === 0) return;
    const channel = supabase
      .channel(`dm-inbox-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages" },
        (payload) => {
          const row = payload.new as { sender_id?: string; channel_id?: string } | null;
          if (!row || row.sender_id === meId) return;
          setActiveChannel((current) => {
            const viewing = open && current?.id === row.channel_id;
            if (!viewing) setDmUnread(true);
            return current;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId, enabledClassIds, open]);

  // Live notifications: new rows land at the top and light the badge even while the popover is
  // closed (this sub is persistent, unlike the old gear modal's open-only one).
  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`student-notifications-${meId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${meId}`,
        },
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

  useEffect(() => {
    if (open) setDmUnread(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
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

  const channelByTeacher = useMemo(() => {
    const map = new Map<string, DmChannel>();
    for (const ch of channels) map.set(`${ch.teacher_id}:${ch.class_id}`, ch);
    return map;
  }, [channels]);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) map.set(t.teacher_id, t.teacher_name);
    return map;
  }, [teachers]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications],
  );
  const hasUnread = dmUnread || unreadNotifications > 0;

  const markRead = (n: Notification) => {
    if (n.read_at) return;
    setNotifications((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
    );
    void markNotificationRead(n.id).catch(() => {});
  };

  const markAll = () => {
    setNotifications((prev) =>
      prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })),
    );
    void markAllNotificationsRead().catch(() => {});
  };

  const openThread = (channel: DmChannel, teacherName: string) => {
    setActiveChannel(channel);
    setActiveTeacherName(teacherName);
    // Opening the thread consumes its pending direct_message notification.
    for (const n of notifications) {
      if (!n.read_at && n.kind === "direct_message" && n.ref?.channel_id === channel.id) {
        markRead(n);
      }
    }
  };

  const selectTeacher = async (t: MyTeacher) => {
    if (!meId || opening) return;
    setOpening(true);
    try {
      const existing = channelByTeacher.get(`${t.teacher_id}:${t.class_id}`);
      const channel = existing || (await openDmChannel(meId, t.teacher_id, t.class_id));
      if (!channel) return;
      setChannels((prev) => (prev.some((c) => c.id === channel.id) ? prev : [channel, ...prev]));
      openThread(channel, t.teacher_name);
    } catch (err) {
      notifyErr(err, "Couldn't open the conversation.");
    } finally {
      setOpening(false);
    }
  };

  // A direct_message notification deep-links into its thread when the channel is available;
  // anything else (or an unresolvable channel) just marks read.
  const openNotification = (n: Notification) => {
    markRead(n);
    if (n.kind === "direct_message" && typeof n.ref?.channel_id === "string") {
      const channel = channels.find((c) => c.id === n.ref.channel_id);
      if (channel) {
        openThread(channel, teacherNameById.get(channel.teacher_id) ?? "Teacher");
      }
    }
  };

  if (!meId) return null;

  const now = Date.now();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Inbox"
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
      >
        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.5} />
        {hasUnread ? (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+10px)] z-[var(--z-menu)]"
          style={{ width: "min(360px, calc(100vw - 16px))" }}
        >
          <GradientCard>
            <div className="flex h-[min(70dvh,520px)] flex-col p-3">
              <div className="mb-2 flex items-center gap-2 px-1">
                {activeChannel ? (
                  <button
                    type="button"
                    onClick={() => setActiveChannel(null)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Back to inbox"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1 truncate text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                  {activeChannel ? activeTeacherName || "Teacher" : "Inbox"}
                </div>
                {!activeChannel && unreadNotifications ? (
                  <button
                    type="button"
                    onClick={markAll}
                    className="shrink-0 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>

              {activeChannel ? (
                <div className="min-h-0 flex-1">
                  <DmThread
                    channelId={activeChannel.id}
                    meId={meId}
                    disabled={activeChannel.status !== "open"}
                    disabledNote={
                      activeChannel.status === "blocked"
                        ? "Your teacher has paused this conversation."
                        : "This conversation is closed."
                    }
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {teachers.length ? (
                    <>
                      <div className="mb-1.5 px-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        Message a teacher
                      </div>
                      <div className="mb-3 grid gap-1">
                        {teachers.map((t) => (
                          <button
                            key={`${t.teacher_id}:${t.class_id}`}
                            type="button"
                            onClick={() => void selectTeacher(t)}
                            disabled={opening}
                            className="flex flex-col rounded-xl border border-border px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            <span className="text-[13px] text-foreground">{t.teacher_name}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {t.class_name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}

                  <div className="mb-1.5 px-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    Notifications
                  </div>
                  {notifications.length === 0 ? (
                    <p className="px-1 py-4 text-center text-[12.5px] text-muted-foreground">
                      No notifications yet.
                    </p>
                  ) : (
                    <div className="grid gap-1">
                      {notifications.slice(0, 40).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => openNotification(n)}
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
                </div>
              )}
            </div>
          </GradientCard>
        </div>
      ) : null}
    </div>
  );
}
