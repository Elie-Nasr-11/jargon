/**
 * School · Setup — the ordered, stateful checklist.
 *
 * Rebuild brief, step 7. An admin's first job is getting a pilot ready, and the
 * server has always known exactly how far along each class is: admin-ops'
 * list_pilot_readiness returns a six-item checklist per class — active teacher,
 * active students, published lessons, work prepared, recent completion, no open
 * alerts — plus the issues blocking it. Nothing rendered any of it. R51's Overview
 * showed the STATUS chip and threw the reasons away, which is why an admin could
 * see "Needs setup" and still not know what to do.
 *
 * So this screen is the checklist, not a dashboard. Classes are ordered by how
 * stuck they are, each row says what is missing in the words the server used, and
 * every missing item names the screen that fixes it. A pilot is ready when this
 * list is empty of red.
 */
import { useMemo } from "react";
import { Check, CircleAlert, CircleDashed, RefreshCw } from "lucide-react";
import type {
  AdminScope,
  ClassReadiness,
  PilotReadiness,
  ReadinessChecklistItem,
  ReadinessStatus,
} from "@/lib/types";
import { buildPeople, orgClasses } from "./adminData";

// Worst first: an admin works down this list, and a blocked class is the one
// costing a teacher their morning.
const STATUS_ORDER: Record<ReadinessStatus, number> = {
  blocked: 0,
  needs_setup: 1,
  needs_attention: 2,
  ready: 3,
};

const STATUS_TONE: Record<ReadinessStatus, string> = {
  ready: "border-success/40 text-success",
  needs_setup: "border-info/40 text-info",
  needs_attention: "border-warning/40 text-warning",
  blocked: "border-danger/40 text-danger",
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ready: "Ready",
  needs_setup: "Needs setup",
  needs_attention: "Needs attention",
  blocked: "Blocked",
};

// What to DO about each missing item. The checklist labels come from the server;
// this maps them to the one screen that fixes them, so a row is never a dead end.
const FIX_FOR: Record<string, string> = {
  "Active teacher": "Add a teacher in People, then assign them to this class.",
  "Active students": "Add students in People, or import a roster.",
  "Published lessons": "The class's teacher builds and publishes lessons in their Course screen.",
  "Work/resources prepared": "The teacher sets an assignment or quiz on a lesson.",
  "Recent completion": "Nobody has finished a lesson lately — check Health for stuck sessions.",
  "No open alerts/errors": "See Health for the errors and alerts on this class.",
};

function ChecklistRow({ item }: { item: ReadinessChecklistItem }) {
  const Icon =
    item.status === "ok" ? Check : item.status === "missing" ? CircleDashed : CircleAlert;
  const tone =
    item.status === "ok"
      ? "text-success"
      : item.status === "missing"
        ? "text-muted-foreground"
        : "text-warning";
  return (
    <li className="flex items-start gap-2 py-1">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} strokeWidth={2} />
      <span className="min-w-0">
        <span
          className={`text-meta ${item.status === "ok" ? "text-muted-foreground" : "text-foreground"}`}
        >
          {item.label}
        </span>
        {item.status !== "ok" && FIX_FOR[item.label] ? (
          <span className="ml-1.5 text-meta text-muted-foreground">— {FIX_FOR[item.label]}</span>
        ) : null}
      </span>
    </li>
  );
}

