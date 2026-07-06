import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import {
  COMMS_MINI_CHAT_FLAG,
  fetchCommsEnabledClassIds,
  fetchMaterialComments,
  fetchStudentClasses,
  getSession,
  postMaterialComment,
  softDeleteMaterialComment,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { notifyErr } from "@/lib/feedback";
import type { MaterialComment } from "@/lib/types";

// A class-scoped, 2-level comment thread under a lesson material. Rendered under the ResourceCard only
// when class communications are enabled for one of the student's classes; anchored to that class_id so
// comments never leak across classes (the RLS class_id gate enforces this on the wire). Teacher-side
// moderation is done from the class surfaces; here the author may retract their own comment.

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

export function MaterialComments({ resourceId }: { resourceId: string }) {
  const [meId, setMeId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [comments, setComments] = useState<MaterialComment[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [sending, setSending] = useState(false);

  // Resolve the class context: the first of the student's classes where communications are enabled.
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
        const anchor = classes.map((c) => c.id).find((id) => enabled.has(id)) || null;
        setClassId(anchor);
      } catch {
        // comments stay hidden on any error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the thread once a class anchor is known (cheap; drives the count without a live socket).
  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    fetchMaterialComments(resourceId, classId)
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resourceId, classId]);

  // Subscribe to live updates ONLY while the thread is open, to keep the realtime connection count
  // bounded (many resource cards can be on screen at once).
  useEffect(() => {
    if (!classId || !expanded) return;
    let cancelled = false;
    fetchMaterialComments(resourceId, classId)
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch(() => {});
    const channel = supabase
      .channel(`material-comments-${resourceId}-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "material_comments",
          filter: `resource_id=eq.${resourceId}`,
        },
        (payload) => {
          const row = payload.new as MaterialComment | null;
          if (!row?.id || row.class_id !== classId) return;
          setComments((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "material_comments",
          filter: `resource_id=eq.${resourceId}`,
        },
        (payload) => {
          const row = payload.new as MaterialComment | null;
          if (!row?.id) return;
          setComments((prev) => prev.map((c) => (c.id === row.id ? row : c)));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [resourceId, classId, expanded]);

  const visible = useMemo(
    () => comments.filter((c) => c.moderation_status === "visible" && !c.deleted_at),
    [comments],
  );
  const topLevel = useMemo(
    () =>
      visible.filter((c) => !c.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [visible],
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, MaterialComment[]>();
    for (const c of visible) {
      if (!c.parent_id) continue;
      const list = map.get(c.parent_id) || [];
      list.push(c);
      map.set(c.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return map;
  }, [visible]);

  const post = async (body: string, parentId: string | null) => {
    if (!classId || sending) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await postMaterialComment({ resourceId, classId, body: trimmed, parentId });
      if (parentId) {
        setReplyInput("");
        setReplyTo(null);
      } else {
        setInput("");
      }
    } catch (err) {
      notifyErr(err, "Couldn't post your comment.");
    } finally {
      setSending(false);
    }
  };

  const retract = async (id: string) => {
    try {
      await softDeleteMaterialComment(id);
    } catch (err) {
      notifyErr(err, "Couldn't delete the comment.");
    }
  };

  if (!classId || !meId) return null;

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.6} />
        {topLevel.length > 0 ? `Comments (${topLevel.length})` : "Add a comment"}
      </button>

      {expanded ? (
        <div className="mt-2 space-y-3">
          {topLevel.map((c) => (
            <div key={c.id} className="space-y-1.5">
              <CommentRow comment={c} mine={c.user_id === meId} onRetract={retract} />
              <div className="ml-4 space-y-1.5 border-l border-border/60 pl-3">
                {(repliesByParent.get(c.id) || []).map((r) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    mine={r.user_id === meId}
                    onRetract={retract}
                  />
                ))}
                {replyTo === c.id ? (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyInput}
                      onChange={(e) => setReplyInput(e.target.value)}
                      rows={1}
                      placeholder="Reply…"
                      className="max-h-20 min-h-8 flex-1 resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void post(replyInput, c.id)}
                      disabled={sending || !replyInput.trim()}
                      className="rounded-lg bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
                    >
                      Reply
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTo(c.id);
                      setReplyInput("");
                    }}
                    className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Reply
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={1}
              placeholder="Write a comment…"
              className="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void post(input, null)}
              disabled={sending || !input.trim()}
              className="rounded-lg bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground disabled:opacity-40"
            >
              Post
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommentRow({
  comment,
  mine,
  onRetract,
}: {
  comment: MaterialComment;
  mine: boolean;
  onRetract: (id: string) => void;
}) {
  return (
    <div className="group flex items-start justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] text-foreground">
        {comment.body}
        <span className="ml-2 text-[10.5px] text-muted-foreground">
          {timeAgo(comment.created_at)}
        </span>
      </p>
      {mine ? (
        <button
          type="button"
          onClick={() => onRetract(comment.id)}
          className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
