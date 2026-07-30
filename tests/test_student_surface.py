"""Static invariants for the v6 student surface (frontend/src/student/).

The load-bearing rules this file pins:
- ONE transcript model. The new surface imports Msg + its adapters from
  features/student/chat/chatMessages.ts; a second copy is the duplication this rebuild
  exists to avoid.
- The declared TurnMode reaches the wire. The server-side ceiling is meaningless if the
  client never sends the field.
- Resume-before-send. invokeTypedChat with no session_id creates a NEW session on every
  call, so the boot path must look for an existing session first or each mount fragments
  the student's history.
- The client is not the enforcement point. `canProgress` drives UI affordances only; no
  gate logic may live in the frontend.
"""

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FRONT = REPO / "frontend" / "src"
API = (FRONT / "lib" / "api.ts").read_text()
HOOK = (FRONT / "student" / "useConversation.ts").read_text()
MODES = (FRONT / "student" / "turnModes.ts").read_text()
TRANSCRIPT = (FRONT / "student" / "Transcript.tsx").read_text()
PILLS = (FRONT / "student" / "OfferPills.tsx").read_text()
CHAT_FN = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()


class StudentSurfaceWire(unittest.TestCase):
    def test_turn_mode_reaches_the_request_body(self):
        fn = API[API.index("export async function invokeTypedChat(") :][:1400]
        self.assertIn("mode?: string", fn)
        self.assertIn("mode: input.mode", fn)

    def test_hook_sends_the_declared_mode(self):
        self.assertIn("mode,", HOOK)
        self.assertIn("invokeTypedChat(", HOOK)

    def test_resume_before_send(self):
        # The existing-session lookup must precede the session-creating call, or every mount
        # spawns a fresh session.
        self.assertIn("fetchLatestLearningSession(", HOOK)
        self.assertLess(
            HOOK.index("fetchLatestLearningSession("),
            HOOK.index("const envelope = await invokeTypedChat("),
        )

    def test_single_transcript_model(self):
        # Imported, never redeclared.
        self.assertIn("@/features/student/chat/chatMessages", HOOK)
        self.assertIn("@/features/student/chat/chatMessages", TRANSCRIPT)
        for src in (HOOK, TRANSCRIPT):
            self.assertNotIn("type Msg =", src)

    def test_dropdown_holds_exactly_the_always_available_modes(self):
        block = MODES[MODES.index("export const ALWAYS_MODES") : MODES.index("export const CONDITIONAL_MODES")]
        for mode in ("lesson", "practice", "discuss", "open"):
            self.assertIn(f'id: "{mode}"', block)
        # Quiz and homework are conditional — a dropdown whose length changes per lesson is
        # harder to learn than a fixed list plus visible inline pills.
        self.assertNotIn('id: "quiz"', block)
        self.assertNotIn('id: "assignment"', block)

    def test_checkpoints_mode_is_gone(self):
        self.assertNotIn("checkpoints", MODES)

    def test_homework_keeps_the_assignment_wire_id(self):
        # The server's mode whitelist accepts "assignment"; only the student-facing LABEL says
        # Homework. Renaming the id would fall through to legacy behaviour server-side.
        block = MODES[MODES.index("export const CONDITIONAL_MODES") :]
        self.assertIn('id: "assignment"', block)
        self.assertIn('label: "Homework"', block)
        self.assertIn('"assignment"', CHAT_FN)

    def test_resources_is_not_a_turn_mode(self):
        # Opening materials sends no turn and cannot change the conversation's contract, so it
        # must not be in the TurnMode union.
        union = MODES[MODES.index("export type TurnMode =") :]
        union = union[: union.index(";")]
        self.assertNotIn("resources", union)

    def test_a_pill_only_appears_when_the_lesson_offers_it(self):
        # No guessing: homework has no client-side proxy signal, so its pill stays hidden until
        # the server sends availability rather than pointing a student at work that may not exist.
        self.assertIn("sent?.homework ?? false", HOOK)
        self.assertIn("if (!available.length && !offers.resources) return null;", PILLS)

    def test_errors_are_humanised_for_any_thrown_shape(self):
        # supabase-js rejects with PLAIN OBJECTS carrying a message, not Error instances. An
        # `instanceof Error` check alone renders "[object Object]" to the student — caught by
        # running the surface live, so pin it.
        fn = HOOK[HOOK.index("function friendlyError(") :]
        fn = fn[: fn.index("\n}")]
        self.assertIn("err instanceof Error", fn)
        self.assertIn('typeof err === "string"', fn)
        self.assertIn('typeof (err as { message?: unknown }).message === "string"', fn)
        # Raw developer exceptions never reach the student verbatim.
        self.assertIn("TypeError|ReferenceError|SyntaxError", fn)

    def test_client_holds_no_gate_logic(self):
        # canProgress is a UI hint. If gate vocabulary shows up in the frontend, the
        # enforcement point has drifted off the server.
        for banned in ("code_passed_at", "quiz_passed_at", "understanding_at", "acknowledged_at"):
            self.assertNotIn(banned, MODES)
            self.assertNotIn(banned, HOOK)
            self.assertNotIn(banned, TRANSCRIPT)


if __name__ == "__main__":
    unittest.main()
