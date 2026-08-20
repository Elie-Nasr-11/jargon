import { useMemo, useState } from "react";
import { KeyRound, Search, UserPlus, Users } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { notifyErr, notifyOk } from "@/lib/feedback";
import {
  adminAddUserToClass,
  adminResetUserPassword,
  adminSetMembershipRole,
  adminSetMembershipStatus,
} from "@/lib/api";
import type { AdminScope, AdminScopeResult } from "@/lib/types";
import { buildPeople, orgClasses, timeAgo, type PersonRow } from "./adminData";
import { ConfirmButton } from "./ConfirmButton";

const MIN_TEMP_PASSWORD_LENGTH = 6;

type RoleFilter = "all" | "student" | "teacher" | "org_admin";
type StatusFilter = "all" | "active" | "disabled" | "invited";

// R51 People tab: the org roster over the scope payload, with the management
// actions admin-ops has supported all along — reset password, org role, org
// status, and class membership. Every mutation applies the refreshed scope
// from the response via onScope.
export function PeoplePanel({
  token,
  scope,
  organizationId,
  currentUserId,
  isPlatformAdmin,
  onScope,
}: {
  token: string;
  scope: AdminScope;
  organizationId: string;
  currentUserId: string;
  isPlatformAdmin: boolean;
  onScope: (result: AdminScopeResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [classFilter, setClassFilter] = useState("all");
  const [expandedUserId, setExpandedUserId] = useState("");
  const [busy, setBusy] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [addClassId, setAddClassId] = useState("");
  const [addClassRole, setAddClassRole] = useState<"student" | "teacher">("student");

  const people = useMemo(() => buildPeople(scope, organizationId), [scope, organizationId]);
  const classes = useMemo(
    () => orgClasses(scope, organizationId).filter((item) => item.status === "active"),
    [scope, organizationId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((person) => {
      if (roleFilter !== "all" && person.orgMembership.role !== roleFilter) return false;
      if (statusFilter !== "all" && person.orgMembership.status !== statusFilter) return false;
      if (
        classFilter !== "all" &&
        !person.classes.some((link) => link.membership.class_id === classFilter)
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle)
      );
    });
  }, [people, query, roleFilter, statusFilter, classFilter]);

  const toggleExpanded = (userId: string) => {
    setExpandedUserId((current) => (current === userId ? "" : userId));
    setTempPassword("");
    setAddClassId("");
    setAddClassRole("student");
  };

  const run = async (key: string, work: () => Promise<AdminScopeResult>, okMessage: string) => {
    if (busy) return;
    setBusy(key);
    try {
      onScope(await work());
      notifyOk(okMessage);
    } catch (error) {
      notifyErr(error, "The admin operation failed.");
    } finally {
      setBusy("");
    }
  };

  const resetPassword = (person: PersonRow) => {
    const password = tempPassword.trim();
    if (password.length < MIN_TEMP_PASSWORD_LENGTH) return;
    void run(
      "reset",
      () => adminResetUserPassword(token, person.userId, password),
      `Temporary password set for ${person.name || person.email}.`,
    ).then(() => setTempPassword(""));
  };

  const changeOrgRole = (person: PersonRow, role: "student" | "teacher" | "org_admin") => {
    if (role === person.orgMembership.role) return;
    void run(
      "role",
      () =>
        adminSetMembershipRole(token, {
          membershipType: "organization",
          membershipId: person.orgMembership.id,
          role,
        }),
      `${person.name || person.email} is now ${role.replace("_", " ")}.`,
    );
  };

  const setOrgStatus = (person: PersonRow, status: "active" | "disabled") => {
    void run(
      "status",
      () =>
        adminSetMembershipStatus(token, {
          membershipType: "organization",
          membershipId: person.orgMembership.id,
          status,
        }),
      status === "disabled"
        ? `${person.name || person.email} is disabled.`
        : `${person.name || person.email} is active again.`,
    );
  };

  const addToClass = (person: PersonRow) => {
    if (!addClassId) return;
    void run(
      "class-add",
      () =>
        adminAddUserToClass(token, {
          organizationId,
          classId: addClassId,
          userId: person.userId,
          role: addClassRole,
        }),
      `${person.name || person.email} added to the class.`,
    ).then(() => setAddClassId(""));
  };

  const removeFromClass = (person: PersonRow, membershipId: string) => {
    void run(
      `class-remove-${membershipId}`,
      () =>
        adminSetMembershipStatus(token, {
          membershipType: "class",
          membershipId,
          status: "removed",
        }),
      `${person.name || person.email} removed from the class.`,
    );
  };

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-title font-medium text-foreground">
              People
              <span className="ml-2 text-body font-normal text-muted-foreground">
                {filtered.length}
              </span>
            </h2>
            <p className="mt-1 text-body text-muted-foreground">
              Everyone in this organization — reset passwords, adjust access, and manage class
              membership.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.6}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or email"
                aria-label="Search people"
                className="jargon-input !w-[220px] pl-9"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
              aria-label="Filter by role"
              className="jargon-input !w-[130px]"
            >
              <option value="all">All roles</option>
              <option value="student">Students</option>
              <option value="teacher">Teachers</option>
              <option value="org_admin">Org admins</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              aria-label="Filter by status"
              className="jargon-input !w-[140px]"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="invited">Invited</option>
            </select>
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              aria-label="Filter by class"
              className="jargon-input !w-[180px]"
            >
              <option value="all">All classes</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Users}>
            {people.length === 0
              ? "No members in this organization yet — seed a roster to get started."
              : "No one matches those filters."}
          </EmptyState>
        ) : (
          <div className="grid gap-2">
            {filtered.map((person) => {
              const isSelf = person.userId === currentUserId;
              const disabled = person.orgMembership.status === "disabled";
              const expanded = expandedUserId === person.userId;
              const openClasses = classes.filter(
                (item) => !person.classes.some((link) => link.membership.class_id === item.id),
              );
              return (
                <div
                  key={person.orgMembership.id}
                  className={`rounded-card border border-border bg-depth-field ${disabled ? "opacity-70" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-body text-foreground">
                        <span className="truncate font-medium">
                          {person.name || person.email || "Unnamed account"}
                        </span>
                        {isSelf ? (
                          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline text-muted-foreground">
                            You
                          </span>
                        ) : null}
                        {disabled ? (
                          <span className="shrink-0 rounded-full border border-danger/40 px-2 py-0.5 text-overline text-danger">
                            Disabled
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-meta text-muted-foreground">
                        {person.email}
                        {person.grade ? ` · ${person.grade}` : ""}
                        {person.classes.length
                          ? ` · ${person.classes.map((link) => link.className).join(", ")}`
                          : " · No classes"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                      {person.orgMembership.role.replace("_", " ")}
                    </span>
                    <span className="w-[86px] shrink-0 text-right text-meta text-muted-foreground">
                      {timeAgo(person.lastSignInAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(person.userId)}
                      className="btn btn-secondary btn-sm shrink-0"
                    >
                      {expanded ? "Close" : "Manage"}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="grid gap-4 border-t border-border/60 px-3 py-3 sm:grid-cols-2">
                      <div>
                        <div className="text-overline font-medium uppercase tracking-[0.09em] text-muted-foreground">
                          Temporary password
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            type="text"
                            autoComplete="off"
                            value={tempPassword}
                            onChange={(event) => setTempPassword(event.target.value)}
                            placeholder={`${MIN_TEMP_PASSWORD_LENGTH}+ characters`}
                            aria-label="Temporary password"
                            className="jargon-input flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => resetPassword(person)}
                            disabled={
                              Boolean(busy) || tempPassword.trim().length < MIN_TEMP_PASSWORD_LENGTH
                            }
                            className="btn btn-secondary btn-sm shrink-0"
                          >
                            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.7} />
                            {busy === "reset" ? "Setting…" : "Reset password"}
                          </button>
                        </div>
                        <p className="mt-1.5 text-meta text-muted-foreground">
                          Share it with them directly — it is sent to Supabase Auth and never stored
                          in Jargon tables.
                        </p>
                      </div>

                      <div>
                        <div className="text-overline font-medium uppercase tracking-[0.09em] text-muted-foreground">
                          Access
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {isSelf ? (
                            <p className="text-meta text-muted-foreground">
                              This is your own account — role and status stay in your hands
                              elsewhere.
                            </p>
                          ) : (
                            <>
                              {isPlatformAdmin ? (
                                <select
                                  value={person.orgMembership.role}
                                  onChange={(event) =>
                                    changeOrgRole(
                                      person,
                                      event.target.value as "student" | "teacher" | "org_admin",
                                    )
                                  }
                                  disabled={Boolean(busy)}
                                  aria-label="Organization role"
                                  className="jargon-input !w-[150px]"
                                >
                                  <option value="student">student</option>
                                  <option value="teacher">teacher</option>
                                  <option value="org_admin">org admin</option>
                                </select>
                              ) : (
                                <span className="text-meta text-muted-foreground">
                                  Role changes are platform-admin only.
                                </span>
                              )}
                              {disabled ? (
                                <button
                                  type="button"
                                  onClick={() => setOrgStatus(person, "active")}
                                  disabled={Boolean(busy)}
                                  className="btn btn-secondary btn-sm"
                                >
                                  {busy === "status" ? "Enabling…" : "Enable account"}
                                </button>
                              ) : (
                                <ConfirmButton
                                  label="Disable account"
                                  confirmLabel="Confirm disable"
                                  disabled={Boolean(busy)}
                                  onConfirm={() => setOrgStatus(person, "disabled")}
                                />
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <div className="text-overline font-medium uppercase tracking-[0.09em] text-muted-foreground">
                          Classes
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {person.classes.map((link) => (
                            <span
                              key={link.membership.id}
                              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-meta text-foreground"
                            >
                              {link.className}
                              <span className="text-muted-foreground">{link.membership.role}</span>
                              <ConfirmButton
                                label="Remove"
                                confirmLabel="Confirm"
                                disabled={Boolean(busy)}
                                onConfirm={() => removeFromClass(person, link.membership.id)}
                              />
                            </span>
                          ))}
                          {person.classes.length === 0 ? (
                            <span className="text-meta text-muted-foreground">
                              Not in any class yet.
                            </span>
                          ) : null}
                        </div>
                        {openClasses.length ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              value={addClassId}
                              onChange={(event) => setAddClassId(event.target.value)}
                              aria-label="Add to class"
                              className="jargon-input !w-[220px]"
                            >
                              <option value="">Add to a class…</option>
                              {openClasses.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                            <select
                              value={addClassRole}
                              onChange={(event) =>
                                setAddClassRole(event.target.value as "student" | "teacher")
                              }
                              aria-label="Class role"
                              className="jargon-input !w-[110px]"
                            >
                              <option value="student">student</option>
                              <option value="teacher">teacher</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => addToClass(person)}
                              disabled={Boolean(busy) || !addClassId}
                              className="btn btn-secondary btn-sm"
                            >
                              <UserPlus className="h-3.5 w-3.5" strokeWidth={1.7} />
                              {busy === "class-add" ? "Adding…" : "Add"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
