"""R98 — the demo-ready pass, as rules a future edit has to keep.

A school takes this on tomorrow, on laptops and on phones. These pins hold the RULES the
pre-launch audit (docs/LAUNCH_BRIEF.md) turned up, not the class strings that satisfy
them today:

  * the sign-in page carries no demo affordance and no password hint;
  * a row whose children are all fixed-width has to be allowed to wrap, or the name it
    exists to show gets squeezed to one letter;
  * two screens reporting the same fact use the same predicate to compute it;
  * a count and its noun are written together, once;
  * the product does not say its vendors' names to a school.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from source_text import without_comments
from teacher_sources import console_source

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"


def read(*parts: str) -> str:
    return (SRC.joinpath(*parts)).read_text(encoding="utf-8")


LOGIN = read("routes", "login.tsx")
INDEX_ROUTE = read("routes", "index.tsx")
STUDENT_APP = read("student", "StudentApp.tsx")
PEOPLE = read("features", "teacher", "people", "PeopleScreen.tsx")
TODAY = read("features", "teacher", "today", "TodayScreen.tsx")
NEEDS_YOU = read("features", "teacher", "today", "needsYou.ts")
REVIEW_QUEUE = read("features", "teacher", "console", "GlobalReviewQueue.tsx")
DERIVE = read("features", "teacher", "console", "derive.ts")
# Read the SURFACE, not the file: R78's meta-pin forbids naming the console shell by
# path so a pin survives a component moving (tests/teacher_sources.py).
CONSOLE = console_source()
COGNITION_PANEL = read("features", "teacher", "console", "CognitionPanel.tsx")
ROOM = read("features", "teacher", "cognition", "room.ts")
ROOM_PANEL = read("features", "teacher", "cognition", "ClassRoomPanel.tsx")
FORMAT = read("lib", "format.ts")
ADMIN_PAGE = read("features", "admin", "AdminPage.tsx")
ADMIN_PEOPLE = read("features", "admin", "PeoplePanel.tsx")
TEACHER_SIDEBAR = read("features", "teacher", "shell", "TeacherSidebar.tsx")
STUDENT_SIDEBAR = read("student", "StudentSidebar.tsx")
STYLES = (SRC / "styles.css").read_text(encoding="utf-8")
MANIFEST = (ROOT / "frontend" / "public" / "manifest.webmanifest").read_text(encoding="utf-8")


class TheDoorIsAProductionDoor(unittest.TestCase):
    def test_the_sign_in_page_offers_no_demo_accounts(self) -> None:
        """A school's first screen is not the place to advertise a pilot."""
        code = without_comments(LOGIN)
        self.assertNotIn("example.com", code)
        self.assertNotIn("Demo access", code)
        self.assertNotIn("DEMO_LOGINS", code)

    def test_the_password_field_hints_at_no_password(self) -> None:
        """`placeholder="jargon123"` read as an instruction, not as a hint."""
        field = re.search(r"<input\b[^>]*type=\{showPassword[^>]*>", LOGIN, re.S)
        assert field, "the password input must still be there"
        self.assertNotIn("placeholder", field.group(0))


class RowsWrapBeforeTheyStarveTheirName(unittest.TestCase):
    """Every one of these rows sits in a single-track grid with fixed-width children.

    Without `min-w-0` the track takes the row's min-content and the card runs off a
    390px viewport; without wrapping, the one flexible child (always the person's name)
    is what gives up its space.
    """

    def row_classes(self, source: str, anchor: str) -> str:
        """The className of the element the anchor keys.

        Deliberately a window rather than a parse: the three rows write their classes
        three ways (plain string, template literal, conditional), and a pin that only
        understands one of them fails on a rewrite that is not a regression.
        """
        start = source.index(anchor)
        window = source[start : start + 900]
        at = window.index("className=")
        return window[at : at + 400]

    def test_the_roster_row_can_wrap(self) -> None:
        classes = self.row_classes(PEOPLE, "key={studentId}")
        self.assertIn("min-w-0", classes)
        self.assertIn("flex-wrap", classes)

    def test_the_live_row_can_wrap(self) -> None:
        classes = self.row_classes(TODAY, "key={row.studentId}")
        self.assertIn("min-w-0", classes)
        self.assertIn("flex-wrap", classes)

    def test_the_review_row_can_wrap(self) -> None:
        classes = self.row_classes(REVIEW_QUEUE, "key={`${row.kind}")
        self.assertIn("min-w-0", classes)
        self.assertIn("flex-wrap", classes)

    def test_no_row_reserves_a_fixed_name_width_on_a_phone(self) -> None:
        """A 140px floor on a 390px screen is most of the row before anything else."""
        for name, source in (("people", PEOPLE), ("today", TODAY)):
            for match in re.finditer(r"min-w-\[(\d+)px\]", source):
                prefix = source[max(0, match.start() - 4) : match.start()]
                self.assertTrue(
                    prefix.endswith("sm:") or prefix.endswith("md:") or prefix.endswith("lg:"),
                    f"{name}: an unqualified {match.group(0)} applies on phones too",
                )


class TheStudentStageClearsItsMenuButton(unittest.TestCase):
    def test_the_stage_leaves_room_for_the_fixed_button_below_lg(self) -> None:
        """The button is `fixed left-3 top-3 … lg:hidden`; content must not sit under it."""
        main = re.search(r'<main className="([^"]*)"', STUDENT_APP)
        assert main, "the student shell must keep its <main>"
        self.assertRegex(
            main.group(1),
            r"max-lg:pt-\d+",
            "the student stage needs phone-only top clearance, as PageShell gives the teacher",
        )


