"""R52 — the control vocabulary: buttons are obviously buttons, cards are cards,
fields are fields, and tables scroll inside their cards on narrow viewports.

Owner directive 2026-08-20: "consolidate the ui design (especially of the teachers
portal) so that buttons are obvious, cards are cards, not cards are not cards,
selectors, sliders ... also make sure tables adapt properly to lower screen widths."

Pinned contracts:
- styles.css owns ONE button hierarchy (.btn + primary/secondary/ghost/danger,
  .btn-sm/.btn-icon) and the one table idiom (.table-scroll). Component classes
  win the cascade against utility chrome by design (declared after utilities).
- No hand-rolled interactive pill chrome remains in the teacher/admin portals —
  the pre-R52 idiom (rounded-full + border-border + hover:bg-muted + text chrome)
  is gone from buttons; rows that legitimately use field surfaces stay.
- Every <table> sits inside a .table-scroll wrapper.
- The gradebook clip fix: the class card carries min-w-0 because grid items
  refuse to shrink below content (min-width:auto) — without it the 920px table
  pushed the card past the viewport and CLIPPED the action column at tablet
  widths instead of scrolling.
- Rows contain their actions: the Live row's Watch button and the People row's
  section select render INSIDE the row container (previously detached pills).
- The class tabs use the dark active pill (the same read as the admin portal's
  WorkspaceTabs) instead of a gray fill.
"""
from pathlib import Path
import re
import unittest
from tests.teacher_sources import AUTHORING_ROUTE, authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
STYLES = (SRC / "styles.css").read_text(encoding="utf-8")
CONSOLE = console_source()
STUDIO = authoring_source()
ADMIN = (SRC / "routes" / "admin.tsx").read_text(encoding="utf-8")

# rglob, not glob: R78 split the console into subdirectories, and the control
# vocabulary applies to a moved component exactly as it did before the move.
PORTAL_FILES = (
    list((SRC / "features" / "teacher").rglob("*.tsx"))
    + list((SRC / "features" / "admin").rglob("*.tsx"))
    + [AUTHORING_ROUTE, SRC / "routes" / "admin.tsx", SRC / "routes" / "login.tsx"]
)

# The pre-R52 hand-rolled button idiom: an interactive pill drawing its own chrome.
LEGACY_BUTTON = re.compile(
    r'rounded-full border border-border px-[\d.]+ py-[\d.]+ text-(?:meta|body) '
    r'text-(?:foreground|muted-foreground) (?:transition-colors )?hover:bg-muted'
)


class R52VocabularyTests(unittest.TestCase):
    def test_styles_own_the_button_hierarchy(self):
        for fragment in (
            ".btn {", ".btn-primary {", ".btn-secondary {", ".btn-ghost {",
            ".btn-danger {", ".btn-sm {", ".btn-icon {", ".btn:disabled {",
            # Secondary is a RAISED surface, not a chip — that is the "obvious" part.
            "box-shadow: 0 1px 2px rgb(0 0 0 / 0.07);",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, STYLES)

    def test_table_scroll_is_the_one_table_idiom(self):
        self.assertIn(".table-scroll {", STYLES)
        self.assertIn("overflow-x: auto;", STYLES)

    def test_no_legacy_button_chrome_survives(self):
        for f in PORTAL_FILES:
            src = f.read_text(encoding="utf-8")
            with self.subTest(file=f.name):
                self.assertIsNone(LEGACY_BUTTON.search(src))

    def test_the_canon_is_actually_used(self):
        for text, name in ((CONSOLE, "TeacherConsole"), (STUDIO, "studio"), (ADMIN, "admin")):
            with self.subTest(surface=name):
                self.assertIn("btn btn-secondary", text)
        # Primary = the single main action of a view; the console's views delegate
        # theirs to the studio (+ Create) and dialogs, so it is pinned where it lives.
        for text, name in ((STUDIO, "studio"), (ADMIN, "admin")):
            with self.subTest(surface=name):
                self.assertIn("btn btn-primary", text)


class R52TableTests(unittest.TestCase):
    def test_every_table_has_a_scroll_wrapper(self):
        for f in SRC.rglob("*.tsx"):
            # The shadcn primitive ships its own overflow container and is not a
            # surface; app surfaces are what must adopt the idiom.
            if "components/ui" in str(f):
                continue
            src = f.read_text(encoding="utf-8")
            tables = src.count("<table")
            if not tables:
                continue
            with self.subTest(file=str(f.relative_to(SRC))):
                self.assertGreaterEqual(src.count("table-scroll"), tables)

    def test_gradebook_clip_fix_is_pinned(self):
        # min-w-0 on the class card: grid items refuse to shrink below content, so
        # without it the wide table stretched the card past the viewport and the
        # Action column was unreachable at tablet widths.
        self.assertIn(
            '<section className="min-w-0 rounded-card border border-border bg-depth-card shadow-card">',
            CONSOLE,
        )
        self.assertIn("min-width:auto", CONSOLE)
        self.assertIn('"table-scroll hidden max-h-[58vh] overflow-auto pb-1 md:block"', CONSOLE)


class R52StructureTests(unittest.TestCase):
    def test_rows_contain_their_actions(self):
        self.assertIn("ONE row container owns the chrome", CONSOLE)
        # People rows: the section picker sits inside the row container now.
        self.assertIn("the section picker lives inside", CONSOLE)

    def test_class_tabs_use_the_solid_active_pill(self):
        # R53 evolved the active pill from graphite to the primary blue (the owner
        # read the black chrome as "light mode is too dark") — the contract is still
        # ONE solid active pill, now in primary.
        self.assertIn(
            '? "border-primary bg-primary font-medium text-primary-foreground"',
            CONSOLE,
        )

    def test_lesson_editor_lost_its_third_nesting_tier(self):
        # Tutor behavior is a hairline group inside the ONE inset level, not a
        # box-in-box-in-box.
        idx = STUDIO.index("Tutor behavior")
        preceding = STUDIO[idx - 600 : idx]
        self.assertIn("border-t border-border/60 pt-4", preceding)
        self.assertNotIn("rounded-card border border-border bg-depth-field p-3", preceding)


if __name__ == "__main__":
    unittest.main()
