from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0012_live_teacher_intervention_realtime.sql"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
CHAT_ROUTE = ROOT / "frontend" / "src" / "routes" / "chat.tsx"
TEACHER_ROUTE = ROOT / "frontend" / "src" / "routes" / "teacher.tsx"


class LiveTeacherInterventionStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.chat = CHAT_ROUTE.read_text(encoding="utf-8")
        cls.teacher = TEACHER_ROUTE.read_text(encoding="utf-8")

    def test_realtime_publication_is_enabled_for_live_tables(self):
        for fragment in (
            "pg_publication",
            "pg_publication_tables",
            "supabase_realtime",
            "public.live_session_viewers",
            "public.teacher_live_comments",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_frontend_uses_real_intervention_alert_message_column(self):
        self.assertIn("message: string", self.types)
        self.assertIn("detail: alert.message", self.teacher)
        self.assertNotIn("alert.detail", self.teacher)

    def test_live_intervention_api_helpers_are_present(self):
        for fragment in (
            "supabase.realtime.setAuth",
            "fetchLiveSessionViewers",
            "fetchTeacherLiveComments",
            "startLiveSessionViewer",
            "heartbeatLiveSessionViewer",
            "stopLiveSessionViewer",
            "sendTeacherLiveComment",
            "updateInterventionAlertStatus",
            'event_type: "teacher_intervention"',
            '.from("teacher_live_comments")',
            '.from("live_session_viewers")',
            '.from("transcript_heatmap_events")',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)

    def test_student_chat_subscribes_to_viewers_and_teacher_comments(self):
        for fragment in (
            "fetchLiveSessionViewers",
            "fetchTeacherLiveComments",
            "postgres_changes",
            'table: "live_session_viewers"',
            'table: "teacher_live_comments"',
            'role: "teacher"',
            "Teacher viewing",
            "liveCommentToMessage",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)

    def test_teacher_dashboard_can_watch_comment_and_update_alerts(self):
        for fragment in (
            "Watch live",
            "Stop watching",
            "Live teacher tip",
            "Teacher live",
            "startWatchingSelectedSession",
            "stopWatchingSelectedSession",
            "sendLiveComment",
            "updateAlertStatus",
            "onUpdateAlertStatus",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.teacher)


if __name__ == "__main__":
    unittest.main()
