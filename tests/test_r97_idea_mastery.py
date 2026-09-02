"""R97 — the idea-mastery write, and the ideas it needs to write about.

Two faults shipped together, and these pins hold the RULES that keep them shut, not the
shapes of the code that closes them today.

1. `chat` called the four-argument `upsertRows` helper with three arguments, so every
   student_idea_mastery request went out as `?on_conflict=undefined`, PostgREST rejected
   it, and an empty `catch {}` hid the failure. The table held zero rows for its entire
   life. The rule: every upsert names its conflict key, and a swallowed write still says
   something out loud.

2. Even fixed, the writer had almost nothing to write: 973 of 992 graded attempts sat on
   lessons with no authored ideas, so `evidenceIdeaKeys()` returned an empty list. The
   rule: the backfill mints an idea for every lesson that lacks one, and it replays the
   graded history with the SAME arithmetic the runtime uses — a pin that fails when the
   two drift apart.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
CHAT_CODE = without_comments(CHAT)
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20261102000000_r97_idea_mastery_backfill.sql"
).read_text(encoding="utf-8")
BRAIN_MASTERY = (
    ROOT / "supabase" / "migrations" / "20260930000000_brain_mastery.sql"
).read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")


def call_arguments(source: str, opening: str) -> list[str]:
    """Top-level arguments of the first call written as `opening...)`.

    Splits on commas that sit at depth zero, so nested calls, object literals and
    template strings inside an argument do not count as separators.
    """
    start = source.index(opening) + len(opening) - 1
    depth = 0
    quote = ""
    args: list[str] = []
    current = ""
    for i in range(start, len(source)):
        ch = source[i]
        if quote:
            current += ch
            if ch == quote and source[i - 1] != "\\":
                quote = ""
            continue
        if ch in "\"'`":
            quote = ch
            current += ch
            continue
        if ch in "([{":
            depth += 1
            if depth == 1:
                continue
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                args.append(current.strip())
                # A trailing comma before `)` is prettier's doing, not an argument.
                if args and not args[-1]:
                    args.pop()
                return args
        if depth == 1 and ch == ",":
            args.append(current.strip())
            current = ""
            continue
        current += ch
    raise AssertionError(f"unbalanced call after {opening!r}")


class UpsertsNameTheirConflictKey(unittest.TestCase):
    def test_every_upsert_call_passes_a_conflict_key(self) -> None:
        """The bug in one sentence: an upsert that does not say what makes a row unique.

        Reading the count off the call sites rather than naming the tables means a NEW
        upsert added later is covered by this pin the day it is written.
        """
        call_sites = [
            m.start()
            for m in re.finditer(r"\bupsertRows\(", CHAT_CODE)
            if not CHAT_CODE[max(0, m.start() - 20) : m.start()].rstrip().endswith("function")
        ]
        self.assertGreaterEqual(len(call_sites), 3, "expected chat to upsert several tables")

        for start in call_sites:
            args = call_arguments(CHAT_CODE[start:], "upsertRows(")
            self.assertEqual(
                len(args),
                4,
                f"upsertRows call at offset {start} passes {len(args)} arguments, not 4: {args}",
            )
            self.assertTrue(
                args[3].startswith('"') and len(args[3]) > 2,
                f"the conflict key must be a literal column list, got {args[3]!r}",
            )

    def test_the_mastery_conflict_key_is_the_table_key(self) -> None:
        """A conflict key that is not the table's key merges the wrong rows together."""
        declared = re.search(
            r"create table if not exists public\.student_idea_mastery\b.*?primary key \(([^)]+)\)",
            BRAIN_MASTERY,
            re.S,
        )
        assert declared, "student_idea_mastery must declare a primary key"
        expected = ",".join(part.strip() for part in declared.group(1).split(","))

        start = CHAT_CODE.index('upsertRows(config, "student_idea_mastery"')
        args = call_arguments(CHAT_CODE[start:], "upsertRows(")
        self.assertEqual(args[3].strip('"'), expected)


class AFailedWriteSaysSomething(unittest.TestCase):
    def test_the_mastery_writer_does_not_swallow_its_error_in_silence(self) -> None:
        """Enrichment may fail without costing the turn; it may not fail invisibly."""
        body = CHAT_CODE[CHAT_CODE.index("async function recordIdeaEvidence(") :]
        body = body[: body.index("\n}\n")]
        catch = re.search(r"\}\s*catch\s*(\(([^)]*)\))?\s*\{(.*)$", body, re.S)
        assert catch, "recordIdeaEvidence must keep its catch"
        self.assertTrue(
            catch.group(2), "the catch must bind the error rather than discarding it"
        )
        self.assertIn(
            "console.error", catch.group(3), "a swallowed write must still be logged"
        )


