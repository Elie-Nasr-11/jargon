"""Trimmed 2026-07-30: ProfilePanel was removed in the MVP strip; the review-due
surface is now the chat header ReviewDueChip + the Practice mode pane in chat.tsx
(see docs/MVP_SCOPE.md §8 "practice"). The SM-2-lite queue and the isolated chat-fn
review path are KEPT and stay pinned below against their current shape."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
REVIEW = ROOT / "frontend" / "src" / "lib" / "review.ts"
CHIP = ROOT / "frontend" / "src" / "features" / "student" / "ReviewDueChip.tsx"
CHAT = ROOT / "frontend" / "src" / "routes" / "chat.tsx"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"


class ReviewDueStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.review = REVIEW.read_text(encoding="utf-8")
        cls.chip = CHIP.read_text(encoding="utf-8")
        cls.chat = CHAT.read_text(encoding="utf-8")
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")

    def test_sm2lite_due_queue_in_api(self):
        for fragment in (
            "export const REVIEW_INTERVAL_DAYS",
            "emerging: 1",
            "developing: 3",
            "secure: 7",
            "export function computeReviewDue",
            "export async function fetchReviewDue",
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

    def test_chip_renders_only_when_due(self):
        # The chip hides itself when nothing is due; the chat surface owns the due
        # queue (fetchReviewDue) and passes the count down.
        self.assertIn("export function ReviewDueChip", self.chip)
        self.assertIn("if (count <= 0) return null;", self.chip)
        # And it is mounted in the student chat header, fed from the SM-2-lite queue.
        self.assertIn("<ReviewDueChip", self.chat)
        self.assertIn("fetchReviewDue", self.chat)

    def test_guided_review_loop_close(self):
        # MVP §8 practice: the guided review runs retrieval + refreshes the spacing
        # clock, and completes the backing review_sessions row when wrapped up.
        self.assertIn("export async function invokeReview", self.api)
        self.assertIn("review: true", self.api)
        self.assertIn("skill_key: input.skillKey", self.api)
        for fragment in ("useGuidedReview", "invokeReview", "completeReviewSession"):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chip)

    def test_practice_surface_shows_review_due(self):
        # The completion banner offers Practice when reviews are due, and the chat
        # surface tracks the due queue in state.
        self.assertIn("Practice review ·", self.chat)
        self.assertIn("const [reviewDue, setReviewDue]", self.chat)

    def test_chat_fn_review_handler_is_isolated_and_closes_loop(self):
        # Fires ONLY on review:true (normal turn loop untouched), and refreshes the spacing clock.
        self.assertIn("async function handleReviewRequest", self.chat_fn)
        self.assertIn("if (record.review === true) return await handleReviewRequest", self.chat_fn)
        # Stamps mode='revision' evidence + refreshes last_practiced_at via the shared writer.
        self.assertIn('"revision"', self.chat_fn)
        self.assertIn("writeEvidenceAndMastery", self.chat_fn)

    def test_review_format_helpers(self):
        self.assertIn("export function humanizeSkillKey", self.review)
        self.assertIn("export function practicedAgo", self.review)


if __name__ == "__main__":
    unittest.main()
