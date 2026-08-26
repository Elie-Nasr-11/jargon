"""R66 — launch hardening: the student path degrades, it does not die.

Owner (2026-08-26): schools launch in days; "we can't have this happen at all
later." Three layers, each pinning a failure class the static suite could never
see on its own:

1. scheduleBackground defensively catches every task — an unhandled rejection
   inside waitUntil can kill the isolate, turning one background hiccup into a
   dead student turn. Self-catching callers were a convention; now a guarantee.
2. Optional context reads are fail-soft: a transient hiccup on mastery,
   resources, interactions, profile, milestone, misconceptions, or chunks costs
   that garnish, never the turn. Loads that guard INTEGRITY or correctness stay
   hard on purpose: lesson, activities, recentTurns (dedup/idempotency), the
   quiz rows (a transiently "missing" quiz must never silently drop a quiz
   gate), and stepWork (its own fail-closed contract).
3. A LIVE smoke test drives a real student turn against the DEPLOYED function
   after every deploy and on a 2-hour heartbeat — sign-in, the R65
   stale-pointer self-heal, and a resume turn with a non-empty mentor reply.
   The pins here only anchor its existence and contract; the proof runs in CI.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
SMOKE = (ROOT / "scripts" / "smoke-live-turn.mjs").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github" / "workflows" / "smoke-live.yml").read_text(encoding="utf-8")


class BackgroundTasksCannotKillTheTurn(unittest.TestCase):
    def test_schedule_background_defensively_catches(self):
        block = CHAT.split("function scheduleBackground(", 1)[1]
        block = block[: block.index("\n}")]
        self.assertIn('task.catch((err) =>', block)
        self.assertIn('console.error("background_task_failed"', block)
        self.assertIn("runtime.waitUntil(safe);", block)


class OptionalContextIsFailSoft(unittest.TestCase):
    def test_the_seven_optional_reads_are_caught(self):
        # Each softened read carries its R66 marker comment beside the catch.
        self.assertGreaterEqual(CHAT.count("// R66: optional"), 7)

    def test_integrity_reads_stay_hard(self):
        # The quiz rows must never be silently absent — a transient read failure
        # that dropped a quiz gate would let a graded step pass ungraded.
        quiz_read = CHAT.split("quiz_items?lesson_id=eq.", 2)[1][:400]
        self.assertNotIn(".catch(", quiz_read)
        # The lesson and step-list reads fail the turn honestly too.
        lesson_read = CHAT.split("lessons?id=eq.", 1)[1][:400]
        self.assertNotIn(".catch(", lesson_read.split("loadMany", 1)[0])


class LiveSmokeExists(unittest.TestCase):
    def test_the_script_exercises_the_real_seams(self):
        self.assertIn("auth/v1/token?grant_type=password", SMOKE)
        self.assertIn("functions/v1/chat", SMOKE)
        # The stale-pointer heal is asserted with a well-formed, never-existing id.
        self.assertIn("00000000-0000-4000-8000-000000000000", SMOKE)
        self.assertIn("server echoed the bogus session id instead of healing", SMOKE)
        # A configured failure is loud; missing secrets skip green with a warning.
        self.assertIn("process.exit(1)", SMOKE)
        self.assertIn("::warning title=Live smoke SKIPPED::", SMOKE)

    def test_the_workflow_runs_after_deploys_and_on_a_heartbeat(self):
        self.assertIn('workflows: ["Deploy backend (Supabase)"]', WORKFLOW)
        self.assertIn('cron: "17 */2 * * *"', WORKFLOW)
        self.assertIn("workflow_dispatch", WORKFLOW)
        self.assertIn("node scripts/smoke-live-turn.mjs", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
