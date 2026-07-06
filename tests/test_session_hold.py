from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260729000000_session_holds.sql"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
CHAT_ROUTE = ROOT / "frontend" / "src" / "routes" / "chat.tsx"
TEACHER = ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-backend.yml"


class SessionHoldStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.chat = CHAT_ROUTE.read_text(encoding="utf-8")
        cls.teacher = TEACHER.read_text(encoding="utf-8")
        cls.deploy = DEPLOY.read_text(encoding="utf-8")

    def test_migration_creates_holds_table_with_rls_and_realtime(self):
        for fragment in (
            "create table if not exists public.session_holds",
            "session_id uuid not null unique",
            "session_holds_select",
            "session_holds_insert",
            "session_holds_update",
            "can_view_student(student_id)",
            # A student must never be able to release their own hold (can_view_student is true for
            # self) — the write policies require the actor to be a teacher/admin, not the student.
            "student_id <> auth.uid()",
            "alter publication supabase_realtime add table public.session_holds",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)
        self.assertIn("20260729000000_session_holds.sql", self.deploy)

    def test_chat_fn_has_fail_open_hold_gate(self):
        # Reads the hold under the student's own JWT and returns a held envelope instead of running.
        self.assertIn("session_holds?session_id=eq.", self.chat_fn)
        self.assertIn("held: true", self.chat_fn)
        # Fail-open: the gate is wrapped so an error falls through to the normal turn.
        self.assertIn("Fail-open", self.chat_fn)
        # The envelope type carries the optional held flag.
        self.assertIn("held?: boolean", self.chat_fn)

    def test_hold_only_enforced_while_a_teacher_is_watching(self):
        # Combined-audit fix: a hold left active by a teacher who left must not strand the student —
        # the gate additionally requires a fresh active viewer heartbeat.
        self.assertIn("live_session_viewers?session_id=eq.", self.chat_fn)
        self.assertIn("status=eq.active&last_seen_at=gte.", self.chat_fn)
        # Teacher side: stopping the watch releases any pause first (else the student is stuck).
        self.assertIn("releaseSessionHold(selectedSession.id)", self.teacher)

    def test_api_has_hold_helpers_and_evidence_record(self):
        for fragment in (
            "export async function holdSession",
            "export async function releaseSessionHold",
            "export async function fetchSessionHold",
            'onConflict: "session_id"',
            "recordInterventionEvidence",
            'source_type: "teacher_note"',
            'teaching_move: "teacher_intervention"',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)

    def test_types_carry_hold_shapes(self):
        self.assertIn("export type SessionHold", self.types)
        self.assertIn("held?: boolean", self.types)

    def test_student_chat_locks_on_hold(self):
        for fragment in (
            "setSessionHeld",
            'table: "session_holds"',
            "fetchSessionHold",
            "sending={sending || sessionHeld}",
            "Your teacher paused the session",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)

    def test_teacher_console_has_pause_resume(self):
        for fragment in (
            "holdSelectedSession",
            "resumeSelectedSession",
            "onHoldSession",
            "onResumeSession",
            "Pause mentor",
            "Resume mentor",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.teacher)


if __name__ == "__main__":
    unittest.main()
