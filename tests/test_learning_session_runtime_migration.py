from pathlib import Path
import re
import unittest

from jargon_interpreter import StructuredJargonInterpreter


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0003_learning_session_runtime.sql"
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
RUNTIME_TABLES = (
    "lesson_activities",
    "learning_sessions",
    "learning_turns",
    "lesson_attempts",
    "student_mastery",
)


class LearningSessionRuntimeMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.lowered = cls.source.lower()

    def test_migration_is_incremental_after_lesson_spine(self):
        self.assertIn("apply after 0001_init and 0002_lesson_spine", self.source)
        self.assertNotIn("create table public.lessons", self.lowered)
        self.assertNotIn("insert into public.lessons", self.lowered)

    def test_migration_creates_runtime_tables_with_rls(self):
        for table in RUNTIME_TABLES:
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.lowered)
                self.assertIn(f"alter table public.{table} enable row level security", self.lowered)

    def test_migration_grants_data_api_access_explicitly(self):
        self.assertIn("grant select on public.lesson_activities to anon, authenticated", self.lowered)
        for table in ("learning_sessions", "learning_turns", "lesson_attempts", "student_mastery"):
            with self.subTest(table=table):
                self.assertIn(
                    f"grant select, insert, update, delete on public.{table} to authenticated",
                    self.lowered,
                )
                self.assertIn(
                    f"grant select, insert, update, delete on public.{table} to service_role",
                    self.lowered,
                )

    def test_migration_seeds_one_activity_per_v1_lesson(self):
        for lesson_id in LESSON_IDS:
            with self.subTest(lesson_id=lesson_id):
                self.assertIn(f"'{lesson_id}-practice'", self.source)
                self.assertIn(f"'{lesson_id}'", self.source)
        self.assertIn("on conflict (id) do update set", self.lowered)

    def test_seeded_activity_programs_run_and_match_expected_output(self):
        for lesson_id in LESSON_IDS:
            with self.subTest(lesson_id=lesson_id):
                code = self._tag(lesson_id, "code")
                expected_output = self._tag(lesson_id, "output")
                answers = ["Fatima"] if "ASK " in code else []
                result = StructuredJargonInterpreter().run(code, answers=answers)

                self.assertEqual(result["status"], "ok", result)
                self.assertEqual(result["errors"], [])
                self.assertEqual("\n".join(result["output"]), expected_output)

    def test_activity_metadata_supports_course_flow_and_rubrics(self):
        for value in ("intro", "teach", "practice", "assessment", "review", "complete"):
            self.assertIn(value, self.source)
        for value in ("text", "code", "multiple_choice", "file"):
            self.assertIn(value, self.source)
        self.assertIn("rubric jsonb", self.lowered)
        self.assertIn("skill_keys text[]", self.lowered)
        self.assertIn("pass_score numeric", self.lowered)

    def _tag(self, lesson_id, kind):
        tag = f"{lesson_id}_activity_{kind}"
        match = re.search(rf"\${tag}\$(.*?)\${tag}\$", self.source, re.DOTALL)
        self.assertIsNotNone(match, f"Missing ${tag}$ block")
        return match.group(1).strip()


if __name__ == "__main__":
    unittest.main()
