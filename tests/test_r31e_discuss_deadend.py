"""R31e: the Discuss dead end — a phantom Continue button and a lesson that never moved.

Live demo, verbatim. In Discuss mode the student asked to move on FIVE times ("lets start
the lesson", "start the first step", "lets move on, yes", "lets continue", "lets go") and
got the same step-1 summary back every time, each closing with "just tap Continue" — a
button R31b had deleted from the client weeks earlier.

Two faults, one root:
  1. applyModeCeiling lifts continue_signal -> question in Discuss/Practice (correct: those
     registers must never close a lesson gate). But downstream that made an explicit
     advance request indistinguishable from an ordinary question, so it vanished.
  2. A "question" turn returns from applyTurn WITHOUT stamping presented_at, so
     presentedBefore stayed false forever — re-firing the not-yet-presented directives,
     which were among the last sites still naming the Continue button.

Fixed by carrying the swallowed request through as advanceAskedButCeilinged, answering it
in its own directive, and attaching a real [Back to the lesson] pill.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
SRC = ROOT / "frontend" / "src"
APP = (SRC / "student" / "StudentApp.tsx").read_text(encoding="utf-8")
TYPES = (SRC / "lib" / "types.ts").read_text(encoding="utf-8")
CONVO = (SRC / "student" / "useConversation.ts").read_text(encoding="utf-8")


class NoDirectivePointsAtTheDeletedButton(unittest.TestCase):
    """Every INSTRUCTION to name the Continue button is gone; only bans remain."""

    def test_no_directive_instructs_the_mentor_to_name_it(self):
        # The exact strings that shipped this bug. Each told the model to point at a
        # button that is not rendered anywhere in the client.
        for gone in (
            "tell them to tap the Continue button when they're ready to move on",
            "and tap Continue when they're ready",
            "they can tap Continue to move on",
            "they tap Continue here once they've seen it",
            "The Continue button on screen moves them on when they're ready",
            "The Continue button on screen will bring up this step's material",
        ):
            self.assertNotIn(gone, CHAT, f"directive still points at the button: {gone!r}")

    def test_remaining_mentions_are_prohibitions_or_comments(self):
        # A mention is allowed only when it FORBIDS the button or explains history in a
        # comment. Any other surviving mention would be a live instruction again.
        for line in CHAT.splitlines():
            if "Continue button" not in line and "tap Continue" not in line:
                continue
            comment = line.lstrip().startswith(("//", "*", "/*"))
            forbids = any(
                phrase in line
                for phrase in (
                    "There is no Continue button",
                    "There is NO Continue button",
                    "THERE IS NO CONTINUE BUTTON",
                    "Never name the Continue button",
                    'Never write "tap Continue"',
                    "never tell them to tap Continue",
                    "never tell the student to tap Continue",
                    # A ban whose "Never close with" opener sits on the previous line.
                    "or an invitation to tap Continue",
                )
            )
            self.assertTrue(comment or forbids, f"live button instruction: {line.strip()!r}")

    def test_the_present_step_directives_ask_instead(self):
        # The replacement for each: the mentor's own question is the advance verb.
        self.assertIn("close by ASKING whether to move on", CHAT)
        self.assertIn("that is what moves the lesson on", CHAT)

    def test_system_prompt_no_longer_denies_every_button(self):
        # It used to say "no button of any kind, anywhere", which contradicts the hand-off
        # pill the server really does attach — and directives OUTRANK the system prompt,
        # so the contradiction resolved the wrong way in production.
        self.assertNotIn("no button of any kind, anywhere", CHAT)
        self.assertIn("unless the turn directive tells you one is attached", CHAT)


class AdvanceRequestSurvivesTheModeCeiling(unittest.TestCase):
    """Discuss/Practice still cannot advance — but they must SAY so, not go silent."""

    def test_the_ceiling_still_refuses_to_advance(self):
        # The guard itself is correct and must not be weakened to "fix" the symptom.
        self.assertIn("function applyModeCeiling", CHAT)
        self.assertIn(
            'if (kind === null || kind === "answer_attempt" || kind === "continue_signal") {',
            CHAT,
        )

    def test_the_swallowed_request_is_remembered(self):
        self.assertIn("const advanceAskedButCeilinged =", CHAT)
        self.assertIn(
            'routedKindRaw === "continue_signal" && routedKind !== "continue_signal"', CHAT
        )

    def test_it_reaches_the_directive_builder(self):
        # Declared on the input type, destructured, and passed at the call site — all
        # three, or the flag is dead weight that type-checks fine.
        self.assertIn("  advanceAskedButCeilinged: boolean;", CHAT)
        self.assertEqual(CHAT.count("advanceAskedButCeilinged"), 6)

    def test_it_gets_its_own_directive_ahead_of_the_question_branch(self):
        # Order matters: the question branch is what looped, so this must win first.
        advance = CHAT.index("if (advanceAskedButCeilinged && !quizActive)")
        question = CHAT.index('if (routedKind === "question" && !quizActive')
        self.assertLess(advance, question)
        self.assertIn("advance_needs_lesson_mode", CHAT)

    def test_the_directive_refuses_to_re_teach(self):
        # Re-teaching the same step is exactly what the student saw five times.
        self.assertIn("Do NOT re-teach or re-summarize the step", CHAT)
        self.assertIn("never advances the lesson", CHAT)


class TheWayBackIsARealButton(unittest.TestCase):
    def test_the_pill_is_attached_server_side(self):
        self.assertIn('label: "Back to the lesson"', CHAT)
        self.assertIn('mode: "lesson",', CHAT)

    def test_it_is_attached_outside_the_advancing_branch(self):
        # THE bug to guard: this turn by definition did NOT advance, so a pill emitted
        # inside `if (advancing)` would never render in the one case it exists for.
        pill = CHAT.index('label: "Back to the lesson"')
        advancing = CHAT.index("    if (advancing) {")
        self.assertLess(pill, advancing, "the way-back pill is unreachable in Discuss")

    def test_it_outranks_the_brains_outward_handoffs(self):
        # Answering "let's move on" with [Practice this idea] is a third suggestion that
        # doesn't do what was asked.
        pill = CHAT.index('label: "Back to the lesson"')
        brain_offer = CHAT.index('label: "Practice this idea"')
        self.assertLess(pill, brain_offer)

    def test_lesson_is_an_accepted_offer_mode_end_to_end(self):
        # Server envelope type, server validation, client envelope type, and the control
        # turn the pill posts — a gap anywhere drops the tap on the floor.
        self.assertIn(
            'mode_offer?: { mode: "practice" | "discuss" | "lesson"; topic: string; label: string } | null;',
            CHAT,
        )
        self.assertIn(
            '(raw.mode === "practice" || raw.mode === "discuss" || raw.mode === "lesson") &&',
            CHAT,
        )
        self.assertIn('mode?: "practice" | "discuss" | "lesson";', TYPES)
        self.assertIn(
            'mode_offer?: { mode: "practice" | "discuss" | "lesson"; topic: string; label: string } | null;',
            TYPES,
        )
        self.assertIn('(offer: { mode: "practice" | "discuss" | "lesson";', CONVO)


class ModeOfferPillIsSingleUse(unittest.TestCase):
    """The demo transcript shows two identical [Talk it through] turns back to back."""

    def test_accepting_retires_the_offer_by_message_id(self):
        # The `sending` flag alone lost the race against a fast second tap.
        self.assertIn("acceptedOfferOn", APP)
        self.assertIn("if (offeredOn) setAcceptedOfferOn(offeredOn);", APP)
        self.assertIn(
            "const liveModeOffer = offeredOn && acceptedOfferOn === offeredOn ? undefined : rawModeOffer;",
            APP,
        )

    def test_the_sending_guard_is_kept_as_well(self):
        # Belt and braces: the id check stops double-taps, this stops taps mid-stream.
        self.assertIn("disabled={conversation.sending || conversation.booting}", APP)


if __name__ == "__main__":
    unittest.main()
