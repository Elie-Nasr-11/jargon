from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260730000000_review_sessions.sql"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
CHIP = ROOT / "frontend" / "src" / "features" / "student" / "ReviewDueChip.tsx"
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
        cls.chip = CHIP.read_text(encoding="utf-8")
        cls.teacher_view = TEACHER_VIEW.read_text(encoding="utf-8")
        cls.teacher = TEACHER.read_text(encoding="utf-8")
        cls.deploy = DEPLOY.read_text(encoding="utf-8")

    def test_greenfield_table_with_rls(self):
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
        # The chosen design is greenfield: it must NOT relax NOT NULL on the live-tutor hot tables.
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

    def test_chat_fn_review_session_lifecycle(self):
        for fragment in (
            'review_session_id?: string',
            "review_sessions",
            'reviewAction === "complete"',
            "review_session_id: reviewSessionId || undefined",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)
        # Never creates a learning_sessions / learning_turns row on the review path.
        self.assertIn("NEVER reads this table", self.chat_fn)

    def test_frontend_wiring(self):
        self.assertIn("export type ReviewSession", self.types)
        self.assertIn("review_session_id?: string", self.types)
        self.assertIn("completeReviewSession", self.api)
        self.assertIn("fetchStudentReviewSessions", self.api)
        self.assertIn("reviewSessionId", self.chip)
        self.assertIn("completeReviewSession", self.chip)
        self.assertIn("export function StudentReviewSessions", self.teacher_view)
        self.assertIn("<StudentReviewSessions studentId={studentId} />", self.teacher)


if __name__ == "__main__":
    unittest.main()
