import { useEffect, useMemo, useState } from "react";
import { BookMarked } from "lucide-react";
import { fetchClassCourses, getSession, setClassCourses } from "@/lib/api";
import type { Lesson } from "@/lib/types";

// v4.0 Phase 3 — teacher control to scope a class to a set of courses (docs/PLATFORM.md
// class-scoping rule). Students in a class with ≥1 linked course see only those courses' lessons;
// an empty link set means no scoping (the full published catalog). Available courses are derived
// from the lessons already in the teacher's dashboard scope — no extra fetch. The write goes
// through curriculum-admin `set_class_courses` (auditable, re-checks author access server-side).
export function LinkedCoursesPanel({
  classId,
  lessons,
  onSaved,
}: {
  classId: string;
  lessons: Lesson[];
  onSaved?: (courseIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());

  // Course titles are derived from the lessons in dashboard scope. The render list is the union of
  // those courses AND any already-linked course id (so a course whose lessons aren't in scope — or
  // were deleted — still shows a checkbox and can be unchecked/removed; otherwise it would be stuck
  // linked and invisible, and "uncheck all" could never truly clear the scope).
  const availableCourses = useMemo(() => {
    const titleById = new Map<string, string>();
    for (const lesson of lessons) {
      if (lesson.course_id && !titleById.has(lesson.course_id)) {
        titleById.set(lesson.course_id, lesson.course_title || lesson.course_id);
      }
    }
    const ids = new Set<string>([...titleById.keys(), ...initial]);
    return Array.from(ids, (id) => ({ id, title: titleById.get(id) || id })).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [lessons, initial]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setStatus(null);
    fetchClassCourses(classId)
      .then((ids) => {
        if (!alive) return;
        setSelected(new Set(ids));
        setInitial(new Set(ids));
      })
      .catch((e) => {
        if (alive) setError((e as Error).message || "Could not load linked courses.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [classId]);

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  const toggle = (id: string) => {
    setStatus(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const session = await getSession();
      if (!session) throw new Error("Your session expired — sign in again.");
      const courseIds = Array.from(selected);
      await setClassCourses({ accessToken: session.access_token, classId, courseIds });
      setInitial(new Set(courseIds));
      onSaved?.(courseIds);
      setStatus(
        courseIds.length
          ? "Saved — students in this class now see only these courses."
          : "Saved — scoping cleared; students see the full catalog.",
      );
    } catch (e) {
      setError((e as Error).message || "Could not save linked courses.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5 rounded-3xl border border-border bg-depth-sub p-4">
      <div className="mb-1 flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
        <BookMarked className="h-3.5 w-3.5" strokeWidth={1.8} />
        Linked courses
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
        Choose which courses this class's students see in their lesson catalog. Leave everything
        unchecked to show the full published catalog.
      </p>
      {loading ? (
        <p className="text-[12.5px] text-muted-foreground">Loading…</p>
      ) : availableCourses.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          No published courses are available to link yet.
        </p>
      ) : (
        <div className="grid gap-1.5">
          {availableCourses.map((course) => (
            <label
              key={course.id}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-depth-field px-3 py-2 text-[12.5px] text-foreground"
            >
              <input
                type="checkbox"
                checked={selected.has(course.id)}
                onChange={() => toggle(course.id)}
                className="h-4 w-4 shrink-0 accent-foreground"
              />
              <span className="min-w-0 flex-1 truncate">{course.title}</span>
            </label>
          ))}
        </div>
      )}
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      {status ? <p className="mt-2 text-[12px] text-success">{status}</p> : null}
      {availableCourses.length ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-foreground hover:bg-muted disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save linked courses"}
          </button>
          <span className="text-[11.5px] text-muted-foreground">
            {selected.size ? `${selected.size} linked` : "No scoping (full catalog)"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
