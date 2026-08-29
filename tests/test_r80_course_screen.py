"""R80 — the Course screen, built new (rebuild brief, step 4).

Owner: "go for step 4 please", against the brief's own step 4 — "Build Course
new. Outline only, one Add per level, review banner." Deletes: the books panel,
the builder panels, the drawer.

What the brief asked for, and what is pinned here:
- THE OUTLINE IS THE SCREEN. Units → lessons, and nothing standing beside it.
  Every lesson row states itself ("draft · 6 steps · pp. 31–45").
- ONE ADD PER LEVEL, NAMING ITS TARGET. "Add a unit" on the course, "Add a
  lesson" on the unit. No generic Create that asks where afterwards.
- A REVIEW BANNER. When drafts exist the screen says so, in the consequence a
  teacher cares about — students cannot see them — and opens the gate.
- NO PANELS. Building from a book, drafting a lesson in a unit, reviewing, and
  choosing the class's courses all open OVER the outline and close again.
- LAW 6, SUBTRACT: the books panel, the outline's work rows and the always-open
  drawer are deleted, and the studio route is now only a redirect.

Two regressions were caught by older pins while this was built, and both are
fixed here rather than pinned away:
- the link baseline (R43): saving a class's course links from an UNKNOWN
  baseline would have wiped the courses it already teaches;
- step-linked work (R48): R79's lesson screen dropped the step id on the way
  into the dialog, so a quiz made on step 4 came back unattached.
"""
from pathlib import Path
import unittest

from tests.teacher_sources import AUTHORING_ROUTE, authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
COURSE = SRC / "features" / "teacher" / "course"
SCREEN = (COURSE / "CourseScreen.tsx").read_text(encoding="utf-8")
OUTLINE = (COURSE / "CourseOutline.tsx").read_text(encoding="utf-8")
DATA = (COURSE / "useCourseData.ts").read_text(encoding="utf-8")
BUILD = (COURSE / "useCourseBuild.ts").read_text(encoding="utf-8")
SHARED = (SRC / "features" / "teacher" / "authoring" / "useAuthoringData.ts").read_text(
    encoding="utf-8"
)
REDIRECT = AUTHORING_ROUTE.read_text(encoding="utf-8")
SURFACE = authoring_source()
CONSOLE = console_source()


class OutlineIsTheScreenTests(unittest.TestCase):
    def test_the_screen_is_the_banner_the_notice_and_the_outline(self):
        # Everything else in this file is a <Dialog> — it opens over the outline and
        # closes again, which is what "no panels" means.
        body = SCREEN.split("return (", 1)[1]
        self.assertEqual(body.count("<CourseOutline"), 1)
        self.assertNotIn("<BooksPanel", SURFACE)
        self.assertNotIn("function ClassworkList(", SURFACE)

    def test_every_lesson_row_states_itself(self):
        self.assertIn("export function lessonStateLine(", OUTLINE)
        for part in ('parts.push(status)', '"empty"', "step${stepCount === 1", "pp. ${source.firstPage}"):
            with self.subTest(part=part):
                self.assertIn(part, OUTLINE)

    def test_one_add_per_level_naming_its_target(self):
        self.assertIn("Add a unit", OUTLINE)
        self.assertIn("Add a lesson", OUTLINE)
        # And no generic create that would ask where afterwards.
        self.assertNotIn("+ Create", OUTLINE)
        self.assertNotIn("New assignment", OUTLINE)

    def test_both_levels_reorder(self):
        self.assertIn('onReorder={(ids) => onReorder("unit", ids)}', OUTLINE)
        self.assertIn("onReorder={onReorderLessons}", OUTLINE)


