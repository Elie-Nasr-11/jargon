"""Round 19 (live-transcript review): the flow stops crediting echoes, answers questions
before presenting steps, activates authored links from the student's own words, paces
question-led modes properly, and the composer keeps dictation available while typing."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
CHATBOX = ROOT / "frontend" / "src" / "student" / "Chatbox.tsx"
PILLS = ROOT / "frontend" / "src" / "student" / "OfferPills.tsx"
TRANSCRIPT = ROOT / "frontend" / "src" / "student" / "Transcript.tsx"


class TranscriptSmoothingStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")

    def test_echo_check_gates_and_redirects(self):
        for fragment in (
            "function isEchoOfMentor(",
            "const ECHO_THRESHOLD = 0.6;",
            "const ECHO_MIN_WORDS = 12;",
            # The override happens at the flow layer, not model discipline.
            "answerEchoesMentor && gradedUnderstanding?.demonstrated",
            "const effectiveUnderstanding =",
            "ECHO CHECK: the student's message largely restates YOUR own recent words",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)
        # Downstream gating reads the EFFECTIVE verdict.
        self.assertIn("gradedUnderstanding: effectiveUnderstanding,", self.chat_fn)

    def test_question_answered_before_step_presentation(self):
        self.assertIn(
            "The student's message asks a QUESTION — answer it fully and helpfully FIRST",
            self.chat_fn,
        )

    def test_curriculum_link_activation_from_student_words(self):
        for fragment in (
            "const touchedByStudent = (ideaKey: string): boolean =>",
            "for (const clink of input.curriculumLinks)",
            '"student_articulated",',
            "curriculum_links?status=eq.published&select=from_key,to_key,kind,note",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)

    def test_pacing_rules_in_prompt(self):
        for fragment in (
            "- PACING: when the student asks for questions, practice, or a quiz, LEAD with the question",
            'Never combine "tap\n  Continue" with a request for an answer',
            "VARY your\n  exercises",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)

    def test_dictation_button_persists_while_typing(self):
        chatbox = CHATBOX.read_text(encoding="utf-8")
        self.assertIn("{surface === \"text\" && dictationAvailable ? (", chatbox)
        self.assertNotIn("dictationAvailable && (draftEmpty || dictating)", chatbox)

    def test_offer_pills_are_resources_only(self):
        # Phase A superseded the round-19 hide-while-selected logic: quiz/homework left the
        # chatbox entirely (teacher posts in the dock); only Resources remains inline.
        pills = PILLS.read_text(encoding="utf-8")
        self.assertNotIn("CONDITIONAL_MODES", pills)
        self.assertIn("if (!offers.resources) return null;", pills)

    def test_sections_split_when_arc_step_changes(self):
        transcript = TRANSCRIPT.read_text(encoding="utf-8")
        self.assertIn("const stepChanged =", transcript)
        self.assertIn("current.arc.step !== arcStep", transcript)


if __name__ == "__main__":
    unittest.main()


class GrowthMomentsStaticTests(unittest.TestCase):
    """Round 20: think-invitations, the center growth flash, checkpoint markers."""

    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.styles = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
        cls.flash = (ROOT / "frontend" / "src" / "student" / "GrowthFlash.tsx").read_text(
            encoding="utf-8"
        )
        cls.toasts = (ROOT / "frontend" / "src" / "student" / "KnowledgeToasts.tsx").read_text(
            encoding="utf-8"
        )

    def test_think_invitations(self):
        self.assertIn("- INVITE THINKING ACROSS SUBJECTS:", self.chat_fn)
        self.assertIn("NEVER state the connection", self.chat_fn)
        self.assertIn("possible_links: (() => {", self.chat_fn)

    def test_growth_flash_component_and_keyframes(self):
        self.assertIn("export function GrowthFlash(", self.flash)
        # Link = two circles + line; vocab = one line into one circle.
        self.assertIn('const isLink = toast.kind === "link";', self.flash)
        for keyframe in (
            "gflash-line-draw",
            "gflash-b-light",
            "gflash-a-settle",
            "gflash-glow-ping",
            "gflash-fade",
        ):
            with self.subTest(keyframe=keyframe):
                self.assertIn(keyframe, self.styles)
        # Yellow is the discuss/memory hue; everything settles to gray (ink).
        self.assertIn("stroke: var(--mode-discuss);", self.styles)
        self.assertIn("fill: var(--ink-45);", self.styles)

    def test_flash_plays_once_per_fresh_event(self):
        self.assertIn("toast.fresh && !flashedRef.current.has(toast.id)", self.toasts)
        self.assertIn("<GrowthFlash key={flash.id} toast={flash} />", self.toasts)

    def test_checkpoint_section_markers(self):
        self.assertIn("const opensCheckpoint =", self.transcript)
        self.assertIn('<ModeRule label="Checkpoint" />', self.transcript)
        self.assertIn("checkpoint={section.checkpoint}", self.transcript)


if __name__ == "__main__":
    unittest.main()


class PresentationIntegrityStaticTests(unittest.TestCase):
    """Round 22i (Portability transcript): a step counts as presented only when the
    MENTOR actually presents it — conversation turns can no longer 'present' a step
    whose material was never shown, so Continue can't conclude unseen steps."""

    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")

    def test_conversation_turns_do_not_stamp_presentation(self):
        self.assertIn(
            'if (routedKind === "question" || routedKind === "tangent" || routedKind === "meta") {',
            self.chat_fn,
        )

    def test_presenting_directive_stamps_presentation(self):
        self.assertIn("const presentsThisTurn =", self.chat_fn)
        self.assertIn(
            "if (presentsThisTurn && !finalState.presented_at) {", self.chat_fn
        )

    def test_continue_copy_honest_on_unpresented_steps(self):
        self.assertIn(
            "will bring up this step's material when they're ready", self.chat_fn
        )

    def test_pending_articulation_never_writes_the_answers(self):
        # The live transcript showed one partial attempt earning the mentor's full
        # comparison list — copy-bait the echo gate then rejects.
        self.assertIn(
            "NEVER write out the completed answer, list, or comparisons yourself",
            self.chat_fn,
        )
        self.assertIn(
            "If their message ALSO asked a question — even folded into an answer — answer it briefly FIRST",
            self.chat_fn,
        )


