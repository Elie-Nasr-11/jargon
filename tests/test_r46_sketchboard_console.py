"""R46 — what survives of the sketchboard console after R47.

R46 rebuilt the console to the sketchboard (badges-only Home, roster-with-context,
Review behind a strip, resources library). R47 then re-grouped the class workspace
into the four fixed tabs (see test_r47_four_tab_console) — the strip, the Review
room, and the resources view are gone BY DESIGN now. What R46 contributed that
still stands, pinned here:

- Home is just the class grid — no hero, no hotlist feed; each card carries its
  own signals (students · sections, live now, to review) derived from the
  dashboard blob.
- The student page names the student, their section chip (from THIS class's
  membership), and the class.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
CONSOLE = (FRONTEND / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")


def _slice(text: str, start: str, end: str) -> str:
    """The region of `text` between the first `start` and the next `end`."""
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


class HomeTests(unittest.TestCase):
    def test_home_is_just_the_class_grid(self):
        self.assertIn("Your classes", CONSOLE)
        # The hero and the hotlist feed are gone from the console; only the
        # NumberFlip odometer survives from that module.
        self.assertNotIn("<HotlistFeed", CONSOLE)
        self.assertNotIn("deriveHotlist", CONSOLE)
        self.assertNotIn("openHotlistItem", CONSOLE)
        self.assertIn('import { NumberFlip } from "@/features/teacher/HotlistFeed";', CONSOLE)

    def test_class_cards_carry_their_own_signals(self):
        self.assertIn("signals={classSignals(dashboard, item.id)}", CONSOLE)
        card = _slice(CONSOLE, "function ClassButton({", "function ClassDetail({")
        self.assertIn("live now", card)
        self.assertIn("quiet", card)
        self.assertIn("to review", card)
        self.assertIn("nothing to review", card)
        self.assertIn("sections ${signals.sections.join", card)

    def test_signals_derive_live_and_gradeable_from_the_dashboard(self):
        helper = _slice(CONSOLE, "function classSignals(", "function relTime(")
        self.assertIn('status !== "complete"', helper)  # live = an unfinished session
        self.assertIn('"submitted"', helper)  # to review = submitted work


class StudentPageTests(unittest.TestCase):
    def test_student_header_names_the_section_and_the_class(self):
        detail = _slice(CONSOLE, "function StudentDetail({", "function GradebookTable(")
        self.assertIn("section: string | null;", detail)
        self.assertIn("classLabel: string | null;", detail)
        self.assertIn("{section ? (", detail)
        self.assertIn("{classLabel ? (", detail)
        # The chip comes from THIS class's membership row.
        self.assertIn("membership.class_id === selectedClassId", CONSOLE)
        self.assertIn("?.section ?? null", CONSOLE)
        self.assertIn("classLabel={selectedClass?.name ?? null}", CONSOLE)


if __name__ == "__main__":
    unittest.main()
