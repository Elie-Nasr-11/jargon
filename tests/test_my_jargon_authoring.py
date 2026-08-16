from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
HOME = ROOT / "frontend" / "src" / "student" / "StudentHome.tsx"
CONVO = ROOT / "frontend" / "src" / "student" / "useConversation.ts"
CURRICULUM_ADMIN = ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts"


class MyJargonSurface(unittest.TestCase):
    """Wael's task: the vocab list is named "My Jargon" — a Home section collecting the
    words a student has met (student_vocab x vocab_terms), bridge-marked when a word
    has traveled into a second subject."""

    @classmethod
    def setUpClass(cls):
        cls.api = API.read_text(encoding="utf-8")
        cls.home = HOME.read_text(encoding="utf-8")

    def test_fetch_reads_own_rows_via_embed(self):
        for fragment in (
            "async function fetchMyJargonUncached()",
            '.from("student_vocab")',
            'vocab_terms(term,definition,subject)',
            '.eq("user_id", session.user.id)',
            'cached("my_jargon", 45_000, fetchMyJargonUncached)',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)
        self.assertIn("export type MyJargonWord", TYPES.read_text(encoding="utf-8"))

    def test_home_renders_the_card(self):
        for fragment in (
            "function MyJargonCard({",
            "My Jargon",
            "bridges subjects",
            # Empty state teaches what the surface is, instead of rendering blank.
            "Every new word your mentor teaches you collects here",
            "<MyJargonCard words={jargonWords} highlightTerm={highlightTerm} />",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.home)

    def test_vocab_events_invalidate_the_cache(self):
        # A word collected mid-conversation must appear on the next Home visit.
        self.assertIn(
            'if (envelope.vocab_events?.length) invalidateSurface("my_jargon");',
            CONVO.read_text(encoding="utf-8"),
        )


class AuthoringAutoExtract(unittest.TestCase):
    """Wael: "Creating the learning objectives and vocab list happens automatically with
    uploading content... teachers can edit." Publish is the trigger; drafts only; the
    studio Knowledge tab review still gates what students see."""

    @classmethod
    def setUpClass(cls):
        cls.fn = CURRICULUM_ADMIN.read_text(encoding="utf-8")

    def test_publish_schedules_extraction_off_the_critical_path(self):
        for fragment in (
            "function scheduleBackground(task: Promise<unknown>): void",
            'if (action === "publish_lesson") {',
            "autoExtractKnowledgeAfterPublish(config, actorId, record)",
            # A failed extraction must never fail the publish that scheduled it.
            "auto extract_knowledge on publish failed:",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.fn)

    def test_extraction_is_idempotent_and_draft_gated(self):
        for fragment in (
            "async function autoExtractKnowledgeAfterPublish(",
            # Emptiness check: a lesson that already has knowledge rows is skipped.
            "if (ideaRows.length || vocabRows.length) return;",
            # The underlying intake still writes drafts only (pre-existing hard rule).
            "written status='draft'",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.fn)


if __name__ == "__main__":
    unittest.main()
