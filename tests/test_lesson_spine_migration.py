from pathlib import Path
import re
import unittest

from jargon_interpreter import StructuredJargonInterpreter


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0002_lesson_spine.sql"
LESSON_IDS = (
    "lesson1",
    "lesson2",
    "lesson3",
    "lesson4",
    "lesson5",
    "coding1",
    "coding2",
    "coding3",
    "coding4",
    "coding5",
)


class LessonSpineMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MIGRATION.read_text(encoding="utf-8")

    def test_migration_adds_lesson_metadata_columns(self):
        self.assertIn("add column if not exists module text not null default 'Processes'", self.source)
        self.assertIn("add column if not exists level text not null default 'Level 0-1'", self.source)
        self.assertIn("add column if not exists expected_output text", self.source)

    def test_migration_is_incremental_and_idempotent(self):
        lowered = self.source.lower()
        self.assertNotIn("create table public.lessons", lowered)
        self.assertIn("on conflict (id) do update set", lowered)
        self.assertIn("0001_init is already applied", self.source)

    def test_migration_seeds_ten_lesson_spine(self):
        for lesson_id in LESSON_IDS:
            self.assertIn(f"'{lesson_id}'", self.source)
        for lesson_id in ("coding1", "coding2", "coding3", "coding4", "coding5"):
            self.assertRegex(self.source, rf"\(\s*'{lesson_id}',\s*\d+,", msg=lesson_id)

    def test_seeded_starter_programs_run_and_match_expected_output(self):
        for lesson_id in LESSON_IDS:
            with self.subTest(lesson_id=lesson_id):
                code = self._tag(lesson_id, "code")
                expected_output = self._tag(lesson_id, "output")
                answers = ["Fatima"] if "ASK " in code else []
                result = StructuredJargonInterpreter().run(code, answers=answers)

                self.assertEqual(result["status"], "ok", result)
                self.assertEqual(result["errors"], [])
                self.assertEqual("\n".join(result["output"]), expected_output)

    def _tag(self, lesson_id, kind):
        tag = f"{lesson_id}_{kind}"
        match = re.search(rf"\${tag}\$(.*?)\${tag}\$", self.source, re.DOTALL)
        self.assertIsNotNone(match, f"Missing ${tag}$ block")
        return match.group(1).strip()


if __name__ == "__main__":
    unittest.main()
