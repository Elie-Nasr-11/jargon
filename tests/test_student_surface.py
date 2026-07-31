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
WINDOW = (FRONT / "student" / "ChatWindow.tsx").read_text()
MODEL = (FRONT / "features" / "student" / "chat" / "chatMessages.ts").read_text()


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



class ModeSections(unittest.TestCase):
    """The border and label describe a stretch of conversation, not the window."""

    def test_mode_is_persisted_on_both_turn_roles(self):
        # Without this a RELOADED transcript cannot know which mode any message happened in, so
        # the sections would vanish on refresh. Both roles are stamped so a reply groups with the
        # student turn it answers instead of opening a new unlabelled section.
        self.assertIn("{ ...answer, turn_mode: declaredMode } : answer", CHAT_FN)
        self.assertIn("{ ...envelope, turn_mode: declaredMode } : envelope", CHAT_FN)

    def test_the_client_reads_the_persisted_mode_back(self):
        self.assertIn("turn_mode", MODEL)
        self.assertIn("turnMode", MODEL)

    def test_unknown_mode_gets_no_section_chrome(self):
        # Relabelling a turn written before modes existed would be inventing history.
        # (Anchored to the next top-level function rather than the first "\n}" — the
        # multi-line props destructure closes with one before the body even starts.)
        fn = TRANSCRIPT[TRANSCRIPT.index("function ModeSection(") :]
        tail = fn.find("\nfunction ")
        if tail != -1:
            fn = fn[:tail]
        self.assertIn("if (!mode || !isTurnMode(mode))", fn)

    def test_only_student_and_mentor_messages_open_a_section(self):
        # Thinking placeholders and teacher interjections are not the student picking a mode; if
        # they opened sections, a reply and its "Thinking…" bubble would split across two boxes.
        fn = TRANSCRIPT[TRANSCRIPT.index("function groupIntoSections(") :]
        fn = fn[: fn.index("\n}")]
        self.assertIn('message.role === "user" || message.role === "bot"', fn)
        self.assertIn("!opensSection || mode === current.mode", fn)

    def test_the_window_no_longer_owns_the_border_or_label(self):
        # One lesson can contain several modes, so a single window-level border would be a lie
        # about which part was which.
        self.assertNotIn("mode-surface", WINDOW)
        self.assertNotIn("mode-eyebrow", WINDOW)
        # The sections do own the chrome: a full-width rule + pill per section (the tinted
        # fit-width .mode-surface boxes retired with the 2026-07-31 flat restyle).
        self.assertIn("mode-divider", TRANSCRIPT)
        self.assertIn("mode-eyebrow", TRANSCRIPT)

    def test_the_rule_spans_the_window_but_messages_keep_the_reading_column(self):
        # The rule is full-bleed; the messages under it stay centered and width-capped —
        # the window no longer wraps children in its own column (Transcript owns layout).
        self.assertIn("max-w-3xl", TRANSCRIPT)
        fn = WINDOW[WINDOW.index("overflow-y-auto") :]
        self.assertNotIn("max-w-3xl", fn[: fn.index("</div>")])

    def test_the_rule_animates_once_on_first_visibility(self):
        # Both entrances (fresh mode selection at the bottom, scroll-back through history) run
        # through one mechanism; reduced motion renders the final state immediately.
        self.assertIn("IntersectionObserver", TRANSCRIPT)
        self.assertIn("prefersReducedMotion()", TRANSCRIPT)

