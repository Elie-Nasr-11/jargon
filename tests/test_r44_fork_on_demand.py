"""R44 — fork-on-demand for shared courses (slice 3 of the class-first hierarchy).

Owner decision (docs/DECISIONS.md 2026-08-18): courses stay shared by default with
visible honesty; when a class needs to diverge, the teacher duplicates the course FOR
THAT CLASS. The copy is a go-forward split — student history stays on the originals.

Pins:
- curriculum-admin `duplicate_course`: registered, class-authorized, refuses foreign-org
  sources, copies the full teaching content, keeps idea/vocab keys for mastery/link
  continuity, org-owns the fork, and relinks insert-first (fail-open).
- api.ts `duplicateCourseForClass` wraps the action with a longer timeout.
- The studio's shared-course strip carries the "Duplicate for this class" action, and
  courses are org-filtered so one org's fork never surfaces in another org's studio.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FUNCTION = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
STUDIO = (ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text(
    encoding="utf-8"
)


class DuplicateCourseActionTests(unittest.TestCase):
    def test_action_is_registered_and_authorized(self):
        self.assertIn(
            'if (action === "duplicate_course") return await duplicateCourse(config, actorId, record);',
            FUNCTION,
        )
        body = FUNCTION.split("async function duplicateCourse")[1].split(
            "async function instantiateTemplate"
        )[0]
        self.assertIn("await assertCanAuthor(config, actorId, classOrgId, classId);", body)
        self.assertIn("Course organization does not match", body)
        self.assertIn("This class does not link that course.", body)

    def test_copy_covers_the_full_teaching_content(self):
        body = FUNCTION.split("async function duplicateCourse")[1].split(
            "async function instantiateTemplate"
        )[0]
        for table in (
            '"courses"',
            '"course_versions"',
            '"units"',
            '"lessons"',
            '"milestones"',
            '"lesson_activities"',
            '"quiz_items"',
            '"lesson_completion_rules"',
            '"lesson_resource_placements"',
            '"vocab_terms"',
            '"ideas"',
        ):
            with self.subTest(table=table):
                self.assertIn(table, body)
        # Two-phase milestone linking (the same FK dance as create_lesson_stub).
        self.assertIn("milestone_id: null", body)
        self.assertIn("milestone_id: newMilestoneId", body)
        # Fork provenance travels in curriculum_metadata.
        self.assertIn("metadata.forked_from_course", body)
        self.assertIn("metadata.forked_from_lesson", body)

    def test_fork_is_org_owned_and_relinks_fail_open(self):
        body = FUNCTION.split("async function duplicateCourse")[1].split(
            "async function instantiateTemplate"
        )[0]
        self.assertIn("organization_id: classOrgId", body)
        # Insert the new link BEFORE deleting the old one.
        insert_at = body.index("on_conflict=class_id,course_id")
        delete_at = body.index('method: "DELETE"')
        self.assertLess(insert_at, delete_at)

    def test_keys_are_preserved_for_continuity(self):
        body = FUNCTION.split("async function duplicateCourse")[1].split(
            "async function instantiateTemplate"
        )[0]
        # ideas/vocab copy via omitId + lesson remap only — key/term columns ride the
        # spread untouched, so mastery-by-key and key-based links keep working. (The
        # "keep their keys" statement lives in the doc comment above the function.)
        self.assertIn("keep their keys", FUNCTION)
        self.assertNotIn("key: fork", body)

    def test_bulk_insert_helper_exists(self):
        self.assertIn("async function bulkInsert", FUNCTION)


class ClientTests(unittest.TestCase):
    def test_api_wrapper(self):
        self.assertIn("export function duplicateCourseForClass", API)
        self.assertIn('action: "duplicate_course"', API)
        self.assertIn("60000", API.split("duplicateCourseForClass")[1][:600])


class StudioTests(unittest.TestCase):
    def test_shared_strip_carries_the_fork_action(self):
        self.assertIn("Duplicate for this class", STUDIO)
        self.assertIn("duplicateSharedCourse(sharedNotice.courseId)", STUDIO)
        self.assertIn("This class now edits its own copy", STUDIO)
        self.assertIn("Past student work stays with the original lessons.", STUDIO)

    def test_courses_are_org_filtered(self):
        self.assertIn(
            "course.organization_id === selectedClass?.organization_id",
            STUDIO,
        )


if __name__ == "__main__":
    unittest.main()
