from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ADMIN_SEED = ROOT / "supabase" / "functions" / "admin-seed" / "index.ts"
CHAT_FUNCTION = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
ROUTE_TREE = ROOT / "frontend" / "src" / "routeTree.gen.ts"
ADMIN_ROUTE = ROOT / "frontend" / "src" / "routes" / "admin.tsx"
TEACHER_ROUTE = ROOT / "frontend" / "src" / "routes" / "teacher.tsx"
DOC = ROOT / "docs" / "ADMIN_SEEDED_PILOT.md"


class AdminSeedPilotStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin_seed = ADMIN_SEED.read_text(encoding="utf-8")
        cls.chat = CHAT_FUNCTION.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.route_tree = ROUTE_TREE.read_text(encoding="utf-8")
        cls.admin_route = ADMIN_ROUTE.read_text(encoding="utf-8")
        cls.teacher_route = TEACHER_ROUTE.read_text(encoding="utf-8")
        cls.doc = DOC.read_text(encoding="utf-8")

    def test_admin_seed_requires_auth_and_platform_admin(self):
        for fragment in (
            'req.headers.get("Authorization")',
            "Authentication is required.",
            "async function fetchCurrentUser",
            "async function assertPlatformAdmin",
            "platform_admins",
            "Platform admin access is required.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.admin_seed)

    def test_admin_seed_uses_service_role_only_server_side(self):
        for fragment in (
            'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
            "serviceRoleKey",
            "/auth/v1/admin/users",
            "Bearer ${config.serviceRoleKey}",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.admin_seed)

        frontend_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "frontend" / "src").rglob("*")
            if path.suffix in {".ts", ".tsx"}
        )
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", frontend_source)
        self.assertNotIn("serviceRoleKey", frontend_source)

    def test_seed_roster_writes_all_required_records(self):
        for table in (
            "profiles",
            "organization_memberships",
            "class_memberships",
            "admin_account_seed_batches",
            "admin_account_seed_entries",
        ):
            with self.subTest(table=table):
                self.assertIn(table, self.admin_seed)

        self.assertIn("upsertOrganization", self.admin_seed)
        self.assertIn("upsertClass", self.admin_seed)
        self.assertIn("findAuthUserByEmail", self.admin_seed)
        self.assertIn("existing ? \"reused\" : \"created\"", self.admin_seed)

    def test_seed_entries_do_not_store_plaintext_passwords(self):
        self.assertIn("password_supplied", self.admin_seed)
        self.assertIn("never stores plaintext passwords", self.doc.lower())
        seed_entry_section = self.admin_seed[
            self.admin_seed.index("async function insertSeedEntry") :
            self.admin_seed.index("function normalizeSeedUsers")
        ]
        self.assertNotIn("password:", seed_entry_section)
        self.assertNotIn("defaultPassword", seed_entry_section)

    def test_frontend_admin_and_teacher_routes_are_registered(self):
        self.assertIn('createFileRoute("/admin")', self.admin_route)
        self.assertIn('createFileRoute("/teacher")', self.teacher_route)
        for route in ("/admin", "/teacher"):
            with self.subTest(route=route):
                self.assertIn(route, self.route_tree)

    def test_frontend_admin_uses_edge_function_not_direct_auth_admin(self):
        self.assertIn('functionUrl("admin-seed")', self.api)
        self.assertIn('action: "seed_roster"', self.api)
        self.assertIn("isPlatformAdmin", self.api)
        self.assertNotIn("/auth/v1/admin/users", self.api)
        self.assertIn("invokeAdminSeed", self.admin_route)

    def test_teacher_shell_reads_membership_scoped_classes(self):
        self.assertIn("fetchTeacherClasses", self.api)
        self.assertIn('eq("role", "teacher")', self.api)
        self.assertIn("class_memberships(role,status)", self.api)
        self.assertIn("rosterCount", self.teacher_route)

    def test_typed_chat_auth_errors_are_no_longer_generic_500(self):
        self.assertIn("function typedAuthStatus", self.chat)
        self.assertIn("return typedError(message, typedAuthStatus(message)", self.chat)
        self.assertIn("Authentication is required", self.chat)

    def test_bootstrap_doc_records_no_public_claim_flow(self):
        for phrase in (
            "not a public signup or claim-admin flow",
            "insert into public.platform_admins",
            "SUPABASE_SERVICE_ROLE_KEY",
            "Temporary passwords are sent to Supabase Auth only",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.doc)


if __name__ == "__main__":
    unittest.main()
