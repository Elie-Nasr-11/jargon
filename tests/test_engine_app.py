import os
import unittest

try:
    from engine.app import app
except ModuleNotFoundError as exc:
    if exc.name != "flask":
        raise
    app = None


@unittest.skipIf(app is None, "Flask is not installed locally")
class EngineAppTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.original_app_url = os.environ.pop("JARGON_APP_URL", None)

    def tearDown(self):
        if self.original_app_url is not None:
            os.environ["JARGON_APP_URL"] = self.original_app_url
        else:
            os.environ.pop("JARGON_APP_URL", None)

    def test_root_returns_diagnostic_json_without_app_url(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "service": "jargon-engine",
                "status": "ok",
                "health": "/health",
                "run": "/run",
                "message": "This is the Jargon engine API, not the student app.",
            },
        )

    def test_root_redirects_to_configured_app_url(self):
        os.environ["JARGON_APP_URL"] = "https://example.com/"

        response = self.client.get("/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "https://example.com/")

    def test_health_unchanged(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok", "service": "jargon-engine"})

    def test_run_unchanged(self):
        response = self.client.post("/run", json={"code": "PRINT 5 // 2", "answers": []})

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["output"], ["2"])
        self.assertEqual(data["result"], ["2"])
        self.assertEqual(data["status"], "ok")


if __name__ == "__main__":
    unittest.main()
