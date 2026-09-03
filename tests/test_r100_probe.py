"""R100 — the delayed unaided ask (rubric §10 transfer, §11 retention, §20).

The rubric refuses to let these two be inferred: transfer "should generally be assessed
through a separate task rather than inferred from the original response", retention
"through delayed independent retrieval". Until this release the product had no moment
where it asked a student to produce something with no help, later — so §10 and §11 were
unmeasurable, and §14's central claim ("a learner who performs well only when substantial
AI support is available should not be classified as independently proficient") had nothing
to compare against.

The rules pinned here are the ones that make it a measurement rather than a nuisance:

  * ONE PER SESSION, enforced by the schema and not by the handler remembering.
  * ONLY GENUINELY DELAYED — evidence from this sitting is a comprehension check.
  * UNAIDED IS THE POINT — the ask carries no content, and does not present the step.
  * DECLINING IS NOT FAILING — a skip expires the probe; it does not score a zero.
  * THE RESULT CHANGES SOMETHING — it feeds back into mastery, and it stops §19 calling
    a student mastered on evidence a delayed check contradicted.

The property tests that exercise the selection itself live in tests/flow_core.test.ts and
run through the Pillar-4 harness; these are the rules that text can hold.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
CHAT_CODE = without_comments(CHAT)
SCORER = (
    ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts"
).read_text(encoding="utf-8")
SCORER_CODE = without_comments(SCORER)
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20261103000000_r100_cognition_probes.sql"
).read_text(encoding="utf-8")
SWEEP = (
    ROOT / "supabase" / "migrations" / "20260831140000_r92_cognition_sweep.sql"
).read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
DENO_SUITE = (ROOT / "tests" / "flow_core.test.ts").read_text(encoding="utf-8")
PANEL = (
    ROOT / "frontend" / "src" / "features" / "teacher" / "console" / "CognitionPanel.tsx"
).read_text(encoding="utf-8")
LABELS = (
    ROOT / "frontend" / "src" / "features" / "teacher" / "cognition" / "labels.ts"
).read_text(encoding="utf-8")


def number_in(source: str, name: str) -> float:
    match = re.search(rf"const {name} = ([0-9.]+);", source)
    assert match, f"expected {name} to be a named constant"
    return float(match.group(1))


class OnePerSessionIsStructural(unittest.TestCase):
    def test_the_database_refuses_a_second_probe_in_one_session(self) -> None:
        """A rule the handler has to remember is a rule that eventually gets forgotten."""
        self.assertRegex(MIGRATION, r"unique \(session_id\)")

    def test_a_second_one_is_also_ruled_out_before_the_insert(self) -> None:
        """The constraint is the guard; checking first is what stops a wasted error."""
        self.assertIn("!context.sessionProbe", CHAT_CODE)

    def test_there_is_a_gap_between_probes_at_all(self) -> None:
        """Sessions are cheap to start. Being quizzed at the top of each is a nuisance."""
        self.assertGreater(number_in(CHAT_CODE, "PROBE_MIN_GAP_HOURS"), 0)
        self.assertIn("PROBE_MIN_GAP_HOURS", CHAT_CODE.split("const probePick")[1])


class OnlyGenuinelyDelayed(unittest.TestCase):
    def test_evidence_from_this_sitting_is_not_delayed_retrieval(self) -> None:
        picker = CHAT_CODE[CHAT_CODE.index("export function pickProbe(") :]
        picker = picker[: picker.index("\n}\n")]
        self.assertIn("sessionStart", picker, "the session's own start has to be a boundary")
        self.assertIn("PROBE_MIN_AGE_HOURS", picker)

    def test_an_idea_with_no_evidence_is_never_probed(self) -> None:
        """Asking what they remember about something never taught measures nothing."""
        picker = CHAT_CODE[CHAT_CODE.index("export function pickProbe(") :]
        picker = picker[: picker.index("\n}\n")]
        self.assertIn("Number(row.attempts) > 0", picker)


class TheAskIsUnaided(unittest.TestCase):
    def directive(self) -> str:
        block = CHAT[CHAT.index('key: "probe_opener"') :]
        return block[: block.index("};")]

    def test_the_ask_supplies_nothing(self) -> None:
        text = self.directive()
        for phrase in ("no hint", "EXACTLY ONE question"):
            self.assertIn(phrase, text, f"the ask must say {phrase!r}")

    def test_the_probe_turn_cannot_also_present_the_step(self) -> None:
        """A reply that teaches and then asks what they remember measures the teaching."""
        presents = CHAT_CODE[CHAT_CODE.index("const presentsThisTurn =") :]
        presents = presents[: presents.index(";")]
        self.assertNotIn("probe_opener", presents)
        self.assertIn('directive.key === "present_step"', presents)

    def test_the_probe_wins_the_directive_before_anything_else(self) -> None:
        """It owns the whole reply, so it cannot sit below a branch that returns first."""
        pick = CHAT_CODE[CHAT_CODE.index("const pick = (): TurnDirective => {") :]
        self.assertLess(
            pick.index("probeAsk"),
            pick.index('navAction === "revisit"'),
            "the probe branch must come first in pick()",
        )


class DecliningIsNotFailing(unittest.TestCase):
    def test_a_skip_expires_the_probe_rather_than_scoring_it(self) -> None:
        """The rubric measures what a student produced. Declining is an absence."""
        self.assertIn("probeDeclined", CHAT_CODE)
        self.assertIn('{ status: "expired" }', CHAT_CODE)

    def test_a_declined_probe_carries_no_answer_mark(self) -> None:
        mark = CHAT_CODE[CHAT_CODE.index("const probeAnswerMark =") :]
        mark = mark[: mark.index(";")]
        self.assertIn("!probeDeclined", mark)


class TheAnswerIsScoredAsWhatItIs(unittest.TestCase):
    def test_the_answer_is_marked_on_the_turn(self) -> None:
        """Nothing else in the transcript distinguishes an unaided delayed recall."""
        self.assertIn("probe: probeAnswerMark", CHAT_CODE)

    def test_the_mark_points_at_the_turn_that_actually_landed(self) -> None:
        """The scorer joins on answer_turn_id; a turn that failed to insert has no id."""
        close = CHAT_CODE[CHAT_CODE.index("const probePath =") :]
        close = close[: close.index("const isTextExplanation")]
        self.assertIn("studentTurnPromise.then", close)
        self.assertIn("answer_turn_id", close)

    def test_the_scorer_admits_a_probe_answer_at_any_length(self) -> None:
        """"The part where the water splits" is under the floor and is exactly §11."""
        self.assertIn("!isConstructedResponse(turn) && !probeOf(turn)", SCORER_CODE)

    def test_the_judge_is_told_the_transcript_above_belongs_elsewhere(self) -> None:
        """Those mentor turns are from a previous sitting; read as scaffolding they lie."""
        self.assertIn("PROBE kind=", SCORER)
        self.assertIn("previous sitting", SCORER)

    def test_only_the_kind_that_was_asked_is_scored(self) -> None:
        """Scoring transfer on a retention probe invents an observation nobody made."""
        # The insert loop, not buildProfile's rollup — both iterate PROBE_DIMENSIONS.
        block = SCORER_CODE[SCORER_CODE.index("const probed = probeOf(turn);") :]
        block = block[: block.index("inserts.push(insert);")]
        self.assertIn("probed.kind === dim", block)

    def test_both_dimensions_have_full_anchors(self) -> None:
        prompt = re.search(r"const JUDGE_SYSTEM = `(.*?)`;", SCORER, re.S)
        assert prompt
        for dim in ("retention", "transfer"):
            line = next(
                (l for l in prompt.group(1).splitlines() if l.startswith(f"- {dim}")), None
            )
            self.assertIsNotNone(line, f"{dim} needs a scale, not a mention")
            assert line
            self.assertRegex(line, r"\b0 \w")
            self.assertRegex(line, r"\b4 \w")

    def test_the_anchors_are_conditional_on_a_probe(self) -> None:
        """On an ordinary response neither can be inferred, so both stay null."""
        self.assertIn("ONLY FOR A RESPONSE MARKED PROBE", SCORER)


class TheQueueDoesNotMakeItWaitAWeek(unittest.TestCase):
    def test_a_probe_answer_surfaces_on_the_next_tick(self) -> None:
        self.assertIn("or bool_or(lt.payload ? 'probe')", MIGRATION)

    def test_the_five_response_threshold_still_governs_everything_else(self) -> None:
        """The queue exists to keep model calls worth making; the probe is the exception."""
        self.assertIn("having count(*) >= 5 or bool_or", MIGRATION)
        # The R92 pin reads its threshold out of the original migration; that number and
        # this one must stay the same, or two views disagree about what is worth scoring.
        original = re.search(r"having count\(\*\) >= (\d+)", SWEEP)
        assert original
        self.assertIn(f"having count(*) >= {original.group(1)} or", MIGRATION)


class TheResultChangesSomething(unittest.TestCase):
    def test_a_probe_moves_the_students_mastery(self) -> None:
        """A measurement the system takes and then ignores is not a measurement."""
        self.assertIn("async function closeProbes(", SCORER_CODE)
        self.assertIn("student_idea_mastery?on_conflict=user_id,idea_key", SCORER_CODE)

    def test_the_write_back_uses_the_same_arithmetic_as_chat(self) -> None:
        """Two ways of computing one number is two numbers."""
        for name in ("MASTERY_EMA_ALPHA", "MASTERY_PRIOR"):
            self.assertEqual(
                number_in(CHAT_CODE, name),
                number_in(SCORER_CODE, name),
                f"{name} has drifted between chat and the scorer",
            )

    def test_a_partial_recall_counts_the_attempt_without_moving_the_score(self) -> None:
        """The rubric's "developing" band should not be forced to pick a side."""
        block = SCORER_CODE[SCORER_CODE.index("async function closeProbes(") :]
        self.assertIn('value >= 3 ? "pass" : value <= 1 ? "fail" : "neutral"', block)

    def test_a_failed_check_stops_the_mentor_calling_them_mastered(self) -> None:
        """§14: performing well WITH help does not establish independent proficiency."""
        mastered = CHAT_CODE[CHAT_CODE.index("const mastered =") :]
        mastered = mastered[: mastered.index(";")]
        self.assertIn("RETENTION_WEAK_AT_OR_BELOW", mastered)
        self.assertIn("TRANSFER_HOLDS_AT_OR_ABOVE", mastered)

    def test_blocking_the_fade_is_not_the_whole_move(self) -> None:
        """Silence would make the measurement change nothing, which is the §19 failure."""
        self.assertIn("CONSOLIDATE, DO NOT FADE", CHAT_CODE)

    def test_the_two_move_cap_survives(self) -> None:
        """R91's constraint: a mentor handed five weaknesses asks five things."""
        self.assertIn("moves.slice(0, 2)", CHAT_CODE)


