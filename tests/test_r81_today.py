"""R81 — Today, and the class landing (rebuild brief, step 5).

Owner: "Go for 5", against the brief's own step 5 — "Build Today. Digest +
needs-me. Becomes the landing." Deletes: the hotlist duplication.

    Class · Today — jobs 4 & 5, see who's learning, act on what needs me
    - The weekly digest — what the class learned, who moved, who did nothing.
    - Needs me now: submissions to mark, students stuck live.
    - This is the landing screen. A teacher who opens Jargon and does nothing
      else still learns something.

What is pinned here:
- TODAY IS THE LANDING. An unknown or absent ?tab lands on Today, and Today is
  the first room in the spine.
- THREE THINGS, IN ORDER. The digest, then who is in a lesson right now, then
  what is waiting to be marked. Nothing else — Today creates nothing.
- THE ROOM IT REPLACED. R60's Activity held the same two live surfaces one tab
  away, plus a class-level work list and a class-level Create. The surfaces lead
  the landing now; the list belongs to each lesson (R79); the Create belongs on
  the lesson too (Law 2) — so the room is gone rather than kept beside Today.
- THE HOTLIST IS DELETED. HotlistFeed.tsx was 280 lines that nothing had
  rendered since R46 and that duplicated the review queue. Only the NumberFlip
  odometer survived, into the console's own chrome.
- GRADING NEVER HIDES. An open ?assignment/?assessment still takes the room,
  now from Today, whatever the URL's ?tab says.
"""
from pathlib import Path
import unittest

from tests.teacher_sources import console_source


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
TODAY_DIR = SRC / "features" / "teacher" / "today"
SCREEN = (TODAY_DIR / "TodayScreen.tsx").read_text(encoding="utf-8")
NEEDS = (TODAY_DIR / "needsYou.ts").read_text(encoding="utf-8")
NAV = (SRC / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
CONSOLE = console_source()
NOTIFICATIONS = (SRC / "components" / "NotificationsMenu.tsx").read_text(encoding="utf-8")


class LandingTests(unittest.TestCase):
    def test_today_is_the_default_and_leads_the_spine(self):
        self.assertIn(
            'export type ClassSection = "today" | "people" | "course" | "settings";', NAV
        )
        self.assertIn('{ value: "today", label: "Today" }', NAV)
        # The default arm of the legacy map — an unknown or absent tab lands here.
        self.assertIn('return "today";', NAV.split("switch (tab) {", 1)[1])
        sections = NAV.split("CLASS_SECTIONS", 1)[1]
        self.assertLess(sections.index('"today"'), sections.index('"students"'))

    def test_the_class_renders_today_first(self):
        self.assertIn('{section === "today" && !openAssignmentId && !openAssessmentId ? (', CONSOLE)
        self.assertIn("<TodayScreen", CONSOLE)


class ThreeThingsTests(unittest.TestCase):
    def test_the_digest_leads_then_live_then_waiting(self):
        body = SCREEN.split("return (", 1)[1]
        self.assertLess(body.index("<ClassDigestCard"), body.index("In a lesson now"))
        self.assertLess(body.index("In a lesson now"), body.index("Waiting on you"))

    def test_today_creates_nothing(self):
        # Work is set on the lesson it belongs to; Today only reports and opens.
        for absent in ("setCreateOpen", "New assignment", "New quiz", "<Dialog"):
            with self.subTest(absent=absent):
                self.assertNotIn(absent, SCREEN)

    def test_both_lists_say_what_an_empty_one_means(self):
        self.assertIn("No one is in a lesson right now", SCREEN)
        self.assertIn("Nothing is waiting on you", SCREEN)

    def test_the_derivations_are_pure_and_class_scoped(self):
        self.assertIn("export function liveNowRows(", NEEDS)
        self.assertIn("export function toMarkRows(", NEEDS)
        self.assertNotIn("useState", NEEDS)
        self.assertNotIn("import {", NEEDS.split("from \"@/lib/types\";", 1)[1])
        live = NEEDS.split("export function liveNowRows(", 1)[1].split("export function", 1)[0]
        self.assertIn("row.class_id === classId", live)
        self.assertIn('session.status === "complete"', live)
        self.assertIn("(row) => row.classId === classId", NEEDS)


class ClassScopeTests(unittest.TestCase):
    """A student can be in two of a teacher's classes. R71 shipped the same bug in the
    weekly digest and it was caught against production data — 111 turns reported for a
    class whose true count was 0. The landing must not repeat it."""

    def test_in_a_lesson_now_reports_this_class_lessons(self):
        self.assertIn("teachesLesson?: (lessonId: string) => boolean", NEEDS)
        self.assertIn("if (teachesLesson && !teachesLesson(session.lesson_id)) continue;", NEEDS)
        self.assertIn("courseIds.has(courseId)", SCREEN)

    def test_unknown_links_over_report_rather_than_hide(self):
        # R43's discipline: an unreadable link set means unscoped, never a silent empty.
        self.assertIn("if (!links) return undefined;", SCREEN)
        self.assertIn("return courseId ? courseIds.has(courseId) : true;", SCREEN)


class SubtractionTests(unittest.TestCase):
    def test_the_hotlist_module_is_gone(self):
        self.assertFalse((SRC / "features" / "teacher" / "HotlistFeed.tsx").exists())
        self.assertIn("export function NumberFlip(", CONSOLE)
        self.assertNotIn("HotlistFeed", CONSOLE)

    def test_the_activity_room_is_gone_not_hidden(self):
        self.assertNotIn('{section === "activity"', CONSOLE)
        self.assertNotIn("activityItems", CONSOLE)
        self.assertNotIn("Quizzes &amp; assignments", CONSOLE)

    def test_the_digest_is_not_in_two_rooms(self):
        self.assertEqual(CONSOLE.count("<ClassDigestCard"), 1)


class DeepLinkTests(unittest.TestCase):
    def test_every_work_link_lands_on_today(self):
        self.assertIn('{ tab: "today", assignment: assignmentId }', NOTIFICATIONS)
        self.assertIn('{ tab: "today", assessment: assessmentId }', NOTIFICATIONS)
        self.assertNotIn('tab: "activity"', NOTIFICATIONS)
        self.assertNotIn('tab: "activity"', CONSOLE)

    def test_grading_still_takes_the_room(self):
        self.assertIn(
            'search.assignment || search.assessment ? "today" : normalizeClassSection(search.tab)',
            CONSOLE,
        )
        self.assertIn('{section === "today" && (openAssignmentId || openAssessmentId) ? (', CONSOLE)


if __name__ == "__main__":
    unittest.main()
