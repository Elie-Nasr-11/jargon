/**
 * "Courses in this class" — the class's course links.
 *
 * The only control in the product that changes what a student can SEE: students in
 * this class see exactly the linked courses' published lessons, and nothing is implied
 * by an empty set except "nothing yet". It replaces the class's whole link set on save,
 * which is why an unreadable baseline disables editing rather than guessing.
 */
import { useEffect, useMemo, useState } from "react";
import { BookMarked } from "lucide-react";
import { getSession, setClassCourses } from "@/lib/api";

// R43 "Courses in this class" — the single management surface for a class's course links.
// R83 moved it to Class · Settings, the screen the rebuild brief gives it: this is the only
// control in the product that changes what a student can see, and it does not belong in an
// overflow menu on the outline it happens to scope.
// Semantics are strict class-first: students in the class see exactly the linked
// courses' published lessons; nothing is implied by an empty set except "nothing yet".
// The write goes through curriculum-admin `set_class_courses` (auditable, re-checks author
// access server-side) and REPLACES the class's whole link set.
export function LinkedCoursesPanel({
  classId,
  courses,
  linked,
  peerNames,
  onSaved,
}: {
  classId: string;
  courses: Array<{ id: string; title: string; subjectTitle: string }>;
  // The saved link set. null = links could not be loaded — editing is disabled, because a
  // save from an unknown baseline would silently wipe links.
  linked: Set<string> | null;
  peerNames: (courseId: string) => string[];
  onSaved: (courseIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(linked ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Class switch → full reset. Kept separate from the linked-set resync below: a save
  // updates `linked` through onSaved, and clearing status there would wipe the success
  // message the moment it appeared.
  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [classId]);

  // Resync the draft whenever the saved set changes (a panel save, or the studio
  // auto-linking a course it just created).
  useEffect(() => {
    setSelected(new Set(linked ?? []));
  }, [classId, linked]);

  // Group by subject so long org catalogs stay scannable.
  const groups = useMemo(() => {
    const bySubject = new Map<string, Array<{ id: string; title: string }>>();
    for (const course of courses) {
      const list = bySubject.get(course.subjectTitle) ?? [];
      list.push({ id: course.id, title: course.title });
      bySubject.set(course.subjectTitle, list);
    }
    return Array.from(bySubject.entries())
      .map(([subject, list]) => ({
        subject,
        courses: list.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }, [courses]);

  const dirty = useMemo(() => {
    if (!linked) return false;
    if (selected.size !== linked.size) return true;
    for (const id of selected) if (!linked.has(id)) return true;
    return false;
  }, [selected, linked]);

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
      onSaved(courseIds);
      setStatus(
        courseIds.length
          ? "Saved — this is now the class's curriculum; students see exactly these courses."
          : "Saved — no courses linked; students in this class see no lessons until you link or create one.",
      );
    } catch (e) {
      setError((e as Error).message || "Could not save the class's courses.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
      <div className="mb-1 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        <BookMarked className="h-3.5 w-3.5" strokeWidth={1.8} />
        Courses in this class
      </div>
      <p className="mb-3 text-meta leading-relaxed text-muted-foreground">
        Students see exactly the courses linked here, and the class's Course screen shows the same
        set. A course can be shared by several classes; edits reach them all.
      </p>
      {!linked ? (
        <p className="text-meta text-muted-foreground">
          Couldn't load this class's course links — refresh to try again. (Editing is disabled so a
          save can't wipe links you can't see.)
        </p>
      ) : courses.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          No courses exist yet — create a subject and course in the outline above.
        </p>
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => (
            <div key={group.subject}>
              <div className="mb-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {group.subject}
              </div>
              <div className="grid gap-1.5">
                {group.courses.map((course) => {
                  const peers = peerNames(course.id);
                  return (
                    <label
                      key={course.id}
                      className="flex items-center gap-2.5 rounded-control border border-border bg-depth-field px-3 py-2 text-meta text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(course.id)}
                        onChange={() => toggle(course.id)}
                        className="h-4 w-4 shrink-0 accent-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">{course.title}</span>
                      {peers.length ? (
                        <span className="shrink-0 text-meta text-muted-foreground">
                          also in {peers.join(", ")}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {error ? <p className="mt-2 text-meta text-danger">{error}</p> : null}
      {status ? <p className="mt-2 text-meta text-success">{status}</p> : null}
      {linked && courses.length ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn btn-secondary btn-sm"
          >
            {saving ? "Saving…" : "Save courses"}
          </button>
          <span className="text-meta text-muted-foreground">
            {selected.size
              ? `${selected.size} in this class`
              : "Nothing linked — students see no lessons"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
