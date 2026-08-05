"""Learning framework F1-F4 (2026-08-02, docs/LEARNING_FRAMEWORK.md). Ideas (authored +
student-grown emergent), vocab terms, curriculum links vs earned student links, the chat
fn's knowledge processor (deterministic sighting, validated mentor proposals), the chat
UX (highlights, dropdown, growth toasts), and brain map v4 (idea stars + earned arcs;
the lexical topic links retired)."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260925000000_learning_framework.sql"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-backend.yml"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
CONVO = ROOT / "frontend" / "src" / "student" / "useConversation.ts"
TRANSCRIPT = ROOT / "frontend" / "src" / "student" / "Transcript.tsx"
TOASTS = ROOT / "frontend" / "src" / "student" / "KnowledgeToasts.tsx"
BRAIN = ROOT / "frontend" / "src" / "student" / "BrainMap.tsx"
HOME = ROOT / "frontend" / "src" / "student" / "StudentHome.tsx"
CHATWINDOW = ROOT / "frontend" / "src" / "student" / "ChatWindow.tsx"


class LearningFrameworkStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.convo = CONVO.read_text(encoding="utf-8")
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.brain = BRAIN.read_text(encoding="utf-8")

    def test_schema_tables_rls_and_view(self):
        for fragment in (
            "create table if not exists public.ideas",
            "constraint ideas_emergent_owned check (origin != 'emergent' or user_id is not null)",
            "create table if not exists public.vocab_terms",
            "create table if not exists public.curriculum_links",
            "create table if not exists public.student_links",
            "unique (user_id, from_key, to_key)",
            "create table if not exists public.student_vocab",
            "create or replace view public.lesson_subjects",
            "security_invoker = on",
            "create policy ideas_emergent_insert",
            "create policy student_links_insert",
            "create policy student_vocab_update",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)
        self.assertIn("20260925000000_learning_framework.sql", DEPLOY.read_text(encoding="utf-8"))

    def test_demo_seed_is_guarded_and_cross_course(self):
        for fragment in (
            "'exact-instructions'",
            "'claims-vs-reasons'",
            "'fractions-as-division'",
            "where exists (select 1 from public.lessons l where l.id = v.lesson_id)",
            "on conflict do nothing",
            "'same_pattern'",
            "'vocab_bridge'",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_server_knowledge_processor(self):
        for fragment in (
            "function processKnowledge(",
            "vocab_in_new_subject",
            "subjects_seen",
            "mentor_flagged",
            "function slugifyIdeaKey(",
            'origin: "emergent"',
            "events.link_events.length < 1",
            "events.vocab_events.length < VOCAB_EVENTS_PER_TURN",
            # R31 (demo feedback): a term counts as encountered when the MENTOR uses it —
            # scanning the student's own message fired cards for words never taught.
            "const haystack = String(input.replyText).toLowerCase();",
            "Knowledge is enrichment",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)

    def test_server_contract_and_payload(self):
        for fragment in (
            '"link": null,',
            '"new_idea": null',
            'Set "link" to { "from_idea"',
            'Set "new_idea" to { "title"',
            "knowledge: {",
            "emergent_ideas: context.ideas",
            "lesson_subjects?lesson_id=eq.",
            "vocab_events: Array.isArray(partial.vocab_events)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)

    def test_client_types_api_and_toasts(self):
        self.assertIn("export type VocabEvent", self.types)
        self.assertIn("export type IdeaNode", self.types)
        self.assertIn("vocab_events?: VocabEvent[];", self.types)
        for fn in ("fetchVocabTerms", "fetchIdeas", "fetchStudentLinks", "fetchCurriculumLinks"):
            self.assertIn(f"export async function {fn}(", self.api)
        self.assertIn("knowledgeToasts", self.convo)
        self.assertIn(".slice(-3)", self.convo)
        self.assertIn("KnowledgeToasts", TOASTS.read_text(encoding="utf-8"))
        self.assertIn(
            "<KnowledgeToasts onSeeBrain={onSeeBrain} />",
            CHATWINDOW.read_text(encoding="utf-8"),
        )

    def test_transcript_highlighting(self):
        for fragment in (
            "export function buildVocabMatcher(",
            "function highlightRun(",
            "seen: new Set<string>()",
            'className="vocab-mark"',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.transcript)

    def test_brain_map_v4(self):
        for fragment in (
            "knowledge.arcs.map",
            "const knowledge = useMemo",
            "strokeOpacity={arc.earned ? 0.85 : 0.22}",
            'className={arc.fresh ? "bmap-thread" : undefined}',
            '"Your idea: "',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.brain)
        self.assertNotIn("topicLinks", self.brain)
        home = HOME.read_text(encoding="utf-8")
        self.assertIn("studentLinks={studentLinks}", home)
        self.assertIn("curriculumLinks={curriculumLinks}", home)


if __name__ == "__main__":
    unittest.main()
