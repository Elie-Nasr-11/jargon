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
from tests.teacher_sources import authoring_source

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

    def test_class_linkage_joins_through_course_versions(self):
        # units has NO course_id column — it carries course_version_id, and course_id
        # lives on course_versions. A one-hop `units?...select=course_id` is a PostgREST
        # 400 on an unknown column, and serviceFetch throws on !ok, so the regression
        # 500s every build for a student in more than one class.
        unit_select = re.search(r"units\?id=eq\.[^`]*select=([a-z_,]+)", LIVE)
        self.assertIsNotNone(unit_select)
        self.assertEqual(unit_select.group(1), "course_version_id")
        self.assertIn("course_versions?id=eq.", LIVE)
        # Refinement is best-effort: a linkage failure must not sink the build.
        linkage = LIVE[LIVE.index("units?id=eq.") : LIVE.index("let organizationId")]
        self.assertIn("catch (linkageError)", linkage)

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


class ChatLiveArtifactWire(unittest.TestCase):
    def test_envelope_offer_field_with_tristate(self):
        self.assertIn("artifact_offer?: { label: string;", CHAT)
        # makeEnvelope must normalize it like continue_offer (absent stays absent).
        self.assertIn("partial.artifact_offer === null", CHAT)

    def test_offer_gates(self):
        # Project assist widened the trigger rung: the block now ends on the
        # PROJECT_DECK_REQUEST_RE alternative (same gates, one more way in).
        block = re.search(
            r"const artifactOfferEligible =.*?PROJECT_DECK_REQUEST_RE\.test\(content\)\);",
            CHAT,
            re.S,
        )
        self.assertIsNotNone(block)
        gates = block.group(0)
        for token in (
            "allow_live_artifacts === true",
            '!== "assessment"',
            '!== "revision"',
            '!== "open_ended"',
            "!inRevisit",
            "!stepStateBefore.artifact_offer_at",
            "graded_fails >= 2",
            "hintRung >= 3",
        ):
            self.assertIn(token, gates)
        # The pill never renders under a just-finished step.
        self.assertIn("artifactOfferEligible && !advancing && !finalStepDone", CHAT)

    def test_artifact_ready_control_is_validated(self):
        branch = re.search(
            r'controlType === "artifact_ready".*?artifactReadyResource = candidate;',
            CHAT,
            re.S,
        )
        self.assertIsNotNone(branch)
        body = branch.group(0)
        # Belt-and-braces: RLS-loaded row + artifact type + mentor provenance + session.
        self.assertIn('String(candidate.resource_type) === "artifact"', body)
        self.assertIn("generated.session_id", body)
        # Invalid ids refuse deterministically (no mentor turn, no writes).
        self.assertIn("That activity isn't ready yet", CHAT)

    def test_step_state_gains_bookkeeping(self):
        for token in (
            "artifact_offer_at: null",
            "artifact_generated: 0",
            "artifact_last_resource_id: null",
            "iso(raw.artifact_offer_at)",
            "count(raw.artifact_generated)",
        ):
            self.assertIn(token, CHAT)

    def test_loader_hygiene(self):
        # Mentor-built rows never ride the ordinary attach rungs...
        self.assertIn("const curatedResources = context.resources.filter", CHAT)
        self.assertIn("isGeneratedResource", CHAT)
        # ...and the pinned loader select prefix survives, now carrying the student's
        # own student_private rows via RLS with headroom for curated materials.
        self.assertIn("lesson_resources?lesson_id=eq.", CHAT)
        self.assertIn("limit=16", CHAT)

    def test_lesson_select_carries_toggle(self):
        self.assertIn("grade_band,allow_live_artifacts`", CHAT)

    def test_frontend_wire(self):
        front = REPO / "frontend" / "src"
        types = (front / "lib" / "types.ts").read_text()
        api = (front / "lib" / "api.ts").read_text()
        supa = (front / "lib" / "supabase.ts").read_text()
        chat_messages = (
            front / "features" / "student" / "chat" / "chatMessages.ts"
        ).read_text()
        studio = authoring_source()
        # Types: the control union + per-student visibility.
        self.assertIn('"continue" | "navigate" | "resume" | "artifact_ready"', types)
        self.assertIn('"student_private"', types)
        # API: the long-call budget matches the server's ~150s gateway wall.
        self.assertIn("export async function generateLiveArtifact(", api)
        gen = api[api.index("export async function generateLiveArtifact(") :]
        self.assertIn("150000", gen[:1600])
        self.assertIn('"artifact-live"', supa)
        # Model: the offer is live-turn only (never replayed from history) and rides the
        # envelope adapter, so a resubscribing surface gets the data path for free.
        self.assertIn("artifactOffer: envelope.artifact_offer ?? undefined", chat_messages)
        # Studio: the opt-in toggle + student-private oversight with the promote action.
        self.assertIn("allow_live_artifacts: fields.allowLiveArtifacts", studio)
        self.assertIn("Share with class", studio)
        self.assertIn('visibility: "class_private"', studio)
        self.assertIn("student_id: null", studio)

    def test_v6_client_build_loop(self):
        # Re-anchored 2026-07-30 (slice B2): the client build loop retired with
        # routes/chat.tsx is RECONNECTED on the v6 surface — the offer pill lives in the
        # transcript, the 30-90s build runs in useConversation OUTSIDE the turn loop.
        front = REPO / "frontend" / "src"
        hook = (front / "student" / "useConversation.ts").read_text()
        transcript = (front / "student" / "Transcript.tsx").read_text()
        # The tap calls the dedicated artifact-live client (never invokeTypedChat).
        self.assertIn("await generateLiveArtifact({", hook)
        # Consent stays consent: the offer is consumed off its message at tap so the
        # retired pill can't flash back between bubbles.
        self.assertIn("artifactOffer: undefined", hook)
        # On success the mentor presents the card through an artifact_ready control turn
        # (the ONLY path that attaches a mentor-built row).
        self.assertIn('control: { type: "artifact_ready", resource_id: built.resource_id }', hook)
        # Busy-retry: a build resolving mid-turn waits the in-flight turn out and
        # re-posts, so a successful build is never silently dropped.
        self.assertIn('outcome === "busy"', hook)
        self.assertIn("await inFlightTurnRef.current?.catch(() => {})", hook)
        # Lesson-switch guard: a build that resolves after the lesson changed is dropped,
        # never smeared into the new session.
        self.assertIn("lessonRef.current?.id !== builtForLesson", hook)
        # The pill: rides the offering message, live only while it is the latest mentor
        # message (like the Continue pill), and carries the canonical label fallback.
        self.assertIn("message.artifactOffer && isLatestBot && !message.isError", transcript)
        self.assertIn("channel.buildArtifact(message.artifactOffer!)", transcript)
        self.assertIn('"Build me a quick activity"', transcript)

    def test_admin_passes_toggle_through(self):
        admin = (
            REPO / "supabase" / "functions" / "curriculum-admin" / "index.ts"
        ).read_text()
        # The RULE: a teacher's per-lesson toggle survives the lesson write path.
        # R102 note — this pin used to list three code shapes. Two of them lived inside
        # the template handlers (saveTemplate, instantiateTemplate), which were archived
        # to archive/curriculum-templates/. The live path is the one that matters and is
        # asserted here; restoring templates should re-add their own pin.
        self.assertIn(
            "policyPatch.allow_live_artifacts = meta.allow_live_artifacts", admin
        )


if __name__ == "__main__":
    unittest.main()
