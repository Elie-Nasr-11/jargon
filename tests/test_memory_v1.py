"""Static invariants for Memory v1 in the unified (TurnMode) chat fn.

The load-bearing rules this file pins:
- The Memory v1 summary/profile writer runs ONLY as a background task (the
  scheduleBackground/EdgeRuntime.waitUntil pattern) on the turn that transitions the
  session to complete, and is best-effort end to end.
- The cross-session memory reads in loadContext are best-effort (a failure yields
  absent memory, never a failed turn) and the prompt view is hard-capped and rides in
  the stable -> volatile key order.
- The memory_v1 migration is RLS-complete: owner policies that the chat fn's
  student-JWT writes can satisfy, teacher reads through can_view_student, and
  session_summaries stays append-only (no UPDATE/DELETE policies).
- chat/index.ts still holds NO service-role key.
- The deploy workflow applies the memory migration.

(The chat_mode pins that used to live here are gone with the feature: the declared
TurnMode design in test_turn_modes.py superseded chat_mode entirely.)
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


class MemoryWriteIsBackgroundOnly(unittest.TestCase):
    """(1) The summary write rides the background-schedule pattern on completion."""

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
        self.assertLess(memory_key, CHAT.index("recent_questions: recentQuestions.slice(0, 8)"))

    def test_system_prompt_memory_rule_replaced(self):
        self.assertIn("STUDENT MEMORY:", CHAT)
        self.assertIn("ONLY as described there", CHAT)
        # The hallucination guard survives, now scoped to "beyond student.memory".
        self.assertIn("never invent or claim specifics about the student's past sessions", CHAT)


class CommonErrorPatternsMirror(unittest.TestCase):
    """(2) upsertMisconception mirrors patterns into student_mastery, best-effort."""

    def test_merge_is_deduped_capped_and_row_gated(self):
        site = CHAT[CHAT.index("async function upsertMisconception") :]
        site = site[: site.index("\n}") + 2]
        # Only when the mastery row already exists — never creates one.
        self.assertIn("if (masteryRow) {", site)
        self.assertIn("!existingPatterns.includes(pattern)", site)
        self.assertIn("[...existingPatterns, pattern].slice(-5)", site)
        # Best-effort: a merge failure never fails the turn.
        self.assertRegex(site, r"} catch \{\s*\n\s*// Best-effort mirror only\.")


class MemoryMigration(unittest.TestCase):
    """(3) RLS enables + owner policies + can_view_student teacher reads."""

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
    """(4) The chat fn still runs entirely under the student's JWT."""

    def test_chat_fn_has_no_service_role_key(self):
        self.assertNotIn("SERVICE_ROLE", CHAT)


class DeployWorkflow(unittest.TestCase):
    """(5) The idempotent-migration list applies memory v1."""

    def test_workflow_lists_the_migration(self):
        self.assertIn("supabase/migrations/20260731100000_memory_v1.sql", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
