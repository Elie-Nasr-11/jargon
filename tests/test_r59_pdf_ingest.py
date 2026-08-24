"""R59 — make the PRODUCT path good enough to take a chapter PDF.

Owner (2026-08-24): "cut up the 2 PDFs into individual PDFs for each chapter and
I'll plug in each chapter on its own and see how the platform handles taking in
PDFs… have the platform do the work rather than just feeding it in through the
back end."

Right instinct — hand-authored JSON hides whether the feature works. Two things
stood between that plan and a good result, and both are fixed here.

1. THE PLATFORM COULDN'T SEE THE ANSWERS. Teacher editions mark the key by colour
   (IT Frontiers prints every correct option and model answer in red).
   getTextContent() drops colour, so a teacher uploading a teacher edition handed us
   the questions and hid the answers — and the generator guessed a key the book was
   already stating. Extraction now walks the operator list too and appends the
   marked runs to their page.

2. THE PLATFORM ONLY READ THE FIRST PART OF A CHAPTER. A 111-page chapter is ~140k
   characters. The client truncated uploads at 40k and the outline window was 24k,
   so a chapter upload produced an outline of its first lesson and a half.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PDF = (ROOT / "frontend" / "src" / "lib" / "pdf-extract.ts").read_text(encoding="utf-8")
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
STUDIO = (ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text(
    encoding="utf-8"
)
MATERIAL = (ROOT / "frontend" / "src" / "lib" / "materialText.ts").read_text(encoding="utf-8")


class ColourAwareExtractionTests(unittest.TestCase):
    def test_extraction_reads_the_fill_colour(self):
        self.assertIn("async function markedRunsForPage(", PDF)
        self.assertIn("OPS.setFillRGBColor", PDF)
        self.assertIn("OPS.showText", PDF)

    def test_marked_runs_ride_with_their_own_page(self):
        # A question and its key must stay together however the material is later
        # sliced per lesson.
        self.assertIn("Marked in the source", PDF)
        self.assertIn("const marked = await markedRunsForPage(page);", PDF)

    def test_dominant_ink_is_not_a_mark(self):
        self.assertIn("A colour used for MOST of the page is body ink", PDF)
        self.assertIn("run.fill !== dominant", PDF)

    def test_a_decorative_page_marks_nothing(self):
        self.assertIn("marked.length > runs.length * 0.5", PDF)

    def test_colour_never_fails_an_extraction(self):
        # Colour is a bonus on top of text; a PDF that refuses an operator list must
        # still extract.
        block = PDF.split("async function markedRunsForPage(", 1)[1]
        self.assertIn("} catch {", block.split("\n\n", 3)[0] + block[:400])
        self.assertIn("never fail an extraction over it", PDF)

    def test_no_publisher_specific_rule(self):
        # Generic by design: any book that colours its key benefits, and no hue is
        # hardcoded.
        self.assertNotIn("ff5739", PDF)
        self.assertIn("no hardcoded hue", PDF)


class ChapterSizedUploadTests(unittest.TestCase):
    def test_client_keeps_a_whole_chapter(self):
        self.assertIn("text.trim().slice(0, 400000)", STUDIO)
        self.assertIn("~140k characters (111 pages)", STUDIO)

    def test_outline_window_fits_a_chapter(self):
        window = int(
            ADMIN.split("const outlineReference = clampText(cleanText(body.reference_text), ", 1)[1]
            .split(")", 1)[0]
        )
        self.assertGreaterEqual(window, 100_000)

    def test_package_window_fits_one_lesson(self):
        window = int(
            ADMIN.split("const referenceText = clampText(cleanText(body.reference_text), ", 1)[1]
            .split(")", 1)[0]
        )
        self.assertGreaterEqual(window, 40_000)

    def test_per_lesson_slice_fits_a_real_lesson(self):
        # A book lesson is 20-35 pages; the old 6k window cut one off at its first
        # section.
        window = int(MATERIAL.split("maxChars = ", 1)[1].split(",", 1)[0])
        self.assertGreaterEqual(window, 20_000)


if __name__ == "__main__":
    unittest.main()
