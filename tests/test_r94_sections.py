"""R94 — the room, by section.

R93 reads a class as one room. A teacher who streams a class teaches its sections at
different hours and to different plans, so one blended reading hides the thing they
most need to see: that one section is leaning on the tutor and the other is not.

The DERIVATIONS (which students a choice covers, which summary it shows, what the
comparison says) are property-tested against the real module in tests/room_view.test.ts.
These pins hold the wiring and the two rules that keep the feature honest: the section
arithmetic stays on the server, and a class that does not use sections gains nothing to
click.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SCORER = (ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts").read_text(
    encoding="utf-8"
)
COGNITION = ROOT / "frontend" / "src" / "features" / "teacher" / "cognition"
ROOM = (COGNITION / "room.ts").read_text(encoding="utf-8")
PANEL = (COGNITION / "ClassRoomPanel.tsx").read_text(encoding="utf-8")
DENO_SUITE = (ROOT / "tests" / "room_view.test.ts").read_text(encoding="utf-8")


class TheSectionComesFromTheRosterTests(unittest.TestCase):
    def test_the_roster_query_asks_for_it(self):
        # A section is a text label on the membership, not a row anywhere — so the
        # roster IS the section map.
        self.assertIn("&role=eq.student&status=eq.active&select=user_id,section", SCORER)

    def test_a_student_is_never_counted_twice(self):
        # The schema permits two memberships in one class; the roster must still be a
        # set of people, or a student would appear in two sections at once.
        view = SCORER[SCORER.index("async function classView(") :]
        view = view[: view.index("\nfunction summarizeSections(")]
        self.assertIn("const sectionOf = new Map<string, string | null>();", view)
        self.assertIn("const studentIds = Array.from(sectionOf.keys());", view)

    def test_every_student_carries_their_section(self):
        self.assertIn("section: string | null;", SCORER)
        self.assertIn("rollUpStudent(id, sectionOf.get(id) ?? null,", SCORER)
        self.assertIn("section: string | null;", (COGNITION.parent.parent.parent / "lib" / "api.ts").read_text(encoding="utf-8"))


class TheArithmeticStaysOnTheServerTests(unittest.TestCase):
    """R93's rule, held one level further: reading a dimension VALUE is the server's
    job. A client that summarized sections itself would have to read them."""

    def test_sections_are_summarized_beside_the_class(self):
        self.assertIn("function summarizeSections(students: RoomStudent[]): DbRow[]", SCORER)
        self.assertIn("sections: summarizeSections(students),", SCORER)
        # ...through the SAME summarizer, so a section and the class can never mean
        # different things by "weakest".
        block = SCORER[SCORER.index("function summarizeSections(") :]
        block = block[: block.index("\n// R92: the run log")]
        self.assertIn("...summarizeRoom(students.filter((student) => student.section === label))", block)

    def test_the_browser_still_reads_no_dimension_value(self):
        for name, text in (("room", ROOM), ("panel", PANEL)):
            with self.subTest(surface=name):
                self.assertNotIn(".dims", without_comments(text))

    def test_the_client_picks_a_summary_it_never_builds_one(self):
        self.assertIn("export function summaryForChoice(", ROOM)
        picker = ROOM[ROOM.index("export function summaryForChoice(") :]
        picker = picker[: picker.index("\n/**")] if "\n/**" in picker else picker
        for arithmetic in ("filter", "reduce", "weakest.map"):
            with self.subTest(arithmetic=arithmetic):
                self.assertNotIn(arithmetic, picker)


class ASectionlessClassGainsNothingToClickTests(unittest.TestCase):
    def test_no_sections_means_no_summaries(self):
        block = SCORER[SCORER.index("function summarizeSections(") :]
        block = block[: block.index("\n// R92: the run log")]
        self.assertIn("if (!named.length) return [];", block)

    def test_one_section_is_not_a_choice(self):
        # It is the whole class under another name; a control that does nothing is
        # worse than no control.
        self.assertIn("if (!sections || sections.length < 2) return [];", ROOM)

    def test_the_unsectioned_are_named_not_dropped(self):
        block = SCORER[SCORER.index("function summarizeSections(") :]
        block = block[: block.index("\n// R92: the run log")]
        self.assertIn("if (students.some((student) => student.section === null)) labels.push(null);", block)
        self.assertIn('section.label ?? "No section"', ROOM)

    def test_a_section_named_all_is_still_reachable(self):
        # The choice keys are prefixed so a label can never collide with the
        # whole-class view and make a real section unselectable.
        self.assertIn('export const ALL_SECTIONS = "all";', ROOM)
        self.assertIn('return label === null ? UNSECTIONED : `section:${label}`;', ROOM)
        self.assertIn("a section actually called 'all' is still selectable", DENO_SUITE)


class TheComparisonIsNotASecondOpinionTests(unittest.TestCase):
    def test_each_section_line_is_the_headline_that_section_gets(self):
        # Reusing roomHeadline means selecting a section cannot tell a teacher
        # something different from what the comparison line just told them — and no
        # new threshold rule had to be invented to decide when sections "differ".
        block = ROOM[ROOM.index("export function sectionHeadlines(") :]
        self.assertIn("line: roomHeadline(section),", block)
        self.assertIn("the comparison is the same sentence each section gets on its own", DENO_SUITE)

    def test_the_comparison_only_appears_on_the_whole_class_view(self):
        self.assertIn("const perSection = active === ALL_SECTIONS ? sectionHeadlines(data?.sections) : [];", PANEL)

    def test_a_stale_choice_cannot_strand_the_teacher(self):
        # A section that disappears between loads must not leave the panel showing an
        # empty room with no way back to the class.
        self.assertIn(
            "const active = choices.some((option) => option.key === choice) ? choice : ALL_SECTIONS;",
            PANEL,
        )

    def test_the_choice_resets_with_the_class(self):
        # A section label only means something inside the class that defines it.
        self.assertIn("useEffect(() => setChoice(ALL_SECTIONS), [classId]);", PANEL)


class TheDerivationsArePropertyTestedTests(unittest.TestCase):
    def test_the_suite_covers_each_section_rule(self):
        for rule in (
            "a class that has never used sections gets no control",
            "one section is not a choice",
            "the whole class leads, then the sections, and nobody is nameless",
            "choosing a section narrows the room to exactly that section",
            "every student is reachable through exactly one section choice",
            "the summary follows the choice",
            "a divergence between sections is visible rather than averaged away",
            "a section headline never carries a score either",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, DENO_SUITE)

    def test_the_suite_tests_the_real_exports(self):
        for export in ("sectionChoices", "studentsInSection", "summaryForChoice", "sectionHeadlines"):
            with self.subTest(export=export):
                self.assertIn(f"export function {export}(", ROOM)
                self.assertIn(export, DENO_SUITE)


if __name__ == "__main__":
    unittest.main()
