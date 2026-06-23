from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ADMIN_OPS = ROOT / "supabase" / "functions" / "admin-ops" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
SUPABASE = ROOT / "frontend" / "src" / "lib" / "supabase.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
ADMIN_ROUTE = ROOT / "frontend" / "src" / "routes" / "admin.tsx"


class AdminOpsStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.function = ADMIN_OPS.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.supabase = SUPABASE.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.route = ADMIN_ROUTE.read_text(encoding="utf-8")

    def test_admin_ops_is_scoped_admin_service_role_only(self):
        for fragment in (
            'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
            'req.headers.get("Authorization")',
            "async function fetchCurrentUser",
            "async function fetchActorAccess",
            "platform_admins",
            "org_admin",
            "Admin access is required.",
            "Admin access for this organization is required.",
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
        self.assertNotIn("/auth/v1/admin/users", frontend_source)

    def test_admin_ops_supports_required_actions_and_audit(self):
        for fragment in (
            '"list_admin_scope"',
            '"list_pilot_readiness"',
            '"export_class_snapshot"',
            '"create_class"',
            '"update_class"',
            '"reset_user_password"',
            '"update_membership_status"',
            '"update_membership_role"',
            '"add_existing_user_to_class"',
            "audit_events",
            "admin.password_reset",
            "admin.membership_status_updated",
            "admin.membership_role_updated",
            "admin.class_created",
            "admin.class_updated",
            "buildPilotReadiness",
            "handleExportClassSnapshot",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

    def test_org_admin_scope_is_enforced_server_side(self):
        for fragment in (
            'level: "org_admin"',
            "actor_access",
            "organization_ids",
            "requireOrganizationAccess",
            "fetchAccessibleOrgMembershipsForUser",
            "Only platform admins may change organization roles.",
            "Org admins may add only existing active organization users to classes.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

    def test_password_reset_does_not_persist_plaintext(self):
        self.assertIn("password_supplied", self.function)
        self.assertIn("/auth/v1/admin/users/${encodeURIComponent(userId)}", self.function)
        reset_section = self.function[
            self.function.index("async function handleResetPassword") :
            self.function.index("function membershipTable")
        ]
        self.assertNotIn("admin_account_seed_entries", reset_section)

    def test_frontend_exposes_admin_ops_without_service_role(self):
        self.assertIn('"admin-ops"', self.supabase)
        self.assertIn('functionUrl("admin-ops")', self.api)
        self.assertIn("invokeAdminOps", self.api)
        self.assertIn("fetchAdminScope", self.api)
        self.assertIn("fetchPilotReadiness", self.api)
        self.assertIn("exportClassSnapshot", self.api)
        self.assertIn("AdminActorAccess", self.types)
        self.assertIn("AdminScope", self.types)
        self.assertIn("PilotReadiness", self.types)
        self.assertIn("ClassSnapshotExport", self.types)

    def test_snapshot_export_does_not_include_passwords(self):
        export_section = self.function[
            self.function.index("async function handleExportClassSnapshot") :
            self.function.index("async function handleCreateClass")
        ]
        self.assertNotIn("temporary_password", export_section)
        self.assertNotIn("password_supplied", export_section)
        self.assertNotIn("password", export_section.lower())
        self.assertIn("Completed lessons", export_section)
        self.assertIn("Open alerts", export_section)

    def test_admin_route_contains_operations_dashboard(self):
        for fragment in (
            "Operations dashboard",
            "Pilot Readiness",
            "Classroom launch command center",
            "Roster/account health",
            "Export CSV",
            "Copy login instructions",
            "Org admin",
            "Platform admin",
            "Create class",
            "Class settings",
            "Add existing user",
            "Password reset",
            "Recent audit events",
            "Organization role updated.",
            "Bulk roster seeding stays platform-admin only",
            "update_membership_status",
            "reset_user_password",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.route)


if __name__ == "__main__":
    unittest.main()
