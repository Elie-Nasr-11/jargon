/**
 * Class · People — the roster.
 *
 * Rebuild brief, step 6. Three questions and nothing else: who is in this class,
 * what section are they in, and how is each of them doing. Two actions: add
 * someone from the school directory, and remove someone from this class.
 *
 * It NEVER creates or deletes an account. Adding picks from students the school
 * already registered; removing marks this one membership 'removed' and leaves the
 * person, their evidence and their other classes alone. Accounts are made in one
 * place — the school directory in admin — and this screen says so out loud.
 */
import { useMemo, useState } from "react";
import { UserMinus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayName } from "@/features/teacher/classShared";
import { GradebookTable } from "@/features/teacher/console/GradebookTable";
import {
  gradeChipLabel,
  gradeSummariesForClass,
  studentContextLine,
} from "@/features/teacher/console/derive";
import { sectionByStudent, sectionGroups, sectionNames } from "@/features/teacher/people/roster";
import type { LearningSession, Lesson, Profile, TeacherDashboardData } from "@/lib/types";

export function PeopleScreen({
  classId,
  dashboard,
  profilesById,
  lessons,
  lessonsById,
  studentIds,
  selectedLessonId,
  selectedStudentId,
  onSelectLesson,
  onSelectStudent,
  onSetSection,
  onListEnrollable,
  onEnroll,
  onRemove,
}: {
  classId: string;
  dashboard: TeacherDashboardData;
  profilesById: Map<string, Profile>;
  lessons: Lesson[];
  lessonsById: Map<string, Lesson>;
  studentIds: string[];
  selectedLessonId: string;
  selectedStudentId: string | null;
  onSelectLesson: (lessonId: string) => void;
  onSelectStudent: (studentId: string) => void;
  onSetSection: (studentId: string, section: string | null) => Promise<void>;
  onListEnrollable: () => Promise<Array<{ user_id: string; name: string; grade: string | null }>>;
  onEnroll: (userIds: string[], section: string | null) => Promise<void>;
  onRemove: (studentId: string) => Promise<void>;
}) {
  // Roster = the people. Gradebook = the same people, scored across every lesson.
  // Both answer "how each is doing"; the toggle picks the grain, not a different room.
  const [view, setView] = useState<"roster" | "gradebook">("roster");
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => sectionByStudent(dashboard, classId), [dashboard, classId]);
  const names = useMemo(() => sectionNames(sections), [sections]);
  const groups = useMemo(() => sectionGroups(studentIds, sections), [studentIds, sections]);
  const gradeSummaries = useMemo(
    () => gradeSummariesForClass(dashboard, classId),
    [dashboard, classId],
  );
  const liveByStudent = useMemo(() => {
    const map = new Map<string, LearningSession>();
    for (const session of dashboard.sessions) {
      if (session.status === "complete") continue;
      const existing = map.get(session.user_id);
      if (!existing || session.updated_at > existing.updated_at) map.set(session.user_id, session);
    }
    return map;
  }, [dashboard.sessions]);
  const nowMs = Date.now();

  // --- add from the school directory -------------------------------------------------
  const [addOpen, setAddOpen] = useState(false);
  const [addable, setAddable] = useState<Array<{
    user_id: string;
    name: string;
    grade: string | null;
  }> | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [addSection, setAddSection] = useState("");
  const [adding, setAdding] = useState(false);

  const openAdd = () => {
    setAddOpen(true);
    setAddable(null);
    setChecked(new Set());
    setError(null);
    void onListEnrollable()
      .then(setAddable)
      .catch((problem) => {
        setAddable([]);
        setError((problem as Error).message || "Could not load the school's students.");
      });
  };

  const submitAdd = async () => {
    if (!checked.size) return;
    setAdding(true);
    setError(null);
    try {
      await onEnroll(Array.from(checked), addSection.trim() || null);
      setAddOpen(false);
    } catch (problem) {
      setError((problem as Error).message || "Could not add those students.");
    } finally {
      setAdding(false);
    }
  };

  // --- remove from this class ---------------------------------------------------------
  // Confirmed by name, because the row it acts on is a person and the teacher should see
  // which one before it happens.
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const submitRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    setError(null);
    try {
      await onRemove(removing);
      setRemoving(null);
    } catch (problem) {
      setError((problem as Error).message || "Could not remove that student.");
    } finally {
      setRemoveBusy(false);
    }
  };

  const changeSection = async (studentId: string, value: string) => {
    let next: string | null = value || null;
    if (value === "__new__") {
      const entered = window.prompt("New section name (e.g. 7A)");
      if (entered === null) return;
      next = entered.trim() || null;
    }
    setError(null);
    try {
      await onSetSection(studentId, next);
    } catch (problem) {
      setError((problem as Error).message || "Could not change that section.");
    }
  };

  return (
    <div className="panel-fade mt-4">
      <h3 className="sr-only">People</h3>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-meta text-muted-foreground">
          {studentIds.length} student{studentIds.length === 1 ? "" : "s"}
          {names.length ? ` · sections ${names.join(" · ")}` : ""}
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full border border-border p-0.5">
            {(["roster", "gradebook"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-full px-3 py-1 text-meta transition-colors ${
                  view === option
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "roster" ? "Roster" : "Gradebook"}
              </button>
            ))}
          </div>
          {/* The brief's words, and the honest ones: this picks from people the school
              already registered. It is not a "+ Add student" that might make one. */}
          <button type="button" onClick={openAdd} className="btn btn-secondary btn-sm">
            Add from the school directory
          </button>
        </div>
      </div>
      {error ? <p className="mb-2 text-meta text-danger">{error}</p> : null}

      {view === "gradebook" ? (
        <GradebookTable
          lessons={lessons}
          lessonsById={lessonsById}
          studentIds={studentIds}
          dashboard={dashboard}
          profilesById={profilesById}
          selectedLessonId={selectedLessonId}
          selectedStudentId={selectedStudentId}
          onSelectLesson={onSelectLesson}
          onSelectStudent={onSelectStudent}
        />
      ) : (
        <div className="grid gap-4">
          {groups.length ? (
            groups.map((group) => (
              <div key={group.label ?? "__none__"}>
                {groups.length > 1 || group.label ? (
                  <div className="mb-1.5 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {group.label ? `Section ${group.label}` : "No section"} ·{" "}
                    {group.students.length}
                  </div>
                ) : null}
                <div className="grid gap-3">
                  {group.students.map((studentId) => {
                    const profile = profilesById.get(studentId) || null;
                    return (
                      <div
                        key={studentId}
                        className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card border py-2 pl-4 pr-2 transition-colors ${
                          selectedStudentId === studentId
                            ? "border-primary/45 bg-depth-card"
                            : "border-border bg-depth-sub"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectStudent(studentId)}
                          className="flex min-w-0 flex-1 basis-full items-center gap-3 py-1 text-left transition-colors hover:opacity-80 sm:basis-auto"
                        >
                          {liveByStudent.has(studentId) ? (
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                            </span>
                          ) : (
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-border" />
                          )}
                          <span className="min-w-0 truncate text-body font-medium text-foreground sm:min-w-[140px] sm:shrink-0">
                            {displayName(profile, studentId)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                            {studentContextLine(
                              profile,
                              dashboard.sessions,
                              studentId,
                              lessonsById,
                              nowMs,
                            )}
                          </span>
                          <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-meta text-muted-foreground">
                            {gradeChipLabel(gradeSummaries.get(studentId))}
                          </span>
                        </button>
                        <label className="flex shrink-0 items-center max-sm:ml-[22px]">
                          <span className="sr-only">
                            Section for {displayName(profile, studentId)}
                          </span>
                          <select
                            value={sections.get(studentId) ?? ""}
                            onChange={(event) => void changeSection(studentId, event.target.value)}
                            className="jargon-input !w-auto"
                          >
                            <option value="">No section</option>
                            {names.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                            <option value="__new__">New section…</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => setRemoving(studentId)}
                          aria-label={`Remove ${displayName(profile, studentId)} from this class`}
                          title="Remove from this class"
                          className="shrink-0 rounded-control p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-danger"
                        >
                          <UserMinus className="h-4 w-4" strokeWidth={1.7} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-card border border-border bg-depth-sub p-5 text-body text-muted-foreground">
              Nobody is in this class yet. Add students your school has already registered, and
              group them into sections if you teach them separately.
            </div>
          )}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add from the school directory</DialogTitle>
          </DialogHeader>
          <p className="text-meta text-muted-foreground">
            These are the students your school has registered. New accounts are created by your
            admin, never here.
          </p>
          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Section (optional)
            <input
              value={addSection}
              onChange={(event) => setAddSection(event.target.value)}
              placeholder="e.g. 7A"
              className="jargon-input normal-case tracking-normal"
            />
          </label>
          {addable === null ? (
            <p className="text-meta text-muted-foreground">Loading students…</p>
          ) : addable.length === 0 ? (
            <p className="text-meta text-muted-foreground">
              Every registered student is already in this class.
            </p>
          ) : (
            <div className="grid max-h-[300px] gap-1.5 overflow-y-auto">
              {addable.map((student) => (
                <label
                  key={student.user_id}
                  className="flex items-center gap-2.5 rounded-control border border-border bg-depth-field px-3 py-2 text-meta text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(student.user_id)}
                    onChange={() =>
                      setChecked((current) => {
                        const next = new Set(current);
                        if (next.has(student.user_id)) next.delete(student.user_id);
                        else next.add(student.user_id);
                        return next;
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{student.name}</span>
                  {student.grade ? (
                    <span className="shrink-0 text-muted-foreground">{student.grade}</span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitAdd()}
              disabled={adding || !checked.size}
              className="btn btn-primary btn-sm"
            >
              {adding ? "Adding…" : `Add ${checked.size || ""}`.trim()}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Remove from this class?</DialogTitle>
          </DialogHeader>
          <p className="text-body text-muted-foreground">
            {removing
              ? `${displayName(profilesById.get(removing) || null, removing)} will no longer see this class or its lessons.`
              : ""}{" "}
            Their account and their work are kept, and your admin can add them back.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setRemoving(null)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitRemove()}
              disabled={removeBusy}
              className="btn btn-danger btn-sm"
            >
              {removeBusy ? "Removing…" : "Remove"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
