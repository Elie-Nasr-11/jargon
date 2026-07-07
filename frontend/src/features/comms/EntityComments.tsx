import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import {
  fetchEntityComments,
  getSession,
  postEntityComment,
  softDeleteEntityComment,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { notifyErr } from "@/lib/feedback";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import type { EntityComment, EntityCommentType } from "@/lib/types";

// The v5 universal comment surface: a chip + inline 2-level thread on any learning entity
// (lesson row, assignment card, assessment card, grade row). The chip obeys the interaction law —
// with zero comments it is invisible until the surrounding `group` row is hovered/focused (always
// faintly visible on touch); with comments it always shows "· N". Clicking expands the thread in
// place (the MaterialComments pattern — a popover would clip inside the panel's scroll container).
// Visibility: [Class | Private] segmented toggle on new top-level comments; grade threads are
// ALWAYS private (enforced server-side; the toggle is hidden). Replies inherit the thread's
// visibility server-side. Replies under a hidden/deleted root never render (and the server rejects
// new ones).

let channelSeq = 0;

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

export function EntityComments({
  entityType,
  entityId,
  classId,
  initialCount = 0,
}: {
  entityType: EntityCommentType;
  entityId: string;
  classId: string;
  // From the surface's batched count fetch — the chip label before the thread is ever opened.
  initialCount?: number;
}) {
  const forcePrivate = entityType === "grade";
  const coarse = useCoarsePointer();
  const [meId, setMeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<EntityComment[] | null>(null);
  const [input, setInput] = useState("");
  const [visibility, setVisibility] = useState<"class_public" | "teacher_private">(
    forcePrivate ? "teacher_private" : "class_public",
  );
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then((s) => !cancelled && setMeId(s?.user?.id ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load + live-subscribe ONLY while open (many chips can be on screen; sockets stay bounded).
  // The channel name carries a per-subscription sequence — reusing the exact name of a channel
  // that is still tearing down (collapse → immediate re-expand) would join the dying instance.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    fetchEntityComments(entityType, entityId, classId)
      .then((rows) => !cancelled && setComments(rows))
      .catch(() => {});
    const channel = supabase
      .channel(`entity-comments-${entityType}-${entityId}-${classId}-${++channelSeq}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "entity_comments",
          filter: `entity_id=eq.${entityId}`,
        },
        (payload) => {
          const row = payload.new as EntityComment | null;
          if (!row?.id || row.class_id !== classId || row.entity_type !== entityType) return;
          setComments((prev) =>
            prev ? (prev.some((c) => c.id === row.id) ? prev : [...prev, row]) : prev,
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "entity_comments",
          filter: `entity_id=eq.${entityId}`,
        },
        (payload) => {
          const row = payload.new as EntityComment | null;
          if (!row?.id) return;
          setComments((prev) => prev?.map((c) => (c.id === row.id ? row : c)) ?? prev);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [expanded, entityType, entityId, classId]);

  const visible = useMemo(
    () => (comments ?? []).filter((c) => c.moderation_status === "visible" && !c.deleted_at),
    [comments],
  );
  const topLevel = useMemo(
    () =>
      visible.filter((c) => !c.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [visible],
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, EntityComment[]>();
    for (const c of visible) {
      if (!c.parent_id) continue;
      const list = map.get(c.parent_id) || [];
      list.push(c);
      map.set(c.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return map;
  }, [visible]);

  const count = comments === null ? initialCount : topLevel.length;

  const post = async (body: string, parentId: string | null) => {
    if (sending) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await postEntityComment({
        entityType,
        entityId,
        classId,
        body: trimmed,
        // Replies inherit the thread's visibility server-side; only top-level comments choose.
        visibility: parentId ? undefined : forcePrivate ? "teacher_private" : visibility,
        parentId,
      });
      if (parentId) {
        setReplyInput("");
        setReplyTo(null);
      } else {
        setInput("");
      }
      // Refetch rather than trust realtime alone — the socket can lag or miss the own-insert.
      void fetchEntityComments(entityType, entityId, classId)
        .then((rows) => setComments(rows))
        .catch(() => {});
    } catch (err) {
      notifyErr(err, "Couldn't post your comment.");
    } finally {
      setSending(false);
    }
  };

  const retract = async (id: string) => {
    try {
      await softDeleteEntityComment(id);
      // Update locally: the author's own SELECT policy excludes deleted rows, so the realtime
      // UPDATE event never reaches them — without this the retract looks like a no-op.
      setComments(
        (prev) =>
          prev?.map((c) => (c.id === id ? { ...c, deleted_at: new Date().toISOString() } : c)) ??
          prev,
      );
    } catch (err) {
      notifyErr(err, "Couldn't delete the comment.");
    }
  };

  if (!meId) return null;

  // Rendered as a FRAGMENT: the chip sits inline at the end of the consumer's `group flex
  // flex-wrap` row; the expanded thread is a w-full sibling that wraps onto its own line.
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={
          count > 0
            ? `Comments on this ${entityType} — ${count}`
            : `Add a comment on this ${entityType}`
        }
        className={`inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-meta text-muted-foreground transition-[color,opacity,background-color] duration-(--dur-fast) hover:bg-muted hover:text-foreground focus-visible:opacity-100 ${
          count > 0 || expanded
            ? ""
            : coarse
              ? "opacity-60"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        <MessageSquare className="h-3 w-3" strokeWidth={1.6} />
        {count > 0 ? `· ${count}` : "Comment"}
      </button>

      {expanded ? (
        <div className="mt-2 w-full space-y-3">
          {comments === null ? (
            <p className="text-meta text-muted-foreground">Loading…</p>
          ) : (
            topLevel.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <ThreadRow
                  comment={c}
                  mine={c.user_id === meId}
                  coarse={coarse}
                  onRetract={retract}
                />
                <div className="ml-4 space-y-1.5 border-l border-border/60 pl-3">
                  {(repliesByParent.get(c.id) || []).map((r) => (
                    <ThreadRow
                      key={r.id}
                      comment={r}
                      mine={r.user_id === meId}
                      coarse={coarse}
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
                        className="max-h-20 min-h-8 flex-1 resize-none rounded-control border border-border bg-background px-2 py-1.5 text-meta outline-none focus:border-foreground/40"
                      />
                      <button
                        type="button"
                        onClick={() => void post(replyInput, c.id)}
                        disabled={sending || !replyInput.trim()}
                        className="rounded-control bg-primary px-2.5 py-1.5 text-meta font-medium text-primary-foreground disabled:opacity-40"
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
                      className="text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
                    >
                      Reply
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          <div>
            {!forcePrivate ? (
              <div
                role="radiogroup"
                aria-label="Who can see this comment"
                className="mb-1.5 inline-flex rounded-pill border border-border p-0.5"
              >
                {(
                  [
                    ["class_public", "Class"],
                    ["teacher_private", "Private"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={visibility === value}
                    onClick={() => setVisibility(value)}
                    title={
                      value === "class_public"
                        ? "Visible to everyone in your class"
                        : "Visible only to you and your teacher"
                    }
                    className={`rounded-pill px-2.5 py-0.5 text-meta font-medium transition-colors duration-(--dur-fast) ${
                      visibility === value
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mb-1.5 text-meta text-muted-foreground">
                Only you and your teacher can see grade comments.
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={1}
                placeholder={
                  forcePrivate || visibility === "teacher_private"
                    ? "Write a private comment…"
                    : "Write a comment…"
                }
                className="max-h-24 min-h-9 flex-1 resize-none rounded-control border border-border bg-background px-2.5 py-2 text-meta outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                onClick={() => void post(input, null)}
                disabled={sending || !input.trim()}
                className="rounded-control bg-primary px-3 py-2 text-meta font-medium text-primary-foreground disabled:opacity-40"
              >
                Post
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ThreadRow({
  comment,
  mine,
  coarse,
  onRetract,
}: {
  comment: EntityComment;
  mine: boolean;
  coarse: boolean;
  onRetract: (id: string) => void;
}) {
  return (
    <div className="group/row flex items-start justify-between gap-2 rounded-control bg-muted/50 px-2.5 py-1.5">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-meta text-foreground">
        {comment.body}
        <span className="ml-2 text-[10.5px] text-muted-foreground">
          {timeAgo(comment.created_at)}
          {comment.visibility === "teacher_private" ? " · Private" : ""}
        </span>
      </p>
      {mine ? (
        <button
          type="button"
          onClick={() => onRetract(comment.id)}
          className={`mt-0.5 shrink-0 text-muted-foreground transition-opacity duration-(--dur-fast) hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 ${
            coarse ? "opacity-60" : "opacity-0"
          }`}
          title="Delete"
          aria-label="Delete comment"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
