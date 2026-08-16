"""Flow rebuild Pillar 5: dead flow contracts are retired, not carried.

continue_offer spent two rounds (since R31b removed the Continue button) as a wire +
transcript-model contract that nothing rendered — emission, envelope field, replay
passthrough, client model field, restore path, and the caller-less sendContinue are
all gone. The `continue` CONTROL is deliberately still parsed server-side: a browser
tab open since before R31b can still send one.

Control turns also stop declaring a hardcoded "lesson": they ride the LIVE register,
so a stepper click can no longer fire the server's REGISTER SHIFT voice nod, and the
live message stamp agrees with what a replay reconstructs under the Pillar-1 rule.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT_FN = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
HOOK = (ROOT / "frontend" / "src" / "student" / "useConversation.ts").read_text(encoding="utf-8")
MESSAGES = (ROOT / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts").read_text(
    encoding="utf-8"
)
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")
E2E = (ROOT / "tools" / "e2e_chat_script.py").read_text(encoding="utf-8")


class ContinueOfferIsRetired(unittest.TestCase):
    def test_no_layer_still_declares_the_field(self):
        for name, text in (("chat fn", CHAT_FN), ("types", TYPES), ("chatMessages", MESSAGES)):
            with self.subTest(layer=name):
                self.assertNotIn("continue_offer?:", text)
        self.assertNotIn("continueOffer?:", MESSAGES)

    def test_the_offer_is_neither_emitted_nor_replayed(self):
        self.assertNotIn("envelope.continue_offer =", CHAT_FN)
        self.assertNotIn("partial.continue_offer", CHAT_FN)
        self.assertNotIn("payload.continue_offer", MESSAGES)

    def test_send_continue_lost_its_last_caller_and_is_gone(self):
        self.assertNotIn("const sendContinue", HOOK)
        self.assertNotIn('control: { type: "continue" }', HOOK)

    def test_the_server_still_parses_the_continue_control_for_old_tabs(self):
        self.assertIn('controlType === "continue"', CHAT_FN)

    def test_the_e2e_harness_asserts_the_gate_not_the_dead_pill(self):
        self.assertNotIn("continue_offer", E2E)


class ControlTurnsRideTheLiveRegister(unittest.TestCase):
    def test_no_control_declares_a_hardcoded_lesson_register(self):
        # sendResume / sendNavigate / retryControlTurn each read the register at the
        # owner. (sendModeOffer passes offer.mode — it IS the register change.)
        self.assertNotIn('{ mode: "text", text: "", client_msg_id: uid() },\n      "lesson",', HOOK)
        self.assertNotIn('sendAnswer(answer, "lesson"', HOOK)
        for fragment in (
            'registerRef.current,\n      "Return to where I was",',
            'registerRef.current,\n        `Revisit: ${title || "an earlier step"}`,',
            "sendAnswer(answer, registerRef.current, undefined, { control });",
        ):
            with self.subTest(fragment=fragment.splitlines()[0]):
                self.assertIn(fragment, HOOK)


if __name__ == "__main__":
    unittest.main()
