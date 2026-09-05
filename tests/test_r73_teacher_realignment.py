"""R73 — realigning the teacher console on the curriculum-delivery frame.

The console was built as a general-purpose LMS: subjects -> courses -> units ->
lessons, with "build from material" tucked inside a "+ Lesson" menu, and nothing
anywhere naming which book a lesson came from. But the claim this product is
sold on — and the only thing a competitor cannot copy without content deals — is
that the school's OWN book becomes a taught course, and that the medium reports
back who is learning what.

Owner (2026-08-27) chose to realign INSIDE the existing three rooms rather than
restructure them days before a school launch. So: same rooms, same URLs, same
deep links — reframed around the book.

What this pins:
- SOURCE IDENTITY. Every lesson that came from a book names the book and the
  pages it covers, in the outline and in the lesson header, so a teacher can
  check it against the copy on their desk. A hand-authored lesson claims no
  source — the console must never imply one that does not exist.
- THE BOOK LEADS. R73 put a books panel above the tree to say what was built and
  what was still an unreviewed draft. R80 dissolved the panel INTO the outline:
  every lesson row names its own pages and state, and the drafts speak for
  themselves in a review banner. Same two guarantees, one surface instead of two.
- THE REVIEW GATE IS STANDING. R70 was reachable only from a just-finished
  build; drafts now offer their review from the banner at any time.
- THE LANDING REPORTS BACK. The weekly digest moves from inside Activity to the
  top of Students, the room a teacher lands in.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "frontend" / "src" / "features" / "teacher" / "bookSource.ts").read_text(encoding="utf-8")
ROUTE = authoring_source()
CONSOLE = console_source()
NAV = (ROOT / "frontend" / "src" / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")


class SourceIdentityTests(unittest.TestCase):
    def test_only_book_lessons_claim_a_source(self):
        body = SOURCE.split("export function bookSourceFor(", 1)[1].split("\n}", 1)[0]
        self.assertIn("if (!lesson.import_key) return null;", body)
        self.assertIn("if (!book) return null;", body)

    def test_pages_are_omitted_rather_than_guessed(self):
        body = SOURCE.split("export function bookSourceLabel(", 1)[1].split("\n}", 1)[0]
        self.assertIn("if (source.firstPage === null) return source.book;", body)

    def test_a_single_page_reads_as_one_page(self):
        body = SOURCE.split("export function bookSourceLabel(", 1)[1].split("\n}", 1)[0]
        self.assertIn("`page ${source.firstPage}`", body)

    def test_page_ranges_ignore_unusable_rows(self):
        body = SOURCE.split("export function pageRangesFromFigures(", 1)[1].split("\n}", 1)[0]
        self.assertIn("!Number.isFinite(page) || page <= 0", body)

    def test_the_lesson_type_carries_the_book_key(self):
        self.assertIn("import_key?: string | null;", TYPES)
        self.assertIn("export type LessonBookSource = {", TYPES)

    def test_a_failed_page_read_never_costs_the_outline(self):
        # The page range is a nicety; the curriculum tree is the room.
        self.assertIn("figurePagesResult.error\n      ? {}", API)


class BookLeadsTests(unittest.TestCase):
    def test_the_drafts_lead_the_course_room(self):
        # The banner is the first thing on the screen, above the outline, and it says
        # the consequence rather than a count in the abstract.
        face = ROUTE.split("export function CourseScreen(", 1)[1]
        self.assertLess(face.index("waiting for your review"), face.index("<CourseOutline"))
        self.assertIn("students cannot see", face)

    def test_hand_authored_lessons_are_never_counted_as_book_lessons(self):
        # The page range comes from the book source, which is null without an import key.
        body = SOURCE.split("export function bookSourceFor(", 1)[1].split("\n}", 1)[0]
        self.assertIn("if (!lesson.import_key) return null;", body)

    def test_the_room_reports_what_is_there_not_a_completion_score(self):
        # Counts of what is actually loaded — never a completion percentage, which
        # would be a claim about a book we have only seen part of.
        # Scoped to the banner and what sits above the outline: a build IN FLIGHT does
        # report its own progress as a percentage, which is a fact about the run rather
        # than a claim about how much of the book is in.
        face = ROUTE.split("export function CourseScreen(", 1)[1].split("<CourseOutline", 1)[0]
        self.assertNotIn("%", face)
        self.assertIn("course.drafts.length", face)

    def test_the_review_gate_is_standing(self):
        self.assertIn("Review {course.drafts.length === 1 ?", ROUTE)
        self.assertIn("build.openReview(draftUnitIds)", ROUTE)

    def test_a_lesson_row_names_its_pages(self):
        self.assertIn("lessonStateLine(lesson, bookPages, stepCountFor(lesson.id))", ROUTE)
        body = ROUTE.split("export function lessonStateLine(", 1)[1].split("\n}", 1)[0]
        # Draft state still leads — that is what a teacher must act on.
        self.assertIn('if (status !== "published") parts.push(status);', body)
        self.assertIn("pp. ${source.firstPage}", body)

    def test_the_lesson_header_names_its_book(self):
        self.assertIn("bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id))", ROUTE)


class LandingReportsBackTests(unittest.TestCase):
    def test_the_landing_is_today(self):
        # R81 moved the landing from Students to Today. The digest that used to lead
        # this screen was cut in R102 (archive/weekly-digest/), so what remains of the
        # rule is the landing itself.
        self.assertIn('return "today";', NAV)

    def test_the_digest_is_gone_from_every_room(self):
        # R102: cut, and archived. If it comes back it lands in ONE room, not two.
        self.assertEqual(CONSOLE.count("<ClassDigestCard"), 0)

if __name__ == "__main__":
    unittest.main()