class TheThresholdsCannotDriftApart(unittest.TestCase):
    def test_chat_and_the_scorer_agree_on_what_unaided_means(self) -> None:
        """They cannot import each other, so the pin is the only thing holding them."""
        self.assertEqual(number_in(SCORER_CODE, "UNAIDED_AT_OR_BELOW"), 1)
        self.assertEqual(number_in(SCORER_CODE, "SUPPORTED_AT_OR_ABOVE"), 3)
        self.assertGreater(
            number_in(SCORER_CODE, "SUPPORTED_AT_OR_ABOVE"),
            number_in(SCORER_CODE, "UNAIDED_AT_OR_BELOW"),
            "the two populations must not overlap or the comparison is meaningless",
        )


class TheTeacherCanSeeIt(unittest.TestCase):
    def test_the_two_dimensions_are_named_for_what_they_answer(self) -> None:
        self.assertIn("PROBE_LABELS", LABELS)
        self.assertIn("PROBE_LABELS", PANEL)

    def test_not_yet_asked_reads_as_pending_rather_than_as_a_dash(self) -> None:
        """The rubric's own §15 example prints "Retention: Pending"."""
        self.assertIn('"Pending"', PANEL)

    def test_the_unaided_share_is_shown_with_its_denominator(self) -> None:
        """"2 of 3" and "67%" are different claims.

        Stated as the rule it always meant — the count is printed in one expression with
        its denominator — rather than as the name of the object that held them (R101
        moved the statistic one scope out, and the pin on `profile.` broke).
        """
        self.assertIn("unaided_count", PANEL)
        self.assertRegex(without_comments(PANEL), r"unaided_count\}\s+of\s+\{[\w.]+\.turns_scored\}")


class TheMigrationRuns(unittest.TestCase):
    def test_it_is_in_the_deploy_list(self) -> None:
        self.assertIn(
            "supabase/migrations/20261103000000_r100_cognition_probes.sql", DEPLOY
        )

    def test_a_probe_is_read_as_narrowly_as_a_turn_score(self) -> None:
        """A probe names what a child could not remember."""
        self.assertIn("cognition_probes_read", MIGRATION)
        self.assertIn("platform_admins", MIGRATION)
        self.assertIn("organization_memberships", MIGRATION)

    def test_the_student_owns_their_own_rows(self) -> None:
        """chat never holds the service key, so the write is the caller's."""
        self.assertIn("auth.uid() = user_id", MIGRATION)


class ThePropertiesActuallyRun(unittest.TestCase):
    def test_the_selection_is_covered_by_executable_properties(self) -> None:
        """Text pins cannot prove an ordering; the deno suite runs the real function."""
        self.assertIn("pickProbe", DENO_SUITE)
        self.assertIn("export function pickProbe(", CHAT_CODE)
        self.assertGreaterEqual(
            DENO_SUITE.count('Deno.test("R100'), 8, "expected the probe properties"
        )


if __name__ == "__main__":
    unittest.main()
