"""R101b — §14 in the room.

"A learner who performs well only when substantial AI support is available should not be
classified as independently proficient."

The room already said what to DO about each student. It did not say what the saying
rested on: a teacher reading "needs: reasoning" could not tell whether that came from work
the child did alone or work the tutor carried, and those are different lessons. This
release puts §14's own statistic — the count of answers with no help before them — beside
every student, and closes two places where the room and the mentor would have said
different things about the same child.

Measured on production before any of it was designed: zero of the nineteen profiles are
mastery-shaped and zero of the fifteen eligible have no weak dimension, so a positive
"looks strong but only with help" chip could not have fired on anyone. It was not built.
What is here instead are GUARDS, which can only ever withhold an optimistic label — the
safe place for a threshold nothing has calibrated yet.
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
COGNITION = ROOT / "frontend" / "src" / "features" / "teacher" / "cognition"
ROOM = (COGNITION / "room.ts").read_text(encoding="utf-8")
PANEL = (COGNITION / "ClassRoomPanel.tsx").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
DOC = (ROOT / "docs" / "COGNITION.md").read_text(encoding="utf-8")

SCORER_CODE = without_comments(SCORER)
CHAT_CODE = without_comments(CHAT)
ROOM_CODE = without_comments(ROOM)


def number_in(source: str, name: str) -> float:
    match = re.search(rf"const {name} = ([0-9.]+);", source)
    assert match, f"{name} not found"
    return float(match.group(1))


def roll_up(source: str) -> str:
    block = source[source.index("function rollUpStudent(") :]
    return block[: block.index("\nasync function classView(")]


class OneRuleThreeFilesTests(unittest.TestCase):
    """chat steers the mentor, cognition-scorer groups the room, room.ts writes what the
    teacher reads. None of the three can import the others. A room saying "ready for
    harder ground" about a student the mentor is being told to consolidate is worse than
    having no room view at all (R93), so the three are held together here."""

    def test_the_share_threshold_is_one_number_in_both_functions(self):
        self.assertEqual(
            number_in(SCORER, "MASTERY_MIN_SHARE_UNAIDED"),
            number_in(CHAT, "MASTERY_MIN_SHARE_UNAIDED"),
        )
        # ...and the frontend's "mostly supported" marker is the same line, so the chip
        # and the mentor cannot disagree about who is on which side of it.
        self.assertEqual(
            number_in(SCORER, "MASTERY_MIN_SHARE_UNAIDED"),
            number_in(ROOM, "MOSTLY_SUPPORTED_BELOW"),
        )

    def test_it_is_a_guard_and_only_ever_withholds(self):
        # The rule may block mastery. It must never CREATE a group or a move: an
        # uncalibrated number that can only take away an optimistic label is safe, and
        # one that can assert something about a child is not.
        mastered = CHAT_CODE[
            CHAT_CODE.index("const mastered =") : CHAT_CODE.index("const strongButNotHeld")
        ]
        self.assertIn("seenWorkingAlone", mastered)
        moves = CHAT_CODE[CHAT_CODE.index("const STEER_MOVES") : CHAT_CODE.index("function steerDim")]
        for banned in ("share_unaided", "seenWorkingAlone", "unaided"):
            with self.subTest(banned=banned):
                self.assertNotIn(banned, moves)

    def test_absent_evidence_does_not_block(self):
        # Every profile written before R100 carries a null share. Blocking on that would
        # silently withhold mastery from a term of stale rollups, on nothing. Same
        # posture as R100's retention and transfer guards.
        self.assertIn(
            "shareUnaided === null || shareUnaided >= MASTERY_MIN_SHARE_UNAIDED", CHAT_CODE
        )
        self.assertIn(
            "shareUnaided === null || shareUnaided >= MASTERY_MIN_SHARE_UNAIDED", SCORER_CODE
        )

    def test_the_room_makes_the_same_held_call_the_mentor_makes(self):
        roll = roll_up(SCORER_CODE)
        self.assertIn("RETENTION_WEAK_AT_OR_BELOW", roll)
        self.assertIn("TRANSFER_HOLDS_AT_OR_ABOVE", roll)
        for name in ("RETENTION_WEAK_AT_OR_BELOW", "TRANSFER_HOLDS_AT_OR_ABOVE"):
            with self.subTest(constant=name):
                self.assertEqual(number_in(SCORER, name), number_in(CHAT, name))

    def test_not_held_mirrors_the_mentors_consolidate_move(self):
        # This closed a real disagreement: since R100 chat has told the mentor
        # CONSOLIDATE, DO NOT FADE for a strong-but-not-retained student, while the room
        # went on calling them "ready for harder ground".
        self.assertIn("CONSOLIDATE, DO NOT FADE", CHAT)
        roll = roll_up(SCORER_CODE)
        self.assertIn('group = "not_held"', roll)
        self.assertLess(roll.index('group = "not_held"'), roll.index('group = "mastered"'))
        self.assertIn('case "not_held":', ROOM)

    def test_mastery_needs_both_conditions_in_the_room(self):
        roll = roll_up(SCORER_CODE)
        mastered = roll[roll.index('strongOnTheThree && held') : roll.index('group = "mastered"')]
        self.assertIn("seenWorkingAlone", mastered)


class TheRoomStillCarriesNoDimensionValueTests(unittest.TestCase):
    """R93's rule, and the one most at risk when new numbers are added to this payload."""

    def test_retention_and_transfer_never_reach_the_room(self):
        # They are read in rollUpStudent to decide `held`, and deliberately not returned.
        roll = roll_up(SCORER_CODE)
        returned = roll[roll.index("  return {") :]
        for dimension in ("retention", "transfer"):
            with self.subTest(dimension=dimension):
                self.assertNotIn(f"{dimension}:", returned)
        for dimension in ("retention", "transfer"):
            with self.subTest(dimension=dimension, side="wire"):
                room_student = API[API.index("export type RoomStudent = {") :]
                room_student = room_student[: room_student.index("};")]
                self.assertNotIn(f"{dimension}?:", room_student)
                self.assertNotIn(f"{dimension}:", room_student)

    def test_what_was_added_is_counts_not_judgments(self):
        room_student = API[API.index("export type RoomStudent = {") :]
        room_student = room_student[: room_student.index("};")]
        for field in ("unaided_count: number", "share_unaided: number | null",
                      "probes_answered: number"):
            with self.subTest(field=field):
                self.assertIn(field, room_student)

    def test_the_chip_shows_the_denominator_not_a_percentage(self):
        # "2 of 14" and "14%" are different claims, and the second hides what decides
        # how much the first is worth.
        label = ROOM_CODE[ROOM_CODE.index("export function unaidedLabel(") :]
        label = label[: label.index("\n}")]
        self.assertIn("student.turns_scored", label)
        self.assertNotIn("%", label)
        self.assertNotIn("* 100", ROOM_CODE)

    def test_the_share_is_summed_not_averaged(self):
        # A mean of per-lesson shares weights a three-response lesson like a thirty-
        # response one. The question is "of everything they have done", so it is one
        # fraction with one denominator.
        roll = roll_up(SCORER_CODE)
        share = roll[roll.index("const shareUnaided") : roll.index("const probesAnswered")]
        self.assertIn("unaidedCount / turnsScored", share)


