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

    def test_offer_pill_hides_for_selected_mode(self):
        self.assertIn("&& mode !== spec.id", PILLS.read_text(encoding="utf-8"))

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


class StreamingProseStaticTests(unittest.TestCase):
    """Round 21: blur-in gray streaming, sentence whiten, live formatting, richer prose."""

    @classmethod
    def setUpClass(cls):
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.styles = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")

    def test_streaming_body_sentence_treatment(self):
        for fragment in (
            "function StreamingBody(",
            "function splitSentences(",
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

    def test_prose_is_not_flat(self):
        # Questions wear the accent, settled and live.
        self.assertIn("function isQuestionSentence(", self.transcript)
        self.assertIn("prose-question", self.transcript)
        self.assertIn(".prose-question {", self.styles)
        # Lists indent behind a divider rule; inline code carries its own hue.
        self.assertIn("border-l-2 border-border pl-6", self.transcript)
        self.assertIn("inline-code-hue", self.transcript)
        self.assertIn(".inline-code-hue {", self.styles)


if __name__ == "__main__":
    unittest.main()
