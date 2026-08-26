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
        # R64: the questionFirst rung prefix became STEP TYPES' presentation rule +
        # the CONVERSATION FLOW question rule — same order guarantee, standing form.
        self.assertIn(
            "serve anything their message asked FIRST, then present", self.chat_fn
        )
        self.assertIn(
            "answer it fully and directly FIRST — a real answer, not a\n  redirect",
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


class KnowledgeCardStaticTests(unittest.TestCase):
    """R32 (owner: "much better design for the link and vocab popups — it's not good").

    Was: THREE surfaces for one moment — a full-screen SVG of two circles and a line, a
    vocab banner from the top centre, and growth toasts stacking top right. A turn that
    taught three words put three cards on screen plus an animation carrying no information
    its own caption didn't. Now: ONE card holding the whole turn, which also delivers the
    owner's earlier ask that several vocab words share a single pop-up.
    """

    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.styles = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
        cls.card = (ROOT / "frontend" / "src" / "student" / "KnowledgeCard.tsx").read_text(
            encoding="utf-8"
        )
        cls.toasts = (ROOT / "frontend" / "src" / "student" / "KnowledgeToasts.tsx").read_text(
            encoding="utf-8"
        )

    def test_think_invitations(self):
        self.assertIn("- INVITE THINKING ACROSS SUBJECTS:", self.chat_fn)
        self.assertIn("NEVER state the connection", self.chat_fn)
        self.assertIn("possible_links: (() => {", self.chat_fn)

    def test_the_three_old_surfaces_are_gone(self):
        self.assertFalse(
            (ROOT / "frontend" / "src" / "student" / "GrowthFlash.tsx").exists(),
            "the full-screen flash should be deleted, not merely unmounted",
        )
        for dead in ("gflash", "ktoast"):
            with self.subTest(dead=dead):
                self.assertNotIn(dead, self.styles)
        for dead in ("VocabBanner", "GrowthToast", "GrowthFlash"):
            with self.subTest(dead=dead):
                self.assertNotIn(dead, self.toasts)

    def test_one_card_carries_every_event_from_the_turn(self):
        # The owner asked for this twice: "multiple vocab words in the pop-up".
        self.assertIn("toasts={channel.knowledgeToasts}", self.toasts)
        self.assertIn("{toasts.map((toast) => (", self.card)
        self.assertIn("new word${words > 1", self.card)

    def test_a_definition_is_the_body_of_the_entry(self):
        # The old flash showed circles; the definition is what a student came for.
        self.assertIn("toast.event.definition", self.card)
        self.assertIn("toast.event.note", self.card)
        self.assertIn("toast.event.one_liner", self.card)

    def test_it_is_modal_and_must_be_dismissed(self):
        self.assertIn('role="dialog"', self.card)
        self.assertIn('aria-modal="true"', self.card)
        self.assertIn("pointer-events-auto", self.card)
        self.assertIn('event.key === "Escape"', self.card)

    def test_nothing_is_on_a_timer(self):
        # R31c's guarantee, carried forward: a word lost to a countdown while the student
        # is still reading is the opposite of the point.
        for banned in ("setTimeout", "useAutoDismiss"):
            with self.subTest(banned=banned):
                self.assertNotIn(banned, self.card)
                self.assertNotIn(banned, self.toasts)

    def test_the_entrance_cannot_leave_an_invisible_blocker(self):
        # The trap that shipped once: the container animated to opacity 0 with fill-mode
        # both while staying mounted, leaving a full-screen click sink. The entrance must
        # END opaque.
        block = self.styles[self.styles.index("@keyframes kcard-in") :][:220]
        self.assertIn("to {\n    opacity: 1;", block)

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
        # R31e: the honest copy no longer names a button (there is none) — but it must
        # still never imply that moving on SKIPS material that was never taught.
        # (R64 home: the CONVERSATION FLOW question rule, keyed off flow.presented.)
        self.assertIn("material has NOT been taught yet (flow.presented false)", self.chat_fn)
        self.assertIn("never imply that moving on skips the material", self.chat_fn)

    def test_pending_articulation_never_writes_the_answers(self):
        # The live transcript showed one partial attempt earning the mentor's full
        # comparison list — copy-bait the echo gate then rejects. (R64 home: the
        # STEP TYPES reflection contract.)
        self.assertIn(
            "NEVER write out the completed answer, list, or comparisons yourself",
            self.chat_fn,
        )
        self.assertIn("that turns the step into\n  copy-bait", self.chat_fn)


class StreamingProseStaticTests(unittest.TestCase):
    """R32 (owner): "remove the blur stuff... just have words load like any normal AI."

    Rounds 21/22h focused reading by graying every sentence but the newest and blurring
    each forming word in. It recoloured the reply UNDER a student who was still reading
    it. Now text arrives the plain way and stays put.
    """

    @classmethod
    def setUpClass(cls):
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.styles = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")

    def test_streaming_body_still_streams(self):
        for fragment in (
            "function StreamingBody(",
            'import { splitSentences } from "@/lib/sentences";',
            "<StreamingBody text={message.text} />",
            'className="stream-word"',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.transcript)

    def test_no_blur_anywhere_in_the_stream(self):
        # The owner asked for this by name. A blur on arriving text is what "the blur
        # stuff" meant, and it must not creep back under another keyframe name.
        stream_css = self.styles[self.styles.index("@keyframes stream-word-in") :]
        stream_css = stream_css[: stream_css.index("@media (prefers-reduced-motion")]
        self.assertNotIn("blur", stream_css)

    def test_settled_text_is_never_recoloured(self):
        # No gray-past / whiten pass: every word arrives in the normal foreground colour
        # and stays there. These classes are gone from BOTH files, not just unused.
        for dead in ("stream-past", "stream-done", "stream-tail", "stream-whiten"):
            with self.subTest(dead=dead):
                self.assertNotIn(dead, self.transcript)
                self.assertNotIn(dead, self.styles)

    def test_the_only_motion_is_a_short_opacity_fade(self):
        block = self.styles[self.styles.index("@keyframes stream-word-in") :][:220]
        self.assertIn("opacity: 0;", block)
        self.assertIn("opacity: 1;", block)
        self.assertNotIn("filter:", block)
        self.assertIn("animation: stream-word-in 0.18s", self.styles)

    def test_reduced_motion_still_opts_out(self):
        self.assertIn(".stream-word {\n    animation: none;", self.styles)

    def test_a_question_sentence_keeps_its_accent(self):
        # The one surviving reason StreamingBody splits sentences at all.
        self.assertIn(
            'className={isQuestionSentence(sentence) ? "prose-question" : undefined}',
            self.transcript,
        )

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

    def test_the_learning_moment_still_steps_the_conversation_back(self):
        # R32 replaced the full-screen flash with one card, but the moment must still
        # OWN the screen while it is up: a dimmed backdrop, and no way past it except
        # the student's own dismissal.
        card = (ROOT / "frontend" / "src" / "student" / "KnowledgeCard.tsx").read_text(
            encoding="utf-8"
        )
        self.assertIn("absolute inset-0", card)
        self.assertIn("var(--background) 62%", card)
        self.assertIn("Got it", card)
        self.assertIn("See it in your brain", card)
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
        # R64: the full close ritual lives ONCE, in the SYSTEM prompt's CLOSING A STEP
        # block (brief closes read it directly); CONCLUDE_HANDOFF survives as the
        # pointer the kept deterministic-close rungs append so an event instruction
        # can never disagree with the standing rule.
        self.assertIn("CLOSING A STEP:", self.chat_fn)
        self.assertIn("Never name the Continue button or any button", self.chat_fn)
        # R31 (demo feedback): a step closes by ASKING, and never over an unanswered request.
        self.assertIn('END WITH "Shall we continue?"', self.chat_fn)
        self.assertIn("Never wrap up over an unanswered request", self.chat_fn)
        self.assertIn("const CONCLUDE_HANDOFF =", self.chat_fn)
        self.assertIn("follow your CLOSING A STEP rules", self.chat_fn)
        # Declaration + the five kept deterministic closes (quiz/code passes, the
        # three stuck caps) — dissolved closes need no pointer, the prompt rules bind.
        self.assertEqual(self.chat_fn.count("CONCLUDE_HANDOFF"), 6)

    def test_continue_tap_never_credits_unshown_thinking(self):
        self.assertIn(
            "do NOT invent, credit, or reference thinking they never showed",
            self.chat_fn,
        )

    def test_bare_readiness_gets_one_line_not_a_reask(self):
        # R64: readiness_ack dissolved into the CONVERSATION FLOW bare-readiness rule.
        # It binds by SHAPE of the message, not by routed kind — so a meta-routed
        # "ready" cannot fall into summarize/reassure either.
        self.assertIn("Bare readiness (", self.chat_fn)
        self.assertIn("is a signal to PROCEED, not an answer and not a\n  question", self.chat_fn)
        self.assertIn("do NOT restate, rephrase, or re-explain any part of it", self.chat_fn)
        self.assertIn("asks\n  directly for the thing flow.owed names", self.chat_fn)

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
