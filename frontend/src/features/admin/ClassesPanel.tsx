import { useMemo, useState } from "react";
import { Download, GraduationCap, Plus, UserPlus } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { notifyErr, notifyOk } from "@/lib/feedback";
import {
  adminAddUserToClass,
  adminCreateClass,
  adminExportClassSnapshot,
  adminSetMembershipStatus,
  adminUpdateClass,
} from "@/lib/api";
import type { AdminScope, AdminScopeResult, PilotReadiness, ReadinessStatus } from "@/lib/types";
import { buildPeople, classMembers, downloadExport, orgClasses, timeAgo } from "./adminData";
import { ConfirmButton } from "./ConfirmButton";

const READINESS_BADGE: Record<ReadinessStatus, { label: string; className: string }> = {
  ready: { label: "Ready", className: "border-success/40 text-success" },
  needs_setup: { label: "Needs setup", className: "border-info/40 text-info" },
  needs_attention: { label: "Needs attention", className: "border-warning/40 text-warning" },
  blocked: { label: "Blocked", className: "border-danger/40 text-danger" },
};

// R51 Classes tab: class lifecycle (create / rename / archive), the per-class
// roster, readiness badges from list_pilot_readiness, and the CSV snapshot
// export admin-ops has offered since the pilot-governance round.
export function ClassesPanel({
  token,
  scope,
  organizationId,
  readiness,
  readinessLoading,
  onScope,
}: {
  token: string;
  scope: AdminScope;
  organizationId: string;
  readiness: PilotReadiness | null;
  readinessLoading: boolean;
  onScope: (result: AdminScopeResult) => void;
}) {
  const [newClassName, setNewClassName] = useState("");
  const [expandedClassId, setExpandedClassId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"student" | "teacher">("student");

  const classes = useMemo(() => orgClasses(scope, organizationId), [scope, organizationId]);
  const people = useMemo(() => buildPeople(scope, organizationId), [scope, organizationId]);
  const readinessByClass = useMemo(
    () => new Map((readiness?.classes || []).map((item) => [item.class_id, item])),
    [readiness],
  );

  const toggleExpanded = (classId: string, currentName: string) => {
    setExpandedClassId((current) => (current === classId ? "" : classId));
    setRenameValue(currentName);
    setAddUserId("");
    setAddRole("student");
  };

  const run = async (key: string, work: () => Promise<AdminScopeResult>, okMessage: string) => {
    if (busy) return;
    setBusy(key);
    try {
      onScope(await work());
      notifyOk(okMessage);
    } catch (error) {
      notifyErr(error, "The class operation failed.");
    } finally {
      setBusy("");
    }
  };

  const createClass = () => {
    const name = newClassName.trim();
    if (!name) return;
    void run(
      "create",
      () => adminCreateClass(token, { organizationId, name }),
      `Class "${name}" created.`,
    ).then(() => setNewClassName(""));
  };

  const renameClass = (classId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    void run("rename", () => adminUpdateClass(token, { classId, name }), "Class renamed.");
  };

  const setClassStatus = (classId: string, status: "active" | "archived") => {
    void run(
      "status",
      () => adminUpdateClass(token, { classId, status }),
      status === "archived" ? "Class archived." : "Class restored.",
    );
  };

  const exportSnapshot = async (classId: string) => {
    if (busy) return;
    setBusy("export");
    try {
      downloadExport(await adminExportClassSnapshot(token, classId));
      notifyOk("Class snapshot downloaded.");
    } catch (error) {
      notifyErr(error, "Could not export the class snapshot.");
    } finally {
      setBusy("");
    }
  };

  const addMember = (classId: string) => {
    if (!addUserId) return;
    void run(
      "member-add",
      () =>
        adminAddUserToClass(token, {
          organizationId,
          classId,
          userId: addUserId,
          role: addRole,
        }),
      "Member added to the class.",
    ).then(() => setAddUserId(""));
  };

  const removeMember = (membershipId: string) => {
    void run(
      `member-remove-${membershipId}`,
      () =>
        adminSetMembershipStatus(token, {
          membershipType: "class",
          membershipId,
          status: "removed",
        }),
      "Member removed from the class.",
    );
  };

  return (
    <div className="space-y-5">
      <section className="rounded-card border border-border bg-depth-card shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3 p-4 sm:p-6">
          <div>
            <h2 className="text-title font-medium text-foreground">Create a class</h2>
            <p className="mt-1 text-body text-muted-foreground">
              New classes start empty — add teachers and students from People, or seed a roster.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              placeholder="Class name"
              aria-label="New class name"
              className="jargon-input !w-[240px]"
            />
            <button
              type="button"
              onClick={createClass}
              disabled={Boolean(busy) || !newClassName.trim()}
              className="btn btn-primary"
            >
              <Plus className="h-4 w-4" strokeWidth={1.6} />
              {busy === "create" ? "Creating…" : "Create class"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-card border border-border bg-depth-card shadow-card">
        <div className="p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="text-title font-medium text-foreground">
              Classes
              <span className="ml-2 text-body font-normal text-muted-foreground">
                {classes.length}
              </span>
            </h2>
            <p className="mt-1 text-body text-muted-foreground">
              Rosters, readiness, and lifecycle for every class in this organization.
              {readinessLoading ? " Checking readiness…" : ""}
            </p>
          </div>

          {classes.length === 0 ? (
            <EmptyState icon={GraduationCap}>
              No classes yet — create one above or seed a pilot roster.
            </EmptyState>
          ) : (
            <div className="grid gap-2">
              {classes.map((klass) => {
                const members = classMembers(scope, klass.id);
                const teacherCount = members.filter(
                  (member) => member.membership.role === "teacher",
                ).length;
                const studentCount = members.length - teacherCount;
                const classReadiness = readinessByClass.get(klass.id);
                const badge = classReadiness ? READINESS_BADGE[classReadiness.status] : null;
                const archived = klass.status === "archived";
                const expanded = expandedClassId === klass.id;
                const openPeople = people.filter(
                  (person) =>
                    person.orgMembership.status === "active" &&
                    !members.some((member) => member.membership.user_id === person.userId),
                );
                return (
                  <div
                    key={klass.id}
                    className={`rounded-card border border-border bg-depth-field ${archived ? "opacity-70" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-body text-foreground">
                          <span className="truncate font-medium">{klass.name}</span>
                          {archived ? (
                            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-overline text-muted-foreground">
                              Archived
                            </span>
                          ) : null}
                          {badge ? (
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-overline ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-meta text-muted-foreground">
                          {teacherCount} {teacherCount === 1 ? "teacher" : "teachers"} ·{" "}
                          {studentCount} {studentCount === 1 ? "student" : "students"}
                          {klass.class_code ? ` · code ${klass.class_code}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void exportSnapshot(klass.id)}
                        disabled={Boolean(busy)}
                        className="btn btn-secondary btn-sm shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
                        {busy === "export" ? "Exporting…" : "Export CSV"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(klass.id, klass.name)}
                        className="btn btn-secondary btn-sm shrink-0"
                      >
                        {expanded ? "Close" : "Manage"}
                      </button>
                    </div>

                    {expanded ? (
                      <div className="space-y-4 border-t border-border/60 px-3 py-3">
                        {classReadiness?.issues.length ? (
                          <ul className="space-y-1">
                            {classReadiness.issues.map((issue) => (
                              <li key={issue.message} className="text-meta text-muted-foreground">
                                · {issue.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            aria-label="Class name"
                            className="jargon-input !w-[240px]"
                          />
                          <button
                            type="button"
                            onClick={() => renameClass(klass.id)}
                            disabled={
                              Boolean(busy) ||
                              !renameValue.trim() ||
                              renameValue.trim() === klass.name
                            }
                            className="btn btn-secondary btn-sm"
                          >
                            {busy === "rename" ? "Saving…" : "Rename"}
                          </button>
                          {archived ? (
                            <button
                              type="button"
                              onClick={() => setClassStatus(klass.id, "active")}
                              disabled={Boolean(busy)}
                              className="btn btn-secondary btn-sm"
                            >
                              {busy === "status" ? "Restoring…" : "Restore"}
                            </button>
                          ) : (
                            <ConfirmButton
                              label="Archive class"
                              confirmLabel="Confirm archive"
                              disabled={Boolean(busy)}
                              onConfirm={() => setClassStatus(klass.id, "archived")}
                            />
                          )}
                        </div>

                        <div>
                          <div className="text-overline font-medium uppercase tracking-[0.09em] text-muted-foreground">
                            Roster
                          </div>
                          <div className="mt-1.5 grid gap-1.5">
                            {members.map((member) => (
                              <div
                                key={member.membership.id}
                                className="flex flex-wrap items-center gap-2 rounded-card border border-border/70 bg-depth-sub px-3 py-1.5"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="text-body text-foreground">
                                    {member.name || member.email || "Unnamed account"}
                                  </span>
                                  <span className="ml-2 text-meta text-muted-foreground">
                                    {member.email}
                                  </span>
                                </div>
                                <span className="shrink-0 text-overline uppercase tracking-[0.08em] text-muted-foreground">
                                  {member.membership.role}
                                </span>
                                <span className="w-[86px] shrink-0 text-right text-meta text-muted-foreground">
                                  {timeAgo(member.lastSignInAt)}
                                </span>
                                <ConfirmButton
                                  label="Remove"
                                  confirmLabel="Confirm"
                                  disabled={Boolean(busy)}
                                  onConfirm={() => removeMember(member.membership.id)}
                                />
                              </div>
                            ))}
                            {members.length === 0 ? (
                              <p className="text-meta text-muted-foreground">
                                Nobody in this class yet.
                              </p>
                            ) : null}
                          </div>
                          {openPeople.length ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <select
                                value={addUserId}
                                onChange={(event) => setAddUserId(event.target.value)}
                                aria-label="Add member"
                                className="jargon-input !w-[240px]"
                              >
                                <option value="">Add someone from this org…</option>
                                {openPeople.map((person) => (
                                  <option key={person.userId} value={person.userId}>
                                    {person.name || person.email}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={addRole}
                                onChange={(event) =>
                                  setAddRole(event.target.value as "student" | "teacher")
                                }
                                aria-label="Class role for the new member"
                                className="jargon-input !w-[110px]"
                              >
                                <option value="student">student</option>
                                <option value="teacher">teacher</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => addMember(klass.id)}
                                disabled={Boolean(busy) || !addUserId}
                                className="btn btn-secondary btn-sm"
                              >
                                <UserPlus className="h-3.5 w-3.5" strokeWidth={1.7} />
                                {busy === "member-add" ? "Adding…" : "Add"}
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
    </div>
  );
}
