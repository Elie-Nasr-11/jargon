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
- THE BOOK LEADS. The Content room opens with the books panel (what was built
  from your material, what is still an unreviewed draft) above the generic tree.
- THE REVIEW GATE IS STANDING. R70 was reachable only from a just-finished
  build; a book with drafts now offers "Review & publish" any time.
- THE LANDING REPORTS BACK. The weekly digest moves from inside Activity to the
  top of Students, the room a teacher lands in.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "frontend" / "src" / "features" / "teacher" / "bookSource.ts").read_text(encoding="utf-8")
BOOKS = (ROOT / "frontend" / "src" / "features" / "teacher" / "BooksPanel.tsx").read_text(encoding="utf-8")
ROUTE = (ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
CONSOLE = (ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
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
    def test_the_books_panel_leads_the_content_room(self):
        self.assertIn("<BooksPanel books={books} onReview={openReview} />", ROUTE)
        # It sits ABOVE the generic curriculum tree.
        self.assertLess(ROUTE.index("<BooksPanel"), ROUTE.index("<ClassworkList"))

    def test_hand_authored_lessons_are_never_counted_into_a_book(self):
        body = BOOKS.split("export function summarizeBooks(", 1)[1].split("\n}", 1)[0]
        self.assertIn("if (!key) continue;", body)

    def test_the_panel_reports_what_is_there_not_a_completion_score(self):
        panel = BOOKS.split("export function BooksPanel(", 1)[1]
        self.assertIn("awaiting review", panel)
        # Counts of what is actually loaded — never a completion percentage, which
        # would be a claim about a book we have only seen part of.
        self.assertNotIn("%", panel)

    def test_the_review_gate_is_standing(self):
        self.assertIn("Review &amp; publish", BOOKS)
        self.assertIn("book.drafts && book.firstDraftUnitId", BOOKS)

    def test_a_lesson_row_names_its_pages(self):
<<<<<<< HEAD
        # R74 added a step count to the same call; the page-naming guarantee is unchanged.
        self.assertIn("meta={outlineLessonMeta(lesson, bookPages, stepCountFor(lesson.id))}", ROUTE)
=======
        self.assertIn("meta={outlineLessonMeta(lesson, bookPages)}", ROUTE)
>>>>>>> origin/main
        body = ROUTE.split("function outlineLessonMeta(", 1)[1].split("\n}", 1)[0]
        # Draft state still leads — that is what a teacher must act on.
        self.assertIn('if (status !== "published") return pages ? `${status} · ${pages}` : status;', body)

    def test_the_lesson_header_names_its_book(self):
        self.assertIn("bookSourceLabel(bookSourceFor(lesson, bookPages, lesson.id))", ROUTE)


class LandingReportsBackTests(unittest.TestCase):
    def test_the_digest_opens_the_room_a_teacher_lands_in(self):
        students = CONSOLE.split('{section === "students" ? (', 1)[1][:900]
        self.assertIn("<ClassDigestCard classId={item.id} />", students)

    def test_it_is_not_duplicated_in_activity(self):
        self.assertEqual(CONSOLE.count("<ClassDigestCard"), 1)


if __name__ == "__main__":
    unittest.main()
