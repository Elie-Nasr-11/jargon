"""R35: the pre-handoff visual pass (screenshot-driven, offline harness).

Three fixes, each found by actually rendering the app:

1. PHONE OVERFLOW — a long step-title divider eyebrow (`shrink-0` + nowrap) set the
   flex column's intrinsic min-width, pushing the whole conversation past the right
   edge on a 390px viewport (measured: column 508px). Fix: `min-w-0` on the ChatWindow
   flex columns + a shrinkable, truncating eyebrow.
2. MODE-OFFER RELOAD LOSS — turnToMessage never restored payload.mode_offer, so a
   student who reloaded while a hand-off pill was pending lost the pill the mentor's
   own text points at (re-opening the R31e Discuss dead-end). The transcript renders
   offers only on the latest mentor message, so stale offers stay retired.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
WINDOW = (SRC / "student" / "ChatWindow.tsx").read_text(encoding="utf-8")
TRANSCRIPT = (SRC / "student" / "Transcript.tsx").read_text(encoding="utf-8")
MESSAGES = (SRC / "features" / "student" / "chat" / "chatMessages.ts").read_text(encoding="utf-8")


class PhoneOverflowIsStructurallyImpossible(unittest.TestCase):
    def test_the_conversation_flex_columns_may_shrink(self):
        self.assertIn('className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-4"', WINDOW)
        self.assertIn(
            'className="relative flex min-h-0 min-w-0 flex-1 flex-col"',
            WINDOW,
        )

    def test_the_divider_eyebrow_truncates_instead_of_widening_the_page(self):
        self.assertIn(
            'className="mode-eyebrow mode-pill min-w-0 max-w-[70%] truncate px-1',
            TRANSCRIPT,
        )
        self.assertNotIn("mode-pill max-w-[70%] shrink-0", TRANSCRIPT)


class PendingHandoffPillSurvivesReload(unittest.TestCase):
    def test_turn_to_message_restores_the_offer(self):
        self.assertIn("modeOffer:\n        payload.mode_offer &&", MESSAGES)
        self.assertIn('["practice", "discuss", "lesson"].includes(', MESSAGES)

    def test_the_live_envelope_path_still_maps_it(self):
        self.assertIn("modeOffer: envelope.mode_offer ?? undefined,", MESSAGES)


if __name__ == "__main__":
    unittest.main()
