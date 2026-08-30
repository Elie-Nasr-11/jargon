/**
 * Class · Settings — the rare, real things.
 *
 * Rebuild brief, step 6. Four things a teacher does to a class perhaps once a term:
 * choose which courses it teaches, rename it, tidy its sections, archive it. None of
 * them belongs on a daily screen, which is why Settings is reached from the gear
 * beside the class name rather than from a pill that would sit there all year (Law 4).
 *
 * "Which courses this class teaches" arrives here from the Course screen's overflow
 * menu, where R80 parked it with a note saying it moves here when this screen exists.
 * It is the only control in the product that changes what students can see, so it
 * leads — and it says so.
 *
 * Every write is a class-teacher RLS write (see lib/api.ts): no admin token, no edge
 * function. Archiving is a status flip and removing a section only clears a label —
 * nothing on this screen deletes a class, a person, or a lesson.
 */
import { useMemo, useState } from "react";
import { Archive, BookMarked, Pencil, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LinkedCoursesPanel } from "@/features/teacher/settings/LinkedCoursesPanel";
import { sectionByStudent, sectionCounts } from "@/features/teacher/people/roster";
import { useCourseData } from "@/features/teacher/course/useCourseData";
import { renameClassSection, updateClassDetails } from "@/lib/api";
import type { TeacherDashboardData } from "@/lib/types";

function SettingsCard({
  icon,
  title,
  blurb,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-depth-card p-4 shadow-card">
      <div className="mb-1 flex items-center gap-2 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mb-3 text-meta leading-relaxed text-muted-foreground">{blurb}</p>
      {children}
    </section>
  );
}

export function ClassSettingsScreen({
  classId,
  className,
  dashboard,
  studentIds,
  onChanged,
}: {
  classId: string;
  className: string;
  dashboard: TeacherDashboardData;
  studentIds: string[];
  onChanged: () => void;
}) {
  const course = useCourseData(classId);

  const sections = useMemo(() => sectionByStudent(dashboard, classId), [dashboard, classId]);
  const counts = useMemo(() => sectionCounts(studentIds, sections), [studentIds, sections]);
  const sectionRows = useMemo(
    () => Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    [counts],
  );

  const [name, setName] = useState(className);
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busySection, setBusySection] = useState<string | null>(null);

  const nameDirty = name.trim() !== className && name.trim().length > 0;

  const saveName = async () => {
    setSavingName(true);
    setError(null);
    setStatus(null);
    try {
      await updateClassDetails({ classId, name: name.trim() });
      onChanged();
      setStatus("Class renamed.");
    } catch (problem) {
      setError((problem as Error).message || "Could not rename the class.");
    } finally {
      setSavingName(false);
    }
  };

  const editSection = async (from: string) => {
    const entered = window.prompt(`Rename section "${from}" to:`, from);
    if (entered === null) return;
    const to = entered.trim();
    if (!to || to === from) return;
    setBusySection(from);
    setError(null);
    setStatus(null);
    try {
      await renameClassSection({ classId, from, to });
      onChanged();
      setStatus(`Section "${from}" is now "${to}".`);
    } catch (problem) {
      setError((problem as Error).message || "Could not rename that section.");
    } finally {
      setBusySection(null);
    }
  };

  const clearSection = async (from: string) => {
    // Removing a section is one click that changes every student in it, so it asks —
    // the same courtesy the roster's remove gives, at the same stake.
    const count = counts.get(from) ?? 0;
    const ok = window.confirm(
      `Remove section "${from}"? Its ${count} student${count === 1 ? "" : "s"} stay in the class with no section.`,
    );
    if (!ok) return;
    setBusySection(from);
    setError(null);
    setStatus(null);
    try {
      await renameClassSection({ classId, from, to: null });
      onChanged();
      setStatus(`Section "${from}" removed — its students are still in the class.`);
    } catch (problem) {
      setError((problem as Error).message || "Could not remove that section.");
    } finally {
      setBusySection(null);
    }
  };

  const archive = async () => {
    setArchiving(true);
    setError(null);
    try {
      await updateClassDetails({ classId, status: "archived" });
      setArchiveOpen(false);
      onChanged();
    } catch (problem) {
      setError((problem as Error).message || "Could not archive the class.");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="panel-fade mt-4 grid gap-4">
      <h3 className="sr-only">Class settings</h3>
      {error ? <p className="text-meta text-danger">{error}</p> : null}
      {status ? <p className="text-meta text-success">{status}</p> : null}

      {/* First, because it is the only control here that changes what a STUDENT sees. */}
      <LinkedCoursesPanel
        classId={classId}
        courses={course.courseOptions}
        linked={course.linkedCourseIds}
        peerNames={course.peerClassNames}
        onSaved={() => void course.resync()}
      />

      <SettingsCard
        icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />}
        title="Class name"
        blurb="What this class is called everywhere — your sidebar, your students' class list, and the weekly digest."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Class name"
            className="jargon-input min-w-[220px] flex-1"
          />
          <button
            type="button"
            onClick={() => void saveName()}
            disabled={savingName || !nameDirty}
            className="btn btn-secondary btn-sm"
          >
            {savingName ? "Saving…" : "Save name"}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<Users className="h-3.5 w-3.5" strokeWidth={1.8} />}
        title="Sections"
        blurb="Groups within the class — 7A and 7B taught from the same course. A section is a label on each student, so renaming one moves everyone in it and removing one only clears the label."
      >
        {sectionRows.length ? (
          <div className="grid gap-1.5">
            {sectionRows.map(([label, count]) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-control border border-border bg-depth-field px-3 py-2 text-meta text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {count} student{count === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => void editSection(label)}
                  disabled={busySection === label}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void clearSection(label)}
                  disabled={busySection === label}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-meta text-muted-foreground">
            No sections — everyone in this class is in one group. Give a student a section from
            People to start one.
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        icon={<Archive className="h-3.5 w-3.5" strokeWidth={1.8} />}
        title="Archive"
        blurb="Closes the class at the end of a term. It leaves your list and your students' — nothing is deleted, and an admin can bring it back."
      >
        <button
          type="button"
          onClick={() => setArchiveOpen(true)}
          className="btn btn-danger btn-sm"
        >
          Archive this class
        </button>
      </SettingsCard>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Archive {className}?</DialogTitle>
          </DialogHeader>
          <p className="text-body text-muted-foreground">
            {studentIds.length} student{studentIds.length === 1 ? "" : "s"} will stop seeing this
            class and its lessons. Their work is kept, and an admin can make the class active again.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setArchiveOpen(false)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void archive()}
              disabled={archiving}
              className="btn btn-danger btn-sm"
            >
              {archiving ? "Archiving…" : "Archive"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
