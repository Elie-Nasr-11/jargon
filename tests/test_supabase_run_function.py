from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUN_FUNCTION = ROOT / "supabase" / "functions" / "run" / "index.ts"


class SupabaseRunFunctionStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = RUN_FUNCTION.read_text(encoding="utf-8")

    def test_run_function_requires_engine_secret(self):
        self.assertIn('Deno.env.get("JARGON_ENGINE_URL")', self.source)
        self.assertIn("JARGON_ENGINE_URL is not configured.", self.source)
        self.assertNotIn("DEFAULT_ENGINE_URL", self.source)
        self.assertNotIn("jargon-engine-test.onrender.com", self.source)

    def test_run_function_uses_canonical_error_shape(self):
        helper = self.source[
            self.source.index("function runError") : self.source.index("function errorMessage")
        ]
        for field in (
            "output",
            "result",
            "errors",
            "memory",
            "ask",
            "ask_var",
            "status",
            "truncated",
            "limits_hit",
        ):
            self.assertIn(field, helper)

    def test_run_function_passes_engine_json_through(self):
        self.assertIn("const data = JSON.parse(text);", self.source)
        self.assertIn("return json(data, res.status);", self.source)
        self.assertIn("Engine returned non-JSON response", self.source)
        self.assertIn("AbortController", self.source)
        self.assertIn("Engine request timed out", self.source)
        self.assertIn("return json(runError(message, timedOut), 502);", self.source)


if __name__ == "__main__":
    unittest.main()
