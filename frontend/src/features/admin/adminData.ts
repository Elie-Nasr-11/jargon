// R51 admin window: pure derivations shared by the Overview / People / Classes
// panels. Everything works off the AdminScope payload the admin-ops function
// already returns (members, profiles, auth users, audit trail) — no new reads.
import type {
  AdminClass,
  AdminScope,
  AuditEvent,
  ClassSnapshotExport,
  OrganizationMembership,
  TeacherClassMembership,
} from "@/lib/types";

export type PersonClassLink = {
  membership: TeacherClassMembership;
  className: string;
};

export type PersonRow = {
  userId: string;
  name: string;
  grade: string;
  email: string;
  lastSignInAt: string | null;
  orgMembership: OrganizationMembership;
  classes: PersonClassLink[];
};

// One row per organization membership in the selected org, joined with the
// profile, auth user, and active class links. Sorted by display name.
export function buildPeople(scope: AdminScope, organizationId: string): PersonRow[] {
  const profileById = new Map(scope.profiles.map((profile) => [profile.id, profile]));
  const userById = new Map(scope.users.map((user) => [user.id, user]));
  const classById = new Map<string, AdminClass>(
    scope.classes
      .filter((item) => item.organization_id === organizationId)
      .map((item) => [item.id, item]),
  );
  const classLinksByUser = new Map<string, PersonClassLink[]>();
  for (const membership of scope.class_memberships) {
    if (membership.status !== "active") continue;
    const klass = classById.get(membership.class_id);
    if (!klass) continue;
    const list = classLinksByUser.get(membership.user_id) || [];
    list.push({ membership, className: klass.name });
    classLinksByUser.set(membership.user_id, list);
  }

  return scope.organization_memberships
    .filter((membership) => membership.organization_id === organizationId)
    .map((membership) => {
      const profile = profileById.get(membership.user_id);
      const user = userById.get(membership.user_id);
      return {
        userId: membership.user_id,
        name: profile?.name || "",
        grade: profile?.grade || "",
        email: user?.email || "",
        lastSignInAt: user?.last_sign_in_at || null,
        orgMembership: membership,
        classes: (classLinksByUser.get(membership.user_id) || []).sort((a, b) =>
          a.className.localeCompare(b.className),
        ),
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export function orgClasses(scope: AdminScope, organizationId: string): AdminClass[] {
  return scope.classes
    .filter((item) => item.organization_id === organizationId)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function classMembers(
  scope: AdminScope,
  classId: string,
): Array<{
  membership: TeacherClassMembership;
  name: string;
  email: string;
  lastSignInAt: string | null;
}> {
  const profileById = new Map(scope.profiles.map((profile) => [profile.id, profile]));
  const userById = new Map(scope.users.map((user) => [user.id, user]));
  return scope.class_memberships
    .filter((membership) => membership.class_id === classId && membership.status === "active")
    .map((membership) => ({
      membership,
      name: profileById.get(membership.user_id)?.name || "",
      email: userById.get(membership.user_id)?.email || "",
      lastSignInAt: userById.get(membership.user_id)?.last_sign_in_at || null,
    }))
    .sort((a, b) => {
      if (a.membership.role !== b.membership.role) {
        return a.membership.role === "teacher" ? -1 : 1;
      }
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
}

export function orgAuditEvents(scope: AdminScope, organizationId: string): AuditEvent[] {
  return scope.audit_events.filter((event) => event.organization_id === organizationId);
}

// "admin.membership_status_updated" -> "Member status updated", with friendlier
// labels for the events the panels themselves produce.
const EVENT_LABELS: Record<string, string> = {
  "admin.password_reset": "Password reset",
  "admin.class_created": "Class created",
  "admin.class_updated": "Class updated",
  "admin.membership_status_updated": "Member status updated",
  "admin.membership_role_updated": "Member role updated",
  "admin.user_added_to_class": "Added to a class",
};

export function auditEventLabel(event: AuditEvent): string {
  const known = EVENT_LABELS[event.event_type];
  if (known) return known;
  const stripped = event.event_type.replace(/^admin\./, "").replaceAll("_", " ");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Browser-download a CSV handed back by admin-ops (export_class_snapshot).
export function downloadExport(file: ClassSnapshotExport) {
  const blob = new Blob([file.body], { type: file.content_type || "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
