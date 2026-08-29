"""R79 — the Lesson screen, built new (rebuild brief, step 3).

Owner: "go for step 3 please", against the brief's own step 3 — "Build Lesson
new. Four sections, at a new route. The hardest screen and the one that proves
the model." Deletes: the old lesson editor.

What the brief asked for, and what is pinned here:
- FOUR SECTIONS. Header (title, objective, source, state, one Save), Steps (80%
  of the screen), Work (assignments and quizzes, with who they are for), Material
  (ranked: on a step, on the lesson, from the book). Not thirteen.
- ITS OWN ADDRESS. A lesson is a route, not a pane inside the outline, so it can
  be linked, and Back works.
- THE EMPTY STATE DOES THE WORK (mechanism B). An empty steps list does not show
  "No steps yet" beside a Draft button; it offers the steps, grounded in what the
  lesson was built from. Nothing is written until the teacher keeps them.
- LAW 5. Derived things are outputs: ideas and vocabulary are read from the
  header's menu, never edited as fields on the lesson.
- LAW 6. Subtract before adding. This release deletes the old lesson editor
  (LessonDetail), the pane that hosted it (DetailPane) and the inventory bar.
- THE LEXICON IS ENFORCEABLE. docs/LEXICON.md exists (step 0), and no retired
  word appears in this screen's copy.
"""
from pathlib import Path
import re
import unittest

from tests.teacher_sources import AUTHORING_ROUTE, authoring_source


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
LESSON = SRC / "features" / "teacher" / "lesson"
AUTHORING = SRC / "features" / "teacher" / "authoring"
SCREEN = (LESSON / "LessonScreen.tsx").read_text(encoding="utf-8")
HEADER = (LESSON / "LessonHeader.tsx").read_text(encoding="utf-8")
STEPS = (LESSON / "LessonSteps.tsx").read_text(encoding="utf-8")
WORK_UI = (LESSON / "LessonWork.tsx").read_text(encoding="utf-8")
WORK = (LESSON / "lessonWork.ts").read_text(encoding="utf-8")
MATERIALS = (LESSON / "LessonMaterials.tsx").read_text(encoding="utf-8")
HOOK = (LESSON / "useLessonAuthoring.ts").read_text(encoding="utf-8")
ROUTE_FILE = (SRC / "routes" / "teacher.class.$classId.lesson.$lessonId.tsx").read_text(
    encoding="utf-8"
)
ROUTE_TREE = (SRC / "routeTree.gen.ts").read_text(encoding="utf-8")
STUDIO = AUTHORING_ROUTE.read_text(encoding="utf-8")
SURFACE = authoring_source()
LEXICON = ROOT / "docs" / "LEXICON.md"


class FourSectionsTests(unittest.TestCase):
    def test_the_page_is_exactly_four_sections(self):
        composed = SCREEN.split("<div className=\"grid gap-4\">", 1)[1].split("</PageShell>", 1)[0]
        for section in ("<LessonHeader", "<LessonSteps", "<LessonWork", "<LessonMaterials"):
            with self.subTest(section=section):
                self.assertIn(section, composed)
        # A RATCHET. Anything else a release wants on a lesson has to replace one of
        # these four, or live behind the header's menu.
        self.assertEqual(len(re.findall(r"<Lesson[A-Z]\w+", composed)), 4)
        # And the header stays reachable while the steps scroll under it.
        self.assertIn('className="sticky top-0 z-20', composed)

    def test_the_header_carries_what_the_lesson_is_and_the_only_save(self):
        self.assertIn('aria-label="Lesson title"', HEADER)
        self.assertIn('aria-label="Lesson objective"', HEADER)
        self.assertIn("bookSourceLabel(bookSourceFor(lesson", HEADER)
        self.assertIn("Students can see this", HEADER)  # state, in words
        self.assertIn("unsaved change", HEADER)
        self.assertEqual(HEADER.count("onClick={onSave}"), 1)

    def test_the_steps_are_the_screen(self):
        self.assertIn("<ReorderList items={steps}", STEPS)
        self.assertIn("<StepCard", STEPS)
        self.assertIn("Add a step", STEPS)

    def test_work_says_who_it_is_for_and_when_it_is_due(self):
        self.assertIn("export function recipientLabel(", WORK)
        self.assertIn("export function dueLabel(", WORK)
        self.assertIn("recipientLabel(row.recipients)", WORK_UI)
        self.assertIn("dueLabel(row.dueAt)", WORK_UI)
        # Marking owed is the thing a teacher looks for first, so it sorts first.
        self.assertIn("b.toMark - a.toMark ||", WORK)

    def test_material_is_ranked_closest_first(self):
        self.assertLess(MATERIALS.index("const onStep"), MATERIALS.index("const onLesson"))
        self.assertIn("on this lesson", MATERIALS)
        self.assertIn("From the book", MATERIALS)
        # The book group is collapsed AND lazy — it is large and rarely read.
        self.assertIn("if (!open || figures) return;", MATERIALS)


