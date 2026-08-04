"""Brain-first Phase E: one assessment call per text turn, and cached/prefetched
student surfaces. Static pins for the load-bearing wiring."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
CACHE = (ROOT / "frontend" / "src" / "lib" / "surfaceCache.ts").read_text(encoding="utf-8")
CONVO = (ROOT / "frontend" / "src" / "student" / "useConversation.ts").read_text(encoding="utf-8")
TREE = (ROOT / "frontend" / "src" / "student" / "LessonTree.tsx").read_text(encoding="utf-8")


class AssessTurnMerge(unittest.TestCase):
    def test_router_and_grader_are_one_call(self):
        self.assertIn("async function assessTurn(", CHAT)
        # The two old separate calls are gone.
        self.assertNotIn("function classifyTurn(", CHAT)
        self.assertNotIn("function checkUnderstanding(", CHAT)
        self.assertIn("routerEligible || isTextExplanation", CHAT)

    def test_verdict_semantics_preserved(self):
        # Strict grading rules, named criterion, pre-emption, and the closed kind set all
        # survive the merge; the echo gate stays code-side.
        for fragment in (
            "NEVER evidence",
            "NAMED-CRITERION RULE",
            '"preempted"',
            "TASK 1 — CLASSIFY",
            "function isEchoOfMentor(",
            "function heuristicKind(",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, CHAT)

    def test_one_usage_record_with_honest_task(self):
        fn = CHAT[CHAT.index("async function assessTurn(") :]
        fn = fn[: fn.index("\n// Semantic grader for CODE activities:")]
        self.assertEqual(fn.count("recordModelUsage("), 1)
        self.assertIn('gradeExplanation ? "grading" : "routing"', fn)


class SurfaceCache(unittest.TestCase):
    def test_cache_module_contract(self):
        self.assertIn("export async function cached<", CACHE)
        self.assertIn("export function warm<", CACHE)
        self.assertIn("export function invalidateSurface(", CACHE)
        # A different signed-in user never sees the previous user's surfaces.
        self.assertIn("supabase.auth.onAuthStateChange", CACHE)

    def test_hot_fetchers_are_wrapped_with_names_intact(self):
        for name, key in (
            ("fetchStudentClasses", '"classes"'),
            ("fetchStudentCatalog", "catalog:"),
            ("fetchLearningTurns", "turns:"),
            ("fetchLatestLearningSession", "session:"),
            ("fetchLessonActivities", "activities:"),
            ("fetchVocabTerms", '"vocab_terms"'),
        ):
            with self.subTest(name=name):
                self.assertIn(f"export async function {name}(", API)
                self.assertIn(f"async function {name}Uncached(", API)
                self.assertIn(key, API)

    def test_envelope_settles_invalidate_conversational_surfaces(self):
        self.assertIn('invalidateSurface("turns:");', CONVO)
        self.assertIn('invalidateSurface("session:");', CONVO)
        self.assertIn('invalidateSurface("progress");', CONVO)

    def test_lesson_hover_prefetches(self):
        self.assertIn("export function prefetchLesson(", API)
        self.assertIn("onPointerEnter={() => prefetchLesson(lesson.id)}", TREE)


if __name__ == "__main__":
    unittest.main()
