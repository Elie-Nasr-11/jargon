"""Static invariants for Memory v2: relevance-picked summaries, profile decay, the
abandonment sweep, and the student-owned reset.

The load-bearing rules this file pins:
- The prompt's summary slots are picked by RELEVANCE (lesson > unit > keywords, recency
  tiebreak) over a bounded pool, the newest summary always rides, and the per-turn token
  budget stays flat (still at most 3 summaries, same caps).
- Profile list entries decay: last-affirmed stamps in profile.affirmed, struggles on the
  short TTL, and expiry enforced at BOTH write and read.
- Abandoned sessions get summarized: the sweep runs only in the background on a FRESH
  open, is bounded per open, requires substance (min turns) and real idleness, and is
  idempotent + best-effort like every other memory path.
- Reset is the ONE exception to append-only summaries: owner-scoped DELETE policies in
  the v2 migration, a wholesale client delete, and the deploy workflow applies the
  migration.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()
MIGRATION = (
    REPO / "supabase" / "migrations" / "20260910000000_memory_v2.sql"
).read_text()
WORKFLOW = (REPO / ".github" / "workflows" / "deploy-backend.yml").read_text()
API = (REPO / "frontend" / "src" / "lib" / "api.ts").read_text()
HOME = (REPO / "frontend" / "src" / "student" / "StudentHome.tsx").read_text()


class RelevancePickedSummaries(unittest.TestCase):
    """Summaries ride by relevance to the current lesson, not recency alone."""

    def test_pool_is_bounded_and_best_effort(self):
        self.assertIn("const MEMORY_SUMMARY_POOL = 40;", CHAT)
        loader = CHAT[
            CHAT.index("async function loadContext") : CHAT.index(
                "async function rescopeActivity"
            )
        ]
        self.assertIn("limit=${MEMORY_SUMMARY_POOL}", loader)
        # Still best-effort, still excludes the current session.
        self.assertRegex(
            loader, r"session_summaries\?user_id=eq\.[^\n]*\n\s*\)\.catch\(\(\) => \[\]"
        )
        self.assertIn("session_id=neq.", loader)

    def test_picker_ranks_lesson_over_unit_over_keywords(self):
        picker = CHAT[
            CHAT.index("function pickRelevantSummaries") : CHAT.index(
                "function memoryForPrompt"
            )
        ]
        # Tiered scores: exact lesson beats unit beats capped keyword hits.
        self.assertIn("if (rowLesson && rowLesson === lessonId) score += 6;", picker)
        self.assertIn("else if (rowLesson && unitLessonIds.has(rowLesson)) score += 3;", picker)
        self.assertIn("if (hits >= 3) break;", picker)
        # The recency tiebreak can never outweigh a tier.
        self.assertIn("score += Math.max(0, 2 - index * 0.1);", picker)
        # The newest summary ALWAYS rides (continuity guarantee).
        self.assertIn("entry.index === 0", picker)

    def test_prompt_budget_stays_flat(self):
        # The prompt view still takes at most 3 summaries at the same caps.
        self.assertIn(".slice(0, 3)", CHAT[CHAT.index("function memoryForPrompt") :])
        self.assertIn("const MEMORY_SUMMARY_MAX = 240;", CHAT)
        self.assertIn("const MEMORY_NARRATIVE_MAX = 600;", CHAT)

    def test_unit_siblings_read_is_best_effort(self):
        loader = CHAT[
            CHAT.index("async function loadContext") : CHAT.index(
                "async function rescopeActivity"
            )
        ]
        self.assertRegex(
            loader, r"lessons\?unit_id=eq\.[^\n]*\n\s*\)\.catch\(\(\) => \[\]"
        )
        self.assertIn("pickRelevantSummaries(", loader)


class ProfileDecay(unittest.TestCase):
    """Struggles stop following the student around: TTLs at write AND read."""

    def test_ttl_constants(self):
        self.assertIn("const MEMORY_STRUGGLE_TTL_DAYS = 45;", CHAT)
        self.assertIn("const MEMORY_TRAIT_TTL_DAYS = 120;", CHAT)

    def test_unstamped_entries_are_grandfathered(self):
        fresh = CHAT[
            CHAT.index("function freshEntries") : CHAT.index(
                "function pickRelevantSummaries"
            )
        ]
        self.assertIn("if (!stamp) return true;", fresh)

    def test_write_path_stamps_and_prunes(self):
        writer = CHAT[
            CHAT.index("async function writeSessionMemory") : CHAT.index(
                "const MEMORY_SWEEP_MIN_TURNS"
            )
        ]
        # Re-affirmed entries get a fresh stamp; kept entries keep their old one.
        self.assertIn("const rollList = (kind: string", writer)
        self.assertIn("nextAffirmed[`${kind}:${entry}`]", writer)
        self.assertIn('MEMORY_STRUGGLE_TTL_DAYS', writer)
        self.assertIn("affirmed: nextAffirmed", writer)

    def test_read_path_filters_expired_entries(self):
        view = CHAT[CHAT.index("function memoryForPrompt") : CHAT.index("artifactForEnvelope")]
        self.assertIn('"struggles",', view)
        self.assertIn("MEMORY_STRUGGLE_TTL_DAYS", view)
        self.assertIn("MEMORY_TRAIT_TTL_DAYS", view)


class AbandonmentSweep(unittest.TestCase):
    """Memory stops skewing toward finishers — bounded, idempotent, background-only."""

    def test_sweep_constants(self):
        self.assertIn("const MEMORY_SWEEP_MIN_TURNS = 6;", CHAT)
        self.assertIn("const MEMORY_SWEEP_MIN_AGE_MS = 30 * 60 * 1000;", CHAT)
        self.assertIn("const MEMORY_SWEEP_MAX_SESSIONS = 2;", CHAT)

    def test_sweep_runs_only_in_background_on_fresh_open(self):
        self.assertRegex(
            CHAT,
            r"if \(!body\.session_id\) \{\s*scheduleBackground\(sweepUnsummarizedSessions\(",
        )
        # Exactly one call site, and it is the scheduled one.
        self.assertEqual(CHAT.count("sweepUnsummarizedSessions("), 2)

    def test_sweep_requires_substance_idleness_and_no_existing_summary(self):
        sweep = CHAT[
            CHAT.index("async function sweepUnsummarizedSessions") : CHAT.index(
                "async function handleTypedRequest"
            )
        ]
        self.assertIn("status=neq.complete", sweep)
        self.assertIn("Date.now() - idleSince < MEMORY_SWEEP_MIN_AGE_MS", sweep)
        self.assertIn(
            "summaryRows.length > 0 || turnRows.length < MEMORY_SWEEP_MIN_TURNS", sweep
        )
        self.assertIn("written >= MEMORY_SWEEP_MAX_SESSIONS", sweep)
        # Best-effort: failures log, never throw into the turn.
        self.assertIn('console.error("memory_sweep_failed"', sweep)


class StudentOwnedReset(unittest.TestCase):
    """The reset affordance: owner-only deletes, wholesale on the client."""

    def test_migration_grants_owner_scoped_deletes_only(self):
        for policy in (
            "session_summaries_owner_delete",
            "student_memory_owner_delete",
        ):
            with self.subTest(policy=policy):
                self.assertIn(policy, MIGRATION)
        self.assertIn("using (auth.uid() = user_id)", MIGRATION)
        # Still no per-row edit path: v2 adds no UPDATE on summaries, and nothing for anon.
        self.assertNotIn("for update", MIGRATION)
        self.assertNotIn("to anon", MIGRATION)

    def test_migration_adds_the_relevance_index(self):
        self.assertIn("session_summaries_user_lesson_idx", MIGRATION)
        self.assertIn("(user_id, lesson_id)", MIGRATION)

    def test_client_reset_is_wholesale_and_owner_scoped(self):
        reset = API[API.index("export async function resetStudentMemory") :]
        reset = reset[: reset.index("\n}") + 2]
        self.assertIn('from("student_memory").delete().eq("user_id", userId)', reset)
        self.assertIn('from("session_summaries")', reset)
        # No row-level targeting — the only delete filter is the student themself.
        self.assertNotIn('eq("id"', reset)
        self.assertNotIn('eq("session_id"', reset)

    def test_memory_card_confirms_before_forgetting(self):
        self.assertIn("resetStudentMemory", HOME)
        self.assertIn("Forget everything your mentor remembers?", HOME)
        # Two-step: the destructive button appears only after the confirm state.
        self.assertIn('setResetState("confirm")', HOME)
        # The recap strip clears with the memory (one reset, no stale leftovers).
        self.assertIn("onAfterReset={() => setRecaps([])}", HOME)

    def test_workflow_applies_the_v2_migration(self):
        self.assertIn("supabase/migrations/20260910000000_memory_v2.sql", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