class OneFactIsOneNumber(unittest.TestCase):
    def test_the_live_count_is_scoped_the_same_way_on_both_screens(self) -> None:
        """The card said 3 live now beside a Today list holding 2."""
        self.assertIn("teachesLesson(session.lesson_id)", NEEDS_YOU)
        self.assertIn("teachesLesson(session.lesson_id)", DERIVE)

    def test_both_screens_build_that_predicate_from_the_same_place(self) -> None:
        """Two copies of the rule is how they drifted apart in the first place."""
        self.assertIn("export function teachesLessonFor(", NEEDS_YOU)
        for name, source in (("TodayScreen", TODAY), ("TeacherConsole", CONSOLE)):
            self.assertIn("teachesLessonFor(", source, f"{name} must use the shared factory")

    def test_the_landing_card_passes_the_predicate(self) -> None:
        signals = re.search(r"classSignals\((.*?)\)\}", CONSOLE, re.S)
        assert signals, "the landing card must still compute its signals"
        self.assertIn("teachesLessonFor", signals.group(1))


class CountsAndTheirNounsAreWrittenTogether(unittest.TestCase):
    def test_there_is_one_pluraliser_and_it_lives_with_the_other_formatters(self) -> None:
        self.assertIn("export function countOf(", FORMAT)

    def test_the_room_uses_the_shared_one(self) -> None:
        """It had its own copy; a second copy is how two screens disagree."""
        self.assertIn('from "@/lib/format"', ROOM)
        self.assertNotIn("function countOf(", ROOM)

    def test_no_touched_surface_interpolates_a_bare_plural(self) -> None:
        """"all 1 lessons" and "1 classes" both shipped."""
        surfaces = {
            "generatePanels": read("features", "teacher", "authoring", "generatePanels.tsx"),
            "coursePanels": read("features", "teacher", "course", "coursePanels.tsx"),
            "StudentHome": read("student", "StudentHome.tsx"),
            "LessonTree": read("student", "LessonTree.tsx"),
            "ClassSummary": read("student", "ClassSummary.tsx"),
        }
        pattern = re.compile(r"\$\{[^}]+\} (lessons|classes|students)\b")
        for name, source in surfaces.items():
            found = pattern.findall(without_comments(source))
            self.assertFalse(found, f"{name} still interpolates a bare plural: {found}")


class TheProductSpeaksForItself(unittest.TestCase):
    def test_the_admin_does_not_name_its_vendors(self) -> None:
        """A school admin should not have to know who hosts the passwords."""
        for name, source in (("AdminPage", ADMIN_PAGE), ("PeoplePanel", ADMIN_PEOPLE)):
            self.assertNotIn("Supabase", without_comments(source), f"{name} names a vendor")

    def test_the_admin_is_not_a_pilot_any_more(self) -> None:
        self.assertNotIn("pilot classrooms", ADMIN_PAGE)

    def test_the_refresh_button_says_what_it_refreshes(self) -> None:
        """"Refresh ops" named an internal noun no admin has met."""
        self.assertNotIn(">\n              Refresh ops\n", ADMIN_PAGE)

    def test_the_two_portals_use_one_pair_of_menu_words(self) -> None:
        """A user moving between roles should not meet two names for one control."""
        for name, source in (("teacher", TEACHER_SIDEBAR), ("student", STUDENT_SIDEBAR)):
            code = without_comments(source)
            self.assertIn("Sign out", code, f"{name} sidebar")
            self.assertIn("Appearance", code, f"{name} sidebar")
            self.assertNotIn("Log out", code, f"{name} sidebar")

    def test_the_thinking_tab_does_not_ask_for_a_press_that_stopped_mattering(self) -> None:
        """Scoring has run itself every fifteen minutes since R92."""
        self.assertIn("fifteen minutes", COGNITION_PANEL)

    def test_the_empty_room_does_not_say_the_same_sentence_twice(self) -> None:
        """Headline and detail printing one string reads as a rendering bug."""
        headline = re.search(r'room\.students === 0\) return "([^"]+)"', ROOM)
        assert headline, "roomHeadline must still handle an empty room"
        self.assertNotIn(f'"{headline.group(1)}"', ROOM_PANEL)


class TheAppSurvivesABadMoment(unittest.TestCase):
    def test_the_entry_route_falls_back_to_sign_in_when_the_role_will_not_resolve(self) -> None:
        """A network blip took the whole route to the router's error boundary."""
        body = INDEX_ROUTE[INDEX_ROUTE.index("beforeLoad") :]
        role_call = body.index("fetchPrimaryRole")
        preceding = body[:role_call]
        self.assertIn("try {", preceding, "the role lookup must sit inside a try")
        after = body[role_call:]
        catch = re.search(r"\} catch \{(.*?)\}", after, re.S)
        assert catch, "the role lookup needs a catch"
        self.assertIn('to: "/login"', catch.group(1))


class TheInstalledAppWearsTheAppsColours(unittest.TestCase):
    def test_the_manifest_matches_the_light_ladder(self) -> None:
        background = re.search(r":root \{.*?--background: (#[0-9a-fA-F]{6})", STYLES, re.S)
        assert background, "styles.css must define --background on :root"
        manifest = json.loads(MANIFEST)
        self.assertEqual(manifest["background_color"].lower(), background.group(1).lower())
        self.assertEqual(manifest["theme_color"].lower(), background.group(1).lower())


if __name__ == "__main__":
    unittest.main()
