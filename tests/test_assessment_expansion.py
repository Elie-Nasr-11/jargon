"""Trimmed 2026-07-30 (first: /quiz/$assessmentId route removed in the MVP strip;
then, trunk unification): the old /chat route and its QuizPanel assessment surface
retired with the v6 /learn student surface, whose quiz-taking runs through the
"quiz" TurnMode on the chat function instead — no student-side consumer of the
attempt API (fetchStudentAssessments/startAssessment/submitAssessment) exists
today, so those pins moved to presence-in-lib only. The migration/RLS, the
service-role assessment-admin function, the client API surface, and the teacher
create/review/return UI (TeacherConsole + AssessmentGrading) are KEPT and pinned."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0017_assessment_expansion.sql"
FUNCTION = ROOT / "supabase" / "functions" / "assessment-admin" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
SUPABASE = ROOT / "frontend" / "src" / "lib" / "supabase.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
# The teacher console UI moved out of the thin routes/teacher.tsx into the
# feature module; the assessment surfaces live in TeacherConsole.tsx now,
# with the attempt review/return half in AssessmentGrading.tsx.
TEACHER_ROUTE = ROOT / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx"
GRADING = ROOT / "frontend" / "src" / "features" / "teacher" / "AssessmentGrading.tsx"


class AssessmentExpansionStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.function = FUNCTION.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.supabase = SUPABASE.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.teacher_route = TEACHER_ROUTE.read_text(encoding="utf-8")
        cls.grading = GRADING.read_text(encoding="utf-8")

    def test_migration_adds_assessment_tables_with_rls_and_grants(self):
        for fragment in (
            "create table if not exists public.assessments",
            "create table if not exists public.assessment_items",
            "create table if not exists public.assessment_recipients",
            "create table if not exists public.assessment_attempts",
            "create table if not exists public.assessment_item_attempts",
            "alter table public.assessments enable row level security",
            "alter table public.assessment_items enable row level security",
            "alter table public.assessment_recipients enable row level security",
            "alter table public.assessment_attempts enable row level security",
            "alter table public.assessment_item_attempts enable row level security",
            "grant select, insert, update, delete on public.assessments to authenticated",
            "grant select, insert, update, delete on public.assessment_attempts to authenticated",
            "revoke all privileges on table public.assessments from anon",
            "revoke all privileges on table public.assessment_item_attempts from anon",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_migration_scopes_student_teacher_and_admin_access(self):
        for fragment in (
            "public.is_assessment_recipient",
            "public.can_manage_assessment",
            "public.can_view_assessment_attempt",
            "public.is_platform_admin()",
            "public.is_class_teacher(a.class_id)",
            "public.is_org_admin(a.organization_id)",
            "user_id = (select auth.uid())",
            "Teachers and assigned students can view assessments",
            "Students can create own assessment attempts",
            "Students and teachers can view assessment item attempts",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_assessment_admin_function_is_jwt_scoped_and_service_role_only(self):
        for fragment in (
            'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
            'req.headers.get("Authorization")',
            "async function fetchCurrentUser",
            "async function fetchActorCanManageClass",
            "platform_admins",
            "organization_memberships",
            "class_memberships",
            "Class teacher or admin access is required.",
            "Bearer ${config.serviceRoleKey}",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

        frontend_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "frontend" / "src").rglob("*")
            if path.suffix in {".ts", ".tsx"}
        )
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", frontend_source)

    def test_assessment_admin_supports_required_actions_and_records(self):
        for fragment in (
            '"create_assessment"',
            '"set_assessment_status"',
            '"start_assessment"',
            '"submit_assessment"',
            '"review_assessment_item"',
            '"return_assessment"',
            "assessment_recipients",
            "assessment_item_attempts",
            "learning_evidence",
            "student_mastery",
            "Multiple-choice questions need at least two choices and a correct answer.",
            "Review all text/code questions before returning results.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

    def test_frontend_exposes_assessment_api(self):
        for fragment in (
            '"assessment-admin"',
            'functionUrl("assessment-admin")',
            "createAssessment",
            "fetchStudentAssessments",
            "startAssessment",
            "submitAssessment",
            "reviewAssessmentItem",
            "returnAssessment",
        ):
            with self.subTest(fragment=fragment):
                self.assertTrue(fragment in self.supabase or fragment in self.api)
        # The old /chat QuizPanel mount is gone (see module docstring); the v6 surface
        # runs quizzes through the "quiz" TurnMode instead of the attempt API.

    def test_teacher_ui_can_create_assign_review_and_return_assessments(self):
        for fragment in (
            "Create quiz",
            "Assign quiz",
            "AssessmentManager",
            "AssessmentStatusChip",
            "AssessmentRecipientChip",
            "onReviewAssessmentItem",
            "Text response",
            "Code response",
            "Multiple choice",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.teacher_route)
        # The attempt review/return half lives in AssessmentGrading.tsx.
        self.assertIn("onReviewAssessmentItem", self.grading)
        self.assertIn("Return result", self.grading)

    def test_assessment_types_cover_student_and_teacher_contracts(self):
        for fragment in (
            "export type Assessment",
            "export type AssessmentItem",
            "export type AssessmentRecipient",
            "export type AssessmentAttempt",
            "export type AssessmentItemAttempt",
            "export type StudentAssessmentBundle",
            "export type AssessmentAdminResponse",
            '"assigned"',
            '"pending_review"',
            '"auto_graded"',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.types)


if __name__ == "__main__":
    unittest.main()
