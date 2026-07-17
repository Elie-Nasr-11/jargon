"""Static invariants for Artifacts v1 P8: live mentor-generated artifacts.

The load-bearing rules this file pins:
- chat/index.ts NEVER gains a service-role key — privileged writes live only in the
  dedicated artifact-live function (student JWT proves identity, service key writes).
- artifact-live verifies EVERYTHING (session ownership, lesson opt-in, step-kind
  answer-leak exclusions, caps) BEFORE its first model call.
- The scoping migration adds student_private visibility AND fences the legacy
  class-null org fallback branch of can_view_lesson_resource — without the fence, a
  student-private artifact with an org id would be readable by every org member.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MIGRATION = (
    REPO / "supabase" / "migrations" / "20260901000000_live_artifact_scoping.sql"
).read_text()
BASELINE = (
    REPO / "supabase" / "migrations" / "0009_full_platform_foundation.sql"
).read_text()
WORKFLOW = (REPO / ".github" / "workflows" / "deploy-backend.yml").read_text()
LIVE = (REPO / "supabase" / "functions" / "artifact-live" / "index.ts").read_text()
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()


class LiveArtifactMigration(unittest.TestCase):
    def test_visibility_check_swap_is_idempotent(self):
        self.assertIn(
            "drop constraint if exists lesson_resources_visibility_check", MIGRATION
        )
        self.assertIn(
            "check (visibility in ('class_private', 'org_private', 'public', 'student_private'))",
            MIGRATION,
        )

    def test_student_scope_column_and_check(self):
        self.assertIn("add column if not exists student_id uuid", MIGRATION)
        self.assertIn(
            "check (visibility <> 'student_private' or student_id is not null)", MIGRATION
        )
        self.assertIn("allow_live_artifacts boolean not null default false", MIGRATION)

    def test_view_function_has_student_branch_and_fence(self):
        self.assertIn(
            "create or replace function public.can_view_lesson_resource", MIGRATION
        )
        self.assertIn(
            "lr.visibility = 'student_private' and lr.student_id = auth.uid()", MIGRATION
        )
        # THE leak fence: the legacy class-null org fallback (visibility-ungated in
        # 0009) must exclude student_private explicitly.
        self.assertIn(
            "lr.visibility <> 'student_private' and lr.class_id is null", MIGRATION
        )

    def test_baseline_migration_untouched(self):
        # 0009 keeps its ORIGINAL visibility check text and view function — the deploy
        # loop never replays 0009; the swap lives in the new file only.
        self.assertIn(
            "check (visibility in ('class_private', 'org_private', 'public'))", BASELINE
        )
        self.assertNotIn("student_private", BASELINE)

    def test_workflow_wires_migration_and_function(self):
        self.assertIn("20260901000000_live_artifact_scoping.sql", WORKFLOW)
        self.assertIn("supabase functions deploy artifact-live", WORKFLOW)
        self.assertIn('"supabase/functions/artifact-live/**"', WORKFLOW)


class ArtifactLiveFunction(unittest.TestCase):
    def test_service_role_posture(self):
        # artifact-live holds the service key; chat NEVER does. This pair of asserts
        # pins the entire P8 security posture.
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", LIVE)
        self.assertNotIn("SERVICE_ROLE", CHAT)

    def test_every_gate_runs_before_the_first_model_call(self):
        first_model_call = LIVE.index("await callModelJson(")
        for gate in (
            "learning_sessions?id=eq.",  # session ownership (membership)
            "allow_live_artifacts !== true",  # lesson opt-in
            'mode === "assessment"',  # step-kind exclusions
            'mode === "revision"',
            'modeType === "open_ended"',
            'stage === "assessment"',
            "quiz_items?lesson_id=eq.",  # quiz-bearing step exclusion
            "LIVE_ARTIFACT_STEP_CAP",  # caps
            "LIVE_ARTIFACT_LESSON_DAY_CAP",
            "LIVE_ARTIFACT_USER_HOUR_CAP",
            "DUPLICATE_REUSE_WINDOW_MS",  # two-tap idempotency
        ):
            self.assertLess(
                LIVE.index(gate), first_model_call, f"gate {gate!r} must precede generation"
            )

    def test_caps_counted_from_usage_events_including_failures(self):
        self.assertIn("model_usage_events?user_id=eq.", LIVE)
        self.assertIn('task_type=eq.authoring', LIVE)
        self.assertIn('"artifact_live"', LIVE.replace("'", '"'))
        # The usage row is written before the generation-failure early return.
        self.assertLess(
            LIVE.index('"/rest/v1/model_usage_events"'),
            LIVE.index('"generation_failed"'),
        )

    def test_insert_shape_is_student_private(self):
        insert = LIVE[LIVE.index('"/rest/v1/lesson_resources"'):]
        for token in (
            'visibility: "student_private"',
            "student_id: userId",
            "created_by: null",
            "activity_id: null",
            'status: "published"',
            'resource_type: "artifact"',
        ):
            self.assertIn(token, insert)
        # Provenance for loaders/teacher surfaces + the real step binding.
        self.assertIn("generated: {", insert)
        self.assertIn('by: "mentor"', insert)

    def test_storage_cleanup_on_insert_failure(self):
        cleanup = LIVE[LIVE.index("catch (insertError)"):]
        self.assertIn('method: "DELETE"', cleanup)

    def test_brief_excludes_raw_student_text_and_answers(self):
        # The generator's input is composed ONLY from structured fields — the activity
        # select must not pull expected_output/starter_code, and no student answer text
        # is read at all.
        select = re.search(r"lesson_activities\?id=eq\.[^`]*select=([a-z_,]+)", LIVE)
        self.assertIsNotNone(select)
        self.assertNotIn("expected_output", select.group(1))
        self.assertNotIn("starter_code", select.group(1))
        self.assertNotIn("learning_turns", LIVE)

    def test_generation_pipeline_ported(self):
        for token in (
            "function artifactModel(",
            "OPENAI_MODEL_ARTIFACT",
            "AbortController",
            "function lintArtifactHtml(",
            "function validateDeck(",
            "ARTIFACT_DECK_MAX_BYTES",
        ):
            self.assertIn(token, LIVE)


if __name__ == "__main__":
    unittest.main()
