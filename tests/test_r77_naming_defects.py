"""R77 — the three defects the owner found in R73–R76.

Step 1 of the rebuild brief. These are not new features; they are corrections of
mistakes I made in the four releases immediately before, and they are pinned
individually because each one is a distinct failure mode the brief names:

- RENAMING INSTEAD OF RESOLVING. "Books & shared content" became "Linked
  content" in R75. The panel picks which COURSES a class teaches and has nothing
  to do with resources — and "content" already means the room, the resources and
  the materials. A rename that does not say what the thing is, is not a fix.
- PARTIAL DELETION. R75 removed the lesson-level build fork and reported the
  build path unified, but the course-level entry still stood. On inspection it is
  NOT a duplicate — it drafts the course's units and lessons, where the other
  drafts one lesson's steps — so the correct fix was the one lessons already got:
  name it for what it makes, and put material inside it as an option.
- STALE STRINGS SURVIVING THEIR FEATURE. The outline's empty state still told
  teachers to open a drawer deleted in the same release. Copy is part of a
  feature; removing the feature means removing every sentence that references it.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source, settings_source


ROOT = Path(__file__).resolve().parents[1]
STUDIO = authoring_source()


class NamesSayWhatTheThingIsTests(unittest.TestCase):
    def test_the_course_link_panel_is_named_after_courses(self):
        # R83: the panel moved to Class · Settings; the name it was given is what
        # travelled with it.
        self.assertIn("Courses in this class", settings_source())
        # Neither of the two names that hid what it manages.
        for surface in (STUDIO, settings_source()):
            self.assertNotIn("Linked content", surface)
            self.assertNotIn("Books &amp; shared content", surface)

    def test_planning_a_course_is_not_a_rival_build_path(self):
        self.assertIn("Add units &amp; lessons", STUDIO)
        self.assertNotIn("Build a course from material", STUDIO)

    def test_the_outline_planner_asks_before_it_asks_for_material(self):
        panel = STUDIO.split("function AiOutlinePanel(", 1)[1]
        self.assertIn("What does this course cover?", panel)
        self.assertIn("Reference material (optional)", panel)
        self.assertLess(
            panel.index("What does this course cover?"),
            panel.index("Reference material (optional)"),
        )


class NoStaleStringsTests(unittest.TestCase):
    def test_nothing_points_at_a_deleted_drawer(self):
        self.assertNotIn("shared content below", STUDIO)
        self.assertNotIn("Books & shared content", STUDIO)

    def test_the_empty_state_names_a_control_that_exists(self):
        # R77 fixed a hint pointing at a deleted drawer. R80 replaced the hint with an
        # empty state that offers the two real doors — and both are on the same screen.
        empty = STUDIO.split("This class has no course yet.", 1)[1][:900]
        self.assertIn("Build the course from a book", empty)
        self.assertIn("or add a unit yourself", empty)
        self.assertIn("onBuildCourse", empty)
        self.assertIn("onAddUnit", empty)

    def test_the_deleted_lesson_fork_left_no_prose_behind(self):
        # R75 deleted it; R77 checks the comments went with it.
        self.assertNotIn("Start blank", STUDIO)
        self.assertNotIn('"Build from material" opens the R56 panel', STUDIO)


if __name__ == "__main__":
    unittest.main()
