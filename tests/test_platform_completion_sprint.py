"""Trimmed 2026-07-30: the Google Classroom frontend wrappers (diagnose included)
were removed in the MVP strip (see docs/MVP_SCOPE.md §9 — the edge function stays
deployed BACKEND-ONLY, and its diagnostics + write-gate pins remain below)."""
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260624064345_platform_completion_sprint.sql"
ADMIN_OPS = ROOT / "supabase/functions/admin-ops/index.ts"
VOICE_SESSION = ROOT / "supabase/functions/voice-session/index.ts"
RESOURCE_PROCESSING = ROOT / "supabase/functions/resource-processing/index.ts"
FRONTEND_TYPES = ROOT / "frontend/src/lib/types.ts"


class PlatformCompletionSprintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text()
        cls.admin_ops = ADMIN_OPS.read_text()
        cls.voice = VOICE_SESSION.read_text()
        cls.resource_processing = RESOURCE_PROCESSING.read_text()
        cls.frontend_types = FRONTEND_TYPES.read_text()

    def test_platform_completion_tables_have_rls_and_no_anon_access(self):
        tables = [
            "admin_csv_import_batches",
            "admin_csv_import_rows",
            "admin_data_export_requests",
            "admin_data_retention_requests",
            "parent_guardian_links",
            "student_progress_reports",
            "platform_consent_settings",
            "curriculum_import_jobs",
            "curriculum_import_suggestions",
        ]
        for table in tables:
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.migration)
                self.assertIn(f"alter table public.{table} enable row level security", self.migration)
                self.assertIn(f"revoke all privileges on table public.{table} from anon", self.migration)

    def test_admin_ops_exposes_school_governance_actions(self):
        for action in [
            "preview_csv_import",
            "apply_csv_roster_import",
            "export_student_archive",
            "request_data_retention",
            "upsert_consent_settings",
            "generate_progress_report",
        ]:
            with self.subTest(action=action):
                self.assertIn(f'action === "{action}"', self.admin_ops)
                self.assertIn(f'| "{action}"', self.frontend_types)


    def test_voice_diagnostics_are_env_configurable_without_raw_audio_storage(self):
        for env_name in [
            "OPENAI_REALTIME_MODEL",
            "OPENAI_TTS_MODEL",
            "OPENAI_TRANSCRIBE_MODEL",
        ]:
            self.assertIn(env_name, self.voice)
        self.assertIn('action === "diagnose"', self.voice)
        self.assertIn("raw_student_audio_stored: false", self.voice)

    # R102: the chunk review + curriculum-draft actions were archived to
    # archive/resource-chunk-pipeline/ (only the OCR path stayed live), so the pin
    # that asserted create_curriculum_import_draft went with them.

if __name__ == "__main__":
    unittest.main()
