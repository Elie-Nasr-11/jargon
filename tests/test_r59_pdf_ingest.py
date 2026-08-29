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
import re
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
PDF = (ROOT / "frontend" / "src" / "lib" / "pdf-extract.ts").read_text(encoding="utf-8")


def code_only(source: str) -> str:
    """The source with its comments removed.

    The measured colour table in pdf-extract.ts names real hues — it is the record
    of the measurement that produced the thresholds, and it belongs in the file.
    What must never appear is a hue used as a RULE, so the publisher-specific pin
    reads the executable lines only.
    """
    lines = []
    in_block = False
    for line in source.splitlines():
        stripped = line.strip()
        if in_block:
            if "*/" in stripped:
                in_block = False
            continue
        if stripped.startswith("/*"):
            in_block = "*/" not in stripped
            continue
        if stripped.startswith("//"):
            continue
        lines.append(line.split("//", 1)[0] if "//" in line else line)
    return "\n".join(lines)


PDF_CODE = code_only(PDF)
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
STUDIO = authoring_source()
MATERIAL = (ROOT / "frontend" / "src" / "lib" / "materialText.ts").read_text(encoding="utf-8")


class ColourAwareExtractionTests(unittest.TestCase):
    def test_extraction_reads_the_fill_colour(self):
        # getTextContent() drops colour, so the fill has to come off the operator
        # list: setFillRGBColor sets the pen, showText spends it.
        self.assertIn("function runsWithColour(", PDF)
        self.assertIn("OPS.setFillRGBColor", PDF)
        self.assertIn("OPS.showText", PDF)

    def test_marked_runs_ride_with_their_own_page(self):
        # A question and its key must stay together however the material is later
        # sliced per lesson.
        self.assertIn("Marked in the source", PDF)
        self.assertIn("markColours.has(run.fill)", PDF)
        self.assertIn("contentRuns[i]", PDF)
        appended = PDF.split("const withMarks", 1)[1].split(";", 1)[0]
        self.assertIn("pageTexts[i]", appended)

    def test_body_ink_is_judged_by_text_share_not_by_being_top(self):
        # Measured on the real chapter: these books set body copy in TWO inks, so
        # "everything but the most-used colour" let one through and half the chapter
        # came back marked. Share of total text is the honest test.
        self.assertIn("MARK_MAX_TEXT_SHARE", PDF)
        self.assertIn("stat.chars / totalChars > MARK_MAX_TEXT_SHARE", PDF)
        self.assertIn("these books set body copy in TWO", PDF)

    def test_running_furniture_and_scraps_are_not_marks(self):
        self.assertIn("stat.pages / pages.length > MARK_MAX_PAGE_SHARE", PDF)
        self.assertIn("stat.chars / stat.runs < MARK_MIN_AVG_CHARS", PDF)
        self.assertIn("stat.pages < MARK_MIN_PAGES", PDF)

    def test_a_mark_lives_on_a_minority_of_pages(self):
        # A colour on more than half the pages is structure, not a mark. Measured
        # over all four chapter PDFs, every real key sits at or under a quarter.
        share = float(PDF.split("const MARK_MAX_PAGE_SHARE = ", 1)[1].split(";", 1)[0])
        self.assertLessEqual(share, 0.5)

    def test_repeated_text_is_furniture_whatever_colour_it_wears(self):
        # Book A1 chapter 2 sets its running title in a colour it also uses for
        # section names, so no COLOUR rule separates them — but the same string on
        # 43 of 105 pages gives itself away.
        self.assertIn("function withoutRunningFurniture(pages: ColourRun[][])", PDF)
        self.assertIn("REPEAT_PAGE_SHARE", PDF)
        self.assertIn("REPEAT_MIN_PAGES", PDF)
        self.assertIn("const contentRuns = withoutRunningFurniture(pageRuns);", PDF)

    def test_colours_are_judged_before_furniture_is_stripped(self):
        # Order matters: stripping first shrinks a running head's page count and
        # walks it straight back through the page-share test.
        judged = PDF.index("const markColours = markColoursFor(pageRuns);")
        stripped = PDF.index("const contentRuns = withoutRunningFurniture(pageRuns);")
        self.assertLess(judged, stripped)
        self.assertIn("would shrink", PDF)

    def test_the_decision_is_document_level(self):
        # A single page cannot tell a key from a running head; only the document can.
        self.assertIn("function markColoursFor(pages: ColourRun[][])", PDF)
        self.assertIn("const markColours = markColoursFor(pageRuns);", PDF)

    def test_colour_never_fails_an_extraction(self):
        # Colour is a bonus on top of text; a PDF that refuses an operator list must
        # still extract, so the colour pass is caught and the page falls back to no
        # runs rather than taking the upload down with it.
        window = PDF.split("try {", 1)[1].split("}", 1)[0]
        self.assertIn("page.getOperatorList()", window)
        self.assertIn("pageRuns.push([]);", PDF)
        self.assertIn("must still extract", PDF)

    def test_no_publisher_specific_rule(self):
        # Generic by design: any book that colours its key benefits. The measured
        # table in the comment names the hues it was tuned against — that is the
        # record of the measurement. No hue may be a RULE, so the executable lines
        # carry no colour literal at all.
        self.assertNotIn("ff5739", PDF_CODE)
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{6}\b", PDF_CODE), [])
        self.assertIn("No hue is hardcoded", PDF)


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
