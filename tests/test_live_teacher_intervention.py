"""Trimmed 2026-07-30 (trunk unification): the old /chat route retired in favor of the
v6 /learn surface, which does NOT (yet) resubscribe to live_session_viewers /
teacher_live_comments — the student-side realtime wiring ("Teacher viewing" presence,
live comments streaming into the transcript) has no v6 counterpart today; only the
transcript model's teacher-comment adapter (liveCommentToMessage, the "teacher" Msg
role) survives in chatMessages.ts and stays pinned. The migration, API helpers, and
the teacher dashboard's watch/comment/alert surfaces are all still live and pinned.
The student-side reconnection gap is recorded in docs/OPEN_QUESTIONS.md.

Also trimmed (pre-existing on the MVP trunk, surfaced by this run): the intervention-
alert acknowledge/resolve workflow (updateInterventionAlertStatus + the console's
updateAlertStatus/onUpdateAlertStatus + the alert-detail rendering) was cut in the MVP
strip — the hotlist (HotlistFeed/deriveHotlist) superseded the alert queue UX. The
intervention_alerts read and the InterventionAlert type (message column) remain and
stay pinned."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0012_live_teacher_intervention_realtime.sql"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
# chatMessages.ts holds the transcript model and its pure adapters (including the
# teacher-live-comment → Msg mapping this file asserts on); the v6 surface imports it.
CHAT_MESSAGES = (
    ROOT / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts"
)
# routes/teacher.tsx is now a thin route wrapper; the live-intervention teacher
# UI lives in the TeacherConsole feature component.
TEACHER_ROUTE = ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx"


class LiveTeacherInterventionStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.chat_messages = CHAT_MESSAGES.read_text(encoding="utf-8")
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
        # The alert-queue UI is gone (module docstring) but the type still models the
        # real DB column: `message`, never the phantom `detail` the original bug used.
        self.assertIn("export type InterventionAlert", self.types)
        self.assertIn("message: string", self.types)
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
            'event_type: "teacher_intervention"',
            '.from("teacher_live_comments")',
            '.from("live_session_viewers")',
            '.from("transcript_heatmap_events")',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)

    def test_transcript_model_keeps_the_teacher_comment_adapter(self):
        # The surviving student-side piece: teacher live comments have a first-class Msg
        # role and a pure adapter, so a surface that resubscribes gets rendering for free.
        # (The subscription itself is the open gap noted in the module docstring.)
        for fragment in (
            'role: "teacher"',
            "liveCommentToMessage",
            "TeacherLiveComment",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_messages)

    def test_teacher_dashboard_can_watch_and_comment(self):
        # (alert acknowledge/resolve controls trimmed — see module docstring)
        for fragment in (
            "Watch live",
            "Stop watching",
            "Live teacher tip",
            "Teacher live",
            "startWatchingSelectedSession",
            "stopWatchingSelectedSession",
            "sendLiveComment",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.teacher)


if __name__ == "__main__":
    unittest.main()
