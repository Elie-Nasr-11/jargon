from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0009_full_platform_foundation.sql"

FOUNDATION_TABLES = (
    "environment_modes",
    "feature_flags",
    "admin_account_seed_batches",
    "admin_account_seed_entries",
    "organization_settings",
    "class_settings",
    "student_settings",
    "lesson_completion_rules",
    "rubric_templates",
    "lesson_resources",
    "lesson_resource_placements",
    "resource_interactions",
    "assignment_submission_files",
    "intervention_alerts",
    "live_session_viewers",
    "teacher_live_comments",
    "transcript_heatmap_events",
    "voice_interaction_events",
    "runtime_events",
    "model_usage_events",
    "speech_usage_events",
)


class FullPlatformFoundationMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.lowered = cls.source.lower()

    def test_migration_is_additive_after_0008(self):
        self.assertIn("apply after 0008_lessons_primary_milestone_pointer", self.source)
        self.assertNotIn("drop table", self.lowered)
        self.assertNotIn("create table public.lessons", self.lowered)
        self.assertNotIn("insert into public.lessons", self.lowered)

    def test_foundation_tables_have_rls_grants_indexes_and_no_anon_access(self):
        for table in FOUNDATION_TABLES:
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.lowered)
                self.assertIn(f"alter table public.{table} enable row level security", self.lowered)
                self.assertIn(f"grant select, insert, update, delete on public.{table} to service_role", self.lowered)
                self.assertIn(f"revoke all privileges on table public.{table} from anon", self.lowered)

        for table in FOUNDATION_TABLES[1:]:
            with self.subTest(authenticated_grant=table):
                self.assertIn(
                    f"grant select, insert, update, delete on public.{table} to authenticated",
                    self.lowered,
                )

    def test_admin_seeded_accounts_and_environment_modes_are_present(self):
        for phrase in (
            "admin_account_seed_batches",
            "admin_account_seed_entries",
            "role text not null check (role in ('student', 'teacher', 'org_admin', 'platform_admin'))",
            "'pilot', 'Pilot', 'Real classroom pilot mode.'",
            '"admin_seeded_accounts": true',
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_settings_and_feature_flags_cover_org_class_student_scopes(self):
        for table in ("organization_settings", "class_settings", "student_settings", "feature_flags"):
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.lowered)

        for column in (
            "mentor_settings jsonb",
            "voice_settings jsonb",
            "quiz_settings jsonb",
            "environment_mode_id text references public.environment_modes",
            "class_id uuid references public.classes",
        ):
            with self.subTest(column=column):
                self.assertIn(column, self.lowered)

    def test_lesson_resources_private_storage_and_interactions_are_modeled(self):
        for phrase in (
            "create table if not exists public.lesson_resources",
            "resource_type text not null",
            "check (resource_type in ('video', 'audio', 'pdf', 'flipbook', 'youtube', 'image', 'link', 'document'))",
            "visibility text not null default 'class_private'",
            "create table if not exists public.lesson_resource_placements",
            "create table if not exists public.resource_interactions",
            "event_type in ('shown', 'opened', 'played', 'paused', 'completed', 'downloaded')",
            "insert into storage.buckets",
            "'lesson-resources', 'lesson-resources', false",
            "Authorized users can read lesson resource files",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_student_submission_files_use_private_storage(self):
        for phrase in (
            "create table if not exists public.assignment_submission_files",
            "storage_bucket text not null default 'student-submissions'",
            "'student-submissions', 'student-submissions', false",
            "Students and teachers can read submission files",
            "Students can upload own submission files",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_live_intervention_and_transcript_heatmap_surfaces_exist(self):
        for phrase in (
            "intervention_alerts",
            "live_session_viewers",
            "teacher_live_comments",
            "transcript_heatmap_events",
            "teacher_intervention",
            "low_confidence_dictation",
            "viewer",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_voice_records_metadata_without_raw_audio(self):
        self.assertIn("create table if not exists public.voice_interaction_events", self.lowered)
        self.assertIn("input_modality text check (input_modality in ('dictated', 'audio_session'))", self.lowered)
        self.assertIn("transcript_confidence numeric", self.lowered)
        self.assertIn("add column if not exists input_modality", self.lowered)
        self.assertIn("add column if not exists transcript_confidence", self.lowered)

        forbidden = ("raw_audio", "audio_blob", "audio_bytes", "recording_path")
        for phrase in forbidden:
            with self.subTest(forbidden=phrase):
                self.assertNotIn(phrase, self.lowered)

    def test_runtime_model_and_speech_usage_events_exist(self):
        for phrase in (
            "runtime_events",
            "model_usage_events",
            "speech_usage_events",
            "estimated_cost_usd numeric",
            "task_type in ('mentor_turn', 'grading', 'rescue', 'authoring', 'summarization', 'speech_to_text', 'text_to_speech')",
            "event_type in ('chat_failure', 'run_failure', 'stage_transition', 'completion', 'retry', 'rescue', 'controlled_error')",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_resource_helper_functions_are_revoked_and_granted(self):
        for function in ("can_manage_lesson_resource", "can_view_lesson_resource"):
            with self.subTest(function=function):
                self.assertIn(f"function public.{function}", self.lowered)
                self.assertIn(f"revoke all on function public.{function}(uuid) from public", self.lowered)
                self.assertIn(f"grant execute on function public.{function}(uuid) to authenticated, service_role", self.lowered)

    def test_every_new_table_has_at_least_one_policy(self):
        policy_sources = re.findall(r"create policy .*?\n  on public\.([a-z_]+)", self.lowered)
        for table in FOUNDATION_TABLES:
            with self.subTest(table=table):
                self.assertIn(table, policy_sources)


if __name__ == "__main__":
    unittest.main()
