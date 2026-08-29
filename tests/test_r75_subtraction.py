"""R75 — subtracting the authoring surface.

Owner, after R73/R74 added yet more panels: "why is there the build course from
material? why is there books and shared content? why are the page links in two
places? ... why is building from material different from building from scratch?
nothing seems to live where it should."

Every one of those has the same answer: each release since R43 ADDED a surface
and none ever removed the one it superseded, so the room is eight releases of
sediment viewed at once. (My own R73/R74 added three of those panels — a books
panel to a room that already had a books drawer among them.) The fix for that is
not more organising. It is deletion.

The law, pinned here:
- ONE NAV. The class sections were rendered twice — sidebar sub-rows and console
  pills. The pills won; the sidebar keeps classes only.
- ONE BUILD DOOR. "Build from material" and "Start blank" were the same act
  forked before the teacher had decided anything. Adding a lesson opens the one
  builder, which offers reference material as a choice INSIDE it.
- LINKED CONTENT IS NOT A PAGE FIXTURE. It stays (it is the only surface that
  trims what students see) but opens on demand instead of sitting under the
  curriculum.
- KNOWLEDGE IS A BY-PRODUCT, NOT A STEP. Ideas/vocab are drafted automatically at
  publish and feed the student's brain map, My Jargon and the mentor's sense of
  what is fading — 2,351 live mastery rows lean on them — so the card is kept but
  collapsed: it opens when a teacher wants to check what was derived.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
STUDIO = authoring_source()
SIDEBAR = (ROOT / "frontend" / "src" / "features" / "teacher" / "shell" / "TeacherSidebar.tsx").read_text(encoding="utf-8")
CONSOLE = console_source()


class OneNavTests(unittest.TestCase):
    def test_the_sections_render_in_exactly_one_place(self):
        self.assertNotIn("CLASS_SECTIONS.map", SIDEBAR)
        self.assertEqual(CONSOLE.count("CLASS_SECTIONS.map"), 1)

    def test_the_sidebar_still_remembers_which_room_you_were_in(self):
        # Deleting the rows must not lose the tab when switching classes.
        self.assertIn("active && activeSection ? { tab: activeSection } : undefined", SIDEBAR)


class OneBuildDoorTests(unittest.TestCase):
    def test_there_is_no_fork_before_the_lesson_exists(self):
        self.assertNotIn("Start blank", STUDIO)
        self.assertNotIn("lessonMenuFor", STUDIO)

    def test_adding_a_lesson_opens_the_one_builder(self):
        self.assertIn("onAdd={() => onBuildLesson(unit.id)}", STUDIO)


class DemotionTests(unittest.TestCase):
    def test_linked_content_opens_on_demand_and_still_exists(self):
        self.assertNotIn("Books &amp; shared content", STUDIO)
        self.assertIn("selectedClass && booksOpen ? (", STUDIO)
        self.assertIn("<LinkedCoursesPanel", STUDIO)
        # R77 renamed it after what it manages: this panel picks the class's COURSES and
        # never had anything to do with resources, which "content" implied.
        self.assertIn('{booksOpen ? "Hide courses" : "Courses in this class"}', STUDIO)

    def test_knowledge_is_demoted_not_deleted(self):
        # R75 folded it into a collapsible; R79 moved it off the lesson page entirely,
        # into the header's menu — Law 5, derived things are outputs, never fields in an
        # authoring form. The review path is unchanged.
        self.assertIn("const [knowledgeOpen, setKnowledgeOpen] = useState(false);", STUDIO)
        self.assertIn("Ideas &amp; vocabulary", STUDIO)
        self.assertIn("<KnowledgeCard lessonId={lessonId} />", STUDIO)

    def test_the_authoring_room_may_only_get_lighter(self):
        # A RATCHET, not a target. The diagnosis behind R75 is that every release since
        # R43 added a surface and none removed one, so this pins the current count and
        # lets it fall — never rise. A release that wants a new always-on section has to
        # retire one first, which is the discipline that was missing.
        headings = STUDIO.count('text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">')
        self.assertLessEqual(
            headings,
            21,
            f"{headings} always-on section headings in the authoring room — subtract before adding",
        )


if __name__ == "__main__":
    unittest.main()
