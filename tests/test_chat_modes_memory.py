"""Static invariants for the MVP backend slice: chat modes + Memory v1.

The load-bearing rules this file pins:
- A request WITHOUT chat_mode is the lesson flow, byte-identical to before: every new
  mode branch in chat/index.ts is gated on the parsed chatMode value, and the default
  (null) leaves each guarded expression exactly as it was.
- A chat-mode turn is conversation only: gates neutralized, no step grading, and the
  learning_sessions row (step_state, cursor, stage, status, steps_done, nav, counters)
  is NEVER patched on a mode turn.
- The Memory v1 summary/profile writer runs ONLY as a background task (the
  scheduleBackground/EdgeRuntime.waitUntil pattern) on the turn that transitions the
  session to complete, and is best-effort end to end.
- The memory_v1 migration is RLS-complete: owner policies that the chat fn's
  student-JWT writes can satisfy, teacher reads through can_view_student, and
  session_summaries stays append-only (no UPDATE/DELETE policies).
- chat/index.ts still holds NO service-role key.
- The deploy workflow applies the new migration.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()
MIGRATION = (
    REPO / "supabase" / "migrations" / "20260731100000_memory_v1.sql"
).read_text()
WORKFLOW = (REPO / ".github" / "workflows" / "deploy-backend.yml").read_text()


class ChatModeDefaultPathUnchanged(unittest.TestCase):
    """(1) Without chat_mode, none of the new mode branches can activate."""

    def test_chat_mode_is_parsed_against_a_closed_set(self):
        self.assertIn('const CHAT_MODE_OPTIONS = new Set(["open", "discuss", "quiz"])', CHAT)
        self.assertIn("CHAT_MODE_OPTIONS.has(body.chat_mode)", CHAT)
        # Unknown values refuse loudly instead of silently running the lesson flow.
        self.assertIn('chat_mode must be "open", "discuss", or "quiz".', CHAT)

    def test_mode_turns_require_an_existing_session(self):
        self.assertIn("chat_mode requires an existing session_id.", CHAT)

    def test_every_default_path_guard_keys_on_chat_mode(self):
        # Each of these expressions is the OLD expression with a chatMode gate added —
        # with chatMode null they evaluate exactly as before.
        for fragment in (
            'const controlType = chatMode ? "" : control ? String(control.type || "") : "";',
            "const requirements: StepRequirements = inRevisit || chatMode",
            "staleQuizAnswer || inRevisit || chatMode",
            "const effectiveOrchestratorAssessment: Assessment | null = chatMode\n      ? null",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, CHAT)
        # The graders/router that a mode turn must not pay for are all chatMode-gated.
        for name in ("isTextExplanation", "codeNeedsJudge", "routerEligible", "openEndedMiss"):
            with self.subTest(gated=name):
                self.assertRegex(
                    CHAT, rf"const {name}[^=]*=\s*(?://[^\n]*\n\s*)*!chatMode &&"
                )

    def test_mode_directives_live_behind_chat_mode_checks_in_turn_directive(self):
        directive_fn = CHAT[CHAT.index("function turnDirective") : CHAT.index("function skillKeysFor")]
        for mode, key in (("open", "open_conversation"), ("discuss", "discussion"), ("quiz", "quiz_practice")):
            with self.subTest(mode=mode):
                guard = directive_fn.index(f'if (chatMode === "{mode}")')
                self.assertLess(guard, directive_fn.index(f'key: "{key}"'))
        # The mode branch sits ABOVE the navigation branches (a mode turn ignores nav).
        self.assertLess(
            directive_fn.index('if (chatMode === "open")'),
            directive_fn.index('if (navAction === "revisit")'),
        )

    def test_envelope_echoes_chat_mode_only_when_set(self):
        self.assertIn("if (chatMode) envelope.chat_mode = chatMode;", CHAT)
        # makeEnvelope keeps the field absent unless a valid mode was stored.
        helper = CHAT[CHAT.index("function makeEnvelope") : CHAT.index("function typedError")]
        self.assertIn("CHAT_MODE_OPTIONS.has(partial.chat_mode)", helper)
        self.assertIn("chat_mode:", helper)


class ChatModeNeverWritesFlowState(unittest.TestCase):
    """(2) Mode turns never write step_state (or any other session-flow field)."""

    def test_session_patch_is_inside_the_no_chat_mode_guard(self):
        # The ONLY learning_sessions patch in the turn path is wrapped in if (!chatMode).
        guarded = re.search(
            r"if \(!chatMode\) \{\s*\n\s*await patchRows\(\s*\n?\s*config,\s*\n?\s*`learning_sessions\?",
            CHAT,
        )
        self.assertIsNotNone(guarded)
        # And there is exactly one learning_sessions PATCH site in the chat fn (the
        # other `learning_sessions?id=eq.` hit is loadOrCreateSession's read).
        self.assertEqual(
            len(re.findall(r"patchRows\(\s*\n?\s*config,\s*\n?\s*`learning_sessions\?", CHAT)), 1
        )

    def test_flow_record_writes_are_chat_mode_gated(self):
        # attempts/evidence/quiz_attempts/recommendations all sit behind this guard.
        self.assertIn("!staleQuizAnswer && !inRevisit && !chatMode", CHAT)

    def test_advancement_and_completion_are_chat_mode_gated(self):
        self.assertRegex(
            CHAT, r"finishedCurrentActivity =\s*(?://[^\n]*\n\s*)*!inRevisit &&\s*(?://[^\n]*\n\s*)*!chatMode &&"
        )
        self.assertRegex(
            CHAT,
            r"activitiesDoneThisTurn =\s*!advancing &&\s*(?://[^\n]*\n\s*)*!inRevisit &&\s*(?://[^\n]*\n\s*)*!chatMode &&",
        )

    def test_quiz_mode_writes_revision_recall_evidence_only(self):
        # Quiz mode's only durable grading trace is the shared evidence/mastery writer,
        # stamped mode='revision', mode_type='recall' — never lesson_attempts.
        block = re.search(
            r'if \(chatMode === "quiz" && quizModeAssessment && answer && skillKeys\.length\) \{.*?\n    \}',
            CHAT,
            re.S,
        )
        self.assertIsNotNone(block)
        body = block.group(0)
        self.assertIn("writeEvidenceAndMastery(", body)
        self.assertIn('"revision"', body)
        self.assertIn('"recall"', body)
        self.assertNotIn("lesson_attempts", body)
        self.assertNotIn("step_state", body)


class MemoryWriteIsBackgroundOnly(unittest.TestCase):
    """(3) The summary write rides the background-schedule pattern on completion."""

    def test_summary_writer_is_scheduled_in_background(self):
        self.assertRegex(CHAT, r"scheduleBackground\(\s*writeSessionMemory\(")

    def test_scheduled_exactly_on_the_transition_to_complete(self):
        site = re.search(
            r'nextStatus === "complete" &&\s*String\(session\.status \|\| ""\) !== "complete"\s*\) \{\s*scheduleBackground\(\s*writeSessionMemory\(',
            CHAT,
        )
        self.assertIsNotNone(site)

    def test_writer_is_best_effort_and_cheap_route(self):
        writer = CHAT[
            CHAT.index("async function writeSessionMemory") : CHAT.index(
                "async function handleTypedRequest"
            )
        ]
        # One model call on the cheap understanding route; failures log, never throw.
        self.assertIn('"understanding"', writer)
        self.assertIn('console.error("memory_write_failed"', writer)
        # Duplicate session summaries are ignored, not errors.
        self.assertIn("session_summaries?on_conflict=session_id", writer)
        self.assertIn("resolution=ignore-duplicates", writer)
        # Profile upsert merges on the pk under the student's own JWT.
        self.assertIn('"student_memory"', writer)
        self.assertIn('"user_id"', writer)

    def test_memory_reads_are_best_effort_in_load_context(self):
        loader = CHAT[CHAT.index("async function loadContext") : CHAT.index("async function rescopeActivity")]
        self.assertRegex(
            loader, r"student_memory\?user_id=eq\.[^\n]*\n\s*\)\.catch\(\(\) => null\)"
        )
        self.assertRegex(
            loader, r"session_summaries\?user_id=eq\.[^\n]*\n\s*\)\.catch\(\(\) => \[\]"
        )
        # The current session's own summary is excluded from the recall window.
        self.assertIn("session_id=neq.", loader)

    def test_prompt_memory_is_capped_and_stable_ordered(self):
        self.assertIn("const MEMORY_NARRATIVE_MAX = 600;", CHAT)
        self.assertIn("const MEMORY_SUMMARY_MAX = 240;", CHAT)
        # student.memory rides with the stable student keys, before the per-turn
        # recent_questions (the stable -> volatile prompt-cache discipline).
        memory_key = CHAT.index("memory: memoryForPrompt(context.memory, context.recentSummaries)")
        self.assertLess(memory_key, CHAT.index("recent_questions: recentQuestions.slice(0, 4)"))

    def test_system_prompt_memory_rule_replaced(self):
        self.assertIn("STUDENT MEMORY:", CHAT)
        self.assertIn("ONLY as described there", CHAT)
        # The hallucination guard survives, now scoped to "beyond student.memory".
        self.assertIn("never invent or claim specifics about the student's past sessions", CHAT)


class MemoryMigration(unittest.TestCase):
    """(4) RLS enables + owner policies + can_view_student teacher reads."""

    def test_tables_and_shapes(self):
        self.assertIn("create table if not exists public.session_summaries", MIGRATION)
        self.assertIn("session_id uuid not null unique", MIGRATION)
        self.assertIn("summary jsonb not null", MIGRATION)
        self.assertIn("create table if not exists public.student_memory", MIGRATION)
        self.assertIn("user_id uuid primary key", MIGRATION)
        self.assertIn("profile jsonb not null default '{}'::jsonb", MIGRATION)

    def test_rls_enabled_on_both(self):
        self.assertIn(
            "alter table if exists public.session_summaries enable row level security",
            MIGRATION,
        )
        self.assertIn(
            "alter table if exists public.student_memory enable row level security",
            MIGRATION,
        )

    def test_owner_policies_cover_the_chat_fn_writes(self):
        for policy in (
            "session_summaries_owner_insert",
            "session_summaries_owner_select",
            "student_memory_owner_insert",
            "student_memory_owner_update",
            "student_memory_owner_select",
        ):
            with self.subTest(policy=policy):
                self.assertIn(policy, MIGRATION)
        self.assertIn("auth.uid() = user_id", MIGRATION)

    def test_teacher_reads_via_can_view_student(self):
        self.assertEqual(MIGRATION.count("using (can_view_student(user_id))"), 2)
        self.assertIn("session_summaries_teacher_read", MIGRATION)
        self.assertIn("student_memory_teacher_read", MIGRATION)

    def test_session_summaries_is_append_only(self):
        # No UPDATE/DELETE policies (and no such grants) on the summaries table.
        summaries_sql = MIGRATION[: MIGRATION.index("create table if not exists public.student_memory")]
        self.assertNotIn("for update", summaries_sql)
        self.assertNotIn("for delete", summaries_sql)
        self.assertIn("grant select, insert on public.session_summaries to authenticated", summaries_sql)

    def test_no_anon_access(self):
        self.assertIn("revoke all on public.session_summaries from anon", MIGRATION)
        self.assertIn("revoke all on public.student_memory from anon", MIGRATION)
        self.assertNotIn("to anon", MIGRATION)


class ServiceRolePosture(unittest.TestCase):
    """(5) The chat fn still runs entirely under the student's JWT."""

    def test_chat_fn_has_no_service_role_key(self):
        self.assertNotIn("SERVICE_ROLE", CHAT)


class DeployWorkflow(unittest.TestCase):
    """(6) The idempotent-migration list applies memory v1."""

    def test_workflow_lists_the_migration(self):
        self.assertIn("supabase/migrations/20260731100000_memory_v1.sql", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
