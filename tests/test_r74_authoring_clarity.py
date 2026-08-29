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
- INVENTORY: a lesson says what is inside it — steps, quiz steps, assignments,
  materials — on the lesson itself, and an empty lesson admits it in the tree.
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


ROOT = Path(__file__).resolve().parents[1]
ROUTE = (ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
CONSOLE = (ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
BAR = (ROOT / "frontend" / "src" / "features" / "teacher" / "LessonInventoryBar.tsx").read_text(encoding="utf-8")
INV = (ROOT / "frontend" / "src" / "features" / "teacher" / "lessonInventory.ts").read_text(encoding="utf-8")


class InventoryTests(unittest.TestCase):
    def test_the_lesson_says_what_is_inside_it(self):
        self.assertIn("<LessonInventoryBar inventory={inventory} />", ROUTE)
        block = ROUTE.split("const inventory = useMemo(", 1)[1][:700]
        for part in ("steps:", "quizSteps:", "assignments:", "materials:"):
            self.assertIn(part, block)

    def test_counts_are_places_not_statistics(self):
        # Every cell is a button, and an empty one says what is missing rather than "0".
        self.assertIn("onJump?.(cell.key)", BAR)
        self.assertIn("empty:", BAR)
        self.assertIn('empty: "no assignment"', BAR)

    def test_an_empty_lesson_admits_it_in_the_tree(self):
        block = ROUTE.split("function outlineLessonMeta(", 1)[1].split("\n}", 1)[0]
        self.assertIn('if (stepCount === 0) return status !== "published" ? `${status} · empty` : "empty";', block)

    def test_the_inventory_module_counts_only_this_lesson(self):
        block = INV.split("export function inventoryFor(", 1)[1].split("\n}", 1)[0]
        self.assertIn("step.lesson_id === lessonId", block)
        self.assertIn('resource.status !== "archived"', block)


class TargetedCreationTests(unittest.TestCase):
    def test_lesson_level_work_is_a_first_class_case(self):
        # activityId null = belongs to the lesson, not to one of its steps.
        self.assertIn("activityId: string | null;\n  } | null>(null);", CONSOLE)
        self.assertIn("setCreateContext({ lessonId, activityId: null });", CONSOLE)

    def test_the_lesson_offers_its_own_classwork(self):
        self.assertIn("Classwork on this lesson", ROUTE)
        self.assertIn('onCreate("assignment", lessonId)', ROUTE)
        self.assertIn('onCreate("assessment", lessonId)', ROUTE)

    def test_existing_work_is_listed_where_it_lives(self):
        block = ROUTE.split("<LessonClasswork", 1)[1][:500]
        self.assertIn('item.lessonId === lesson.id && item.kind !== "material"', block)

    def test_the_step_linked_path_is_untouched(self):
        # R48's step-created work still flows through onCreateForStep.
        self.assertIn("onCreateForStep={(kind, ctx) => {", CONSOLE)


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
