"""Trimmed 2026-07-30 (trunk unification): the old /chat route's client-side hold lock
retired with that surface. RE-ANCHORED later the same day (B1): the v6 /learn surface
reconnected the student-facing hold UX — useConversation subscribes to session_holds
over realtime (plus an initial fetch, plus re-locking off a held envelope), and
ChatWindow shows the paused banner while locking the composer. The hold remains
ENFORCED server-side regardless (the chat fn's fail-open hold gate returns a held
envelope instead of running); the client pins below are UX, not the security
boundary. The migration/RLS, chat-fn gate, API helpers, types, and teacher
pause/resume UI pins are all KEPT."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260729000000_session_holds.sql"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
TEACHER = ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-backend.yml"
HOOK = ROOT / "frontend" / "src" / "student" / "useConversation.ts"
WINDOW = ROOT / "frontend" / "src" / "student" / "ChatWindow.tsx"


class SessionHoldStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.teacher = TEACHER.read_text(encoding="utf-8")
        cls.deploy = DEPLOY.read_text(encoding="utf-8")
        cls.hook = HOOK.read_text(encoding="utf-8")
        cls.window = WINDOW.read_text(encoding="utf-8")

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

    def test_student_surface_locks_on_hold(self):
        # Re-anchored (B1): the v6 hold lock. The hook subscribes to session_holds for the
        # active session, seeds from an initial fetch (a hold placed while the student was
        # away must lock on load), and re-locks off a held envelope (server-authoritative:
        # a turn submitted while paused comes back held).
        for fragment in (
            'table: "session_holds"',
            "fetchSessionHold(",
            "if (envelope.held) setHeldState(true);",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.hook)
        # The send path refuses to run while held — the composer lock alone is not enough
        # (voice callbacks and stale closures can race a pause).
        self.assertIn("if (heldRef.current) {", self.hook)
        # The window shows the paused banner and locks the composer while held.
        self.assertIn("Your teacher paused the session — hang tight", self.window)
        self.assertIn("disabled={sending || held}", self.window)

    def test_hold_kills_live_voice(self):
        # A pause must not leave the mic hot: the voice panel unmounts (full WebRTC/mic
        # teardown) when the hold lands.
        self.assertIn("if (held) setVoiceOpen(false);", self.window)

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