class TheTeacherIsToldWhatIsNotKnownTests(unittest.TestCase):
    def test_never_checked_is_said_out_loud(self):
        # probes_answered is 0 for every profile on production. Rendering nothing would
        # read as "fine"; it means "nobody has ever asked them cold".
        note = ROOM_CODE[ROOM_CODE.index("export function independenceNote(") :]
        note = note[: note.index("\n}")]
        self.assertIn("never checked a day later", note)
        self.assertIn("probes_answered", note)

    def test_the_chip_is_rendered_and_carries_the_note(self):
        self.assertIn("unaidedLabel(student)", PANEL)
        self.assertIn("independenceNote(student)", PANEL)
        self.assertIn("mostlySupported(student)", PANEL)

    def test_a_student_nobody_has_read_is_never_marked(self):
        marker = ROOM_CODE[ROOM_CODE.index("export function mostlySupported(") :]
        marker = marker[: marker.index("\n}")]
        self.assertIn('student.group === "unread"', marker)
        self.assertIn("student.share_unaided !== null", marker)

    def test_the_class_view_actually_asks_for_the_columns(self):
        view = SCORER[SCORER.index("async function classView(") :]
        select = view[view.index("cognition_profiles?user_id=in.(") :]
        select = select[: select.index("`,")]
        for column in ("unaided_count", "probes_answered"):
            with self.subTest(column=column):
                self.assertIn(column, select)
        # retention and transfer ride PROBE_DIMENSIONS, which is how `held` is decided.
        self.assertIn("PROBE_DIMENSIONS.join", select)


class TheDocRecordsWhatWasNotBuiltTests(unittest.TestCase):
    def test_the_doc_says_why_there_is_no_watch_chip(self):
        # The measurement that stopped it being built is the part worth keeping: a rule
        # that cannot fire on anyone is unfalsifiable, whichever direction it points.
        section = DOC[DOC.index("## The teacher's two views") :]
        self.assertIn("It did not stick", section)
        self.assertRegex(DOC, r"(?i)could not (have )?fire")


if __name__ == "__main__":
    unittest.main()
