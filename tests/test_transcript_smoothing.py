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
