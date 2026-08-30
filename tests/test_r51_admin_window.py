"""R51 — the admin window grows management tabs over the dormant admin-ops actions.

The admin-ops edge function has shipped people/class management since the pilot
rounds (reset_user_password, update_membership_status/role, add_existing_user_to_class,
create_class/update_class, list_pilot_readiness, export_class_snapshot) but the MVP
strip left the portal at Seeding + Live + Cost. R51 adds the UI: Overview (headline
stats, readiness, audit feed), People (org roster + account actions), Classes
(lifecycle + roster + CSV export) — frontend only, no backend change.

Pinned contracts:
- api.ts wrappers post the existing action names and apply the refreshed scope every
  mutation response already carries (no second list_admin_scope round-trip).
- PeoplePanel guards: you cannot disable or re-role your own account; org-role
  changes render only for platform admins (the backend forbids them for org admins);
  class removal is a status flip to "removed", never a hard delete.
- ClassesPanel: archive is a status flip to "archived" (restorable), and the CSV
  export downloads the admin-ops payload instead of composing rows client-side.
- The Seeding panel renders for BOTH admin levels — the org-admin blank-tab bug
  (platform-gated panel body behind an ungated tab) stays fixed.
- Readiness lazy-loads once for Overview + Classes and is shared between them.
"""
from pathlib import Path
import unittest

from tests.admin_sources import admin_source


ROOT = Path(__file__).resolve().parents[1]
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
ROUTE = admin_source()
DATA = (ROOT / "frontend" / "src" / "features" / "admin" / "adminData.ts").read_text(
    encoding="utf-8"
)
PEOPLE = (ROOT / "frontend" / "src" / "features" / "admin" / "PeoplePanel.tsx").read_text(
    encoding="utf-8"
)
CLASSES = (ROOT / "frontend" / "src" / "features" / "admin" / "ClassesPanel.tsx").read_text(
    encoding="utf-8"
)
OVERVIEW = (ROOT / "frontend" / "src" / "features" / "admin" / "OverviewPanel.tsx").read_text(
    encoding="utf-8"
)
CONFIRM = (ROOT / "frontend" / "src" / "features" / "admin" / "ConfirmButton.tsx").read_text(
    encoding="utf-8"
)


class R51WrapperTests(unittest.TestCase):
    def test_wrappers_post_the_existing_action_names(self):
        for action in (
            'action: "list_pilot_readiness"',
            'action: "reset_user_password"',
            'action: "update_membership_status"',
            'action: "update_membership_role"',
            'action: "add_existing_user_to_class"',
            'action: "create_class"',
            'action: "update_class"',
            'action: "export_class_snapshot"',
        ):
            with self.subTest(action=action):
                self.assertIn(action, API)

    def test_membership_wrappers_send_the_payload_discriminator(self):
        # The backend reads payload.membership_type to pick the table; both
        # membership wrappers must send it.
        self.assertIn("payload: { membership_type: input.membershipType }", API)

    def test_mutations_return_the_refreshed_scope(self):
        # Every admin-ops mutation answers with the refreshed scope; the shared
        # extractor throws instead of silently returning a stale view.
        self.assertIn("function adminScopeFromResponse", API)
        self.assertIn("Admin response was missing the refreshed scope.", API)


class R51RouteTests(unittest.TestCase):
    def test_scope_updates_come_from_mutation_responses(self):
        self.assertIn("const applyScopeResult = (result: AdminScopeResult)", ROUTE)
        self.assertIn("onScope={applyScopeResult}", ROUTE)

    def test_readiness_is_shared_and_lazy(self):
        # One readiness load backs both Overview and Classes, fetched the first
        # time either tab opens.
        self.assertIn('if (adminTab !== "overview" && adminTab !== "classes") return;', ROUTE)
        self.assertIn("fetchPilotReadiness", ROUTE)
        self.assertEqual(ROUTE.count("fetchPilotReadiness("), 1)

    def test_overview_shares_the_live_fleet_poll(self):
        self.assertIn(
            'if ((adminTab !== "live" && adminTab !== "overview") || !token) return;', ROUTE
        )

    def test_seeding_panel_is_no_longer_platform_gated(self):
        # The org-admin blank-tab bug: the tab was visible to both levels but the
        # panel body rendered only for platform admins.
        self.assertNotIn('isPlatformLevel ? (\n                <WorkspacePanel value="seeding">', ROUTE)
        self.assertIn('<WorkspacePanel value="seeding">', ROUTE)
        # The demo-entry section inside stays platform-only.
        self.assertIn("Create demo logins", ROUTE)


class R51PeopleTests(unittest.TestCase):
    def test_self_guard_blocks_own_role_and_status(self):
        self.assertIn("const isSelf = person.userId === currentUserId;", PEOPLE)
        self.assertIn("This is your own account", PEOPLE)

    def test_org_role_editor_is_platform_only(self):
        # Backend: "Only platform admins may change organization roles." The UI
        # mirrors it instead of offering a doomed control.
        self.assertIn("isPlatformAdmin ? (", PEOPLE)
        self.assertIn("Role changes are platform-admin only.", PEOPLE)

    def test_class_removal_is_a_status_flip(self):
        self.assertIn('membershipType: "class"', PEOPLE)
        self.assertIn('status: "removed"', PEOPLE)

    def test_temp_passwords_are_not_persisted_client_side(self):
        # Same posture as seeding: the password goes to the wrapper and the local
        # field clears after the call.
        self.assertIn("adminResetUserPassword(token, person.userId, password)", PEOPLE)
        self.assertIn('.then(() => setTempPassword(""))', PEOPLE)

    def test_disable_and_remove_use_two_click_confirm(self):
        self.assertIn("ConfirmButton", PEOPLE)
        self.assertNotIn("window.confirm", PEOPLE)
        self.assertNotIn("window.confirm", CLASSES)
        self.assertIn("setTimeout(() => setArmed(false), 4000)", CONFIRM)


class R51ClassesTests(unittest.TestCase):
    def test_archive_is_restorable_status(self):
        self.assertIn('setClassStatus(klass.id, "archived")', CLASSES)
        self.assertIn('setClassStatus(klass.id, "active")', CLASSES)

    def test_export_downloads_the_admin_ops_payload(self):
        self.assertIn("adminExportClassSnapshot(token, classId)", CLASSES)
        self.assertIn("downloadExport", CLASSES)
        self.assertIn("URL.createObjectURL", DATA)

    def test_readiness_badges_join_by_class_id(self):
        self.assertIn("readinessByClass.get(klass.id)", CLASSES)


class R51DerivationTests(unittest.TestCase):
    def test_people_rows_join_only_active_class_links(self):
        self.assertIn('if (membership.status !== "active") continue;', DATA)

    def test_overview_counts_never_signed_in(self):
        self.assertIn("!person.lastSignInAt", OVERVIEW)
        self.assertIn("Never signed in", OVERVIEW)

    def test_audit_feed_is_org_scoped(self):
        self.assertIn("orgAuditEvents", OVERVIEW)
        self.assertIn(
            "scope.audit_events.filter((event) => event.organization_id === organizationId)",
            DATA,
        )


if __name__ == "__main__":
    unittest.main()
