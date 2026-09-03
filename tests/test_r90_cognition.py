"""R90 — the cognition ledger (docs/COGNITION.md).

The owner's rubric brief in one sentence: never "Ahmed scored 63%" — instead, what
did Ahmed's own thinking produce, judged in the context of the assistance given
immediately before it, stored longitudinally, told to the teacher as pedagogy.

These pins hold the scorer to the rubric rules that carry the design. They read the
SURFACE (the judge prompt and the function's contract), not implementation shapes —
the lesson of four releases of pins breaking on refactors.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SCORER = (ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts").read_text(
    encoding="utf-8"
)
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20260831120000_r90_cognition_ledger.sql"
).read_text(encoding="utf-8")


class TheJudgeCarriesTheRubricTests(unittest.TestCase):
    """The rubric's own rules, present verbatim-enough in the judge's instructions."""

    def test_the_core_principle_is_the_context(self):
        # §1: quality of the response vs quality of the student's own contribution.
        self.assertIn("IN THE CONTEXT OF THE ASSISTANCE GIVEN IMMEDIATELY BEFORE IT", SCORER)
        self.assertIn("attribute them to the tutor, not the student", SCORER)

    def test_the_scaffold_scale_is_the_rubrics(self):
        # §13: every AI intervention gets a machine-readable assistance level.
        for anchor in (
            "S0 no assistance",
            "S1 motivational or retrieval prompt",
            "S2 strategic prompt",
            "S3 conceptual hint",
            "S4 partial solution",
            "S5 worked answer",
        ):
            with self.subTest(anchor=anchor):
                self.assertIn(anchor, SCORER)

    def test_all_eight_dimensions_are_scored(self):
        for dim in (
            '"retrieval"',
            '"organization"',
            '"reasoning"',
            '"elaboration"',
            '"vocabulary"',
            '"expression"',
            '"independence"',
            '"metacognition"',
        ):
            with self.subTest(dim=dim):
                self.assertIn(dim, SCORER)

    def test_null_is_not_a_zero(self):
        # A response that gives no evidence for a dimension is not a 0 on it.
        self.assertIn("null is NOT a zero", SCORER)

    def test_word_count_is_not_elaboration(self):
        # §5's important rule, verbatim in spirit.
        self.assertIn("NEVER equate word count with elaboration", SCORER)

    def test_precision_beats_sophistication(self):
        # §6: do not reward needlessly difficult vocabulary.
        self.assertIn("Precision matters more than sophistication", SCORER)

    def test_grammar_never_lowers_cognition(self):
        # §7 + §18: mechanics live in expression and nowhere else.
        self.assertIn("Grammar, spelling and accent NEVER lower any dimension except expression", SCORER)
        self.assertIn("Strong reasoning in broken sentences is strong reasoning", SCORER)

    def test_judgments_are_normalized(self):
        # §17: grade band, subject, modality.
        self.assertIn("Normalize every judgment to the student's grade band", SCORER)

    def test_no_percentages_anywhere(self):
        # §15: do not reduce the model to a single percentage — not in the note,
        # not in the narrative, not in a column.
        self.assertIn("Never a percentage", SCORER)
        self.assertIn("No scores, no percentages", SCORER)
        # The schema itself: strip SQL comments (which SAY "no percentage") and check
        # no actual column is one.
        sql = "\n".join(
            line for line in MIGRATION.lower().splitlines() if not line.strip().startswith("--")
        )
        self.assertNotIn("percent", sql)
        self.assertNotIn("composite", sql)

    def test_the_narrative_ends_in_a_next_move(self):
        # The owner's example: "ready to progress after one more retrieval-practice
        # session" — pedagogy, not a verdict.
        self.assertIn("ONE concrete next move", SCORER)
        self.assertIn("retrieval-practice", SCORER)

    def test_evidence_is_quoted_not_vibed(self):
        self.assertIn("Evidence over vibes", SCORER)
        self.assertIn("ai_supplied", SCORER)
        self.assertIn("student_originated", SCORER)

    def test_no_sampling_params_reach_claude(self):
        # The live probe's find: current Claude models REJECT temperature — the first
        # scoring run answered "`temperature` is deprecated for this model." The same
        # latent bug sat in curriculum-admin's R85 Anthropic path, unfired only
        # because that deploy is still blocked.
        self.assertNotIn("temperature", without_comments(SCORER))
        admin = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
            encoding="utf-8"
        )
        anthropic_call = admin[
            admin.index("async function callAnthropicJson") : admin.index(
                "async function callModelJson"
            )
        ]
        self.assertNotIn("temperature", without_comments(anthropic_call))
        # ...and no assistant prefill ("This model does not support assistant message
        # prefill.") — JSON comes from instructions + fence-tolerant extraction, the
        # live chat function's recipe.
        self.assertNotIn('{ role: "assistant", content: "{" }', SCORER)
        self.assertNotIn('{ role: "assistant", content: "{" }', anthropic_call)
        self.assertIn("extractJsonObject", SCORER)


class WhatCountsAsAResponseTests(unittest.TestCase):
    def test_mcq_clicks_are_skipped_not_zeroed(self):
        self.assertIn('if (cleanText(payload.choice_id) && !text) return false;', SCORER)
        self.assertIn("Skipped turns are NOT zero-scored", SCORER)

    def test_code_is_a_constructed_response(self):
        self.assertIn('if (cleanText(payload.code)) return true;', SCORER)

    def test_short_acknowledgements_are_not_evidence(self):
        self.assertIn("MIN_CONSTRUCTED_CHARS = 25", SCORER)


class TheLedgerIsSafeTests(unittest.TestCase):
    def test_the_scorer_writes_only_its_own_ledger(self):
        # It reads the transcript; it must never write to it, or to anything else it
        # does not own. Expressed as the rule and not as "the file contains no PATCH":
        # that reading broke the moment the R92 sweep began patching its own run log,
        # which is not the transcript by any reading.
        writes = re.findall(
            r"""serviceFetch\(\s*config,\s*[`"](/rest/v1/[^`"]+)[`"],\s*\{\s*\n\s*method:\s*"(POST|PATCH|PUT|DELETE)\"""",
            SCORER,
        )
        self.assertTrue(writes, "no writes found — the regex has drifted from the code")
        tables = {path.split("/rest/v1/")[1].split("?")[0] for path, _ in writes}
        self.assertEqual(
            tables,
            {
                # Its own ledger.
                "cognition_turn_scores",
                "cognition_profiles",
                # Its own run log (R92).
                "cognition_sweep_runs",
                # R100: the probe it just scored — chat asks and records, the judge fills
                # in what the answer was worth. Still the scoring outcome, still its own.
                "cognition_probes",
                # R100, and the ONE table here the scorer does not own: a delayed unaided
                # check is the strongest evidence there is about what a student knows now,
                # so it moves their mastery. Deliberate, narrow (one idea per scored
                # probe), and held to chat's arithmetic by tests/test_r100_probe.py, which
                # reads MASTERY_EMA_ALPHA and MASTERY_PRIOR out of both files. If a third
                # table ever appears in this set, ask the same question again.
                "student_idea_mastery",
            },
        )

    def test_scoring_is_idempotent_per_rubric_version(self):
        self.assertIn("on_conflict=turn_id,rubric_version", SCORER)
        self.assertIn("resolution=ignore-duplicates", SCORER)
        self.assertIn("unique (turn_id, rubric_version)", MIGRATION)

    def test_the_function_authorizes_like_the_rls_policy(self):
        # Same three doors, function and policy: shared active class, org admin,
        # platform admin.
        for door in ("platform_admins", "class_memberships", "organization_memberships"):
            with self.subTest(door=door):
                self.assertIn(door, SCORER)
                self.assertIn(door, MIGRATION)
        self.assertIn("Access to this student's work is required.", SCORER)

    def test_rows_are_unreadable_without_a_door(self):
        self.assertIn("enable row level security", MIGRATION)
        # No insert/update/delete policy exists: only the service role writes.
        self.assertNotIn("for insert", MIGRATION)
        self.assertNotIn("for update", MIGRATION)

    def test_one_profile_per_student_per_lesson(self):
        self.assertIn("unique (user_id, lesson_id)", MIGRATION)
        self.assertIn("on_conflict=user_id,lesson_id", SCORER)


if __name__ == "__main__":
    unittest.main()
