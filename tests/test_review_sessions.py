"""Re-pinned 2026-08-02 (chat-flow Phase 1, docs/CHAT_FLOW_SCOPE.md §5.4): the isolated
spaced-review path is REMOVED on the MVP branch — handleReviewRequest and its
`body.review === true` entry left the chat fn (it had no student-surface caller and wrote
rows nothing read), and the teacher's StudentReviewSessions view + its client helpers left
the frontend with it. The greenfield `review_sessions` migration stays applied (tables are
never unshipped) but inert; the full implementation is archived on main. These tests pin
BOTH sides: the migration's invariants still hold, and the dead path stays dead."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260730000000_review_sessions.sql"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
TEACHER_VIEW = ROOT / "frontend" / "src" / "features" / "teacher" / "StudentReviewSessions.tsx"
TEACHER = ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-backend.yml"
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"


class ReviewSessionsStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.teacher = TEACHER.read_text(encoding="utf-8")
        cls.deploy = DEPLOY.read_text(encoding="utf-8")

    def test_greenfield_table_with_rls(self):
        # The applied migration keeps its shape even though nothing writes the table now.
        for fragment in (
            "create table if not exists public.review_sessions",
            "review_sessions_status_check",
            "check (status in ('active', 'complete', 'abandoned'))",
            "review_sessions_owner",
            "review_sessions_teacher_read",
            "can_view_student(user_id)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)
        self.assertIn("20260730000000_review_sessions.sql", self.deploy)

    def test_migration_does_not_touch_live_session_tables(self):
        # The chosen design was greenfield: it must NOT relax NOT NULL on the live-tutor hot tables.
        lowered = self.migration.lower()
        for forbidden in ("alter table public.learning_sessions", "alter table public.learning_turns",
                          "alter table public.lesson_attempts", "drop not null"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, lowered)

    def test_no_other_migration_relaxes_learning_sessions_lesson_id(self):
        # Guard the invariant across the whole migration set (the exhaustive map's key finding).
        for path in MIGRATIONS_DIR.glob("*.sql"):
            text = path.read_text(encoding="utf-8").lower()
            self.assertNotIn("alter column lesson_id drop not null", text, msg=str(path))

    def test_chat_fn_review_path_removed(self):
        # The isolated review turn is gone: no handler, no entry branch, no envelope field,
        # no dedicated rate-limit constants. The removal marker stays as the tombstone.
        body = self.chat_fn.replace(
            "the isolated spaced-review path (handleReviewRequest,", "", 1)
        for gone in (
            "handleReviewRequest(",
            "record.review === true",
            "review_session_id",
            "REVIEW_RATE_LIMIT",
        ):
            with self.subTest(gone=gone):
                self.assertNotIn(gone, body)
        self.assertIn("the isolated spaced-review path", self.chat_fn)

    def test_frontend_review_slice_removed(self):
        self.assertFalse(TEACHER_VIEW.exists(), "StudentReviewSessions.tsx should be deleted")
        for gone, where in (
            ("fetchStudentReviewSessions", self.api),
            ("reviewSessions", self.api),
            ("export type ReviewSession ", self.types),
            ("review_session_id", self.types),
            ("StudentReviewSessions", self.teacher),
        ):
            with self.subTest(gone=gone):
                self.assertNotIn(gone, where)


if __name__ == "__main__":
    unittest.main()
