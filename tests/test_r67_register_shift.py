"""R67 — auto register shift + flow-driven shift suggestions.

Owner (2026-08-27): "lets also add auto mode shift and shift suggestions based
on conversation flow" — and the live case arrived the same morning: Carl, in
Discuss, typed "Can you give me a few questions to try?", got an ungraded
shadow-drill in the wrong register, then had to discover the mode picker
himself and re-send the same words in Practice. Students speak in intent, not
in register names.

The context-first split holds: the MENTOR decides what the words meant
(register_shift, a new output field), the MACHINE decides what the rules allow.
The law, pinned here:
- a shift is VISIBLE (the reply announces it) and REVERSIBLE (the picker stays
  live; the client applies it after the stream settles);
- it changes only what the client sends NEXT turn — this turn folded under the
  register it arrived in, so gates and ceilings are byte-untouched;
- never in a revisit, never over live quiz options, never OUT of Lesson while
  graded work is owed, and never twice in quick succession (anti-flap);
- the R31e advance-demand belt emits the lesson-ward shift deterministically
  even when the model omits the field; the way-back pill still attaches for
  older clients, and a new client suppresses that pill when it applied the
  shift.
mode_offer (suggestions) widens from beat-close-only to flow-driven mid-step,
behind the same cooldown.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")
HOOK = (ROOT / "frontend" / "src" / "student" / "useConversation.ts").read_text(encoding="utf-8")
MESSAGES = (
    ROOT / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts"
).read_text(encoding="utf-8")


class MentorContractTests(unittest.TestCase):
    def test_the_output_contract_carries_the_shift(self):
        self.assertIn('"register_shift": null', CHAT)
        self.assertIn('Set "register_shift" to { "to": "lesson" | "practice" | "discuss"', CHAT)
        # Serve their stated ask, never the mentor's own plan; suggestions stay
        # mode_offer's job.
        self.assertIn("their STATED ask, never your own plan", CHAT)
        self.assertIn("act in the new register IMMEDIATELY", CHAT)

    def test_suggestions_widen_beyond_beat_closes(self):
        self.assertIn("or mid-step, when\nthe conversation's own flow shows the register no longer fits", CHAT)


class MachineLawTests(unittest.TestCase):
    def test_validation_guards_are_all_present(self):
        site = CHAT.split("const shiftRaw =", 1)[1][:2600]
        # Shape + no-op suppression + revisit + live options + anti-flap.
        self.assertIn('shiftTo !== (declaredMode ?? "lesson")', site)
        self.assertIn("!inRevisit", site)
        self.assertIn('finalFlow.nextAction !== "choose"', site)
        self.assertIn("recentRegisterMoves.shifts === 0", site)
        # Outbound shifts never park owed graded work; lesson-ward is exempt.
        self.assertIn('(shiftTo === "lesson" || !integrityOwed)', site)
        self.assertIn('flowOwed === "a quiz tap" || flowOwed === "a code run" || flowOwed === "a submission"', CHAT)

    def test_the_advance_demand_belt_is_deterministic(self):
        self.assertIn('advanceAskedButCeilinged && shiftLegal\n          ? { to: "lesson", reason: "you asked to move on" }', CHAT)
        # The old way-back pill still attaches for older clients, after the strip.
        self.assertIn('label: "Back to the lesson"', CHAT)

    def test_gate_math_is_untouched(self):
        # A shift changes what the client SENDS next turn — never how this turn
        # folded. The ceiling's call-site count is the canary (see test_turn_modes).
        self.assertEqual(CHAT.count("applyModeCeiling("), 4)
        self.assertNotIn("registerShift", CHAT.split("export function applyTurn(", 1)[1].split("\n}", 1)[0])

    def test_anti_flap_memory_derives_from_persisted_payloads(self):
        block = CHAT.split("const recentRegisterMoves =", 1)[1][:900]
        self.assertIn("payload?.register_shift && mentorTurns <= 4", block)
        self.assertIn("payload?.mode_offer", block)

    def test_offer_strip_holds_the_old_guarantees_plus_cooldown(self):
        strip = CHAT.split("const beatClosed =", 1)[1][:700]
        self.assertIn("inRevisit ||", strip)
        self.assertIn("envelope.choices && envelope.choices.length", strip)
        self.assertIn("registerShift !== null", strip)
        self.assertIn("!beatClosed &&", strip)
        self.assertIn("envelope.mode_offer = null;", strip)

    def test_the_room_facts_keep_prose_and_chrome_agreeing(self):
        self.assertIn("The register is being switched back to Lesson for them with this reply", CHAT)
        self.assertIn("do not set mode_offer or register_shift this turn", CHAT)

    def test_replays_reapply_their_own_shift(self):
        passthrough = CHAT.split("register_shift: (() => {", 1)[1][:500]
        self.assertIn('raw.to === "lesson" || raw.to === "practice" || raw.to === "discuss"', passthrough)


class ClientTests(unittest.TestCase):
    def test_the_picker_follows_visibly_and_reversibly(self):
        self.assertIn('register_shift?: { to: "lesson" | "practice" | "discuss"; reason: string } | null;', TYPES)
        self.assertIn('setRegister(envelope.register_shift.to, "shift");', HOOK)
        self.assertIn('"lesson_open" | "shift"', HOOK)

    def test_a_shift_supersedes_the_pill_on_new_clients(self):
        self.assertIn("!payload.register_shift &&\n        payload.mode_offer", MESSAGES)


if __name__ == "__main__":
    unittest.main()
