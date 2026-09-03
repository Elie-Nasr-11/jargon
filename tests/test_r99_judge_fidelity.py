"""R99 — what the judge is told, and what the teacher is finally shown.

Three rules, each closing a gap between the owner's rubric document and the running code.

1. EVERY DIMENSION IS ANCHORED. §2-§9 give each of the eight dimensions a 0-4 scale with
   worded bands. Five of them reached the judge that way; elaboration, vocabulary and
   expression arrived as cautions only ("never equate word count with elaboration"), which
   tells a model what NOT to do without telling it what a 3 looks like.

2. WHAT CODE CAN COUNT, CODE COUNTS. §12 lists eighteen supporting signals. Some are
   judgments; four are arithmetic over the response text, and a model asked to do
   arithmetic on text it is also grading will approximate. Those four are computed here
   and spread OVER the judge's object, so code wins any disagreement.

3. THE EVIDENCE IS SHOWN. §8 asks the system to identify AI-supplied concepts, reasoning,
   vocabulary, examples and sentence structure against what the student added. The judge
   had been writing `evidence` and `signals` since R90 and the panel rendered neither —
   §8 was a claim the product made only to itself.

A fourth rule guards the presentation: §15 says the model is never reduced to one number,
and that holds one level down. Nothing in the disclosure prints a score, and the traceable
share is words rather than a percentage — "68% AI-supplied" is exactly the sentence that
would be repeated to a parent as a grade.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SCORER = (
    ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts"
).read_text(encoding="utf-8")
SCORER_CODE = without_comments(SCORER)
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
SRC = ROOT / "frontend" / "src"
PANEL = (SRC / "features" / "teacher" / "console" / "CognitionPanel.tsx").read_text(
    encoding="utf-8"
)
EVIDENCE = (SRC / "features" / "teacher" / "cognition" / "evidence.ts").read_text(
    encoding="utf-8"
)


def judge_prompt() -> str:
    match = re.search(r"const JUDGE_SYSTEM = `(.*?)`;", SCORER, re.S)
    assert match, "the scorer must keep a JUDGE_SYSTEM prompt"
    return match.group(1)


def dimension_names() -> list[str]:
    match = re.search(r"const DIMENSIONS = \[(.*?)\]", SCORER, re.S)
    assert match, "the scorer must declare its dimensions"
    return re.findall(r'"([a-z_]+)"', match.group(1))


class EveryDimensionIsAnchored(unittest.TestCase):
    def test_each_dimension_line_names_a_zero_and_a_four(self) -> None:
        """A caution says what not to do; an anchor says what a score means."""
        prompt = judge_prompt()
        for dimension in dimension_names():
            line = next(
                (l for l in prompt.splitlines() if l.startswith(f"- {dimension}:")),
                None,
            )
            self.assertIsNotNone(line, f"{dimension} has no line in the judge prompt")
            assert line
            self.assertRegex(line, r"\b0 \w", f"{dimension} has no 0 anchor")
            self.assertRegex(line, r"\b4 \w", f"{dimension} has no 4 anchor")

    def test_the_rubrics_three_cautions_survived_the_rewrite(self) -> None:
        """Adding anchors must not drop the sentences that keep them honest."""
        prompt = judge_prompt()
        self.assertIn("NEVER equate word count with elaboration", prompt)
        self.assertIn("Precision matters more than sophistication", prompt)
        self.assertIn("ONLY dimension where language mechanics belong", prompt)


class TheAttributionIsSplitTheWayTheRubricAsks(unittest.TestCase):
    CATEGORIES = ("concepts", "reasoning", "vocabulary", "examples", "sentence_structure")

    def test_the_contract_carries_all_five_categories_on_both_sides(self) -> None:
        contract = SCORER[SCORER.index("Return ONLY JSON:") :]
        attribution = re.search(r'"attribution":\{(.*?)\}\}\}', contract, re.S)
        assert attribution, "the JSON contract must define an attribution object"
        for side in ("ai_supplied", "student_originated"):
            self.assertIn(f'"{side}"', attribution.group(1))
        for category in self.CATEGORIES:
            self.assertGreaterEqual(
                attribution.group(1).count(f'"{category}"'),
                2,
                f"{category} must appear on both sides of the split",
            )

    def test_the_reader_knows_the_same_five(self) -> None:
        """A category the judge writes and the panel cannot name is invisible."""
        for category in self.CATEGORIES:
            self.assertIn(f'"{category}"', EVIDENCE)


class CodeCountsWhatCodeCanCount(unittest.TestCase):
    def test_the_text_signals_are_computed_not_requested(self) -> None:
        self.assertIn("export function textSignals(", SCORER_CODE)

    def test_the_judge_is_told_not_to_report_them(self) -> None:
        """Two sources for one number is how they come to disagree."""
        self.assertIn("computed in code", judge_prompt())

    def test_code_wins_the_disagreement(self) -> None:
        """The spread order IS the rule: whichever object is spread last wins."""
        insert = SCORER_CODE[SCORER_CODE.index("signals: {") :]
        insert = insert[: insert.index("},")]
        judge_at = insert.index("row.signals")
        code_at = insert.index("textSignals(")
        self.assertLess(
            judge_at,
            code_at,
            "textSignals must be spread AFTER the judge's signals, not before",
        )

    def test_a_sentence_count_is_never_zero_for_real_text(self) -> None:
        """A response with no full stop is one sentence, not none — it divides."""
        self.assertIn("Math.max(1, sentences.length)", SCORER_CODE)


class TheFramingCarriesWhatSeventeenAsksFor(unittest.TestCase):
    def test_the_judge_is_told_the_subject(self) -> None:
        """§17: a terse maths answer is not a weak humanities paragraph."""
        self.assertIn("SUBJECT:", SCORER)
        self.assertIn("subject: cleanText(idea?.subject)", SCORER_CODE)

    def test_the_judge_is_told_how_much_help_came_before(self) -> None:
        """§17's last normalization input, as counts rather than as more prose."""
        self.assertIn("PRIOR ASSISTANCE ON THIS LESSON:", SCORER)


