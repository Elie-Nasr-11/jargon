import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { GradientCard } from "@/components/GradientCard";
import { DmThread } from "@/features/comms/DmThread";
import {
  COMMS_MINI_CHAT_FLAG,
  fetchCommsEnabledClassIds,
  fetchDmChannels,
  fetchStudentClasses,
  getSession,
  listMyTeachers,
  openDmChannel,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { notifyErr } from "@/lib/feedback";
import type { DmChannel, MyTeacher } from "@/lib/types";

// The student's mini-chat: a header launcher that opens a popover to message a teacher of one of the
// classes where messaging has been enabled (per-class feature flag). Hidden entirely until enabled, so
// nothing shows for a student whose class has not opted in.

export function StudentMiniChat() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<MyTeacher[]>([]);
  const [channels, setChannels] = useState<DmChannel[]>([]);
  const [enabledClassIds, setEnabledClassIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<DmChannel | null>(null);
  const [activeTeacherName, setActiveTeacherName] = useState<string>("");
  const [opening, setOpening] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        setMeId(uid);
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
        // messaging stays hidden on any error — never breaks the chat header
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live unread dot: a new message in ANY of my channels (RLS scopes the stream to my own channels)
  // from someone other than me lights the icon, unless I already have that conversation open.
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
            if (!viewing) setUnread(true);
            return current;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId, enabledClassIds, open]);

  useEffect(() => {
    if (open) setUnread(false);
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

  const selectTeacher = async (t: MyTeacher) => {
    if (!meId || opening) return;
    setOpening(true);
    try {
      const existing = channelByTeacher.get(`${t.teacher_id}:${t.class_id}`);
      const channel = existing || (await openDmChannel(meId, t.teacher_id, t.class_id));
      if (!channel) return;
      setChannels((prev) => (prev.some((c) => c.id === channel.id) ? prev : [channel, ...prev]));
      setActiveChannel(channel);
      setActiveTeacherName(t.teacher_name);
    } catch (err) {
      notifyErr(err, "Couldn't open the conversation.");
    } finally {
      setOpening(false);
    }
  };

  // Render nothing at all if messaging is not enabled for any of the student's classes, or no teacher.
  if (enabledClassIds.size === 0 || teachers.length === 0 || !meId) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Messages"
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
      >
        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.5} />
        {unread ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" /> : null}
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
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                ) : null}
                <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                  {activeChannel ? activeTeacherName || "Teacher" : "Messages"}
                </div>
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
                  <div className="grid gap-1">
                    {teachers.map((t) => (
                      <button
                        key={`${t.teacher_id}:${t.class_id}`}
                        type="button"
                        onClick={() => void selectTeacher(t)}
                        disabled={opening}
                        className="flex flex-col rounded-xl border border-border px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <span className="text-[13px] text-foreground">{t.teacher_name}</span>
                        <span className="text-[11px] text-muted-foreground">{t.class_name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </GradientCard>
        </div>
      ) : null}
    </div>
  );
}