class OwnAddressTests(unittest.TestCase):
    def test_the_lesson_is_a_route(self):
        self.assertIn(
            'createFileRoute("/teacher/class/$classId/lesson/$lessonId")', ROUTE_FILE
        )
        self.assertIn("/teacher/class/$classId/lesson/$lessonId", ROUTE_TREE)

    def test_the_outline_links_to_it_and_old_links_forward(self):
        self.assertIn('to: "/teacher/class/$classId/lesson/$lessonId"', STUDIO)
        self.assertIn("params: { classId: first.id, lessonId: search.lesson }", STUDIO)
        self.assertIn("replace: true", STUDIO)

    def test_the_lesson_owns_its_data_and_its_writes(self):
        # Law 1, one home per object: the screen loads the lesson itself rather than
        # being handed it by whatever mounted it.
        self.assertIn("export function useLessonAuthoring(", HOOK)
        for write in ("saveMeta", "upsertStep", "reorderSteps", "deleteStep", "setPublication"):
            with self.subTest(write=write):
                self.assertIn(f"const {write} = useCallback(", HOOK)


class EmptyStateDoesTheWorkTests(unittest.TestCase):
    def test_an_empty_lesson_offers_its_steps_rather_than_a_draft_button(self):
        empty = STEPS.split("steps.length === 0 && !proposal", 1)[1].split("{proposal ?", 1)[0]
        self.assertIn("Nothing here yet.", empty)
        self.assertIn("Draft the steps", empty)
        # Grounded by default: the offer names the book pages it would read.
        self.assertIn("This lesson follows ${sourceLabel}", empty)
        # And it is NOT the old always-on panel with a brief field to fill in first.
        # (Scoped past the module's doc block, which names what it replaced.)
        body = STEPS.split("*/", 1)[1]
        self.assertNotIn("Draft steps with AI", body)
        self.assertNotIn("<AiStepsPanel", body)

    def test_the_proposal_writes_nothing_until_it_is_kept(self):
        self.assertIn("Nothing is saved yet", STEPS)
        self.assertIn("Keep these steps", STEPS)
        self.assertIn("onDiscard", STEPS)

    def test_a_written_brief_is_still_available_one_click_away(self):
        # Capability kept, chrome removed: the full panel lives behind the menu.
        self.assertIn("Draft steps from a brief…", SCREEN)
        self.assertIn("<AiStepsPanel", SCREEN)


class QuietAssistTests(unittest.TestCase):
    """Owner on R76: "not as just an AI button for everything. It should be more
    subtle. It should be better engineered." So the assist is not standing chrome."""

    def test_the_assist_shows_for_an_empty_field_or_one_being_written_in(self):
        self.assertIn('const [writing, setWriting] = useState<"title" | "objective" | null>', HEADER)
        self.assertIn('writing === field || !fields[field].trim()', HEADER)
        self.assertIn('{assistOn("title") ? (', HEADER)
        self.assertIn('{assistOn("objective") ? (', HEADER)

    def test_the_header_does_not_repeat_the_back_link(self):
        # A hand-authored lesson has no book to name, and the page's back link already
        # says which unit it is in. Saying it twice is noise, not context.
        self.assertIn("{source ? (", HEADER)
        self.assertNotIn("{unitTitle}", HEADER)


class SubtractionTests(unittest.TestCase):
    def test_the_old_editor_is_deleted_not_deprecated(self):
        for gone in ("LessonDetail.tsx", "DetailPane.tsx"):
            with self.subTest(file=gone):
                self.assertFalse((AUTHORING / gone).exists())
        for gone in ("LessonInventoryBar.tsx", "lessonInventory.ts"):
            with self.subTest(file=gone):
                self.assertFalse((SRC / "features" / "teacher" / gone).exists())
        self.assertNotIn("function LessonDetail(", SURFACE)
        self.assertNotIn("function LessonClasswork(", SURFACE)

    def test_the_studio_no_longer_hosts_an_editor_pane(self):
        self.assertNotIn("<DetailPane", STUDIO)
        self.assertNotIn("const selection", STUDIO)

    def test_derived_knowledge_is_read_not_authored(self):
        # Law 5. It is in the menu, in a dialog, described as an output.
        self.assertIn("Ideas &amp; vocabulary", SCREEN)
        self.assertIn("Drafted from this lesson when it publishes", SCREEN)
        self.assertNotIn("<KnowledgeCard", STEPS)
        self.assertNotIn("<KnowledgeCard", HEADER)


class LexiconTests(unittest.TestCase):
    """Law 3, made enforceable: one word, one meaning — checked against the copy."""

    RETIRED = ("Classwork", "Linked content", "Shared content", "Reference material")

    def _copy(self, text: str) -> str:
        """Roughly, what a teacher reads: JSX text plus label-ish attributes."""
        parts = re.findall(r">([^<>{}]{3,})<", text)
        parts += re.findall(r'(?:label|title|placeholder|aria-label)="([^"]+)"', text)
        return "\n".join(parts)

    def test_the_lexicon_exists(self):
        # The brief blocks UI work until the word list is written down (step 0).
        self.assertTrue(LEXICON.is_file())
        text = LEXICON.read_text(encoding="utf-8")
        for word in ("Course", "Unit", "Lesson", "Step", "Material", "Work", "Evidence"):
            with self.subTest(word=word):
                self.assertIn(f"**{word}**", text)

    def test_no_retired_word_appears_in_the_lesson_screen(self):
        copy = "\n".join(
            self._copy((LESSON / name).read_text(encoding="utf-8"))
            for name in sorted(path.name for path in LESSON.glob("*.tsx"))
        )
        for word in self.RETIRED:
            with self.subTest(word=word):
                self.assertNotIn(word, copy)


if __name__ == "__main__":
    unittest.main()
