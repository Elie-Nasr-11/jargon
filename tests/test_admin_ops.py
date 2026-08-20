"""Trimmed 2026-07-30 to three MVP tabs (Seeding, Live, Cost & runtime); R51
(2026-08-20) grew the portal back over the dormant admin-ops actions: Overview,
People (reset password / role / status / class membership), and Classes
(create / rename / archive, readiness badges, CSV snapshot export). The
server-side scoping/audit/no-plaintext-password pins survive both eras."""
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
            '"list_cost_model_dashboard"',
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
            "buildCostModelDashboard",
            "handleListCostModelDashboard",
            "model_usage_events",
            "speech_usage_events",
            "runtime_events",
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
        # R51 wrapper surface: the original reads plus the management actions the
        # People/Classes tabs drive. All go through invokeAdminOps (user JWT);
        # nothing in the frontend touches the service role.
        self.assertIn('"admin-ops"', self.supabase)
        self.assertIn('functionUrl("admin-ops")', self.api)
        self.assertIn("invokeAdminOps", self.api)
        self.assertIn("fetchAdminScope", self.api)
        self.assertIn("fetchCostModelDashboard", self.api)
        self.assertIn("fetchActiveSessions", self.api)
        self.assertIn("fetchPilotReadiness", self.api)
        self.assertIn("adminResetUserPassword", self.api)
        self.assertIn("adminSetMembershipStatus", self.api)
        self.assertIn("adminSetMembershipRole", self.api)
        self.assertIn("adminAddUserToClass", self.api)
        self.assertIn("adminCreateClass", self.api)
        self.assertIn("adminUpdateClass", self.api)
        self.assertIn("adminExportClassSnapshot", self.api)
        self.assertIn("AdminActorAccess", self.types)
        self.assertIn("AdminScope", self.types)
        self.assertIn("CostModelDashboard", self.types)
        self.assertIn("ActiveSession", self.types)

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

    def test_admin_route_tabs(self):
        # R51 admin tab set: Overview / People / Classes (management over admin-ops)
        # plus the original Seeding + Live + (platform-admin only) Cost & runtime,
        # with stale ?tab= deep links falling back to Overview, which every admin
        # level can see.
        for fragment in (
            'const visibleTabs = isPlatformLevel\n'
            '    ? ["overview", "people", "classes", "seeding", "live", "cost"]\n'
            '    : ["overview", "people", "classes", "seeding", "live"];',
            'search.tab && visibleTabs.includes(search.tab) ? search.tab : "overview"',
            '<WorkspaceTab value="overview">Overview</WorkspaceTab>',
            '<WorkspaceTab value="people">People</WorkspaceTab>',
            '<WorkspaceTab value="classes">Classes</WorkspaceTab>',
            # The R51 panels mount inside the org-scoped tab frame.
            "<OverviewPanel",
            "<PeoplePanel",
            "<ClassesPanel",
            '<WorkspaceTab value="seeding">Seeding</WorkspaceTab>',
            '<WorkspaceTab value="live">Live</WorkspaceTab>',
            '<WorkspaceTab value="cost">Cost &amp; runtime</WorkspaceTab>',
            # Seeding tab: roster seeding via the admin-seed edge fn; passwords never
            # persist. R51: the panel renders for BOTH admin levels (org admins used to
            # get a blank tab because the panel body was platform-gated).
            '<WorkspacePanel value="seeding">',
            "invokeAdminSeed",
            "Seed classroom",
            "Passwords are sent only to Supabase Auth and are not stored in Jargon tables.",
            # Live tab: the active-sessions fleet view.
            "fetchActiveSessions",
            "Live sessions",
            "No students are in a live session right now.",
            # Cost & runtime tab: usage/reliability with dollar cost gated to platform admins.
            "fetchCostModelDashboard",
            "AI/runtime operations",
            "Usage, reliability, and model load",
            "Estimated cost",
            "Model breakdown",
            "Task type breakdown",
            "Class operating load",
            "Dollar-cost totals stay platform-admin only.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.route)


if __name__ == "__main__":
    unittest.main()
