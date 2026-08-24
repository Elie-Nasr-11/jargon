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

def _component(source: str, marker: str) -> str:
    """A whole component body: its declaration to the next top-level one.

    A fixed character window silently truncates when the component grows (R58 added
    figure signing to SourceFigure), turning a real contract into a flaky pin.
    """
    rest = source[source.index(marker) :]
    nxt = rest.find("\nfunction ", 1)
    return rest if nxt < 0 else rest[:nxt]

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


class ModeOfferIsAnInlineButtonThatGoesStale(unittest.TestCase):
    """R32 (owner): "when the talk it through popup button comes on, make sure it is
    removed before the mentor begins responding if the response is not to click it."

    It used to be a floating row above the composer derived from the last MENTOR message,
    so typing something else instead left it hovering there — still offering a hand-off
    for a conversation that had moved on. The demo transcript also carries two identical
    [Talk it through] turns, because a fast second tap beat the `sending` flag.

    Rendering it INSIDE the message that made it fixes both structurally: `isLatestBot`
    stops being true the moment anything follows, so the offer retires itself.
    """

    TRANSCRIPT = (SRC / "student" / "Transcript.tsx").read_text(encoding="utf-8")

    def test_the_floating_row_above_the_composer_is_gone(self):
        for dead in ("modeOfferRow", "liveModeOffer", "acceptedOfferOn"):
            with self.subTest(dead=dead):
                self.assertNotIn(dead, APP)

    def test_the_offer_renders_inside_its_own_message(self):
        self.assertIn("isLatestBot && message.modeOffer && onAcceptOffer", self.TRANSCRIPT)
        self.assertIn("onAcceptOffer(message.modeOffer!)", self.TRANSCRIPT)

    def test_it_is_live_only_on_the_latest_mentor_message(self):
        # The whole staleness guarantee rides on this gate — the same one that already
        # retires an older question's MCQ buttons.
        self.assertIn("const isLatestBot = message.id === lastBotId;", self.TRANSCRIPT)

    def test_accepting_still_moves_the_composer_picker(self):
        # Pillar 2: the flip lives INSIDE sendModeOffer (the register's one owner), so
        # the picker move and the control send can no longer come apart. The picker
        # renders conversation.register, so this is the same visible behavior.
        HOOK = (ROOT / "frontend" / "src" / "student" / "useConversation.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn('setRegister(offer.mode, "offer");', HOOK)
        self.assertIn("conversation.sendModeOffer(offer);", APP)
        self.assertIn("onAcceptOffer={acceptModeOffer}", APP)

    def test_it_is_inert_while_a_turn_is_in_flight(self):
        # `inert` is the transcript's existing hold/sending lock — the same one the MCQ
        # choices use, so a tap mid-stream cannot double-send.
        block = self.TRANSCRIPT[
            self.TRANSCRIPT.index("isLatestBot && message.modeOffer") :
        ][:900]
        self.assertIn("disabled={inert}", block)

if __name__ == "__main__":
    unittest.main()


class AskingForTheMaterialsHandsThemOver(unittest.TestCase):
    """R31f: "can you give me the rousouces here?" -> a prose list and a signpost.

    The cards existed on the lesson and were never attached: attachment was decided by a
    keyword regex over the RAW message before the model ran, and the typo missed it. So
    did "readings" and "materials" — words the regex never contained at all.
    """

    TRANSCRIPT = (SRC / "student" / "Transcript.tsx").read_text(encoding="utf-8")

    def test_the_request_regex_covers_the_words_students_use(self):
        pattern = re.search(r"const RESOURCE_REQUEST_RE =\n(.*?);", CHAT, re.S).group(1)
        for word in ("readings?", "materials?", "handout", "article", "chapter"):
            self.assertIn(word, pattern, f"regex still misses {word!r}")

    def test_the_mentor_can_hand_a_material_over_by_id(self):
        # Typo-proof backstop: however the ask is worded, the MENTOR decides to hand the
        # card over and the SERVER decides whether that is legal.
        self.assertIn("[[material:<id>]]", CHAT)
        # (the phrase wraps in the prompt source)
        self.assertIn("give them\n  the thing", CHAT)
        self.assertIn(r"/\[\[material:([^\]\s]+)\]\]/g", CHAT)

    def test_materials_payload_carries_the_id(self):
        # Without it the mentor can only ever TALK about a reading — the exact failure.
        block = CHAT[CHAT.index("materials: context.resources.map") :][:400]
        self.assertIn("id: resource.id,", block)

    def test_only_this_lessons_published_resources_resolve(self):
        # Same guarantee as figures: an invented id must not become a card.
        block = CHAT[CHAT.index("resolve [[material:id]] markers") :][:1800]
        self.assertIn("curatedResources.map((row) => [String(row.id), row])", block)
        self.assertIn("handed.length >= 2", block)

    def test_resolved_cards_merge_without_duplicating(self):
        block = CHAT[CHAT.index("resolve [[material:id]] markers") :][:2400]
        self.assertIn("already.has(String(r.id))", block)

    def test_the_card_renders_inline_where_the_mentor_put_it(self):
        # Owner: "lets have the mentor give an inline resource when asked." A RESOLVED
        # marker survives server-side so the client can render the card at that exact
        # point in the reply — the same treatment figures get.
        self.assertIn("handedIds.has(String(id)) ? whole : nl", CHAT)
        self.assertIn("renders INLINE right there", CHAT)
        self.assertIn("renderMaterial", self.TRANSCRIPT)
        self.assertIn("MATERIAL_MARKER_RE.lastIndex = 0;", self.TRANSCRIPT)

    def test_an_unresolved_marker_never_reaches_the_student(self):
        # Only markers that resolved to a real card survive; the rest are stripped, and
        # the client drops any id it cannot resolve (including MID-STREAM, before the
        # envelope's resources have landed). A student never sees raw syntax.
        self.assertIn("that resolved to nothing are stripped", CHAT)
        self.assertIn("const card = renderMaterial?.(part);", self.TRANSCRIPT)
        self.assertIn("return card ? <Fragment key={`mat-${i}`}>{card}</Fragment> : null;", self.TRANSCRIPT)

    def test_an_inlined_card_is_not_repeated_in_the_tray_below(self):
        self.assertIn("inlinedMaterials", self.TRANSCRIPT)
        self.assertIn("const trayResources = (message.resources ?? []).filter(", self.TRANSCRIPT)
        self.assertIn("{trayResources.map((resource) => (", self.TRANSCRIPT)


class SetupFailuresAreRecorded(unittest.TestCase):
    """R32: a live 500 that left no trace anywhere.

    A student hit "Something went wrong on our side" on a fresh lesson. The evidence
    afterwards: 1.7s latency, no session row, no model_usage_events row, no runtime_events
    row — and the identical request succeeded on replay. The cause was unknowable, because
    the auth/session/context setup block returned a bare typedError and recorded nothing,
    while the student-safe message deliberately hides the reason from the reply.
    """

    def test_the_setup_block_records_before_returning(self):
        block = CHAT[CHAT.index("let setupPhase:") :][:2200]
        self.assertIn('eventType: "chat_failure"', block)
        self.assertIn('reason: "setup_failed"', block)
        self.assertIn("phase: setupPhase", block)
        self.assertIn("message", block)

    def test_the_phase_narrows_it_to_one_step(self):
        # "It failed in setup" is not an answer; which of the four steps is.
        self.assertIn(
            'let setupPhase: "config" | "auth" | "session" | "context" = "config";', CHAT
        )
        for phase in ('setupPhase = "auth";', 'setupPhase = "session";', 'setupPhase = "context";'):
            with self.subTest(phase=phase):
                self.assertIn(phase, CHAT)

    def test_recording_can_never_mask_the_real_error(self):
        block = CHAT[CHAT.index("let setupPhase:") :][:2200]
        # Background + try//catch: a telemetry fault must not become the student's error.
        self.assertIn("scheduleBackground(", block)
        self.assertIn("Never mask the real error", block)
        # The original message is still what the caller gets back.
        self.assertIn("return typedError(message, typedAuthStatus(message), {", block)

    def test_the_student_still_sees_the_safe_line(self):
        # The sanitizer stays: this fix is about the SERVER remembering, not about
        # showing a stack trace to a fourteen-year-old.
        self.assertIn("STUDENT_SAFE_ERROR", CHAT)
        self.assertIn("isStudentFacingMessage(message)", CHAT)


class InlineActionsAreTextNotButtons(unittest.TestCase):
    """R32b (owner): "the inline buttons didn't work. Make it absolutely inline, like part
    of the text" — plus mode-coloured action text.

    R32 moved the hand-off from a floating row into the message. The owner's point is that
    it was still a BUTTON sitting beside the prose. Now the mentor writes it into its own
    sentence and it renders as clickable text there, in the hue of the mode it points at.
    """

    TRANSCRIPT = (SRC / "student" / "Transcript.tsx").read_text(encoding="utf-8")
    STYLES = (SRC / "styles.css").read_text(encoding="utf-8")

    def test_the_mentor_writes_the_action_into_its_sentence(self):
        self.assertIn("INLINE ACTIONS", CHAT)
        self.assertIn("[[action:<lesson|practice|discuss>|<the words the student clicks>]]", CHAT)
        # The label must continue the sentence, not shout a button name mid-prose.
        self.assertIn("never a button name shouted", CHAT)

    def test_the_server_decides_which_actions_are_legal(self):
        block = CHAT[CHAT.index("R32b: an [[action:mode|label]]") :][:2000]
        # Unknown register, a second action, or an empty label degrade to PLAIN PROSE —
        # the words survive, the control does not.
        self.assertIn('mode === "lesson" || mode === "practice" || mode === "discuss"', block)
        self.assertIn("if (!legal || kept) return clean;", block)
        # Accepting needs a mode_offer to authorize the control turn.
        self.assertIn("if (kept && !envelope.mode_offer)", block)

    def test_the_client_renders_it_inline_and_recurses_around_it(self):
        # An action lives mid-sentence: the prose either side must keep flowing, which is
        # why MessageBody recurses rather than emitting blocks.
        self.assertIn("const ACTION_MARKER_RE =", self.TRANSCRIPT)
        self.assertIn("if (ACTION_MARKER_RE.test(text)) {", self.TRANSCRIPT)
        self.assertIn('className="prose-action"', self.TRANSCRIPT)
        self.assertIn("renderAction?.(mode, part) ?? part", self.TRANSCRIPT)

    def test_an_older_or_invalid_action_still_reads_as_a_sentence(self):
        # Live only on the latest mentor turn; everywhere else the label is plain words,
        # so scrolling back does not leave half a sentence missing.
        self.assertIn("const hasInlineAction = ACTION_MARKER_RE.test(message.text);", self.TRANSCRIPT)
        self.assertIn("isLatestBot && onAcceptOffer", self.TRANSCRIPT)

    def test_the_chip_only_covers_a_turn_with_no_inline_wording(self):
        # Without this fallback a server-set hand-off the mentor did not word inline
        # would have no way to be taken at all.
        self.assertIn("&& !hasInlineAction ?", self.TRANSCRIPT)

    def test_action_text_wears_the_current_modes_hue(self):
        # Blue in Lesson, green in Practice, yellow in Discuss — --mode-accent is already
        # set per section wrapper, so the question/action prose just reads it.
        self.assertIn(
            "color: color-mix(in oklab, var(--mode-accent, var(--accent-text)) 60%, var(--foreground));",
            self.STYLES,
        )

    def test_an_action_wears_the_hue_of_the_mode_it_points_at(self):
        # "clicking Practice should look like Practice before it happens".
        self.assertIn("--action-accent", self.STYLES)
        self.assertIn('["--action-accent" as string]: modeAccentValue(spec)', self.TRANSCRIPT)

    def test_yellow_stays_readable_on_the_light_ladder(self):
        # Raw --mode-discuss as text is near-invisible on white; both rules use the same
        # 60/62% mix toward ink that .mode-eyebrow already relies on for exactly this.
        block = self.STYLES[self.STYLES.index(".prose-action {") :][:400]
        self.assertIn("color-mix(in oklab, var(--action-accent", block)
        self.assertIn("var(--foreground)", block)


class BoldReadsAsEmphasis(unittest.TestCase):
    """R32b (owner): "make bold text bolder"."""

    TRANSCRIPT = (SRC / "student" / "Transcript.tsx").read_text(encoding="utf-8")
    STYLES = (SRC / "styles.css").read_text(encoding="utf-8")

    def test_inline_bold_is_a_full_step_above_body(self):
        # Body rests at 500 by design ("never 400-thin"), so semibold 600 was one step up
        # and barely registered. 700 restores a real 200-point contrast.
        self.assertIn("font-weight: 500; /* the system's resting weight", self.STYLES)
        block = self.TRANSCRIPT[self.TRANSCRIPT.index("const bold = part.match(") :][:600]
        self.assertIn('<b key={i} className="font-bold">', block)
        self.assertNotIn('className="font-semibold"', block)


class AnAttemptIsNotAQuestion(unittest.TestCase):
    """R32c (anatomy session): five correct drill answers produced five more drill questions.

    In Practice the ceiling lifts answer_attempt -> question, and the question_answer
    directive then told the mentor "the student asked YOU a question — answer it fully".
    Their ANSWER was read back to them as a QUESTION, so the mentor answered and asked
    another, and the drill ran until the student left the mode. Same swallowing as the
    continue_signal case, one routed kind over.
    """

    def test_the_relabelled_attempt_is_remembered(self):
        self.assertIn("const attemptCeilinged =", CHAT)
        self.assertIn(
            'routedKindRaw === "answer_attempt" && routedKind !== "answer_attempt"', CHAT
        )

    def test_it_reaches_the_directive_builder(self):
        # Declared, destructured, passed — all three, or it type-checks and does nothing.
        self.assertIn("  attemptCeilinged: boolean;", CHAT)
        self.assertEqual(CHAT.count("attemptCeilinged"), 5)

    def test_it_wins_before_the_branch_that_misread_it(self):
        attempt = CHAT.index("if (attemptCeilinged && !quizActive)")
        question = CHAT.index('if (routedKind === "question" && !quizActive')
        self.assertLess(attempt, question)
        self.assertIn("attempt_not_graded_here", CHAT)

    def test_the_directive_answers_the_answer_and_breaks_the_chain(self):
        block = CHAT[CHAT.index("attempt_not_graded_here") :][:900]
        self.assertIn("they did not ask you anything", block)
        self.assertIn("does not grade", block)
        # The loop itself: one more question of the same shape, forever.
        self.assertIn("Do NOT chain into another question of the same shape", block)

    def test_the_ceiling_is_still_not_weakened(self):
        # Practice/Discuss still cannot close a gate. This changes the REPLY, not the gate.
        self.assertIn(
            'if (kind === null || kind === "answer_attempt" || kind === "continue_signal") {',
            CHAT,
        )


class PraiseMatchesTheAnswer(unittest.TestCase):
    """The same session: "Exactly right!" to a wrong answer, corrected in that sentence."""

    def test_the_prompt_forbids_unchecked_praise(self):
        self.assertIn("NEVER OPEN WITH PRAISE YOU HAVE NOT CHECKED", CHAT)
        self.assertIn("Not quite", CHAT)

    def test_it_cites_the_real_failure_so_the_rule_is_not_abstract(self):
        self.assertIn("vestibulocochlear", CHAT)

    def test_a_correct_answer_is_not_corrected(self):
        # The very next turn: a right answer got "actually", which reads as a correction.
        self.assertIn('Never use a correcting word ("actually", "in fact")', CHAT)


class OneAskPerReply(unittest.TestCase):
    """R32d (owner): "remove double prompts... one prompt per reply of the agent".

    Live: "What can you tell me about apples?" immediately followed by "Would you like to
    move on?" — the student has to pick which to answer, and mostly answers neither. The
    anatomy transcript does it too ("Would you like to explore more..., or is there
    anything specific you'd like to revisit before we move on?").
    """

    def test_the_prompt_allows_exactly_one_ask(self):
        self.assertIn("EXACTLY ONE ASK PER REPLY", CHAT)
        self.assertIn("not a question plus an offer", CHAT)
        # The owner's own example, so the rule is concrete rather than abstract.
        self.assertIn("apples", CHAT)

    def test_teaching_and_wrapping_are_named_as_the_two_choices(self):
        # The rule only works if the model knows WHICH ask to keep.
        self.assertIn("ask the content question and STOP", CHAT)
        self.assertIn("ask only whether to move on", CHAT)

    def test_an_inline_action_counts_as_the_ask(self):
        # Otherwise the hand-off just becomes the second prompt.
        self.assertIn("counts as the ask, so do not put a question beside it", CHAT)

    def test_directives_do_not_stack_a_second_ask(self):
        # The prompt rule is not enough on its own: a directive that says "ask what they
        # notice" on top of one that says "close by asking for something" produces two.
        self.assertIn("let that BE the reply's one ask", CHAT)
        self.assertIn("make THAT the reply's only question", CHAT)


class MediaOpensInTheApp(unittest.TestCase):
    """R32d: "when I click to open an image, it sends me to a new tab" + a buggy PDF panel."""

    TRANSCRIPT = (SRC / "student" / "Transcript.tsx").read_text(encoding="utf-8")
    STAGE = (SRC / "student" / "MediaStage.tsx").read_text(encoding="utf-8")

    def test_a_figure_opens_in_the_media_panel(self):
        # The stage already rendered "image" — the figure just never used it, so clicking
        # a picture the lesson was about threw the student out of the lesson.
        block = _component(self.TRANSCRIPT, "function SourceFigure(")
        self.assertIn("const stage = useMediaStage();", block)
        self.assertIn('stage.open(asResource, "side")', block)

    def test_it_still_degrades_outside_the_student_shell(self):
        # The teacher studio renders this component with no stage in scope.
        block = _component(self.TRANSCRIPT, "function SourceFigure(")
        self.assertIn("stage ? (", block)
        self.assertIn('target="_blank"', block)

    def test_the_pdf_panel_notices_a_frame_that_never_loads(self):
        # THE bug: an iframe does not fire onError when a PDF is refused, so the R30
        # fallback was unreachable and the panel sat blank forever.
        self.assertIn("onLoad={() => setLoaded(true)}", self.STAGE)
        self.assertIn("const [loaded, setLoaded] = useState(false);", self.STAGE)
        self.assertIn("setTimeout(() => setFailed(true), 12000)", self.STAGE)

    def test_the_watchdog_only_guards_embeds(self):
        # video/audio/image DO fire onError; a timeout there would be a false alarm.
        block = self.STAGE[self.STAGE.index("The framing watchdog") :][:700]
        self.assertIn('resource.resource_type === "pdf" || resource.resource_type === "youtube"', block)
        self.assertIn("if (!framed) return;", block)
