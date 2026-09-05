"""R105 — chat asks for every column it steers on.

The defect this pins against: `learnerSteer` read `share_unaided` (R101b) and `load_flag`
(R103) off the student's cognition profile, and the profile it was handed was loaded with an
explicit `select=` that named neither. Both guards shipped, both passed their property tests,
and both were inert on every live turn — because the property tests construct the profile
themselves and never touch the select. A test that builds its own input cannot see a missing
column.

So the rule is stated where the two halves meet: every profile field `learnerSteer` reads must
be requested by the profile select, and every field the select requests must exist on the
table. The first half catches the next `load_flag`; the second catches a typo that would 400
every turn.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
CHAT_CODE = without_comments(CHAT)
MIGRATIONS = "\n".join(
    path.read_text(encoding="utf-8")
    for path in sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
)


def steer_block() -> str:
    start = CHAT_CODE.index("export function learnerSteer(")
    end = CHAT_CODE.index("export function heuristicKind(")
    return CHAT_CODE[start:end]


def profile_columns_read() -> set[str]:
    block = steer_block()
    read = set(re.findall(r'steerDim\(profile, "(\w+)"\)', block))
    read |= set(re.findall(r"\bprofile\.(\w+)\b", block))
    # The ranked loop reads every STEER_PRIORITY dimension through a variable, which the
    # literal regexes above cannot see. Add the list itself.
    priority = CHAT_CODE[CHAT_CODE.index("const STEER_PRIORITY = [") :]
    priority = priority[: priority.index("] as const;")]
    read |= set(re.findall(r'"(\w+)"', priority))
    return read


def profile_select() -> set[str]:
    line = next(
        line
        for line in CHAT.splitlines()
        if "cognition_profiles?user_id=eq." in line and "select=" in line
    )
    return set(re.search(r"select=([\w,]+)", line).group(1).split(","))


def cognition_profiles_ddl() -> str:
    # The create table plus every later `alter table public.cognition_profiles` block.
    chunks = []
    for match in re.finditer(
        r"(create table if not exists public\.cognition_profiles|alter table public\.cognition_profiles)"
        r"(.*?);",
        MIGRATIONS,
        re.S,
    ):
        chunks.append(match.group(0))
    assert chunks, "no cognition_profiles DDL found in migrations"
    return "\n".join(chunks)


class ChatAsksForWhatItSteersOnTests(unittest.TestCase):
    def test_every_column_learner_steer_reads_is_in_the_select(self):
        missing = profile_columns_read() - profile_select()
        self.assertEqual(
            missing,
            set(),
            f"learnerSteer reads columns chat never asks for: {sorted(missing)}",
        )

    def test_the_two_that_were_missing_are_now_asked_for(self):
        # Belt to the braces: the specific pair that shipped inert.
        asked = profile_select()
        for column in ("share_unaided", "load_flag"):
            with self.subTest(column=column):
                self.assertIn(column, asked)

    def test_every_asked_column_exists_on_the_table(self):
        ddl = cognition_profiles_ddl()
        for column in sorted(profile_select()):
            with self.subTest(column=column):
                self.assertRegex(ddl, rf"\b{column}\b", f"{column} is selected but never defined")

    def test_the_read_set_is_not_empty_and_covers_the_eight(self):
        # If the regexes ever stop matching, the first test passes vacuously. Guard the guard.
        read = profile_columns_read()
        for dimension in (
            "retrieval", "organization", "reasoning", "elaboration",
            "vocabulary", "expression", "independence", "metacognition",
        ):
            with self.subTest(dimension=dimension):
                self.assertIn(dimension, read)
        self.assertIn("turns_scored", read)


if __name__ == "__main__":
    unittest.main()