class LessonFlowAffordances(unittest.TestCase):
    """B1: the turn-loop affordances the envelope drives."""

    def test_quiz_choices_retire_with_the_pick_checkmarked(self):
        # The pick is stamped on the quiz message BEFORE the turn is sent, so when the live
        # buttons retire the history keeps showing WHICH option was chosen.
        self.assertIn("{ ...m, chosen: choiceId }", HOOK)
        # Retired rendering: chosen pill check-marked, the rest dimmed; and a message with a
        # stamped pick is no longer live even while it is still the latest.
        self.assertIn("message.choices?.length && message.chosen", TRANSCRIPT)
        self.assertIn("!message.chosen", TRANSCRIPT)

    def test_lesson_sections_carry_the_step_eyebrow(self):
        # Mentor turn payloads persist the whole envelope, so a reloaded transcript labels
        # each lesson section with the REAL step it happened on — never the live cursor
        # projected backwards onto history.
        self.assertIn("stepEyebrowLabel", MODEL)
        self.assertIn("payload.lesson_arc", MODEL)
        self.assertIn('mode === "lesson" && stepEyebrowLabel(arc)', TRANSCRIPT)

    def test_mode_accents_stay_token_derived(self):
        # Design system (docs/design-system, 2026-07-31): every mode owns a full hue — the old
        # off-spine desaturation is retired. What must NOT regress: the accent stays
        # token-derived (a CSS var, no hex leaking into components), progression honesty lives
        # in canProgress affordances + the server ceiling, and the on-tag ink pairs with it.
        fn = MODES[MODES.index("export function modeAccentValue(") :]
        fn = fn[: fn.index("\n}")]
        self.assertIn("var(${spec.accentVar})", fn)
        self.assertNotIn("#", fn)
        self.assertIn("export function modeInkValue(", MODES)
        self.assertIn("canProgress", MODES)

    def test_mentor_rise_respects_reduced_motion(self):
        # DESIGN_V6 §3: 280ms power3.out rise for mentor replies — and a reduced-motion user
        # gets the final state with no tween at all.
        self.assertIn("prefersReducedMotion()", TRANSCRIPT)
        self.assertIn('ease: "power3.out"', TRANSCRIPT)

    def test_history_never_animates(self):
        # Only newly-arrived replies rise: a reloaded transcript (or a lesson switch) counts
        # as history and renders instantly.
        self.assertIn("seenRef", TRANSCRIPT)


class VoiceThreading(unittest.TestCase):
    """B1: dictation, read-aloud, and live voice all land in the normal turn loop."""

    def _box(self) -> str:
        return (FRONT / "student" / "Chatbox.tsx").read_text()

    def test_dictation_stages_modality_for_the_turn(self):
        # The shell's onSend prop forwards only text+attachments, so the Chatbox stages the
        # modality synchronously and the hook consumes it while building the SAME turn.
        self.assertIn('stageInputMeta({ inputModality: "dictated"', self._box())
        self.assertIn("takeStagedInputMeta()", HOOK)
        self.assertIn('input_modality: meta?.inputModality ?? "typed"', HOOK)

    def test_dictated_transcript_is_editable_before_send(self):
        # Dictation streams INTO the textarea (interim results) — the student reads and fixes
        # the words before sending. Auto-submitting a misheard transcript would be a trap.
        box = self._box()
        self.assertIn("interimResults = true", box)
        self.assertIn("setText(nextText)", box)

    def test_read_aloud_returns_on_mentor_turns(self):
        self.assertIn("ReadAloudAction", TRANSCRIPT)

    def test_voice_turns_carry_audio_session_modality(self):
        self.assertIn('input_modality: "audio_session"', HOOK)


