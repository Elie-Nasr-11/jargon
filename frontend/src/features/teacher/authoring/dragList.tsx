/**
 * The drag surface both ordered lists share.
 *
 * The outline reorders units and lessons with it; the lesson editor reorders
 * steps with it. It owns only the drag choreography - who is over what, and
 * what the drop means - and hands the resulting order back to its caller.
 */
import { useState, type ReactNode } from "react";
import { reorderArray } from "@/features/teacher/authoring/localState";

export function ReorderList<T extends { id: string }>({
  items,
  onReorder,
  disabled,
  children,
}: {
  items: T[];
  onReorder: (orderedIds: string[]) => void;
  disabled?: boolean;
  children: (item: T, state: { dragging: boolean; over: boolean }) => ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = items.map((item) => item.id);

  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          className="min-w-0"
          draggable={!disabled}
          onDragStart={(event) => {
            if (disabled) return;
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            setDragId(item.id);
          }}
          onDragOver={(event) => {
            if (!dragId || dragId === item.id) return;
            event.preventDefault();
            event.stopPropagation();
            setOverId(item.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragId && dragId !== item.id) onReorder(reorderArray(ids, dragId, item.id));
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            setDragId(null);
            setOverId(null);
          }}
        >
          {children(item, { dragging: dragId === item.id, over: overId === item.id })}
        </div>
      ))}
    </>
  );
}

export function dropClass(state: { over: boolean }) {
  // min-w-0 lets nested rows shrink so their labels truncate instead of forcing width.
  return `min-w-0 ${state.over ? "rounded-lg ring-1 ring-foreground/40" : ""}`;
}
