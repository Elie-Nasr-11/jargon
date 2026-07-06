import { useEffect, useRef, useState } from "react";
import { EyeOff, Eye, Trash2 } from "lucide-react";
import { fetchDmMessages, sendDmMessage, setDmMessageHidden, softDeleteDmMessage } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { notifyErr } from "@/lib/feedback";
import type { DmMessage } from "@/lib/types";

// A single 1:1 message thread, reused by the student mini-chat popover and the teacher Messages tab.
// Client-direct reads/writes under the hardened RLS; realtime keeps it live. canModerate exposes the
// teacher hide/unhide controls (RLS still enforces who may actually moderate).

function timeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function DmThread({
  channelId,
  meId,
  canModerate = false,
  disabled = false,
  disabledNote,
}: {
  channelId: string;
  meId: string;
  canModerate?: boolean;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDmMessages(channelId)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {});
    const channel = supabase
      .channel(`dm-thread-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const row = payload.new as DmMessage | null;
          if (!row?.id) return;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dm_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const row = payload.new as DmMessage | null;
          if (!row?.id) return;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [channelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const visibleMessages = messages.filter((m) => {
    // The teacher sees hidden/retracted rows (moderation + audit); everyone else only live rows. RLS
    // already enforces this on the wire — this is a defensive client filter for the moderator view.
    if (canModerate) return true;
    return m.moderation_status === "visible" && !m.deleted_at;
  });

  const send = async () => {
    const body = input.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await sendDmMessage(channelId, body);
      setInput("");
    } catch (err) {
      notifyErr(err, "Couldn't send your message.");
    } finally {
      setSending(false);
    }
  };

  const toggleHide = async (m: DmMessage) => {
    try {
      await setDmMessageHidden(m.id, m.moderation_status !== "hidden");
    } catch (err) {
      notifyErr(err, "Couldn't update the message.");
    }
  };

  const retract = async (m: DmMessage) => {
    try {
      await softDeleteDmMessage(m.id);
    } catch (err) {
      notifyErr(err, "Couldn't delete the message.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-1">
        {visibleMessages.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-muted-foreground">
            No messages yet. Say hello.
          </p>
        ) : (
          visibleMessages.map((m) => {
            const mine = m.sender_id === meId;
            const hidden = m.moderation_status === "hidden";
            const retracted = Boolean(m.deleted_at);
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className="group max-w-[80%]">
                  <div
                    className={`rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-muted text-foreground"
                    } ${hidden || retracted ? "opacity-60" : ""}`}
                  >
                    {retracted ? <span className="italic">(retracted) </span> : null}
                    {hidden ? <span className="italic">(hidden) </span> : null}
                    <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
                    <span>{timeLabel(m.created_at)}</span>
                    {mine && !retracted ? (
                      <button
                        type="button"
                        onClick={() => retract(m)}
                        className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        title="Delete for everyone"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                    {canModerate ? (
                      <button
                        type="button"
                        onClick={() => toggleHide(m)}
                        className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        title={hidden ? "Unhide" : "Hide from student"}
                      >
                        {hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {disabled ? (
        <p className="border-t border-border px-2 py-2 text-center text-[12px] text-muted-foreground">
          {disabledNote || "This conversation is closed."}
        </p>
      ) : (
        <div className="flex items-end gap-2 border-t border-border p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Write a message…"
            className="max-h-24 min-h-9 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="rounded-xl bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
