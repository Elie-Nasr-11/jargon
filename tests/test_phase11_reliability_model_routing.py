from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUN_FUNCTION = ROOT / "supabase" / "functions" / "run" / "index.ts"
CHAT_FUNCTION = ROOT / "supabase" / "functions" / "chat" / "index.ts"
RESOURCE_PROCESSING = ROOT / "supabase" / "functions" / "resource-processing" / "index.ts"
ADMIN_OPS = ROOT / "supabase" / "functions" / "admin-ops" / "index.ts"
ADMIN_ROUTE = ROOT / "frontend" / "src" / "routes" / "admin.tsx"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"


class Phase11ReliabilityModelRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_function = RUN_FUNCTION.read_text(encoding="utf-8")
        cls.chat = CHAT_FUNCTION.read_text(encoding="utf-8")
        cls.resource_processing = RESOURCE_PROCESSING.read_text(encoding="utf-8")
        cls.admin_ops = ADMIN_OPS.read_text(encoding="utf-8")
        cls.admin_route = ADMIN_ROUTE.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")

    def test_run_function_retries_sleeping_engine_and_records_wake_events(self):
        for fragment in (
            '"JARGON_ENGINE_RETRY_COUNT"',
            '"JARGON_ENGINE_RETRY_DELAY_MS"',
            "fetchEngineWithRetry",
            "engine_wake_timeout_retrying",
            "engine_retryable_status",
            "engine_retry_success",
            "Engine request timed out after",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.run_function)

    def test_chat_uses_env_model_routing_and_records_route_payload(self):
        for fragment in (
            '"OPENAI_MODEL_DEFAULT"',
            '"OPENAI_MODEL_GRADING"',
            '"OPENAI_MODEL_RESCUE"',
            '"OPENAI_MODEL_RESOURCE_CONTEXT"',
            "type ModelRoute",
            "modelRouteFor",
            'route === "resource_context"',
            'taskType: "summarization"',
            "payload: { route: usage.route }",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)

    def test_chat_has_controlled_soft_rate_limit(self):
        for fragment in (
            "CHAT_RATE_LIMIT_WINDOW_MS",
            "CHAT_RATE_LIMIT_MAX",
            "isChatRateLimited",
            "chat_rate_limit",
            "Too many chat turns at once",
            "429",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)

    def test_media_processing_records_model_usage_and_limits_expensive_jobs(self):
        for fragment in (
            "RESOURCE_PROCESSING_RATE_LIMIT_WINDOW_MS",
            "RESOURCE_PROCESSING_RATE_LIMIT_MAX",
            "enforceProcessingRateLimit",
            "Processing rate limit reached",
            "model_usage_events",
            'taskType: "speech_to_text"',
            'taskType: "summarization"',
            "insertModelUsage",
            "OpenAiUsage",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.resource_processing)

    def test_admin_dashboard_exposes_runtime_health_summary(self):
        for fragment in (
            "type RuntimeHealthSummary",
            "runtime_health",
            "engine_wake_timeouts",
            "engine_retry_successes",
            "rate_limit_hits",
            "payload,created_at",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.admin_ops)

        for fragment in (
            "export type RuntimeHealthSummary",
            "runtime_health?: RuntimeHealthSummary",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.types)

        for fragment in (
            "Runtime health",
            "Wake timeouts",
            "Retry recoveries",
            "Rate limits",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.admin_route)


if __name__ == "__main__":
    unittest.main()
