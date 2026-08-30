"""R83 — step 6 of the rebuild brief: Class · People and Class · Settings.

The brief gives a class four screens and says exactly what two of them hold:

    Class · People    Who's in the class, in what section, how each is doing.
                      Add from the school directory · remove from this class.
                      Never account creation.

    Class · Settings  Which courses this class teaches (today's mis-named "Linked
                      content"). Class name, sections, archive.

and names the thing it retires: "Students room as-is". These pins hold that shape —
the four screens, the two roster actions and their limits, Settings' four controls,
and the single home each of them has.
"""
import unittest
from pathlib import Path

from tests.teacher_sources import (
    authoring_source,
    console_source,
    people_source,
    settings_source,
)


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
NAV = (SRC / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
API = (SRC / "lib" / "api.ts").read_text(encoding="utf-8")
CONSOLE = console_source()
PEOPLE = people_source()
SETTINGS = settings_source()
STUDIO = authoring_source()


def _fn(text: str, name: str) -> str:
    """The body of an exported function, up to the next top-level export."""
    body = text.split(f"export async function {name}(", 1)
    assert len(body) == 2, f"{name} not found"
    return body[1].split("\nexport ", 1)[0]


class FourScreensTests(unittest.TestCase):
    def test_the_class_is_today_people_course_settings(self):
        self.assertIn(
            'export type ClassSection = "today" | "people" | "course" | "settings";', NAV
        )

    def test_settings_is_a_screen_but_not_a_pill(self):
        # Law 4 — nothing always-on that isn't always needed. A teacher renames a class
        # about once, so Settings gets the gear, not a fourth pill sitting there all year.
        pills = NAV.split("CLASS_SECTIONS", 1)[1].split("]", 1)[0]
        for label in ('label: "Today"', 'label: "People"', 'label: "Course"'):
            self.assertIn(label, pills)
        self.assertNotIn("settings", pills)
        self.assertIn('aria-label="Class settings"', CONSOLE)

    def test_the_students_room_is_gone(self):
        # The brief's named deletion for this step.
        self.assertNotIn('{section === "students" ? (', CONSOLE)
        self.assertNotIn('label: "Students"', NAV)

    def test_old_links_still_land(self):
        # Bookmarks and notification emails carry the retired values; they resolve to
        # the room that owns their content rather than 404ing or dumping on the landing.
        for legacy, room in (
            ("students", "people"),
            ("roster", "people"),
            ("grades", "people"),
            ("content", "course"),
            ("curriculum", "course"),
            ("classwork", "course"),
        ):
            with self.subTest(legacy=legacy):
                block = NAV.split(f'case "{legacy}":', 1)[1].split("return ", 1)[1]
                self.assertTrue(
                    block.startswith(f'"{room}"'),
                    f'?tab={legacy} should resolve to {room}, got {block[:20]}',
                )


class PeopleTests(unittest.TestCase):
    def test_it_answers_the_brief_s_three_questions(self):
        # who is in it, in what section, how each is doing
        self.assertIn("sectionGroups(studentIds, sections)", PEOPLE)
        self.assertIn("gradeChipLabel(gradeSummaries.get(studentId))", PEOPLE)
        self.assertIn("studentContextLine(", PEOPLE)

    def test_adding_is_from_the_directory_and_never_creates_an_account(self):
        self.assertIn("Add from the school directory", PEOPLE)
        self.assertIn("New accounts are created by", PEOPLE)
        # The two verbs that would mean account creation are absent from the room.
        for forbidden in ("signUp", "createUser", "admin_create_user", "invite"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, PEOPLE)

    def test_removing_is_confirmed_and_scoped_to_this_class(self):
        self.assertIn("Remove from this class?", PEOPLE)
        self.assertIn("onRemove(removing)", PEOPLE)
        # The confirm says what survives, because the button's name does not.
        self.assertIn("Their account and their work are kept", PEOPLE)


class SettingsTests(unittest.TestCase):
    def test_it_holds_the_four_things_the_brief_names(self):
        self.assertIn("<LinkedCoursesPanel", SETTINGS)
        self.assertIn('title="Class name"', SETTINGS)
        self.assertIn('title="Sections"', SETTINGS)
        self.assertIn('title="Archive"', SETTINGS)

    def test_courses_in_this_class_has_exactly_one_home(self):
        # It arrived from the Course screen's overflow menu, where R80 parked it with a
        # note saying it moves here. Two homes for the one control that changes what a
        # student sees is precisely the Law-1 failure the brief is about.
        self.assertIn("Courses in this class", SETTINGS)
        self.assertNotIn("LinkedCoursesPanel", STUDIO)
        self.assertNotIn('label: "Courses in this class…"', STUDIO)

    def test_archiving_is_a_status_flip_not_a_delete(self):
        self.assertIn('updateClassDetails({ classId, status: "archived" })', SETTINGS)
        self.assertNotIn("deleteClass", SETTINGS)


class WriteSurfaceTests(unittest.TestCase):
    """Every R83 write is a class-teacher RLS write — no admin token, no edge function."""

    def test_removal_marks_the_membership_rather_than_deleting_it(self):
        body = _fn(API, "removeFromClass")
        self.assertIn('.from("class_memberships")', body)
        self.assertIn('.update({ status: "removed"', body)
        self.assertNotIn(".delete()", body)
        # Scoped to this class, this person, and a student row.
        self.assertIn('.eq("class_id", input.classId)', body)
        self.assertIn('.eq("user_id", input.userId)', body)
        self.assertIn('.eq("role", "student")', body)

    def test_renaming_a_section_is_scoped_to_the_class(self):
        body = _fn(API, "renameClassSection")
        self.assertIn('.eq("class_id", input.classId)', body)
        self.assertIn('.eq("section", input.from)', body)
        self.assertNotIn(".delete()", body)

    def test_the_class_update_never_deletes_the_class(self):
        body = _fn(API, "updateClassDetails")
        self.assertIn('.from("classes")', body)
        self.assertNotIn(".delete()", body)

    def test_none_of_these_screens_reach_for_admin_ops(self):
        # admin-ops is org/platform-admin only. A teacher managing their own class must
        # not need one, and must not appear to.
        for surface, name in ((PEOPLE, "People"), (SETTINGS, "Settings")):
            with self.subTest(surface=name):
                self.assertNotIn("invokeAdminOps", surface)
                self.assertNotIn("admin-ops", surface)


if __name__ == "__main__":
    unittest.main()
