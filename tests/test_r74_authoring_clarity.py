"""R74 — making the authoring surface legible.

Owner (2026-08-27), about the console he built himself: "it's not clear where to
create a lesson, it's not clear how to edit an existing lesson, it's not clear
how to create an assignment in a specific place and assign it to specific
people... there's just one button that creates everything."

The root cause is not missing capability — assignments already bind to a
lesson_id and carry per-student recipients, and every resource already has a
lesson. The root cause is that build-from-material makes steps, a quiz, an
assignment and materials in ONE action, so the teacher never watched the pieces
appear and had no reason to believe they were separate, editable things; and the
only way in was a generic "+ Create" that asked which lesson AFTERWARDS.

The law, pinned here:
- INVENTORY: a lesson says what is inside it — steps, work, material — on the
  lesson itself, and an empty lesson admits it in the tree. (R79 retired the
  inventory BAR: the rebuilt lesson screen shows the things themselves in four
  named sections, so a strip of counts pointing at them was chrome. The law is
  unchanged; what satisfies it is now the sections.)
- CREATION NAMES ITS TARGET: work is created FROM the lesson it belongs to
  (activityId null = lesson-level, the ordinary case; the R48 step-linked case is
  untouched), so the place is never a question and the dialog's student picker
  answers "for whom".
- RESOURCES ARE RANKED, NOT RE-PARENTED: the book import staples the chapter PDF
  and every page image to each lesson (~19 per lesson in production). Nothing is
  moved; what a teacher chose is simply listed above what the book contained.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
ROUTE = authoring_source()
CONSOLE = console_source()
LESSON = ROOT / "frontend" / "src" / "features" / "teacher" / "lesson"
WORK = (LESSON / "lessonWork.ts").read_text(encoding="utf-8")


class InventoryTests(unittest.TestCase):
    def test_the_lesson_says_what_is_inside_it(self):
        # R79: the sections ARE the inventory — each one names itself and reports what
        # it holds, so there is nothing to count separately and nowhere to jump to.
        self.assertIn("{steps.length} step{steps.length === 1 ? \"\" : \"s\"}", ROUTE)
        self.assertIn("<LessonSteps", ROUTE)
        self.assertIn("<LessonWork", ROUTE)
        self.assertIn("<LessonMaterials", ROUTE)

    def test_an_empty_section_says_what_is_missing_rather_than_zero(self):
        self.assertIn("No assignment or quiz is set on this lesson.", ROUTE)
        self.assertIn("Nothing here yet.", ROUTE)
        self.assertIn("Nothing attached.", ROUTE)

    def test_an_empty_lesson_admits_it_in_the_tree(self):
        block = ROUTE.split("export function lessonStateLine(", 1)[1].split("\n}", 1)[0]
        self.assertIn('parts.push(stepCount === 0 ? "empty"', block)

    def test_the_lesson_counts_only_its_own(self):
        block = WORK.split("export function lessonWorkRows(", 1)[1]
        self.assertIn("assignment.lesson_id !== input.lessonId", block)
        self.assertIn("assessment.lesson_id !== input.lessonId", block)
        self.assertIn('resource.lesson_id === lessonId', ROUTE)


class TargetedCreationTests(unittest.TestCase):
    def test_lesson_level_work_is_a_first_class_case(self):
        # activityId null = belongs to the lesson, not to one of its steps.
        # R80: the context is declared where the work is created — on the lesson.
        self.assertIn("const [createForStep, setCreateForStep] = useState<string | null>(null);", ROUTE)
        self.assertIn("context={{ lessonId, activityId: createForStep }}", ROUTE)

    def test_the_lesson_offers_its_own_work(self):
        # R79: "Classwork on this lesson" became the Work section — same law, one word
        # (the lexicon retired "classwork"), and the dialog titles name the target.
        self.assertIn('onCreate("assignment")', ROUTE)
        self.assertIn('onCreate("assessment")', ROUTE)
        self.assertIn("New assignment on this lesson", ROUTE)
        self.assertIn("New quiz on this lesson", ROUTE)
        self.assertIn('context={{ lessonId, activityId: createForStep }}', ROUTE)

    def test_existing_work_is_listed_where_it_lives(self):
        # And it says the three things job 3 is about: who, when, and what is owed.
        self.assertIn("recipientLabel(row.recipients)", ROUTE)
        self.assertIn("dueLabel(row.dueAt)", ROUTE)
        self.assertIn("{row.toMark} to mark", ROUTE)

    def test_the_step_linked_path_is_untouched(self):
        # R48's step-created work still flows through onCreateForStep — from the step
        # card on the lesson screen, which is where a step now lives.
        self.assertIn("onCreateForStep={onCreateForStep}", ROUTE)
        self.assertIn("setCreateForStep(ctx.activityId);", ROUTE)


class RankedResourceTests(unittest.TestCase):
    def test_materials_are_grouped_not_piled(self):
        block = ROUTE.split('<option value="">Attach a material…</option>', 1)[1][:1400]
        self.assertIn('{ key: "lesson", label: "Lesson materials" }', block)
        self.assertIn('{ key: "book", label: "From the book" }', block)
        self.assertIn("<optgroup", block)

    def test_the_book_tier_is_recognised_by_the_importers_own_stamp(self):
        block = ROUTE.split("const resourceTier = ", 1)[1][:400]
        self.assertIn("import_key", block)
        self.assertIn('? "book"', block)

    def test_nothing_is_re_parented(self):
        # Ranking is a display decision; no lesson_id/activity_id rewrite rides with it.
        block = ROUTE.split("const resourceTier = ", 1)[1][:400]
        for writer in ("update", "patch", "lesson_id:"):
            self.assertNotIn(writer, block)


if __name__ == "__main__":
    unittest.main()
