"""R30 (tester feedback): student-safe faults, wider memory, short interactive turns."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")


class StudentSafeFaults(unittest.TestCase):
    def test_raw_internal_errors_never_reach_the_reply(self):
        # The crash testers hit surfaced a raw DB constraint name as the mentor's reply.
        self.assertIn("const STUDENT_SAFE_ERROR", CHAT)
        self.assertIn("that one is on us, not you", CHAT)
        self.assertIn("function isStudentFacingMessage(", CHAT)
        # reply is the safe line unless the message was authored for students.
        self.assertIn("const shown = isStudentFacingMessage(message)", CHAT)

    def test_operator_detail_survives_on_the_envelope(self):
        # We must not lose the real cause: it rides `error` even when reply is calm.
        self.assertIn("error: message,", CHAT)
        self.assertIn("error?: string;", CHAT)

    def test_deliberate_student_messages_still_pass_through(self):
        for allowed in ("too many chat turns", "lesson_id is required", "sign in"):
            self.assertIn(allowed, CHAT)


class ConversationMemoryWindow(unittest.TestCase):
    def test_window_widened(self):
        # Was 8 turns x 400 chars — the mentor forgot mid-explanation, which testers
        # reported as choppy discourse.
        self.assertIn(".slice(0, 16)", CHAT)
        # R72: the context diet may taper OLDER turns back toward 400 when a running
        # summary exists to carry them, but the R30 guarantee this test defends — the
        # immediate thread arrives whole — is untouched: the recent turns keep 1200,
        # and the taper cannot reach them (index >= 6).
        self.assertIn("index >= 6 ? 400 : 1200", CHAT)
        self.assertIn("hasRunningSummary", CHAT)

    def test_query_fetches_enough_rows_to_fill_it(self):
        self.assertIn("order=created_at.desc&limit=20&select=role,stage", CHAT)


class ShortInteractiveTurns(unittest.TestCase):
    def test_one_idea_per_reply_contract(self):
        self.assertIn("SIZE AND TURN-TAKING", CHAT)
        self.assertIn("ONE idea per reply", CHAT)
        self.assertIn("END BY ASKING FOR SOMETHING", CHAT)

    def test_dead_end_check_ins_are_banned(self):
        # "Does that make sense?" invites a yes and teaches nothing.
        self.assertIn("BANNED", CHAT)
        self.assertIn("Does that make sense?", CHAT)

    def test_full_answers_still_allowed_when_asked(self):
        # The cap is on NEW teaching, not on answering a direct question.
        self.assertIn("These limits are about NEW teaching", CHAT)


if __name__ == "__main__":
    unittest.main()
