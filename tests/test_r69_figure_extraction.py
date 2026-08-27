"""R69 — a figure is the FIGURE, not the page it sits on.

Until now a lesson figure was a full-page scan: a student tapped a diagram and
got a picture of page 34, headers and page number included. The mentor prompt
tells the model to point at what is IN the figure ("the stacked layers labelled
B"), which reads as nonsense against a whole page.

The books are vector-drawn (zero embedded raster images), so a figure is a
cluster of drawing operations. scripts/extract-figures.py finds those clusters,
keeps the ones that are art, pulls in the caption that belongs to them, and
renders a tight crop next to the page scan.

The law, pinned here:
- the crop NEVER replaces the page scan on disk — a page with no confident
  figure keeps its scan, so a bad detection degrades to yesterday's behaviour;
- the book's key-fact banners (a green box of centred text, alone in its band)
  are never figures, while a text panel standing BESIDE art is part of one;
- zero-thickness strokes are real drawings: a horizontal rule has an empty
  bounding rect, and dropping those discarded every grid line in the drawn
  data tables (the bug that hid 34 figures in book A2);
- captions below and short labels above join the crop; the page number never
  does.
"""
from pathlib import Path
import importlib.util
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "extract-figures.py"
SOURCE = SCRIPT.read_text(encoding="utf-8")
A1_PDF = ROOT / "IT Frontiers - Advanced - Book A1 - Teacher Edition.pdf"

try:  # PyMuPDF is an authoring-time dependency, not a runtime one.
    import pymupdf  # noqa: F401

    HAVE_PYMUPDF = True
except ImportError:  # pragma: no cover
    HAVE_PYMUPDF = False


def load_module():
    spec = importlib.util.spec_from_file_location("extract_figures", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ScriptContractTests(unittest.TestCase):
    def test_the_page_scan_survives_every_crop(self):
        # Crops are written as p<page>-fig.jpg; nothing ever overwrites p<page>.jpg.
        self.assertIn('f"p{page_no}-fig.jpg"', SOURCE)
        self.assertNotIn('f"p{page_no}.jpg"', SOURCE)
        self.assertIn("no_figure_full_page_kept", SOURCE)

    def test_degenerate_strokes_are_kept_not_dropped(self):
        self.assertIn("zero-thickness rect reads as EMPTY", SOURCE)
        self.assertIn("if rect.width <= 0 and rect.height <= 0:", SOURCE)
        self.assertIn("max(rect.width, 0.5)", SOURCE)

    def test_the_page_number_never_joins_a_crop(self):
        self.assertIn('re.fullmatch(r"\\s*\\d{1,3}\\s*", text)', SOURCE)

    def test_a_lone_text_panel_is_a_banner_not_a_figure(self):
        self.assertIn("beside art", SOURCE.lower())
        self.assertIn("y_overlap", SOURCE)


@unittest.skipUnless(HAVE_PYMUPDF and A1_PDF.exists(), "PyMuPDF or book PDF unavailable")
class DetectionTests(unittest.TestCase):
    """Real pages of book A1, chosen because each breaks a different rule."""

    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        cls.doc = pymupdf.open(A1_PDF)

    def figures(self, page_no):
        return self.module.detect_figures(self.doc[page_no - 1])

    def test_a_scattered_illustration_becomes_one_figure(self):
        # p10: wheat + a steps panel + bread, spread across the text column.
        # The panel is text-heavy but stands BETWEEN art, so it belongs.
        figures = self.figures(10)
        self.assertEqual(len(figures), 1)
        rect = figures[0]["rect"]
        self.assertLess(rect.x0, 100)          # reaches the wheat on the left
        self.assertGreater(rect.x1, 500)       # and the bread on the right
        self.assertLess(rect.height, 260)      # but does not swallow the prose

    def test_the_key_fact_banner_is_excluded_and_the_caption_included(self):
        # p34: a green banner sits well above the supercomputer art + caption.
        figures = self.figures(34)
        self.assertEqual(len(figures), 1)
        rect = figures[0]["rect"]
        self.assertGreater(rect.y0, 520)       # starts below the banner
        self.assertGreater(rect.y1, 700)       # keeps BOTH caption lines

    def test_a_full_width_diagram_keeps_its_label_and_caption(self):
        figures = self.figures(121)
        self.assertEqual(len(figures), 1)
        rect = figures[0]["rect"]
        self.assertGreater(rect.y0, 300)       # excludes the banner above it
        self.assertGreater(rect.width, 400)

    def test_a_worksheet_page_yields_nothing(self):
        # p20 is a true/false activity table — text, not a figure. Pages like
        # this must fall back to the page scan rather than crop a table.
        self.assertEqual(self.figures(20), [])

    def test_crops_stay_inside_the_page(self):
        for page_no in (10, 34, 121):
            for figure in self.figures(page_no):
                self.assertTrue(self.doc[page_no - 1].rect.contains(figure["rect"]))


class WiredIntoLessonsTests(unittest.TestCase):
    """The chapter documents point at crops only where a crop exists."""

    def test_every_crop_url_has_a_file_and_every_file_a_scan(self):
        public = ROOT / "frontend" / "public"
        wired = 0
        for doc_path in sorted(ROOT.glob("books/itf-a*/ch*.json")):
            doc = json.loads(doc_path.read_text(encoding="utf-8"))
            for lesson in doc.get("lessons", []):
                for figure in lesson.get("figures", []):
                    url = figure.get("image_url", "")
                    if not url.endswith("-fig.jpg"):
                        continue
                    crop = public / url.lstrip("/")
                    self.assertTrue(crop.exists(), f"missing crop for {url}")
                    scan = crop.with_name(crop.name.replace("-fig.jpg", ".jpg"))
                    self.assertTrue(scan.exists(), f"crop replaced the scan: {scan}")
                    wired += 1
        self.assertGreater(wired, 40, "expected the books to be wired to crops")


if __name__ == "__main__":
    unittest.main()
