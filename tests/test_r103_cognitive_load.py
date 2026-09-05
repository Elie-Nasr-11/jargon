"""R103 — rubric §19's eighth rule: cognitive load.

"If cognitive load appears excessive: break the task into smaller steps."

Seven of §19's eight rules already steered the mentor. This is the last one, and the
only one that could not be read off the eight dimensions, because OVERLOAD IS NOT
WEAKNESS: a student who finds the work hard produces weak answers, and an overloaded
student produces almost nothing while the tutor carries the turn. Telling the two apart
needs two facts at once — how heavy the help was, and how short the answers came back —
and the second lives on the ledger row, not on the profile.

That split is what these pins protect. The scorer decides WHETHER (it has the ledger);
chat decides WHAT THE MENTOR DOES (it has the profile). Neither may recompute the
other's half, and the two files cannot import each other, so this reads both.

The executable half is in tests/flow_core.test.ts (the steer) and tests/room_view.test.ts
(the room); this file pins the rules that only exist as source.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SCORER = (ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts").read_text(
    encoding="utf-8"
)
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
MIGRATION_FILE = (
    ROOT / "supabase" / "migrations" / "20261105000000_r103_cognitive_load.sql"
)
MIGRATION = MIGRATION_FILE.read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
ROOM = (
    ROOT / "frontend" / "src" / "features" / "teacher" / "cognition" / "room.ts"
).read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
COGNITION_DOC = (ROOT / "docs" / "COGNITION.md").read_text(encoding="utf-8")

SCORER_CODE = without_comments(SCORER)
CHAT_CODE = without_comments(CHAT)


def number_in(source: str, name: str) -> float:
    """The literal a named constant is bound to. Copied from test_r100_probe."""
    match = re.search(rf"const {name} = ([0-9.]+);", source)
    assert match, f"{name} not found"
    return float(match.group(1))


def build_profile(source: str) -> str:
    block = source[source.index("function buildProfile(") :]
    return block[: block.index("\nfunction wordsOf(")]


class BothHalvesOrNothingTests(unittest.TestCase):
    """The rule that makes this rule mean something. Heavy help alone is a scaffolded
    student working; short answers alone is someone disengaged or simply fast. Break
    the conjunction and the flag starts firing on students who are fine."""

    def test_the_flag_needs_heavy_help_AND_short_answers(self):
        block = build_profile(SCORER_CODE)
        flag = block[block.index("profile.load_flag =") : block.index("profile.load_signals")]
        self.assertIn("heavyCount", flag)
        self.assertIn("shortCount", flag)
        # An "or" here would flag every heavily-scaffolded student in the school.
        self.assertNotIn("||", flag)
        self.assertEqual(flag.count("&&"), 2, "three conditions, joined by two ands")

    def test_both_shares_must_clear_the_same_half(self):
        block = build_profile(SCORER_CODE)
        flag = block[block.index("profile.load_flag =") : block.index("profile.load_signals")]
        self.assertEqual(
            flag.count("> LOAD_SHARE"),
            2,
            "heavy and short are measured against ONE threshold, not two that can drift",
        )
        self.assertEqual(number_in(SCORER, "LOAD_SHARE"), 0.5)

    def test_a_missing_word_count_is_never_short(self):
        # The honest default. textSignals started writing `words` in R99; treating an
        # uncounted response as short would have flagged every student whose recent work
        # predates it, on evidence that does not exist.
        block = build_profile(SCORER_CODE)
        short = block[block.index("const shortCount") : block.index("const wordsMissing")]
        self.assertIn("words !== null", short)
        self.assertIn("<= LOAD_SHORT_WORDS_AT_OR_BELOW", short)
        words_of = SCORER_CODE[SCORER_CODE.index("function wordsOf(") :]
        words_of = words_of[: words_of.index("\n}")]
        self.assertIn("return null", words_of)
        self.assertIn('typeof words === "number"', words_of)

    def test_it_reads_the_recent_window_only(self):
        # Overload is a state, not a trait. A student who was drowning three weeks ago
        # and is fine now must not still be flagged.
        block = build_profile(SCORER_CODE)
        self.assertIn("chronological.slice(-LOAD_WINDOW)", block)
        self.assertGreaterEqual(number_in(SCORER, "LOAD_WINDOW"), 3)

    def test_the_floor_is_the_same_three_responses_as_every_other_reading(self):
        block = build_profile(SCORER_CODE)
        flag = block[block.index("profile.load_flag =") : block.index("profile.load_signals")]
        self.assertIn("recent.length >= STEER_FLOOR", flag)
        self.assertIn("const STEER_FLOOR = 3;", SCORER)

    def test_heavy_is_the_same_S_level_the_rest_of_the_rubric_calls_supported(self):
        # S3+ is where the tutor supplies actual content — §14's own line. A second
        # number here would let "supported" and "heavy" drift apart silently.
        self.assertIn("const LOAD_HEAVY_AT_OR_ABOVE = SUPPORTED_AT_OR_ABOVE;", SCORER)
        self.assertIn("const SUPPORTED_AT_OR_ABOVE = 3;", SCORER)

    def test_short_is_below_the_middle_of_the_live_corpus(self):
        # The one threshold that live data moved. The median judged response on
        # production is 11 words; the first draft said 12, which put "short" ABOVE the
        # middle of the distribution and flagged 6 of 15 eligible pairs. A rule that
        # fires on 40% of a school describes the corpus instead of finding anything.
        #
        # The pin is the RULE — short must mean shorter than typical — expressed against
        # the median this doc records. Re-measure and move both together, never one.
        median = int(
            re.search(r"the median response is \*\*(\d+)\n?\s*words\*\*", COGNITION_DOC).group(1)
        )
        self.assertLess(
            number_in(SCORER, "LOAD_SHORT_WORDS_AT_OR_BELOW"),
            median,
            "a short answer must be shorter than a typical one",
        )

    def test_the_arithmetic_is_stored_beside_the_verdict(self):
        # A bare boolean is unfalsifiable. These counts are how a reader disagrees with
        # the thresholds instead of with the machine.
        block = build_profile(SCORER_CODE)
        signals = block[block.index("profile.load_signals = {") :]
        for key in ("window", "heavy_scaffold", "short_answers", "words_missing"):
            with self.subTest(key=key):
                self.assertIn(f"{key}:", signals)


class OneRuleTwoFilesTests(unittest.TestCase):
    """chat and cognition-scorer cannot import each other. The scorer owns the
    arithmetic because it has the ledger rows; chat owns the move because it has the
    prompt. The only thing holding the two halves to the same rule is this."""

    def test_chat_reads_the_verdict_and_never_recomputes_it(self):
        self.assertIn("profile.load_flag === true", CHAT_CODE)
        # None of the scorer's thresholds may appear in chat: a second implementation of
        # the same rule is a second answer to the same question.
        for name in (
            "LOAD_WINDOW",
            "LOAD_SHARE",
            "LOAD_SHORT_WORDS_AT_OR_BELOW",
            "LOAD_HEAVY_AT_OR_ABOVE",
        ):
            with self.subTest(constant=name):
                # Comments stripped: chat's own comment POINTS AT the scorer's constant
                # by name, which is the documentation, not a second implementation.
                self.assertNotIn(name, CHAT_CODE)

    def test_only_a_real_boolean_fires_it(self):
        # PostgREST hands back JSON, but a hand-written row or a future default could put
        # a string here, and "false" is truthy.
        steer = CHAT_CODE[CHAT_CODE.index("export function learnerSteer(") :]
        self.assertIn("=== true", steer[: steer.index("const moves: string[] = []")])

    def test_the_column_name_is_the_same_in_both_files_and_in_the_schema(self):
        self.assertIn("profile.load_flag =", SCORER_CODE)
        self.assertIn("profile.load_flag === true", CHAT_CODE)
        self.assertIn("add column if not exists load_flag boolean", MIGRATION)
        self.assertIn("add column if not exists load_signals jsonb", MIGRATION)

    def test_an_overloaded_student_is_never_faded(self):
        # §19's last rule withdraws scaffolding. Doing that to someone already producing
        # stubs under heavy help is reading the same evidence backwards.
        mastered = CHAT_CODE[
            CHAT_CODE.index("const mastered =") : CHAT_CODE.index("const strongButNotHeld")
        ]
        self.assertIn("!loaded", mastered)

    def test_the_move_comes_after_reduce_assistance_and_before_the_ranked_loop(self):
        steer = CHAT_CODE[CHAT_CODE.index("export function learnerSteer(") :]
        self.assertLess(
            steer.index('moves.push(\n      "REDUCE ASSISTANCE'),
            steer.index("if (loaded) moves.push(STEER_MOVES.load);"),
        )
        self.assertLess(
            steer.index("if (loaded) moves.push(STEER_MOVES.load);"),
            steer.index("for (const key of ranked)"),
        )

    def test_the_two_move_cap_is_untouched(self):
        self.assertIn("moves: moves.slice(0, 2)", CHAT_CODE)


class TheStudentNeverSeesItTests(unittest.TestCase):
    def test_the_move_carries_no_measurement(self):
        move = CHAT[CHAT.index('  load:\n') :]
        move = move[: move.index('",\n')]
        self.assertNotRegex(move, r"\d")
        self.assertNotRegex(move, r"(?i)rubric|score|dimension|overload|profile")

    def test_the_move_says_what_smaller_looks_like(self):
        move = CHAT[CHAT.index('  load:\n') :]
        move = move[: move.index('",\n')]
        self.assertIn("BREAK IT DOWN", move)
        self.assertIn("one step", move)

    def test_the_move_names_the_cause_not_the_child(self):
        # "They are not trying" is the reading a teacher reaches for and the one the
        # rubric exists to prevent.
        move = CHAT[CHAT.index('  load:\n') :]
        move = move[: move.index('",\n')]
        self.assertIn("too big to hold at once", move)


class TheRoomSaysTheSameThingTests(unittest.TestCase):
    def test_the_room_has_a_group_for_it(self):
        self.assertIn('case "load":', ROOM)
        self.assertIn("load: 1,", ROOM)
        self.assertIn('"dependent" | "load" |', API)

    def test_the_room_group_is_derived_where_the_data_is(self):
        roll = SCORER_CODE[SCORER_CODE.index("function rollUpStudent(") :]
        roll = roll[: roll.index("\nasync function classView(")]
        self.assertIn('group = "load"', roll)
        self.assertIn("freshest?.load_flag === true", roll)
        # ...and dependency is still checked first, in the room as in the mentor.
        self.assertLess(roll.index('group = "dependent"'), roll.index('group = "load"'))
        self.assertLess(roll.index('group = "load"'), roll.index('group = "mastered"'))

    def test_the_class_view_actually_selects_the_column(self):
        # The group is computed from a column that has to be asked for. Without this the
        # flag is always undefined and the group silently never fires.
        view = SCORER[SCORER.index("async function classView(") :]
        select = view[view.index("cognition_profiles?user_id=in.(") :]
        self.assertIn("load_flag", select[: select.index("`,")])

    def test_the_room_summary_counts_the_new_group(self):
        self.assertIn("load: 0", SCORER_CODE[SCORER_CODE.index("function summarizeRoom(") :][:400])

    def test_the_whole_student_read_is_untouched(self):
        # R101's rule: the cross-lesson payload carries numbers and ids, never evidence,
        # signals or a note. load_flag is a per-lesson verdict and has no business there.
        columns = SCORER[SCORER.index("const STUDENT_VIEW_COLUMNS") :]
        columns = columns[: columns.index(";")]
        for forbidden in ("evidence", "signals", "note", "*"):
            with self.subTest(column=forbidden):
                self.assertNotIn(forbidden, columns)


class TheMigrationTests(unittest.TestCase):
    def test_the_defaults_read_as_not_overloaded_not_as_unknown(self):
        # Every profile written before this release must read as fine, not as alarming.
        self.assertIn("load_flag boolean not null default false", MIGRATION)
        self.assertIn("load_signals jsonb not null default '{}'::jsonb", MIGRATION)

    def test_it_is_in_the_deploy_list(self):
        # A migration that is not in the hardcoded list never runs on a fresh environment.
        self.assertIn(MIGRATION_FILE.name, WORKFLOW)

    def test_it_only_adds_columns(self):
        lowered = MIGRATION.lower()
        for verb in ("drop ", "delete ", "truncate ", "update "):
            with self.subTest(verb=verb.strip()):
                self.assertNotIn(verb, lowered)


class TheDocSaysTheRuleIsCompleteTests(unittest.TestCase):
    def test_the_eighth_rule_is_in_the_table(self):
        table = COGNITION_DOC[COGNITION_DOC.index("## §19") :]
        table = table[: table.index("\n## ")]
        self.assertIn("BREAK IT DOWN", table)
        self.assertIn("cognitive load", table.lower())

    def test_the_doc_no_longer_claims_a_rule_is_missing(self):
        self.assertNotIn("seven of §19", COGNITION_DOC)
        self.assertNotIn("seven of the eight", COGNITION_DOC)


if __name__ == "__main__":
    unittest.main()
