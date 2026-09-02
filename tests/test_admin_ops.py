"""Trimmed 2026-07-30 to three MVP tabs (Seeding, Live, Cost & runtime); R51
(2026-08-20) grew the portal back over the dormant admin-ops actions: Overview,
People (reset password / role / status / class membership), and Classes
(create / rename / archive, readiness badges, CSV snapshot export). The
server-side scoping/audit/no-plaintext-password pins survive both eras."""
from pathlib import Path
import unittest

from tests.admin_sources import admin_source


ROOT = Path(__file__).resolve().parents[1]
ADMIN_OPS = ROOT / "supabase" / "functions" / "admin-ops" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
SUPABASE = ROOT / "frontend" / "src" / "lib" / "supabase.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"


class AdminOpsStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.function = ADMIN_OPS.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.supabase = SUPABASE.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.route = admin_source()

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
        # R84 admin tab set: Setup / People / Classes / Health — the same four for
        # every admin level. "Seeding" is gone; its three unrelated jobs went to the
        # screen that owns each, and stale ?tab= deep links resolve through
        # normalizeAdminTab rather than dumping the admin on an arbitrary screen.
        for fragment in (
            'const visibleTabs = ["setup", "people", "classes", "health"];',
            "const adminTab = normalizeAdminTab(search.tab, visibleTabs);",
            '<WorkspaceTab value="setup">Setup</WorkspaceTab>',
            '<WorkspaceTab value="people">People</WorkspaceTab>',
            '<WorkspaceTab value="classes">Classes</WorkspaceTab>',
            '<WorkspaceTab value="health">Health</WorkspaceTab>',
            "<SetupPanel",
            "<PeoplePanel",
            "<ClassesPanel",
            "<HealthPanel",
            # The tabs that died, and must not come back as tabs.
            *(),
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.route)
        for gone in (
            '<WorkspaceTab value="overview">',
            '<WorkspaceTab value="seeding">',
            '<WorkspaceTab value="live">',
            '<WorkspaceTab value="cost">',
        ):
            with self.subTest(gone=gone):
                self.assertNotIn(gone, self.route)

    def test_the_contracts_survived_the_move(self):
        # The three Seeding jobs and the two Health reads still exist — this release
        # moved them, it did not quietly drop any.
        surface = self.route
        for fragment in (
            # roster import (People) — still the admin-seed edge fn, still no stored password
            "invokeAdminSeed",
            "Import a roster",
            # demo logins (the fenced developer corner)
            "seedDemoLogins",
            "Developer corner",
            # Health
            "fetchActiveSessions",
            "Live sessions",
            "No students are in a live session right now.",
            "fetchCostModelDashboard",
            "AI/runtime operations",
            "Usage, reliability, and model load",
            "Estimated cost",
            "Model breakdown",
            "Task type breakdown",
            "Class operating load",
            "Cost totals stay platform-level.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, surface)


if __name__ == "__main__":
    unittest.main()
