"""Brain-first Phase B: idea-level mastery evidence + the brain read model."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20260930000000_brain_mastery.sql"
).read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")


class BrainMasterySchema(unittest.TestCase):
    def test_table_rls_and_step_mapping(self):
        self.assertIn("create table if not exists public.student_idea_mastery", MIGRATION)
        self.assertIn("primary key (user_id, idea_key)", MIGRATION)
        for policy in (
            "student_idea_mastery_owner_select",
            "student_idea_mastery_owner_insert",
            "student_idea_mastery_owner_update",
        ):
            self.assertIn(policy, MIGRATION)
        self.assertIn("add column if not exists idea_keys text[]", MIGRATION)

    def test_migration_deploys(self):
        self.assertIn("20260930000000_brain_mastery.sql", DEPLOY)


class BrainReadModel(unittest.TestCase):
    def test_context_loads_mastery_batched(self):
        self.assertIn("student_idea_mastery?user_id=eq.", CHAT)
        self.assertIn("ideaMastery: DbRow[];", CHAT)

    def test_read_model_shape_and_decay(self):
        self.assertIn("function buildBrainContext(", CHAT)
        self.assertIn("function effectiveMastery(", CHAT)
        # Decay floors at 0.4 — knowledge fades toward "needs a refresh", never to zero.
        self.assertIn("const MASTERY_DECAY_FLOOR = 0.4;", CHAT)
        self.assertIn("Math.max(MASTERY_DECAY_FLOOR, Math.exp(-days / MASTERY_DECAY_DAYS))", CHAT)
        for cap in ("BRAIN_WEAK_MAX", "BRAIN_STRONG_MAX", "BRAIN_FRONTIER_MAX", "BRAIN_TRAVELED_MAX"):
            self.assertIn(cap, CHAT)

    def test_brain_rides_the_payload_and_prompt(self):
        self.assertIn("brain: (() => {", CHAT)
        self.assertIn("- BRAIN: turn.brain (when present)", CHAT)

    def test_evidence_writer_wired_to_grading(self):
        self.assertIn("async function recordIdeaEvidence(", CHAT)
        self.assertIn("const MASTERY_EMA_ALPHA = 0.3;", CHAT)
        self.assertIn("const evidenceResult:", CHAT)
        # Echo-rejected answers are neutral — they count the attempt, move no score.
        self.assertIn('answerEchoesMentor\n      ? "neutral"', CHAT)
        self.assertIn("recordIdeaEvidence(", CHAT)
        self.assertIn("function evidenceIdeaKeys(", CHAT)


if __name__ == "__main__":
    unittest.main()
