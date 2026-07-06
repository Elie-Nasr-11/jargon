import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { DmThread } from "@/features/comms/DmThread";
import {
  COMMS_MINI_CHAT_FLAG,
  fetchCommsEnabledClassIds,
  getSession,
  openDmChannel,
  setCommsFlag,
} from "@/lib/api";
import { notifyErr } from "@/lib/feedback";
import type { DmChannel } from "@/lib/types";

// The teacher's side of the 1:1 mini-chat, mounted as a tab in the student-detail view. The teacher is
// a class teacher (RLS + is_dm_pair validate), so opening the channel is allowed; canModerate exposes
// the hide/unhide controls. Nothing renders (gracefully) if the pairing is not permitted.

export function TeacherStudentMessages({
  studentId,
  classId,
  classLabel,
}: {
  studentId: string;
  classId: string | null;
  classLabel: string;
}) {
  const [meId, setMeId] = useState<string | null>(null);
  const [channel, setChannel] = useState<DmChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentEnabled, setStudentEnabled] = useState(false);
  const [togglingFlag, setTogglingFlag] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setChannel(null);
    void (async () => {
      try {
        const session = await getSession();
        const uid = session?.user?.id;
        if (!uid || !classId || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        setMeId(uid);
        const [ch, enabled] = await Promise.all([
          openDmChannel(studentId, uid, classId),
          fetchCommsEnabledClassIds([classId], COMMS_MINI_CHAT_FLAG),
        ]);
        if (cancelled) return;
        setChannel(ch);
        setStudentEnabled(enabled.has(classId));
      } catch (err) {
        if (!cancelled) notifyErr(err, "Couldn't open messages.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, classId]);

  const toggleStudentMessaging = async () => {
    if (!classId || togglingFlag) return;
    setTogglingFlag(true);
    const next = !studentEnabled;
    try {
      await setCommsFlag(classId, null, COMMS_MINI_CHAT_FLAG, next);
      setStudentEnabled(next);
    } catch (err) {
      notifyErr(err, "Couldn't update the messaging setting.");
    } finally {
      setTogglingFlag(false);
    }
  };

  if (!classId) {
    return (
      <p className="mt-5 rounded-2xl border border-border bg-muted/40 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
        Open this student from within a class to message them.
      </p>
    );
  }

  return (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
          <MessagesSquare className="h-4 w-4" strokeWidth={1.6} />
          Direct messages · {classLabel}
        </div>
        <button
          type="button"
          onClick={() => void toggleStudentMessaging()}
          disabled={togglingFlag}
          className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          title="Controls whether students in this class can open the messaging panel"
        >
          Student messaging: {studentEnabled ? "On" : "Off"}
        </button>
      </div>
      {!studentEnabled ? (
        <p className="mb-2 text-[11.5px] text-muted-foreground">
          You can message this student, but they can only reply once student messaging is On for the
          class.
        </p>
      ) : null}
      <div className="h-[min(60vh,460px)] rounded-2xl border border-border bg-background/60 p-2">
        {loading ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">Loading…</p>
        ) : channel && meId ? (
          <DmThread
            channelId={channel.id}
            meId={meId}
            canModerate
            disabled={channel.status !== "open"}
          />
        ) : (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">
            Messaging isn't available for this student.
          </p>
        )}
      </div>
    </div>
  );
}
