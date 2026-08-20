import { useMemo } from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { ActiveSession, AdminScope, PilotReadiness, ReadinessStatus } from "@/lib/types";
import { auditEventLabel, buildPeople, orgAuditEvents, orgClasses, timeAgo } from "./adminData";

const READINESS_TONE: Record<ReadinessStatus, string> = {
  ready: "border-success/40 text-success",
  needs_setup: "border-info/40 text-info",
  needs_attention: "border-warning/40 text-warning",
  blocked: "border-danger/40 text-danger",
};

const READINESS_LABEL: Record<ReadinessStatus, string> = {
  ready: "Ready",
  needs_setup: "Needs setup",
  needs_attention: "Needs attention",
  blocked: "Blocked",
};

// R51 Overview tab: the landing view for an organization — headline counts,
// pilot readiness per class, and the recent admin activity trail. Pure
// derivation over data the portal already loads (scope + live fleet +
// list_pilot_readiness).
export function OverviewPanel({
  scope,
  organizationId,
  activeSessions,
  readiness,
  readinessLoading,
  onRefreshReadiness,
}: {
  scope: AdminScope;
  organizationId: string;
  activeSessions: ActiveSession[] | null;
  readiness: PilotReadiness | null;
  readinessLoading: boolean;
  onRefreshReadiness: () => void;
}) {
  const people = useMemo(() => buildPeople(scope, organizationId), [scope, organizationId]);
  const classes = useMemo(() => orgClasses(scope, organizationId), [scope, organizationId]);
  const events = useMemo(
    () => orgAuditEvents(scope, organizationId).slice(0, 8),
    [scope, organizationId],
  );
  const readinessClasses = useMemo(
    () => (readiness?.classes || []).filter((item) => item.organization_id === organizationId),
    [readiness, organizationId],
  );

  const activePeople = people.filter((person) => person.orgMembership.status === "active");
  const studentCount = activePeople.filter(
    (person) => person.orgMembership.role === "student",
  ).length;
  const teacherCount = activePeople.filter(
    (person) => person.orgMembership.role !== "student",
  ).length;
  const neverSignedIn = activePeople.filter((person) => !person.lastSignInAt).length;
  const activeClassCount = classes.filter((item) => item.status === "active").length;

  const nameByUserId = useMemo(
    () => new Map(people.map((person) => [person.userId, person.name || person.email])),
    [people],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <OverviewStat label="Classes" value={String(activeClassCount)} />
        <OverviewStat label="Teachers & admins" value={String(teacherCount)} />
        <OverviewStat label="Students" value={String(studentCount)} />
        <OverviewStat
          label="Live now"
          value={activeSessions === null ? "—" : String(activeSessions.length)}
        />
        <OverviewStat label="Never signed in" value={String(neverSignedIn)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-card border border-border bg-depth-card shadow-card">
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-title font-medium text-foreground">Pilot readiness</h2>
                <p className="mt-1 text-body text-muted-foreground">
                  Whether each class has what it needs to run.
                </p>
              </div>
              <button
                type="button"
                onClick={onRefreshReadiness}
                disabled={readinessLoading}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-meta text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${readinessLoading ? "animate-spin" : ""}`}
                  strokeWidth={1.7}
                />
                Refresh
              </button>
            </div>
            {readiness === null ? (
              <p className="text-body text-muted-foreground">
                {readinessLoading ? "Checking readiness…" : "Readiness has not loaded yet."}
              </p>
            ) : readinessClasses.length === 0 ? (
              <p className="text-body text-muted-foreground">No classes to check yet.</p>
            ) : (
              <div className="grid gap-1.5">
                {readinessClasses.map((item) => (
                  <div
                    key={item.class_id}
                    className="flex flex-wrap items-center gap-2 rounded-card border border-border/70 bg-depth-field px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {item.class_name}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-overline ${READINESS_TONE[item.status]}`}
                    >
                      {READINESS_LABEL[item.status]}
                    </span>
                    {item.issues[0] ? (
                      <span className="w-full text-meta text-muted-foreground">
                        {item.issues[0].message}
                        {item.issues.length > 1 ? ` (+${item.issues.length - 1} more)` : ""}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-card border border-border bg-depth-card shadow-card">
          <div className="p-4 sm:p-5">
            <div className="mb-3">
              <h2 className="text-title font-medium text-foreground">Recent activity</h2>
              <p className="mt-1 text-body text-muted-foreground">
                The latest admin actions in this organization.
              </p>
            </div>
            {events.length === 0 ? (
              <div className="flex items-center gap-2 text-body text-muted-foreground">
                <Activity className="h-4 w-4" strokeWidth={1.6} />
                No admin activity recorded yet.
              </div>
            ) : (
              <div className="grid gap-1.5">
                {events.map((event) => {
                  const subjectId =
                    typeof event.payload?.user_id === "string" ? event.payload.user_id : "";
                  const subject = subjectId ? nameByUserId.get(subjectId) : "";
                  return (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center gap-2 rounded-card border border-border/70 bg-depth-field px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-body text-foreground">
                        {auditEventLabel(event)}
                        {subject ? (
                          <span className="text-muted-foreground"> · {subject}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-meta text-muted-foreground">
                        {timeAgo(event.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border/75 bg-depth-sub p-4">
      <div className="text-overline uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-[22px] font-semibold tabular-nums leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}
