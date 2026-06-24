import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260624064345_platform_completion_sprint.sql"
ADMIN_OPS = ROOT / "supabase/functions/admin-ops/index.ts"
GOOGLE_CLASSROOM = ROOT / "supabase/functions/google-classroom/index.ts"
VOICE_SESSION = ROOT / "supabase/functions/voice-session/index.ts"
RESOURCE_PROCESSING = ROOT / "supabase/functions/resource-processing/index.ts"
FRONTEND_API = ROOT / "frontend/src/lib/api.ts"
FRONTEND_TYPES = ROOT / "frontend/src/lib/types.ts"


class PlatformCompletionSprintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text()
        cls.admin_ops = ADMIN_OPS.read_text()
        cls.google = GOOGLE_CLASSROOM.read_text()
        cls.voice = VOICE_SESSION.read_text()
        cls.resource_processing = RESOURCE_PROCESSING.read_text()
        cls.frontend_api = FRONTEND_API.read_text()
        cls.frontend_types = FRONTEND_TYPES.read_text()

    def test_platform_completion_tables_have_rls_and_no_anon_access(self):
        tables = [
            "google_classroom_coursework_mappings",
            "google_classroom_grade_passbacks",
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

    def test_google_classroom_has_diagnostics_and_write_gate(self):
        self.assertIn('action === "diagnose"', self.google)
        self.assertIn("missingGoogleSecrets", self.google)
        self.assertIn("write sync is not enabled yet", self.google)
        self.assertIn('| "diagnose"', self.frontend_api)
        self.assertIn("diagnoseGoogleClassroom", self.frontend_api)

    def test_voice_diagnostics_are_env_configurable_without_raw_audio_storage(self):
        for env_name in [
            "OPENAI_REALTIME_MODEL",
            "OPENAI_TTS_MODEL",
            "OPENAI_TRANSCRIBE_MODEL",
        ]:
            self.assertIn(env_name, self.voice)
        self.assertIn('action === "diagnose"', self.voice)
        self.assertIn("raw_student_audio_stored: false", self.voice)

    def test_resource_processing_creates_draft_curriculum_only_from_approved_chunks(self):
        self.assertIn('action === "create_curriculum_import_draft"', self.resource_processing)
        self.assertIn("status=eq.approved", self.resource_processing)
        self.assertIn("curriculum_import_jobs", self.resource_processing)
        self.assertIn("curriculum_import_suggestions", self.resource_processing)
        self.assertNotRegex(
            self.resource_processing,
            re.compile(r"publication_status\\s*:\\s*[\"']published", re.IGNORECASE),
        )


if __name__ == "__main__":
    unittest.main()