class LessonOffersAreServerDriven(unittest.TestCase):
    """envelope.available is what makes the inline pills real rather than decorative."""

    def test_the_server_populates_every_offer(self):
        block = CHAT_FN[CHAT_FN.index("envelope.available = {") :]
        block = block[: block.index("};")]
        self.assertIn("quiz: requirements.quiz", block)
        self.assertIn("homework:", block)
        self.assertIn("resources: attachedResources.length > 0", block)

    def test_homework_counts_assignments_not_assessments(self):
        # An assessment is not homework; counting it would show the Homework pill for a quiz.
        block = CHAT_FN[CHAT_FN.index("envelope.available = {") :]
        block = block[: block.index("};")]
        self.assertIn("pendingCheckpoints", block)
        self.assertIn('=== "assignment"', block)

    def test_offers_are_computed_without_new_queries(self):
        # Each flag reads state the turn already has. A fresh fetch here would add latency to
        # every single turn for three booleans.
        block = CHAT_FN[CHAT_FN.index("envelope.available = {") :]
        block = block[: block.index("};")]
        for banned in ("await ", "loadMany(", "supabaseFetch("):
            self.assertNotIn(banned, block)

    def test_the_field_stays_optional_for_replay(self):
        # Envelopes stored before v6 must replay unchanged.
        self.assertIn("available?: { quiz: boolean; homework: boolean; resources: boolean }", CHAT_FN)


class CodeSurface(unittest.TestCase):
    """Running code IS the turn: the server's code gate only passes on a real result."""

    def test_input_surface_is_a_separate_axis_from_turn_mode(self):
        box = (FRONT / "student" / "Chatbox.tsx").read_text()
        # A student can write code in Practice or in Discuss; the surface says HOW they type,
        # the mode says what the turn is for. Conflating the two is the old surface's mistake.
        self.assertIn('type InputSurface = "text" | "code"', box)
        self.assertIn("ModeSelector", box)

    def test_run_submits_the_turn_rather_than_only_executing(self):
        # One action, so a stale run_result cannot be submitted.
        fn = HOOK[HOOK.index("const sendCode = useCallback(") :]
        fn = fn[: fn.index("[sendAnswer],")]
        self.assertIn("sendAnswer(", fn)
        self.assertIn('mode: "code"', fn)
        self.assertIn("run_result: runResult", fn)

    def test_jargon_result_is_passed_through_untouched(self):
        # The gate inspects status/truncated/errors, so flattening Jargon's response into
        # {ok, output} would discard what the server grades on.
        fn = HOOK[HOOK.index("const sendCode = useCallback(") :]
        fn = fn[: fn.index("[sendAnswer],")]
        self.assertIn("invokeJargonRun(", fn)
        self.assertIn("runResult = response", fn)
        # Browser runners only ever produce {ok, output}.
        self.assertIn("runJavaScript", fn)
        self.assertIn("runPython", fn)

    def test_a_runner_failure_is_output_not_a_chat_error(self):
        fn = HOOK[HOOK.index("const sendCode = useCallback(") :]
        fn = fn[: fn.index("[sendAnswer],")]
        self.assertIn('role: "output"', fn)


class Attachments(unittest.TestCase):
    def _box(self) -> str:
        return (FRONT / "student" / "Chatbox.tsx").read_text()

    def test_picker_uses_the_shared_accept_list(self):
        # CHAT_UPLOAD_ACCEPT deliberately excludes PDF: the edge function only inlines text and
        # images, so accepting one would attach a file the tutor silently cannot read. Hardcoding
        # an accept string here would quietly reintroduce that.
        box = self._box()
        self.assertIn("CHAT_UPLOAD_ACCEPT", box)
        self.assertNotIn('accept="', box)

    def test_send_waits_for_uploads_in_flight(self):
        # Sending mid-upload would hand the tutor a reference to a file that is not there yet.
        box = self._box()
        self.assertIn("&& !uploading", box)

    def test_an_attachment_alone_is_a_valid_message(self):
        # "Here, look at this" needs no accompanying text.
        box = self._box()
        self.assertIn("text.trim().length > 0 || attachments.length > 0", box)

    def test_the_file_count_cap_is_the_shared_constant(self):
        box = self._box()
        self.assertIn("MAX_CHAT_UPLOAD_FILES", box)

    def test_attachments_are_omitted_when_empty(self):
        # The edge function branches on presence, so an empty array is not the same as absent.
        self.assertIn("attachments?.length ? attachments : undefined", HOOK)


if __name__ == "__main__":
    unittest.main()
