"""Systems Lab demo class: the everything-exercising second demo (20261002 seed)."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SEED = (
    ROOT / "supabase" / "migrations" / "20261002000000_systems_lab_demo.sql"
).read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")


class SystemsLabCatalog(unittest.TestCase):
    def test_two_lessons_published(self):
        self.assertIn("'mvp-sys-l1'", SEED)
        self.assertIn("'mvp-sys-l2'", SEED)
        self.assertIn("'mvp-systems-how-systems-work'", SEED)

    def test_steps_carry_idea_keys(self):
        # Every step binds to the knowledge graph so mastery evidence, recall
        # openers, and tier grading engage on this content from turn one.
        self.assertIn("idea_keys = excluded.idea_keys", SEED)
        self.assertIn("ARRAY['feedback-loop', 'inputs-and-outputs']::text[]", SEED)

    def test_step_mode_coverage(self):
        # The two lessons together cover the full step vocabulary the mentor runs.
        for mode in ("'explanation'", "'inquiry'", "'reflection'", "'practice'", "'assessment'"):
            self.assertIn(mode, SEED)
        for mode_type in ("'applied'", "'open_ended'", "'code'", "'mcq'"):
            self.assertIn(mode_type, SEED)

    def test_deploys_after_the_book_f_sweep(self):
        # The 20260713 sweep archives non-Book-F published rows each deploy; this
        # seed must re-publish AFTER it (same contract as the 20260801 catalog).
        sweep = DEPLOY.index("20260713000000_book_f_only_catalog.sql")
        seed = DEPLOY.index("20261002000000_systems_lab_demo.sql")
        self.assertGreater(seed, sweep)


class SystemsLabKnowledge(unittest.TestCase):
    def test_published_graph_reaches_all_three_mvp_subjects(self):
        for target in ("state-and-repetition", "exact-instructions", "claims-vs-reasons",
                       "fractions-as-division"):
            self.assertIn(target, SEED)
        for kind in ("'vocab_bridge'", "'same_pattern'", "'contrast'", "'prerequisite'"):
            self.assertIn(kind, SEED)

    def test_teacher_bank_is_guarded_not_unique_keyed(self):
        # practice_items has no unique constraint; re-runs must not duplicate rows.
        self.assertIn("where p.idea_key = v.idea_key and p.prompt = v.prompt", SEED)

    def test_draft_review_queue_seeded(self):
        # The studio-lite Knowledge card opens with one of each kind to review.
        self.assertIn("'equilibrium'", SEED)
        self.assertIn("'draft'", SEED)

    def test_resources_light_the_media_stage(self):
        self.assertIn("youtube.com/embed/", SEED)
        self.assertIn("'published', 'public'", SEED)


class SystemsLabClassWiring(unittest.TestCase):
    def test_skips_cleanly_without_demo_org(self):
        self.assertIn("skipping class wiring", SEED)

    def test_checkpoints_cover_due_and_graded(self):
        # One assigned upcoming assignment (Work due) + one returned scored
        # assessment (Grades / AVG pill), with the due date kept evergreen.
        self.assertIn("select v_cp, v_student, 'assigned'", SEED)
        self.assertIn("'returned', 0.9, 0.9", SEED)
        self.assertIn("set due_at = now() + interval '7 days'", SEED)


class SystemsLabStarterProgram(unittest.TestCase):
    def test_thermostat_program_runs_and_matches_expected_output(self):
        # Extract the starter program straight from the seed and run it through
        # the real interpreter — the shipped expected_output must be the truth.
        start = SEED.index("// A tiny thermostat")
        end = SEED.index('PRINT "The feedback loop held the room near the goal."', start)
        program = SEED[start : end + len('PRINT "The feedback loop held the room near the goal."')]

        import sys
        sys.path.insert(0, str(ROOT))
        from engine.jargon_interpreter import StructuredJargonInterpreter

        result = StructuredJargonInterpreter().run(program)
        self.assertEqual(result.get("status"), "ok", result.get("error"))
        expected = [
            "16", "Too cold - heater ON",
            "18", "Too cold - heater ON",
            "20", "Warm enough - heater OFF",
            "20", "Warm enough - heater OFF",
            "The feedback loop held the room near the goal.",
        ]
        self.assertEqual(result.get("output"), expected)
        # The expected_output column in the seed must be the same lines verbatim.
        self.assertIn("\n".join(expected), re.sub(r"\r", "", SEED))


if __name__ == "__main__":
    unittest.main()
