from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0014_google_classroom_integration.sql"
FUNCTION = ROOT / "supabase" / "functions" / "google-classroom" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
SUPABASE = ROOT / "frontend" / "src" / "lib" / "supabase.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
ADMIN_ROUTE = ROOT / "frontend" / "src" / "routes" / "admin.tsx"
DOC = ROOT / "docs" / "GOOGLE_CLASSROOM_INTEGRATION.md"


class GoogleClassroomIntegrationStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.function = FUNCTION.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.supabase = SUPABASE.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.admin = ADMIN_ROUTE.read_text(encoding="utf-8")
        cls.doc = DOC.read_text(encoding="utf-8")
        cls.frontend_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "frontend" / "src").rglob("*")
            if path.suffix in {".ts", ".tsx"}
        )

    def test_google_classroom_tables_are_rls_protected(self):
        for fragment in (
            "create table if not exists public.google_classroom_connections",
            "create table if not exists public.google_classroom_course_mappings",
            "create table if not exists public.google_classroom_user_mappings",
            "create table if not exists public.google_classroom_sync_runs",
            "alter table public.google_classroom_connections enable row level security",
            "alter table public.google_classroom_course_mappings enable row level security",
            "alter table public.google_classroom_user_mappings enable row level security",
            "alter table public.google_classroom_sync_runs enable row level security",
            "revoke all privileges on table public.google_classroom_connections from anon, authenticated",
            "revoke all privileges on table public.google_classroom_course_mappings from anon",
            "revoke all privileges on table public.google_classroom_user_mappings from anon",
            "revoke all privileges on table public.google_classroom_sync_runs from anon",
            "public.is_org_admin(organization_id)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_edge_function_uses_read_only_scopes_and_server_side_secrets(self):
        for fragment in (
            "classroom.courses.readonly",
            "classroom.rosters.readonly",
            "classroom.profile.emails",
            "GOOGLE_CLASSROOM_CLIENT_ID",
            "GOOGLE_CLASSROOM_CLIENT_SECRET",
            "GOOGLE_CLASSROOM_REDIRECT_URI",
            "GOOGLE_TOKEN_ENCRYPTION_KEY",
            "encryptToken",
            "decryptToken",
            "fetchActorAccess",
            "ensureOrganizationMembership",
            "ensureClassMembership",
            "listAllAuthUsers",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

        forbidden_scope_fragments = (
            "classroom.coursework.students",
            "classroom.coursework.me",
            "classroom.student-submissions.students",
            "classroom.student-submissions.me",
            '"https://www.googleapis.com/auth/classroom.rosters"',
        )
        scopes_block = self.function.split("const CLASSROOM_SCOPES", 1)[1].split("];", 1)[0]
        for fragment in forbidden_scope_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, scopes_block)

    def test_frontend_calls_edge_function_without_exposing_google_secrets(self):
        for fragment in (
            '"google-classroom"',
            'functionUrl("google-classroom")',
            "startGoogleClassroomOAuth",
            "completeGoogleClassroomOAuth",
            "fetchGoogleClassroomCourses",
            "previewGoogleClassroomRoster",
            "importGoogleClassroomCourse",
            "disconnectGoogleClassroom",
            "GoogleClassroomIntegrationState",
        ):
            with self.subTest(fragment=fragment):
                self.assertTrue(
                    fragment in self.api
                    or fragment in self.supabase
                    or fragment in self.types
                    or fragment in self.admin
                )

        for secret_name in (
            "GOOGLE_CLASSROOM_CLIENT_SECRET",
            "GOOGLE_TOKEN_ENCRYPTION_KEY",
        ):
            with self.subTest(secret_name=secret_name):
                self.assertNotIn(secret_name, self.frontend_source)

    def test_admin_ui_supports_connect_preview_import(self):
        for fragment in (
            "Google Classroom",
            "Connect Google",
            "Load courses",
            "Preview roster",
            "Import into Jargon",
            "needs seed",
            "Recent Classroom syncs",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.admin)

    def test_docs_pin_v1_boundaries(self):
        for fragment in (
            "read-only course and roster import",
            "No Google account creation",
            "No Google assignment creation",
            "No grade passback",
            "Jargon remains the source of truth",
            "GOOGLE_CLASSROOM_REDIRECT_URI",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.doc)


if __name__ == "__main__":
    unittest.main()
