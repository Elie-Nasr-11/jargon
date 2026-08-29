"""Brain-first Phase D: knowledge intake (extract/review) + teacher practice banks."""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
ADMIN = (
    ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts"
).read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20261001000000_practice_items.sql"
).read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
CARD = (
    ROOT / "frontend" / "src" / "features" / "teacher" / "KnowledgeCard.tsx"
).read_text(encoding="utf-8")
STUDIO = authoring_source()


class PracticeItemsSchema(unittest.TestCase):
    def test_table_states_and_read_policy(self):
        self.assertIn("create table if not exists public.practice_items", MIGRATION)
        self.assertIn("check (difficulty in ('intro', 'core', 'stretch'))", MIGRATION)
        self.assertIn("check (status in ('draft', 'published', 'retired'))", MIGRATION)
        # Students read published items only; all writes stay service-role.
        self.assertIn("practice_items_published_read", MIGRATION)
        self.assertIn("using (status = 'published')", MIGRATION)

    def test_migration_deploys(self):
        self.assertIn("20261001000000_practice_items.sql", DEPLOY)


class KnowledgeIntakeActions(unittest.TestCase):
    def test_actions_dispatched(self):
        for line in (
            'if (action === "extract_knowledge") return await extractKnowledge(',
            'if (action === "list_knowledge") return await listKnowledge(',
            'if (action === "review_knowledge") return await reviewKnowledge(',
        ):
            self.assertIn(line, ADMIN)

    def test_extraction_guardrails(self):
        # Links and practice may only cite existing org ideas or this run's drafts —
        # the model cannot mint keys the brain has never seen.
        self.assertIn("const citableKeys = new Set([...existingIdeaKeys, ...draftedKeys]);", ADMIN)
        self.assertIn("if (!citableKeys.has(from) || !citableKeys.has(to)) continue;", ADMIN)
        self.assertIn("if (!ideaKey || !prompt || !citableKeys.has(ideaKey)) continue;", ADMIN)
        # Everything lands as a draft awaiting teacher review.
        self.assertIn('status: "draft",', ADMIN)

    def test_review_never_deletes_published_rows(self):
        # Discard deletes drafts only; published practice retires instead of vanishing.
        self.assertIn("&status=eq.draft", ADMIN)
        self.assertIn('{ status: "retired" }', ADMIN)


class TeacherBankPriority(unittest.TestCase):
    def test_chat_loads_published_bank(self):
        self.assertIn(
            "practice_items?status=eq.published&select=idea_key,prompt,expected,difficulty",
            CHAT,
        )

    def test_bank_rides_the_practice_directive_first(self):
        # Owner decision: teacher-authored items are PRIMARY practice material.
        self.assertIn("TEACHER BANK (use FIRST, verbatim or lightly adapted)", CHAT)
        self.assertIn("practiceBank: { prompt: string; expected: string } | null;", CHAT)


class StudioKnowledgeReview(unittest.TestCase):
    def test_api_wrappers(self):
        self.assertIn('{ action: "extract_knowledge", lesson_id: input.lessonId },', API)
        # Extraction runs a model call over the lesson corpus — long client timeout.
        self.assertIn("90_000,", API)
        self.assertIn('action: "list_knowledge",', API)
        self.assertIn('action: "review_knowledge",', API)

    def test_card_reviews_drafts(self):
        for call in ("extractLessonKnowledge", "listLessonKnowledge", "reviewLessonKnowledge"):
            self.assertIn(call, CARD)
        self.assertIn('"publish"', CARD)
        self.assertIn('"discard"', CARD)

    def test_card_mounted_on_the_lesson(self):
        # R79: reachable from the lesson's own menu rather than sitting open on it.
        self.assertIn("<KnowledgeCard lessonId={lessonId} />", STUDIO)


if __name__ == "__main__":
    unittest.main()