function ClassCard({ item }: { item: ClassReadiness }) {
  const done = item.checklist.filter((entry) => entry.status === "ok").length;
  return (
    <div className="rounded-card border border-border bg-depth-sub p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-body font-medium text-foreground">{item.class_name}</div>
          {/* The brief's own example line, verbatim in shape:
              "Biology 10: 24 students · no teacher · 0 published lessons." */}
          <div className="mt-0.5 text-meta text-muted-foreground">
            {item.student_count} student{item.student_count === 1 ? "" : "s"} ·{" "}
            {item.teacher_count ? `${item.teacher_count} teacher` : "no teacher"}
            {item.teacher_count > 1 ? "s" : ""} · {item.published_lesson_count} published lesson
            {item.published_lesson_count === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.checklist.length ? (
            <span className="text-meta text-muted-foreground">
              {done}/{item.checklist.length}
            </span>
          ) : null}
          <span
            className={`rounded-full border px-2.5 py-0.5 text-meta ${STATUS_TONE[item.status]}`}
          >
            {STATUS_LABEL[item.status]}
          </span>
        </div>
      </div>
      {/* An older admin-ops, or a class the checker could not read, sends no
          checklist. Say so rather than drawing an empty bordered strip under a 0/0. */}
      {item.checklist.length ? (
        <ul className="mt-2.5 border-t border-border/60 pt-2">
          {item.checklist.map((entry) => (
            <ChecklistRow key={entry.label} item={entry} />
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 border-t border-border/60 pt-2 text-meta text-muted-foreground">
          No checklist came back for this class — press Recheck.
        </p>
      )}
    </div>
  );
}

export function SetupPanel({
  scope,
  organizationId,
  readiness,
  readinessLoading,
  onRefreshReadiness,
  developerCorner,
}: {
  scope: AdminScope;
  organizationId: string;
  readiness: PilotReadiness | null;
  readinessLoading: boolean;
  onRefreshReadiness: () => void;
  // The fenced developer corner (demo logins). Passed in rather than imported so
  // this screen stays about readiness and the fence stays one obvious place.
  developerCorner?: React.ReactNode;
}) {
  const people = useMemo(() => buildPeople(scope, organizationId), [scope, organizationId]);
  const classes = useMemo(() => orgClasses(scope, organizationId), [scope, organizationId]);
  const rows = useMemo(() => {
    const list = (readiness?.classes || []).filter(
      (item) => item.organization_id === organizationId,
    );
    return [...list].sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.class_name.localeCompare(b.class_name),
    );
  }, [readiness, organizationId]);

  const active = people.filter((person) => person.orgMembership.status === "active");
  const teachers = active.filter((person) => person.orgMembership.role !== "student").length;
  const students = active.filter((person) => person.orgMembership.role === "student").length;
  const notReady = rows.filter((item) => item.status !== "ready").length;
  // Carried over from R51's Overview when it dissolved into this screen: accounts
  // that exist and have never been used are a setup problem, not a statistic.
  const neverSignedIn = active.filter((person) => !person.lastSignInAt).length;

  return (
    <div className="grid gap-4">
      <section className="rounded-card border border-border bg-depth-card p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-title font-medium text-foreground">Pilot setup</h2>
            <p className="mt-1 max-w-2xl text-meta leading-relaxed text-muted-foreground">
              {rows.length === 0
                ? "No classes yet. Create one in Classes, then add its teacher and students in People."
                : notReady === 0
                  ? `All ${rows.length} class${rows.length === 1 ? "" : "es"} are ready to teach.`
                  : `${notReady} of ${rows.length} class${rows.length === 1 ? "" : "es"} still need something. Worst first.`}
            </p>
            <p className="mt-2 text-meta text-muted-foreground">
              {classes.length} class{classes.length === 1 ? "" : "es"} · {teachers} teacher
              {teachers === 1 ? "" : "s"} · {students} student{students === 1 ? "" : "s"}
              {neverSignedIn ? ` · ${neverSignedIn} never signed in` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshReadiness}
            disabled={readinessLoading}
            className="btn btn-secondary btn-sm shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${readinessLoading ? "animate-spin" : ""}`}
              strokeWidth={1.7}
            />
            {readinessLoading ? "Checking…" : "Recheck"}
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          {readiness === null ? (
            <p className="text-meta text-muted-foreground">
              {readinessLoading ? "Checking readiness…" : "Readiness has not loaded yet."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-meta text-muted-foreground">
              Nothing to check yet — this organization has no classes.
            </p>
          ) : (
            rows.map((item) => <ClassCard key={item.class_id} item={item} />)
          )}
        </div>
      </section>

      {developerCorner}
    </div>
  );
}
