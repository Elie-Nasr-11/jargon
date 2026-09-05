"""R71 — the weekly evidence digest.

Jargon is sold on one line: "the book never told you who's stuck — this one
does." That promise is only real if the teacher is TOLD, on a rhythm, without
going looking. The hotlist answers "who needs me right now"; the progress
report answers "how is this child doing, for their parents". Neither answers
the question a teacher carries into Monday: what did my class learn last week,
and what do I need to teach again?

The law, pinned here:
- read-only and computed on demand — no new table, no scheduled job, nothing to
  migrate; a window over evidence already recorded;
- teacher-scoped through class_memberships (NOT admin access), same posture as
  the teacher snapshot export;
- honest reporting is the whole point: a skill reaches "teach again" only when
  TWO OR MORE students missed it, so one child's bad afternoon is never shown to
  a teacher as a class-wide gap; and study minutes count only gaps under ten
  minutes, so the number under-states rather than flatters;
- silence is reported: every enrolled student with zero turns in the window is
  named, which is the signal no live dashboard shows.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import console_source


ROOT = Path(__file__).resolve().parents[1]
OPS = (ROOT / "supabase" / "functions" / "admin-ops" / "index.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
CARD = (ROOT / "frontend" / "src" / "features" / "teacher" / "ClassDigestCard.tsx").read_text(encoding="utf-8")
CONSOLE = console_source()


class HonestReportingTests(unittest.TestCase):
    def test_reteach_needs_two_students(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn("students.size >= 2", body)

    def test_study_minutes_under_state_rather_than_flatter(self):
        body = OPS.split("function studyMinutes(", 1)[1].split("\n}", 1)[0]
        # Only gaps inside a sitting count; a long gap is a break, not study.
        self.assertIn("gap <= 10 * 60 * 1000", body)
        self.assertIn("if (timestamps.length < 2) return 0;", body)

    def test_silence_is_reported(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn("stalled: rows.filter((row) => row.turns === 0)", body)

    def test_resolved_misconceptions_do_not_count(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn('if (cleanText(row.status) === "resolved") continue;', body)

    def test_only_failed_evidence_counts_as_a_miss(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn("if (!Number.isFinite(score) || score >= 0.5) continue;", body)


class ClassScopingTests(unittest.TestCase):
    """Found against production data while building this: students here are enrolled
    in six classes each, and counting a student's turns without scoping to THIS
    class's lessons showed every class the same 111 turns — a biology teacher would
    have been shown maths work as their own class's progress."""

    def test_the_digest_only_counts_this_class_lessons(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn("const turns = allTurns.filter((row) => inThisClass(row.lesson_id));", body)
        self.assertIn("const sessions = allSessions.filter((row) => inThisClass(row.lesson_id));", body)
        self.assertIn("const evidence = allEvidence.filter((row) => inThisClass(row.lesson_id));", body)

    def test_lesson_scope_walks_the_real_curriculum_path(self):
        body = OPS.split("async function classLessonIds(", 1)[1].split("\nasync function", 1)[0]
        for table in ("class_courses?", "course_versions?", "units?", "lessons?"):
            self.assertIn(table, body)

    def test_a_class_with_no_course_says_so(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn("no_curriculum: studentIds.length > 0 && lessonIds.size === 0", body)


class ScopeAndSafetyTests(unittest.TestCase):
    def test_teacher_scoped_not_admin_scoped(self):
        body = OPS.split("async function handleTeacherClassDigest(", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("const teacherClassIds = await fetchTeacherClassIds(config, actorId);", body)
        self.assertIn('if (!teacherClassIds.includes(classId)) throw new Error("You do not teach this class.");', body)

    def test_the_digest_never_writes(self):
        body = OPS.split("async function buildClassDigest(", 1)[1].split("\nasync function", 1)[0]
        for writer in ("insertRow(", "patchRows(", "upsertByConflict(", "deleteRows("):
            self.assertNotIn(writer, body)

    def test_window_is_bounded(self):
        body = OPS.split("function digestWindow(", 1)[1].split("\n}", 1)[0]
        self.assertIn("rawDays >= 1 && rawDays <= 60", body)
        # Anything outside the clamp falls back to a week, never to "everything".
        self.assertIn("Math.floor(rawDays) : 7", " ".join(body.split()))

    def test_action_is_dispatched(self):
        self.assertIn('if (action === "teacher_class_digest")', OPS)
        self.assertIn("return await handleTeacherClassDigest(config, actorId, record);", OPS)


class ClientTests(unittest.TestCase):
    def test_action_and_types_exist(self):
        self.assertIn('| "teacher_class_digest"', TYPES)
        self.assertIn("export type ClassDigest = {", TYPES)
        self.assertIn("export async function fetchClassDigest(input: {", API)

    def test_card_renders_the_teachers_question(self):
        self.assertIn("Worth teaching again", CARD)
        self.assertIn("Nothing at all", CARD)
        self.assertIn("Moving well", CARD)

    def test_card_leads_the_landing_room(self):
        # R73 put it at the top of Students, the room a teacher landed in. R81 built
        # Today as the landing, and the digest is the first thing on it.
        self.assertIn("<ClassDigestCard classId={classId} />", CONSOLE)
        today = CONSOLE.split("export function TodayScreen(", 1)[1]
        self.assertLess(today.index("<ClassDigestCard"), today.index("In a lesson now"))


if __name__ == "__main__":
    unittest.main()