class StreamingProseStaticTests(unittest.TestCase):
    """Round 21: blur-in gray streaming, sentence whiten, live formatting, richer prose."""

    @classmethod
    def setUpClass(cls):
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.styles = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")

    def test_streaming_body_sentence_treatment(self):
        for fragment in (
            "function StreamingBody(",
            "import { splitSentences } from \"@/lib/sentences\";",
            # Tail = blurred gray; completed sentences whiten; live inline markdown.
            'className="stream-tail"',
            "stream-done",
            "<StreamingBody text={message.text} />",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.transcript)
        self.assertIn("filter: blur(1.6px);", self.styles)
        self.assertIn("@keyframes stream-whiten", self.styles)
        # Reduced motion: no blur, no whiten.
        self.assertIn(".stream-tail {\n    filter: none;", self.styles)

    def test_focus_gray_past_sentences_and_word_blur_in(self):
        # Owner (R22h): while streaming, only the LATEST sentence is white — earlier ones
        # step back to the sidebar's unselected gray — and forming words blur in one at a
        # time. The settled message renders all-white (MessageBody plain foreground).
        self.assertIn(
            'j === done.length - 1 ? "stream-done" : "stream-past"', self.transcript
        )
        self.assertIn('className="stream-word"', self.transcript)
        self.assertIn("tail.split(/(\\s+)/)", self.transcript)
        self.assertIn(".stream-past {", self.styles)
        self.assertIn("@keyframes stream-word-in", self.styles)

    def test_prose_is_not_flat(self):
        # Questions wear the accent, settled and live.
        self.assertIn("function isQuestionSentence(", self.transcript)
        self.assertIn("prose-question", self.transcript)
        self.assertIn(".prose-question {", self.styles)
        # Lists indent behind a divider rule; inline code carries its own hue.
        self.assertIn("border-l-2 border-border pl-6", self.transcript)
        self.assertIn("inline-code-hue", self.transcript)
        self.assertIn(".inline-code-hue {", self.styles)


