"""R43 — class-scoped curriculum (slice 2 of the class-first teacher hierarchy).

Owner decisions (docs/DECISIONS.md 2026-08-18): courses stay shared across classes with
visible "also used by" honesty (fork-on-demand comes later); the student catalog flips to
strict class-first — a classed student sees exactly the union of their classes' linked
courses (backfill for previously-unlinked classes preserves live behavior at the flip).

Pins:
- api.ts: strict `fetchStudentCatalogUncached` (no unlinked-class full-catalog inversion,
  no silent scoped→all fallback) + the shared `fetchClassCourseLinks` reader.
- The studio scopes its outline to the class's linked courses, auto-links a course it
  creates, annotates shared courses, and warns above the editor when edits reach peers.
- LinkedCoursesPanel is the controlled "Courses in this class" surface with strict copy
  and a guard against saving from an unknown baseline.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")
STUDIO = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
PANEL = (FRONTEND / "features" / "teacher" / "LinkedCoursesPanel.tsx").read_text(
    encoding="utf-8"
)
CONSOLE = (FRONTEND / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
PLATFORM = (ROOT / "docs" / "PLATFORM.md").read_text(encoding="utf-8")


class StrictStudentScopeTests(unittest.TestCase):
    def test_unlinked_class_no_longer_unlocks_the_full_catalog(self):
        # The pre-R43 inversion bailed out to the full list when ANY class had no links.
        self.assertNotIn("classesWithLinks", API)
        # …and the silent scoped→all fallback is gone too: empty means empty.
        self.assertNotIn("scoped.length ? scoped : all", API)

    def test_catalog_is_the_union_of_linked_courses(self):
        self.assertIn("const rows = await fetchClassCourseLinks(classIds);", API)
        self.assertIn(
            "linkedCourseIds.has(lesson.course_id)",
            API,
        )
        # Students with no classes and read errors keep the full list; the open lesson is
        # always retained.
        self.assertIn("if (!classIds.length) return all;", API)
        self.assertIn("pinnedLessonId != null && lesson.id === pinnedLessonId", API)

    def test_shared_links_reader_exists(self):
        self.assertIn("export async function fetchClassCourseLinks", API)
        self.assertIn('.select("class_id,course_id")', API)
        self.assertIn('.in("class_id", classIds)', API)


class ClassScopedStudioTests(unittest.TestCase):
    def test_outline_is_scoped_to_the_class_links(self):
        self.assertIn("const linkedCourseIds = useMemo", STUDIO)
        self.assertIn("classCoursesForSubject", STUDIO)
        # R45 flattened the outline to units — the class scoping now feeds classUnits.
        self.assertIn("units={outlineUnits}", STUDIO)
        # Links unknown (read failed) degrades to the unscoped tree, never a hidden one.
        self.assertIn("if (!classLinks) return null;", STUDIO)
        self.assertIn("!linkedCourseIds || linkedCourseIds.has(course.id)", STUDIO)

    def test_new_subjects_stay_visible_to_build_under(self):
        self.assertIn("coursesForSubject(subject.id).length === 0", STUDIO)

    def test_global_orgless_subjects_are_visible(self):
        # All of prod's published courses live under organization_id=NULL (global shared
        # content); hiding them would let a panel Save silently wipe links students rely on.
        self.assertIn("subject.organization_id === null", STUDIO)

    def test_created_course_auto_links_to_the_class(self):
        # R60: course creation lives in ensureBackingCourse (shared by "New unit" and the
        # course-from-material build) — the auto-link contract rides along.
        self.assertIn("Array.from(new Set([...mine, courseId]))", STUDIO)
        # Never write links from an unknown baseline (set_class_courses REPLACES the set).
        self.assertIn("if (links) {", STUDIO)
        self.assertIn("const ensureBackingCourse = async (", STUDIO)

    def test_shared_courses_are_visibly_shared(self):
        self.assertIn("peerClassNames", STUDIO)
        self.assertIn("also in ${peers.join", STUDIO)
        self.assertIn("This course is shared — changes here also reach", STUDIO)

    def test_panel_is_mounted_controlled_by_the_studio(self):
        self.assertIn("<LinkedCoursesPanel", STUDIO)
        self.assertIn("linked={linkedCourseIds}", STUDIO)
        self.assertIn("peerNames={peerClassNames}", STUDIO)
        self.assertNotIn("LinkedCoursesPanel", CONSOLE)


class CoursesPanelTests(unittest.TestCase):
    def test_panel_is_controlled_with_strict_copy(self):
        self.assertIn("linked: Set<string> | null;", PANEL)
        self.assertIn("Students see exactly the courses linked here", PANEL)
        self.assertNotIn("Leave everything unchecked", PANEL)
        self.assertNotIn("full published catalog", PANEL)

    def test_panel_refuses_to_save_from_unknown_baseline(self):
        self.assertIn("Editing is disabled so a", PANEL)
        self.assertIn("if (!linked) return false;", PANEL)

    def test_panel_shows_peer_classes_per_course(self):
        self.assertIn("peerNames(course.id)", PANEL)
        self.assertIn("also in {peers.join", PANEL)


class DocsTests(unittest.TestCase):
    def test_platform_doc_states_the_strict_rule(self):
        self.assertIn("strict class-first since R43", PLATFORM)
        self.assertIn("an unlinked class contributes nothing", PLATFORM)


if __name__ == "__main__":
    unittest.main()