class TheBackfillMatchesTheRuntime(unittest.TestCase):
    """The replay is only trustworthy while its arithmetic equals the live writer's."""

    def runtime_number(self, name: str) -> float:
        match = re.search(rf"const {name} = ([0-9.]+);", CHAT_CODE)
        assert match, f"chat must define {name}"
        return float(match.group(1))

    def test_the_smoothing_factor_is_the_same_number_in_both_files(self) -> None:
        alpha = self.runtime_number("MASTERY_EMA_ALPHA")
        self.assertIn(
            f"{alpha} * (target - prev_score)",
            MIGRATION,
            f"the migration must smooth with the runtime's alpha ({alpha})",
        )

    def test_the_prior_is_the_same_number_in_both_files(self) -> None:
        """Seeding from zero made 'never seen' and 'got it wrong' the same start."""
        prior = self.runtime_number("MASTERY_PRIOR")
        self.assertGreater(prior, 0, "a zero prior is the bug this constant exists to fix")
        self.assertIn(
            f"prev_score := {prior};",
            MIGRATION,
            f"the migration must seed with the runtime's prior ({prior})",
        )

    def test_the_runtime_only_falls_back_to_the_prior_when_there_is_no_row(self) -> None:
        """A stored score of 0 is evidence and must not be replaced by the prior."""
        writer = CHAT_CODE[CHAT_CODE.index("async function recordIdeaEvidence(") :]
        writer = writer[: writer.index("\n}\n")]
        self.assertRegex(
            writer,
            r"const prev = row\s*\?[^;]*Number\(row\.score\)[^;]*:\s*MASTERY_PRIOR;",
            "the prior applies to a missing row, never to a row holding 0",
        )

    def test_the_key_caps_match_the_runtime_mapping(self) -> None:
        """evidenceIdeaKeys takes 6 authored step keys, else 4 of the lesson's own."""
        mapper = CHAT_CODE[CHAT_CODE.index("function evidenceIdeaKeys(") :]
        mapper = mapper[: mapper.index("\n}\n")]
        step_cap = re.search(r"slice\(0, (\d+)\)", mapper)
        lesson_cap = re.findall(r"slice\(0, (\d+)\)", mapper)
        assert step_cap and len(lesson_cap) >= 2, "expected both caps in evidenceIdeaKeys"
        self.assertIn(f"idea_keys[1:{lesson_cap[0]}]", MIGRATION)
        self.assertIn(f"limit {lesson_cap[1]}", MIGRATION)

    def test_the_replay_reads_graded_attempts_in_time_order(self) -> None:
        """An EMA replayed out of order is not the number the runtime would hold."""
        self.assertIn("where la.passed is not null", MIGRATION)
        self.assertIn("order by la.user_id, la.created_at, la.id", MIGRATION)

    def test_the_replay_never_overwrites_a_live_row(self) -> None:
        """The deploy replays every listed migration on every push."""
        self.assertIn("on conflict (user_id, idea_key) do nothing", MIGRATION)
        self.assertIn(
            "not exists (\n        select 1 from public.student_idea_mastery m where m.user_id = la.user_id\n      )",
            MIGRATION,
        )


class EveryLessonCanBeKnown(unittest.TestCase):
    def test_ideas_are_minted_only_for_lessons_that_have_none(self) -> None:
        """Minting over a lesson that already has authored ideas would bury them."""
        self.assertIn("insert into public.ideas", MIGRATION)
        self.assertIn(
            "where not exists (\n  select 1 from public.ideas i where i.lesson_id = l.id and i.user_id is null\n)",
            MIGRATION,
        )

    def test_minted_keys_live_in_their_own_namespace(self) -> None:
        """Finer extraction has to be able to land later without colliding."""
        self.assertIn("'lesson-' || l.id", MIGRATION)

    def test_a_minted_idea_is_authored_published_and_ownerless(self) -> None:
        """The runtime only reads published authored ideas (user_id null)."""
        insert = MIGRATION[MIGRATION.index("insert into public.ideas") :]
        insert = insert[: insert.index("on conflict do nothing;")]
        for token in ("'authored'", "'published'", "null"):
            self.assertIn(token, insert)

    def test_the_minted_idea_says_what_the_lesson_said(self) -> None:
        """It comes from the lesson's own objective — the migration invents nothing."""
        self.assertIn("public.milestones m", MIGRATION)
        self.assertIn("m.objective", MIGRATION)


class TheMigrationActuallyRuns(unittest.TestCase):
    def test_the_backfill_is_in_the_deploy_list(self) -> None:
        """The workflow applies a hardcoded list, not a glob: an unlisted file never runs."""
        self.assertIn(
            "supabase/migrations/20261102000000_r97_idea_mastery_backfill.sql", DEPLOY
        )


if __name__ == "__main__":
    unittest.main()