class TransitionKinksStaticTests(unittest.TestCase):
    """Round 22 (demo-lesson transcript review): the advancing turn stops pointing at a
    Continue button that no longer exists, bare "ready" stops earning a full re-ask,
    graders enforce a named criterion, multi-part answers get engaged part by part, and
    the section marker stops landing one message early."""

    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.types = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(
            encoding="utf-8"
        )

    def test_gated_steps_deny_the_continue_button(self):
        # Caught in the R22c teen gauntlet: "tap Continue if you'd like to move on" on a
        # code-practice step (and "tap Continue to see it run" on a gated reflection step)
        # when no Continue button existed. Gated steps now carry an explicit denial.
        self.assertIn(
            "There is NO Continue button on this step", self.chat_fn
        )
        self.assertIn("!requirements.acknowledge &&", self.chat_fn)

    def test_first_idk_earns_a_nudge_not_the_answer(self):
        # Caught twice live: one "idk"/joke answer earned the full worked solution.
        self.assertIn("EARN THE ANSWER:", self.chat_fn)

    def test_replies_carry_visual_texture(self):
        # Owner (R22d): no bland replies — the prompt teaches the client's render palette.
        self.assertIn("- TEXTURE:", self.chat_fn)
        self.assertIn("never send a flat wall of prose", self.chat_fn)

    def test_lists_drop_bullet_dots_and_indent_the_rule(self):
        # Owner (R22d): no bullet dots; the indented divider rule alone marks the list.
        self.assertIn('className="ml-4 list-none space-y-1.5 border-l-2 border-border pl-6"', self.transcript)
        self.assertNotIn("list-disc", self.transcript)

    def test_growth_flash_owns_the_screen_with_a_note(self):
        # Owner (R22g): dim+blur overlay behind the flash, resistance line draw, and a
        # plain-language note ("New link between A and B" / "New word: x — definition").
        flash = (ROOT / "frontend" / "src" / "student" / "GrowthFlash.tsx").read_text(
            encoding="utf-8"
        )
        styles = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
        toasts = (ROOT / "frontend" / "src" / "student" / "KnowledgeToasts.tsx").read_text(
            encoding="utf-8"
        )
        self.assertIn("gflash-overlay", flash)
        self.assertIn("function noteFor(", flash)
        self.assertIn("New link between ${toast.event.from_title}", flash)
        self.assertIn("New word: ${toast.event.term}", flash)
        self.assertIn(".gflash-overlay {", styles)
        self.assertIn("backdrop-filter: blur(5px);", styles)
        self.assertIn("@keyframes gflash-note-in", styles)
        # Resistance draw: the offset grinds down in shrinking, stalling increments.
        self.assertIn("stroke-dashoffset: 54;", styles)
        self.assertIn("stroke-dashoffset: 29;", styles)
        self.assertIn("setFlash(null), 3_300", toasts)

    def test_no_step_count_boilerplate_divider_signifies_instead(self):
        # Owner (R22e): the appended "That completes step N of M… Send a message" line is
        # gone — the mentor closes naturally and the transcript divider marks the change.
        self.assertNotIn("That completes", self.chat_fn)
        self.assertNotIn("Send a message when you're ready", self.chat_fn)
        self.assertNotIn("arcSuffix", self.chat_fn)
        self.assertIn("never announce completion mechanically", self.chat_fn)
        # Client: the step divider appears immediately after a transition turn and renders
        # dimmed when it sits inside the same mode block.
        self.assertIn("soft?: boolean;", self.transcript)
        self.assertIn("pendingArcDivider", self.transcript)
        self.assertIn("opacity-55", self.transcript)

    def test_post_completion_never_points_at_ghost_buttons(self):
        # Caught in the R22b live run: "you can tap Continue to move on" after the
        # lesson completed, when no Continue button exists anymore.
        self.assertIn(
            "There is NO Continue button after completion", self.chat_fn
        )

    def test_concluding_turns_carry_the_handoff_rule(self):
        self.assertIn("const CONCLUDE_HANDOFF =", self.chat_fn)
        self.assertIn("Never name the Continue button or any button", self.chat_fn)
        # R31 (demo feedback): a step closes by ASKING, and never over an unanswered request.
        self.assertIn('END WITH \\"Shall we continue?\\"', self.chat_fn)
        self.assertIn("Never wrap up over an unanswered request", self.chat_fn)
        # Every concluding directive appends it — declaration + 8 concatenations.
        self.assertGreaterEqual(self.chat_fn.count("CONCLUDE_HANDOFF"), 9)
        self.assertIn("closing + CONCLUDE_HANDOFF", self.chat_fn)

    def test_continue_tap_never_credits_unshown_thinking(self):
        self.assertIn(
            "do NOT invent, credit, or reference thinking they never showed",
            self.chat_fn,
        )

    def test_bare_readiness_gets_one_line_not_a_reask(self):
        self.assertIn("const bareReadiness =", self.chat_fn)
        self.assertIn('key: "readiness_ack",', self.chat_fn)
        self.assertIn("do NOT restate, rephrase, or re-explain any part of it", self.chat_fn)
        # A meta-routed "ready" must not fall into summarize/reassure either.
        self.assertIn(
            'routedKind === "meta" && !quizActive && !bareReadiness', self.chat_fn
        )

    def test_grader_enforces_named_criterion(self):
        self.assertIn("NAMED-CRITERION RULE:", self.chat_fn)
        self.assertIn(
            "requires the latest message ", self.chat_fn
        )

    def test_multipart_answers_and_praise_variance(self):
        self.assertIn(
            "never wave a multi-part answer through with one generic praise line",
            self.chat_fn,
        )
        self.assertIn("VARY your openers too", self.chat_fn)

    def test_transition_arc_keeps_marker_off_by_one_fixed(self):
        # Server stamps the advancing turn's arc.
        self.assertIn("{ ...advancedArc, transition: true }", self.chat_fn)
        # Client type carries the flag; the splitter and the eyebrow both respect it.
        self.assertIn("transition?: boolean;", self.types)
        self.assertIn("!messageArc?.transition;", self.transcript)
        self.assertIn(
            "if (messageArc && !messageArc.transition) open.arc = messageArc;",
            self.transcript,
        )


if __name__ == "__main__":
    unittest.main()