class ReviewBannerTests(unittest.TestCase):
    def test_the_banner_says_the_consequence_not_a_count(self):
        self.assertIn("waiting for your review", SCREEN)
        self.assertIn("students cannot see", SCREEN)

    def test_it_reviews_every_unit_that_has_drafts(self):
        self.assertIn("const draftUnitIds = [...new Set(course.drafts.map((row) => row.unitId))]", SCREEN)
        self.assertIn("for (const unitId of unitIds) {", BUILD)

    def test_drafts_are_lessons_students_cannot_see(self):
        block = DATA.split("const drafts = useMemo(", 1)[1].split("}, [", 1)[0]
        self.assertIn('(lesson.publication_status || "published") !== "published"', block)


class EmptyStateTests(unittest.TestCase):
    def test_a_class_with_no_course_is_offered_its_book(self):
        empty = OUTLINE.split("if (!units.length) {", 1)[1].split("return (\n    <section", 1)[0]
        self.assertIn("This class has no course yet.", OUTLINE)
        self.assertIn("Build the course from a book", OUTLINE)
        self.assertIn("or add a unit yourself", OUTLINE)
        self.assertNotIn("Add a unit", empty)  # the offer leads; the plain add follows

    def test_an_empty_unit_offers_the_drafted_alternative(self):
        self.assertIn("No lessons in this unit yet.", OUTLINE)
        self.assertIn("Draft one from your material", OUTLINE)
        self.assertIn("add an empty one", OUTLINE)


class WriteDisciplineTests(unittest.TestCase):
    def test_both_screens_share_one_payload_and_one_write_discipline(self):
        self.assertIn("export function useAuthoringData(", SHARED)
        self.assertIn('["curriculumAuthoring", teacherId] as const', SHARED)
        self.assertIn("const optimistic = useCallback(", SHARED)
        self.assertIn("const reloading = useCallback(", SHARED)
        self.assertIn('from "@/features/teacher/authoring/useAuthoringData"', DATA)

    def test_links_are_never_saved_from_an_unknown_baseline(self):
        # R43's guarantee, re-stated because this release nearly lost it: writing the
        # link set without knowing the current one would drop every other course.
        block = DATA.split("const ensureBackingCourse = useCallback(", 1)[1]
        self.assertIn("if (classLinks) {", block)
        self.assertLess(block.index("if (classLinks) {"), block.index("setClassCourses"))

    def test_a_build_is_sequential_cancellable_and_per_lesson_recoverable(self):
        self.assertIn("for (let i = 0; i < plan.items.length; i += 1) {", BUILD)
        self.assertIn("if (buildCancel.current) {", BUILD)
        self.assertIn('if (item.status !== "queued") continue;', BUILD)
        self.assertIn('status: "failed",', BUILD)


class SubtractionTests(unittest.TestCase):
    def test_the_studio_is_gone_and_its_route_is_a_redirect(self):
        self.assertNotIn("CurriculumStudio", SURFACE)
        self.assertLess(len(REDIRECT.split("\n")), 90)
        self.assertIn("function CurriculumRedirect()", REDIRECT)

    def test_the_deleted_surfaces_stay_deleted(self):
        for gone in ("BooksPanel.tsx", "lessonInventory.ts", "LessonInventoryBar.tsx"):
            with self.subTest(file=gone):
                self.assertFalse((SRC / "features" / "teacher" / gone).exists())
        self.assertFalse((SRC / "features" / "teacher" / "authoring" / "Outline.tsx").exists())

    def test_the_console_mounts_the_course_screen_on_demand(self):
        self.assertIn('import("@/features/teacher/course/CourseScreen")', CONSOLE)
        self.assertIn("<CourseScreen", CONSOLE)
        self.assertNotIn("workItems={workItems}", CONSOLE.split("<CourseScreen", 1)[1][:400])


class StepLinkedWorkTests(unittest.TestCase):
    """R48's contract, which R79 broke and this release fixes."""

    def test_work_made_from_a_step_stays_attached_to_it(self):
        self.assertIn("setCreateForStep(ctx.activityId);", SURFACE)
        self.assertIn("context={{ lessonId, activityId: createForStep }}", SURFACE)

    def test_closing_the_dialog_forgets_the_step(self):
        self.assertIn("setCreateForStep(null);", SURFACE)


if __name__ == "__main__":
    unittest.main()