class TheLedgerStaysOneVersion(unittest.TestCase):
    def test_this_release_did_not_invalidate_the_scores_already_stored(self) -> None:
        """Every change here is additive JSON: old rows stay readable, none re-score."""
        self.assertIn("const RUBRIC_VERSION = 1;", SCORER_CODE)


class TheScorerShipsThroughTheSamePipelineAsEverythingElse(unittest.TestCase):
    def test_the_workflow_deploys_it(self) -> None:
        """It had shipped v3-v11 by hand while every other function came through CI."""
        self.assertIn('- "supabase/functions/cognition-scorer/**"', DEPLOY)
        self.assertIn("supabase functions deploy cognition-scorer", DEPLOY)


class TheTeacherSeesTheEvidence(unittest.TestCase):
    def test_the_panel_renders_both_fields_it_fetches(self) -> None:
        """Fetched, typed, and never drawn was the whole defect."""
        self.assertIn("turn.evidence", PANEL)
        self.assertIn("turn.signals", PANEL)

    def test_the_disclosure_prints_no_score(self) -> None:
        """§15 one level down: the evidence is quotes and counts, never a mark."""
        block = PANEL[PANEL.index("function ResponseEvidence(") :]
        block = block[: block.index("function AttributionColumn(")]
        self.assertNotIn("/4", block)
        self.assertNotIn("DimensionRow", block)

    def test_the_traceable_share_is_words_and_never_a_percentage(self) -> None:
        """"68% AI-supplied" is the sentence a parent would hear as a grade."""
        self.assertIn("export function traceableShareLabel(", EVIDENCE)
        label = EVIDENCE[EVIDENCE.index("export function traceableShareLabel(") :]
        self.assertNotIn("%", label)
        self.assertNotIn("* 100", label)

    def test_old_rows_still_render(self) -> None:
        """Rows written before this release have no attribution and no sentences."""
        self.assertIn("export function attributionFallback(", EVIDENCE)

    def test_an_absent_signal_is_absent_rather_than_zero(self) -> None:
        """"0 comparisons" on a two-word answer is noise, not a finding."""
        line = EVIDENCE[EVIDENCE.index("export function signalsLine(") :]
        self.assertIn("value <= 0) continue", line)


if __name__ == "__main__":
    unittest.main()
