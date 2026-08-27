"""Flow rebuild Pillar 2: the conversation register has ONE owner.

Before this slice the register was a bare useState in StudentApp with four scattered
writers, and every send call site threaded turnMode by hand — the R33c wrong-mode bug
was exactly a caller threading "lesson" into a Practice tap. Now the register lives in
useConversation behind a single setRegister(mode, cause) seam, sends read it at that
owner, and every change names the student-visible action that caused it (the client
half of PLATFORM §12.3's invariant).
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
HOOK = (SRC / "student" / "useConversation.ts").read_text(encoding="utf-8")
APP = (SRC / "student" / "StudentApp.tsx").read_text(encoding="utf-8")
WINDOW = (SRC / "student" / "ChatWindow.tsx").read_text(encoding="utf-8")


def _frontend_sources():
    for path in SRC.rglob("*.ts*"):
        yield path, path.read_text(encoding="utf-8")


class TheRegisterHasOneOwner(unittest.TestCase):
    def test_the_reducer_and_its_seam_live_in_the_hook(self):
        for fragment in (
            "const [register, dispatchRegister] = useReducer(",
            "const registerRef = useRef<TurnMode>(DEFAULT_TURN_MODE);",
            "const setRegister = useCallback((mode: TurnMode, cause: RegisterCause) => {",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, HOOK)

    def test_no_component_holds_register_state_anymore(self):
        self.assertNotIn("useState<TurnMode>", APP)
        for path, text in _frontend_sources():
            with self.subTest(file=str(path.relative_to(SRC))):
                self.assertNotIn("setTurnMode", text)

    def test_the_ref_updates_before_the_dispatch(self):
        # A gesture that sets the register and sends in the same tick (suggestion rows,
        # offer pills) must send in the register it just chose — state alone is async.
        self.assertIn(
            "registerRef.current = mode;\n    dispatchRegister({ mode, cause });", HOOK
        )


class EveryChangeNamesItsCause(unittest.TestCase):
    ALLOWED = {'"picker"', '"offer"', '"suggestion"', '"lesson_open"', '"shift"'}

    def test_the_cause_union_is_closed(self):
        self.assertIn(
            'export type RegisterCause = "picker" | "offer" | "suggestion" | "lesson_open" | "shift";',
            HOOK,
        )

    def test_every_call_site_carries_an_enumerated_cause(self):
        calls = []
        for path, text in _frontend_sources():
            for match in re.finditer(r"setRegister\(([^)]*)\)", text):
                calls.append((str(path.relative_to(SRC)), match.group(1)))
        self.assertTrue(calls, "expected setRegister call sites")
        for where, args in calls:
            with self.subTest(call=f"{where}: setRegister({args})"):
                cause = args.split(",")[-1].strip()
                self.assertIn(cause, self.ALLOWED)
        # The five causes are all real: picker (composer), offer (hand-off pill),
        # suggestion (welcome/re-entry rows), lesson_open (reset to the spine),
        # shift (R67: the mentor moved the register on the student's own ask — the
        # reply announces it, so the change is still gesture-visible).
        self.assertEqual({args.split(",")[-1].strip() for _, args in calls}, self.ALLOWED)

    def test_opening_a_lesson_resets_to_the_spine_inside_the_hook(self):
        # Folded into openLesson so no caller can open a lesson and forget the reset.
        self.assertIn('setRegister(DEFAULT_TURN_MODE, "lesson_open");', HOOK)
        self.assertNotIn("DEFAULT_TURN_MODE", APP)


class SendsReadTheRegisterAtTheOwner(unittest.TestCase):
    def test_no_send_takes_a_mode_parameter(self):
        for signature in (
            "const sendText = useCallback(\n    (text: string, attachments?: ChatAttachment[]) => {",
            "const sendCode = useCallback(\n    async (code: string, language: ComposerLanguage) => {",
            "const sendChoice = useCallback(\n    (choiceId: string, label: string) => {",
            "const sendVoiceTurn = useCallback(\n    (text: string, confidence?: number | null) =>",
        ):
            with self.subTest(signature=signature.splitlines()[1].strip()):
                self.assertIn(signature, HOOK)
        # The four sends read the ref, and (Pillar 5) the control senders ride the
        # live register too — resume, navigate, control-retry, and (R48) the work-step
        # submitted→continue handshake. The mode-offer control alone passes offer.mode:
        # it IS the register change.
        self.assertEqual(HOOK.count("registerRef.current,"), 8)

    def test_retry_is_a_one_shot_override(self):
        # A retry re-sends in the register the failed turn was SENT in; the sticky
        # register never moves for it (a retry is not the student choosing a mode).
        self.assertIn("(answer: TypedChatAnswer, mode?: TurnMode) =>", HOOK)
        self.assertIn("sendAnswer(answer, mode ?? registerRef.current)", HOOK)

    def test_the_voice_panel_no_longer_threads_a_mode(self):
        self.assertIn("channel.sendVoiceTurn(text, confidence)", WINDOW)
        self.assertNotIn("sendVoiceTurn(text, mode", WINDOW)


if __name__ == "__main__":
    unittest.main()
