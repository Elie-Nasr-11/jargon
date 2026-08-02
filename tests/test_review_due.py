"""Re-pinned 2026-08-02 (chat-flow Phase 1): the isolated chat-fn review path was
removed with the rest of the review slice (see test_review_sessions.py). KEPT below:
the SM-2-lite due queue (computeReviewDue feeds the profile-stats bundle and remains
deterministic/testable — teacher analytics on mastery, independent of the deleted
path) and the lib/review.ts display helpers (ReportsPanel uses them)."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
REVIEW = ROOT / "frontend" / "src" / "lib" / "review.ts"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"


class ReviewDueStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.review = REVIEW.read_text(encoding="utf-8")
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")

    def test_sm2lite_due_queue_in_api(self):
        for fragment in (
            "export const REVIEW_INTERVAL_DAYS",
            "emerging: 1",
            "developing: 3",
            "secure: 7",
            "export function computeReviewDue",
            # Only include actually-practiced skills, and only when overdue.
            "if (!m.last_practiced_at) continue;",
            "daysOverdue >= 0",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)
        # The profile bundle carries the derived due list.
        self.assertIn("reviewDue: computeReviewDue(mastery)", self.api)

    def test_types_carry_review_due(self):
        self.assertIn("export type ReviewDueSkill", self.types)
        self.assertIn("reviewDue: ReviewDueSkill[]", self.types)

    def test_chat_fn_review_handler_removed(self):
        # The isolated review turn left with chat-flow Phase 1; the due queue does not
        # depend on it (last_practiced_at refreshes through normal lesson practice).
        self.assertNotIn("async function handleReviewRequest", self.chat_fn)
        self.assertNotIn("record.review === true", self.chat_fn)

    def test_review_format_helpers(self):
        self.assertIn("export function humanizeSkillKey", self.review)
        self.assertIn("export function practicedAgo", self.review)


if __name__ == "__main__":
    unittest.main()
