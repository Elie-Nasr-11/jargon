import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { StateNote } from "@/components/StateNote";
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
import { notifyErr } from "@/lib/feedback";
import type { DmChannel, MyTeacher } from "@/lib/types";

// The student's Messages modal body: DM threads with a teacher of a class where messaging is
// enabled (per-class flag). DM-only — notifications live under Settings now. `initialChannelId`
// deep-links straight into a thread (from a direct_message notification).
export function MessagesPanel({ initialChannelId }: { initialChannelId?: string | null }) {
  const [meId, setMeId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<MyTeacher[]>([]);
  const [channels, setChannels] = useState<DmChannel[]>([]);
  const [enabledClassIds, setEnabledClassIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [activeChannel, setActiveChannel] = useState<DmChannel | null>(null);
  const [activeTeacherName, setActiveTeacherName] = useState<string>("");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || cancelled) return;
        setMeId(uid);
        const classes = await fetchStudentClasses();
        const enabled = await fetchCommsEnabledClassIds(
          classes.map((c) => c.id),
          COMMS_MINI_CHAT_FLAG,
        );
        if (cancelled) return;
        setEnabledClassIds(enabled);
        if (enabled.size === 0) return;
        const [t, ch] = await Promise.all([listMyTeachers(), fetchDmChannels()]);
        if (cancelled) return;
        setTeachers(t.filter((row) => enabled.has(row.class_id)));
        setChannels(ch);
      } catch {
        // degrades to the empty state on error
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) map.set(t.teacher_id, t.teacher_name);
    return map;
  }, [teachers]);

  const channelByTeacher = useMemo(() => {
    const map = new Map<string, DmChannel>();
    for (const ch of channels) map.set(`${ch.teacher_id}:${ch.class_id}`, ch);
    return map;
  }, [channels]);

  // Deep-link: once channels are loaded, open the requested one.
  useEffect(() => {
    if (!initialChannelId || activeChannel) return;
    const channel = channels.find((c) => c.id === initialChannelId);
    if (channel) {
      setActiveChannel(channel);
      setActiveTeacherName(teacherNameById.get(channel.teacher_id) ?? "Teacher");
    }
  }, [initialChannelId, channels, activeChannel, teacherNameById]);

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

  if (!loaded) {
    return <StateNote>Loading your messages…</StateNote>;
  }
  if (enabledClassIds.size === 0 || teachers.length === 0 || !meId) {
    return <StateNote>Messaging isn't available for your class yet.</StateNote>;
  }

  return (
    <div className="flex h-[min(60dvh,460px)] flex-col">
      {activeChannel ? (
        <>
          <button
            type="button"
            onClick={() => setActiveChannel(null)}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.7} />
            {activeTeacherName || "Back"}
          </button>
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
        </>
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
  );
}
