"""R91 — rubric §19: the cognition profile STEERS the mentor.

R90 built the ledger; §19 is the half that makes it matter — "The rubric should not
merely evaluate the learner. It should influence how Jargon Mentor responds."

The DERIVATION (learnerSteer: profile -> at most two imperative moves) is property-
tested in tests/flow_core.test.ts against the real exported function. These pins hold
the WIRING and the prompt rules: that the profile is actually read per turn, rides the
payload, reaches the model as instructions that outrank the default help level, and
that none of it is ever said to the student.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
DENO_SUITE = (ROOT / "tests" / "flow_core.test.ts").read_text(encoding="utf-8")


class TheProfileReachesTheMentorTests(unittest.TestCase):
    def test_it_is_read_for_this_student_and_this_lesson(self):
        self.assertIn("cognition_profiles?user_id=eq.", CHAT)
        self.assertIn("cognitionProfile", CHAT)

    def test_the_read_is_best_effort(self):
        # A scorer that has never run, or a failed read, must not break a lesson —
        # steering is additive, never a gate.
        block = CHAT[CHAT.index("cognition_profiles?user_id=eq.") :][:400]
        self.assertIn(".catch(() => null)", block)
        self.assertIn("cognitionProfile: DbRow | null;", CHAT)

    def test_it_rides_the_cacheable_prefix(self):
        # A profile changes only when the scorer re-runs, so it is byte-identical turn
        # over turn — putting it in the live block would cost a cache miss every turn.
        stable = CHAT[CHAT.index("const MENTOR_STABLE_PAYLOAD_KEYS") :]
        self.assertIn('"learner",', stable[: stable.index("]);")])

    def test_the_payload_carries_the_derived_steer_not_raw_scores(self):
        self.assertIn("learner: learnerSteer(context.cognitionProfile) ?? undefined,", CHAT)


class TheRulesActOnItTests(unittest.TestCase):
    def test_the_moves_outrank_the_default_help_level(self):
        # Otherwise the steer is a note the mentor may ignore, which is exactly the
        # failure §19 exists to prevent.
        self.assertIn("HOW THIS STUDENT THINKS", CHAT)
        self.assertIn("OUTRANK your\ndefault help level for this turn", CHAT)

    def test_the_steer_still_obeys_the_prompts_hard_rules(self):
        # A steer that could break EXACTLY ONE ASK or the school's help ceiling would
        # be a regression dressed as pedagogy.
        self.assertIn("policy.help_ceiling, EXACTLY ONE\nASK", CHAT)

    def test_a_rising_scaffold_trend_is_named_as_the_warning(self):
        self.assertIn('"rising" when you have been giving', CHAT)

    def test_absent_profile_changes_nothing(self):
        self.assertIn('If "learner" is absent, teach exactly as these rules already say.', CHAT)


class TheStudentIsNeverToldTests(unittest.TestCase):
    def test_the_prompt_forbids_saying_any_of_it(self):
        self.assertIn("NEVER SAY ANY OF THIS TO THE STUDENT", CHAT)
        self.assertIn("never quote or paraphrase a move back at them", CHAT)

    def test_the_student_experiences_the_change_not_the_measurement(self):
        self.assertIn("A student should only ever experience the\nCHANGE", CHAT)

    def test_no_move_text_carries_a_number_or_names_the_measurement(self):
        # Belt to the deno property's braces: the literal move strings themselves.
        #
        # The rule is about what a student could be shown, so it reads the STRINGS. The
        # comments around them are for whoever maintains this table and are allowed to
        # name the measurement — R103's move is documented as "not keyed on a dimension",
        # which the old slice-the-whole-block version read as a violation.
        block = without_comments(CHAT)
        block = block[block.index("const STEER_MOVES") : block.index("function steerDim")]
        moves = re.findall(r'"((?:[^"\\]|\\.)*)"', block)
        self.assertGreaterEqual(len(moves), 7, "the move strings were not found")
        for move in moves:
            for banned in ("rubric", "score", "dimension", "0-4", "/4"):
                with self.subTest(banned=banned, move=move[:40]):
                    self.assertNotIn(banned, move.lower())
            with self.subTest(move=move[:40]):
                self.assertNotRegex(move, r"\d")


class TheDerivationIsPropertyTestedTests(unittest.TestCase):
    def test_the_deno_suite_covers_each_section_19_rule(self):
        # These names are the rubric's own rules; if a rule loses its test, §19 is only
        # half-held.
        for rule in (
            "dependency outranks everything",
            "mastery fades scaffolding and introduces transfer",
            "the weakest dimension is steered first",
            "weak expression beside strong reasoning asks for a reformulation",
            "weak expression AND weak reasoning steers the reasoning",
            "never more than two moves",
            "a move never carries a score",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, DENO_SUITE)

    def test_the_function_is_exported_so_the_suite_tests_the_real_one(self):
        self.assertIn("export function learnerSteer(", CHAT)
        self.assertIn("learnerSteer,", DENO_SUITE)

    def test_an_absent_trend_is_absent_not_steady(self):
        # Number(null) is 0 and 0 is finite: the naive check reported "steady" for a
        # profile with no trend yet, and fed the dependency rule a comparison that
        # never happened. Found by the property test, not by review.
        self.assertIn("const numOrNull = (value: unknown): number | null =>", CHAT)
        self.assertNotIn("Number.isFinite(earlier) && Number.isFinite(recent)", without_comments(CHAT))


if __name__ == "__main__":
    unittest.main()
