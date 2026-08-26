"""Chat-flow Phases 3+4 (2026-08-02): continuity + hygiene pins. The rolling mid-session
summary keeps long sessions from forgetting their beginning; the client consumes the
envelope's session snapshot instead of refetching; progress is a real fraction; a
completed lesson hands off to the next one; model usage rows carry an estimated cost;
the 1,095-line retired Composer is gone."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
ARTIFACT_FN = ROOT / "supabase" / "functions" / "artifact-live" / "index.ts"
RESOURCE_FN = ROOT / "supabase" / "functions" / "resource-processing" / "index.ts"
MIGRATION = ROOT / "supabase" / "migrations" / "20260920000000_session_running_summary.sql"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-backend.yml"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
CONVO = ROOT / "frontend" / "src" / "student" / "useConversation.ts"
APP = ROOT / "frontend" / "src" / "student" / "StudentApp.tsx"
COMPOSER = ROOT / "frontend" / "src" / "components" / "Composer.tsx"
LANGUAGE = ROOT / "frontend" / "src" / "lib" / "composerLanguage.ts"


class ChatContinuityStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.convo = CONVO.read_text(encoding="utf-8")
        cls.app = APP.read_text(encoding="utf-8")

    def test_rolling_summary_end_to_end(self):
        migration = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("add column if not exists running_summary text", migration)
        self.assertIn("summarized_turns integer not null default 0", migration)
        self.assertIn("20260920000000_session_running_summary.sql", DEPLOY.read_text(encoding="utf-8"))
        for fragment in (
            "const RUNNING_SUMMARY_EVERY = 6;",
            "async function refreshRunningSummary(",
            # Prompt-fed ahead of the verbatim history window, absent until written.
            "conversation_so_far:",
            # R64 slice 2: the mentor itself maintains the summary (flow_summary);
            # the cheap-model refresher is the dormant fallback.
            '"conversation_so_far" (when\npresent) is the running summary',
            "storeMentorFlowSummary(config, sessionId, mentorFlowSummary)",
            # Scheduled on live turns only; the completing turn runs the memory writer.
            "refreshRunningSummary(config, userId, sessionId, lessonId)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)

    def test_progress_is_a_real_fraction(self):
        for fragment in (
            '"learning_sessions"',
            "steps_done",
            "Math.max(0.1, Math.min(0.95, stepsDone / total))",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)

    def test_envelope_session_snapshot_is_consumed(self):
        self.assertIn("setSessionSnapshot({", self.convo)
        self.assertIn("if (envelope.session) {", self.convo)
        # StudentApp updates the map locally from the live arc/snapshot; the every-send
        # refetch effect is gone.
        self.assertIn("liveArc.steps_done?.length", self.app)
        self.assertNotIn("prevSendingRef", self.app)

    def test_completion_handoff(self):
        self.assertIn("Lesson complete", self.app)
        self.assertIn("nextLesson", self.app)

    def test_estimated_cost_in_all_three_functions(self):
        for path in (CHAT_FN, ARTIFACT_FN, RESOURCE_FN):
            text = path.read_text(encoding="utf-8")
            with self.subTest(fn=path.parent.name):
                self.assertIn("function estimatedCostUsd(", text)
        # chat + resource-processing price at write time; artifact-live's RESERVATION row
        # legitimately starts null (it's written before the model call) and the finalize
        # PATCH prices the whole build from the token tally.
        for path in (CHAT_FN, RESOURCE_FN):
            self.assertNotIn("estimated_cost_usd: null", path.read_text(encoding="utf-8"))
        artifact = ARTIFACT_FN.read_text(encoding="utf-8")
        self.assertIn("estimated_cost_usd: estimatedCostUsd(", artifact)
        self.assertIn("tally", artifact)

    def test_composer_corpse_removed(self):
        self.assertFalse(COMPOSER.exists(), "components/Composer.tsx should be deleted")
        self.assertIn("export type ComposerLanguage", LANGUAGE.read_text(encoding="utf-8"))
        self.assertNotIn('from "@/components/Composer"', self.convo)

    def test_turns_fetch_is_capped(self):
        self.assertIn(".limit(400)", self.api)


if __name__ == "__main__":
    unittest.main()
