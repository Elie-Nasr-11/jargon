/**
 * The school (admin) window — people, classes, health.
 *
 * R82 moved it out of routes/admin.tsx so /admin and /platform can load it on
 * demand: it is a portal most sessions never open, and it was riding in the
 * bundle every teacher and student downloaded before anything rendered.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  DollarSign,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Tabs, WorkspaceTab, WorkspaceTabList, WorkspacePanel } from "@/components/WorkspaceTabs";
import { Breadcrumb } from "@/components/Breadcrumb";
import { notifyOk, notifyErr } from "@/lib/feedback";
import { RouteLoader } from "@/components/RouteLoader";
import {
  fetchAdminScope,
  fetchTeacherClasses,
  roleHomeNav,
  fetchCostModelDashboard,
  fetchActiveSessions,
  fetchPilotReadiness,
  getSession,
  invokeAdminSeed,
  seedDemoLogins,
} from "@/lib/api";
import type {
  AdminActorAccess,
  AdminScope,
  AdminScopeResult,
  AdminSeedResult,
  AdminSeedUser,
  CostModelDashboard,
  CostModelMetric,
  ActiveSession,
  PilotReadiness,
  PilotRole,
} from "@/lib/types";
import { OverviewPanel } from "@/features/admin/OverviewPanel";
import { PeoplePanel } from "@/features/admin/PeoplePanel";
import { ClassesPanel } from "@/features/admin/ClassesPanel";

// Org + active tab live in the URL (?org=&tab=) so context is set once and is
// deep-linkable. Unknown params are preserved. Shared by the /admin (org admin)
// and /platform (platform admin) portals.

type RosterRow = AdminSeedUser & { rowId: string };

const MIN_TEMP_PASSWORD_LENGTH = 6;

const blankRow = (): RosterRow => ({
  rowId: Math.random().toString(36).slice(2),
  email: "",
  name: "",
  role: "student",
  grade: "",
  password: "",
});

// Placeholder scope for the frame between authorization and the first scope load —
// the R51 panels render their empty states against it instead of null-guarding.
const emptyScope: AdminScope = {
  organizations: [],
  classes: [],
  organization_memberships: [],
  class_memberships: [],
  profiles: [],
  users: [],
  seed_batches: [],
  audit_events: [],
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeRole(value: string): PilotRole {
  return value.trim().toLowerCase() === "teacher" ? "teacher" : "student";
}

function splitLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((part) => part.trim());
  return line.split(",").map((part) => part.trim());
}

function parseRosterPaste(value: string): RosterRow[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const first = splitLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = first.some((cell) =>
    ["email", "name", "role", "grade", "password"].includes(cell),
  );
  const header = hasHeader ? first : ["email", "name", "role", "grade", "password"];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cells = splitLine(line);
    const record: Record<string, string> = {};
    header.forEach((field, index) => {
      record[field] = cells[index] || "";
    });
    return {
      rowId: Math.random().toString(36).slice(2),
      email: (record.email || "").toLowerCase(),
      name: record.name || "",
      role: normalizeRole(record.role || "student"),
      grade: record.grade || "",
      password: record.password || "",
    };
  });
}

function resultTone(status: AdminSeedResult["status"]) {
  if (status === "created") return "text-success";
  if (status === "reused" || status === "skipped") return "text-info";
  return "text-danger";
}

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value || 0);
}

function formatCompactNumber(value: number | null | undefined) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return "Hidden";
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatMs(value: number | null | undefined) {
  if (!value) return "n/a";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function AdminPage() {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");
  const [orgName, setOrgName] = useState("Pilot School");
  const [orgSlug, setOrgSlug] = useState("pilot-school");
  const [className, setClassName] = useState("Jargon Pilot Class");
  const [defaultPassword, setDefaultPassword] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<RosterRow[]>([blankRow()]);
  const [results, setResults] = useState<AdminSeedResult[]>([]);
  const [batchId, setBatchId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actorAccess, setActorAccess] = useState<AdminActorAccess | null>(null);
  const [scope, setScope] = useState<AdminScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const search = useSearch({ strict: false }) as {
    org?: string;
    tab?: string;
    view?: string;
  };
  const isPlatformAdmin = actorAccess?.level === "platform_admin";
  // Platform admins and org admins now have separate portals (/platform vs /admin).
  // The portal a user belongs to is fixed by their level — no in-page toggle — so
  // every level-gated surface keys off `isPlatformLevel` = the platform admin.
  const isPlatformLevel = isPlatformAdmin;
  const adminLevelLabel = isPlatformLevel ? "Platform admin" : "Organization admin";
  // The admin's own portal route — all in-portal navigation targets this so the
  // platform/org portals stay separate. The current path drives the access guard.
  const adminHome: "/admin" | "/platform" = isPlatformAdmin ? "/platform" : "/admin";
  const onPlatformRoute = useLocation({ select: (loc) => loc.pathname.startsWith("/platform") });
  const selectedOrgId = search.org ?? "";
  const [activeSessions, setActiveSessions] = useState<ActiveSession[] | null>(null);
  const [activeSessionsLoading, setActiveSessionsLoading] = useState(false);
  const [activeSessionsError, setActiveSessionsError] = useState("");
  const [costDashboard, setCostDashboard] = useState<CostModelDashboard | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costMessage, setCostMessage] = useState("");
  const [demoPassword, setDemoPassword] = useState("JargonDemo123!");
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoResult, setDemoResult] = useState<{
    password: string;
    accounts: Array<{ email: string; role: string }>;
  } | null>(null);
  const [demoMessage, setDemoMessage] = useState("");
  // R51: pilot readiness backs the Overview + Classes panels; loaded lazily the
  // first time either tab opens, refreshed on demand.
  const [readiness, setReadiness] = useState<PilotReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const session = await getSession();
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const allowed = await refreshScope(session.access_token);
        if (!alive) return;
        if (!allowed) {
          // Not an admin → send them to their own portal instead of showing a
          // dead "admins only" page.
          const classes = await fetchTeacherClasses(session.user.id).catch(() => [] as unknown[]);
          const role = Array.isArray(classes) && classes.length > 0 ? "teacher" : "student";
          navigate({ ...roleHomeNav(role), replace: true });
          return;
        }
        void refreshCostDashboard(session.access_token, true);
        setEmail(session.user.email || "");
        setUserId(session.user.id);
        setToken(session.access_token);
        setAuthorized(true);
        setMessage("");
      } catch (error) {
        if (!alive) return;
        setMessage((error as Error).message || "Could not load admin access.");
      } finally {
        if (alive) setBooting(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
    // The initial admin scope load should run only with the first authenticated session.
    // Later updates are explicit via Refresh ops or operation responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // Keep each admin on their own portal: platform admins on /platform, org admins
  // on /admin.
  useEffect(() => {
    if (!actorAccess) return;
    if (actorAccess.level === "platform_admin" && !onPlatformRoute) {
      navigate({ to: "/platform", replace: true });
    } else if (actorAccess.level === "org_admin" && onPlatformRoute) {
      navigate({ to: "/admin", replace: true });
    }
  }, [actorAccess, onPlatformRoute, navigate]);

  const refreshScope = async (accessToken = token) => {
    if (!accessToken) return false;
    setScopeLoading(true);
    try {
      const data = await fetchAdminScope(accessToken);
      setActorAccess(data.actorAccess);
      setScope(data.scope);
      return true;
    } catch (error) {
      notifyErr(error, "Could not load admin scope.");
      return false;
    } finally {
      setScopeLoading(false);
    }
  };

  const refreshActiveSessions = async (accessToken = token) => {
    if (!accessToken) return;
    setActiveSessionsLoading(true);
    setActiveSessionsError("");
    try {
      setActiveSessions(await fetchActiveSessions(accessToken));
    } catch (error) {
      // Keep a failed load distinct from a genuinely-empty fleet.
      setActiveSessionsError((error as Error).message || "Could not load live sessions.");
    } finally {
      setActiveSessionsLoading(false);
    }
  };

  const refreshCostDashboard = async (accessToken = token, silent = false) => {
    if (!accessToken) return false;
    setCostLoading(true);
    if (!silent) setCostMessage("");
    try {
      const data = await fetchCostModelDashboard(accessToken);
      setActorAccess(data.actorAccess);
      setScope(data.scope);
      setCostDashboard(data.dashboard);
      if (!silent) setCostMessage("AI/runtime dashboard refreshed.");
      return true;
    } catch (error) {
      setCostMessage((error as Error).message || "Could not load AI/runtime dashboard.");
      return false;
    } finally {
      setCostLoading(false);
    }
  };

  const refreshReadiness = async (accessToken = token) => {
    if (!accessToken || readinessLoading) return;
    setReadinessLoading(true);
    try {
      const data = await fetchPilotReadiness(accessToken);
      setActorAccess(data.actorAccess);
      setScope(data.scope);
      setReadiness(data.readiness);
    } catch (error) {
      notifyErr(error, "Could not load pilot readiness.");
    } finally {
      setReadinessLoading(false);
    }
  };

  // Every admin-ops mutation answers with the refreshed scope — apply it directly
  // instead of a second list_admin_scope round-trip.
  const applyScopeResult = (result: AdminScopeResult) => {
    setActorAccess(result.actorAccess);
    setScope(result.scope);
  };

  const validRows = useMemo(
    () =>
      rows
        .map((row) => ({
          rowId: row.rowId,
          email: row.email.trim().toLowerCase(),
          name: row.name.trim(),
          role: row.role,
          grade: row.grade?.trim() || "",
          password: row.password?.trim() || "",
        }))
        .filter((row) => row.email || row.name),
    [rows],
  );

  const defaultPasswordValue = defaultPassword.trim();
  const hasDefaultPassword = defaultPasswordValue.length >= MIN_TEMP_PASSWORD_LENGTH;
  const hasShortDefaultPassword =
    defaultPasswordValue.length > 0 && defaultPasswordValue.length < MIN_TEMP_PASSWORD_LENGTH;

  const emailErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    validRows.forEach((row) => {
      if (!row.email) errors[row.rowId] = "Email required.";
      else if (!row.email.includes("@")) errors[row.rowId] = "Use a valid email.";
    });
    return errors;
  }, [validRows]);

  const nameErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    validRows.forEach((row) => {
      if (!row.name) errors[row.rowId] = "Name required.";
    });
    return errors;
  }, [validRows]);

  const passwordErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    validRows.forEach((row) => {
      if (row.password && row.password.length < MIN_TEMP_PASSWORD_LENGTH) {
        errors[row.rowId] = "Use 6+ characters.";
      } else if (!row.password && !hasDefaultPassword) {
        errors[row.rowId] = "Set a default or add an override.";
      }
    });
    return errors;
  }, [hasDefaultPassword, validRows]);

  const formErrors = useMemo(() => {
    const errors: string[] = [];
    const platform = actorAccess?.level === "platform_admin" && search.view !== "organization";
    if (platform && !orgName.trim()) errors.push("Organization name is required.");
    if (!platform && !selectedOrgId) errors.push("Select your organization first.");
    if (!className.trim()) errors.push("Class name is required.");
    if (!validRows.length) errors.push("Add at least one teacher or student.");
    if (hasShortDefaultPassword) {
      errors.push(
        `Default temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`,
      );
    }
    if (Object.keys(emailErrors).length || Object.keys(nameErrors).length) {
      errors.push("Every roster row needs a valid email and name.");
    }
    if (Object.keys(passwordErrors).length) {
      errors.push("Every roster row needs a temporary password of at least 6 characters.");
    }
    return errors;
  }, [
    actorAccess,
    search.view,
    className,
    emailErrors,
    hasShortDefaultPassword,
    nameErrors,
    orgName,
    passwordErrors,
    selectedOrgId,
    validRows.length,
  ]);

  const canSeed = !submitting && formErrors.length === 0;
  // R51 tab set: Overview / People / Classes (management over admin-ops) plus the
  // original Seeding, Live, and (platform-admin only) Cost & runtime. Unknown or
  // no-longer-visible ?tab= values (including stale deep links to removed tabs)
  // fall back to Overview, which every admin level can see.
  const visibleTabs = isPlatformLevel
    ? ["overview", "people", "classes", "seeding", "live", "cost"]
    : ["overview", "people", "classes", "seeding", "live"];
  const adminTab = search.tab && visibleTabs.includes(search.tab) ? search.tab : "overview";
  const setAdminTab = (tab: string) =>
    navigate({ to: adminHome, search: (prev: Record<string, unknown>) => ({ ...prev, tab }) });

  // Keep the Live fleet current while its tab is open: load on first open, then poll every 30s
  // (foreground only) so the session list + the "Xm ago" labels stay live. The panel keeps its
  // manual Refresh too. R51: Overview shows the same fleet count, so it shares the loop.
  useEffect(() => {
    if ((adminTab !== "live" && adminTab !== "overview") || !token) return;
    if (activeSessions === null && !activeSessionsLoading) {
      void refreshActiveSessions(token);
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshActiveSessions(token);
    }, 30 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, token]);

  // R51: readiness lazy-loads the first time Overview or Classes opens.
  useEffect(() => {
    if (adminTab !== "overview" && adminTab !== "classes") return;
    if (!token || readiness !== null || readinessLoading) return;
    void refreshReadiness(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, token, readiness, readinessLoading]);

  const liveAgo = (iso: string): string => {
    const diff = Date.now() - Date.parse(iso);
    if (!Number.isFinite(diff)) return "";
    const m = Math.round(diff / 60_000);
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
  };

  const selectedOrg = useMemo(
    () => scope?.organizations.find((organization) => organization.id === selectedOrgId) || null,
    [scope, selectedOrgId],
  );
  const costVisible = costDashboard?.visibility === "full_cost";

  const createDemoLogins = async () => {
    if (!token) return;
    if (demoPassword.trim().length < MIN_TEMP_PASSWORD_LENGTH) {
      setDemoMessage(`Use a password of at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`);
      return;
    }
    setDemoBusy(true);
    setDemoMessage("");
    try {
      const result = await seedDemoLogins(token, demoPassword.trim());
      setDemoResult({
        password: result.password,
        accounts: result.accounts.map((account) => ({
          email: account.email,
          role: account.role,
        })),
      });
      setDemoMessage("Demo logins ready.");
      notifyOk("Demo logins created.");
    } catch (error) {
      setDemoMessage((error as Error).message || "Could not create demo logins.");
      notifyErr(error, "Could not create demo logins.");
    } finally {
      setDemoBusy(false);
    }
  };

  const updateRow = (rowId: string, patch: Partial<RosterRow>) => {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId: string) => {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.rowId !== rowId) : current,
    );
  };

  const applyPaste = () => {
    const parsed = parseRosterPaste(pasteText);
    if (!parsed.length) {
      setMessage("Paste at least one roster row first.");
      return;
    }
    setRows(parsed);
    setMessage(`Loaded ${parsed.length} roster ${parsed.length === 1 ? "row" : "rows"}.`);
  };

  const seedRoster = async () => {
    if (submitting || !token) return;
    if (formErrors.length) {
      setMessage(formErrors[0]);
      return;
    }
    setSubmitting(true);
    setMessage("");
    setResults([]);
    setBatchId("");

    try {
      if (isPlatformLevel && !orgName.trim()) throw new Error("Organization name is required.");
      if (!isPlatformLevel && !selectedOrgId) throw new Error("Select your organization first.");
      if (!className.trim()) throw new Error("Class name is required.");
      if (!validRows.length) throw new Error("Add at least one teacher or student.");

      // Org admins seed into their existing org (id); the backend ignores name/slug
      // for them and forbids new-org creation. Platform admins can create an org.
      const organization = isPlatformLevel
        ? { name: orgName.trim(), slug: slugify(orgSlug || orgName) }
        : {
            id: selectedOrgId,
            name: selectedOrg?.name || "",
            slug: selectedOrg?.slug || slugify(selectedOrg?.name || selectedOrgId),
          };

      const response = await invokeAdminSeed({
        accessToken: token,
        organization,
        class: { name: className.trim() },
        defaultPassword: defaultPassword.trim(),
        users: validRows.map(({ rowId: _rowId, ...row }) => row),
      });
      setResults(response.results);
      setBatchId(response.batch_id || "");
      setMessage(
        response.results.some((result) => result.status === "failed")
          ? "Pilot roster seed finished with errors."
          : "Pilot roster seed finished.",
      );
      void refreshScope();
    } catch (error) {
      setMessage((error as Error).message || "Could not seed the pilot roster.");
    } finally {
      setSubmitting(false);
    }
  };

  // While the role check runs (or for a non-admin who will be redirected by the
  // bootstrap guard), show a neutral loader — never the admin chrome.
  // An admin who landed on the wrong portal route is being redirected by the guard
  // effect above — hold the loader so the other admin portal never flashes.
  const routeMismatch =
    Boolean(actorAccess) &&
    ((isPlatformAdmin && !onPlatformRoute) ||
      (actorAccess?.level === "org_admin" && onPlatformRoute));
  if (booting || !authorized || routeMismatch) {
    return <RouteLoader label={message || "Loading…"} />;
  }

  return (
    <AdminShell email={email} home={adminHome}>
      <main className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-5 py-8">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {adminLevelLabel}
            </div>
            <h1 className="font-serif mt-2 text-display text-foreground">
              Manage pilot classrooms.
            </h1>
            <p className="mt-2 max-w-2xl text-body leading-relaxed text-muted-foreground">
              {isPlatformLevel
                ? "Manage people and classes, seed pilot rosters, watch live sessions, and track AI/runtime cost across the pilot."
                : "Manage people and classes, seed rosters, and watch live sessions inside your organization."}{" "}
              Passwords are sent only to Supabase Auth and are not stored in Jargon tables.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshScope()}
              disabled={scopeLoading}
              className="btn btn-secondary"
            >
              <RefreshCw
                className={`h-4 w-4 ${scopeLoading ? "animate-spin" : ""}`}
                strokeWidth={1.6}
              />
              Refresh ops
            </button>
          </div>
        </section>

        {!selectedOrgId ? (
          <section className="rounded-card border border-border bg-depth-card shadow-card">
            <div className="p-5">
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {isPlatformLevel ? "Organizations" : "Your organizations"}
              </div>
              <p className="mt-1 text-meta text-muted-foreground">
                {isPlatformLevel
                  ? "Pick an organization to manage its people, classes, seeding, live sessions, and cost."
                  : "Pick an organization to manage its people, classes, and live sessions."}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(scope?.organizations || []).map((organization) => {
                  const orgClassCount = (scope?.classes || []).filter(
                    (item) => item.organization_id === organization.id,
                  ).length;
                  return (
                    <button
                      key={organization.id}
                      type="button"
                      onClick={() =>
                        navigate({
                          to: adminHome,
                          search: (prev: Record<string, unknown>) => ({
                            ...prev,
                            org: organization.id,
                          }),
                        })
                      }
                      className="rounded-card border border-border bg-depth-sub p-3.5 text-left transition-colors hover:bg-muted"
                    >
                      <div className="text-body font-medium text-foreground">
                        {organization.name}
                      </div>
                      <div className="mt-0.5 text-meta text-muted-foreground">
                        {organization.status || "active"} · {orgClassCount} classes
                      </div>
                    </button>
                  );
                })}
                {(scope?.organizations || []).length === 0 ? (
                  <div className="text-body text-muted-foreground">
                    No organizations in scope yet.
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <>
            <Breadcrumb
              segments={[
                {
                  label: adminLevelLabel,
                  onClick: () => navigate({ to: adminHome, search: {} }),
                },
                { label: selectedOrg?.name || "Organization" },
              ]}
            />

            <Tabs value={adminTab} onValueChange={setAdminTab}>
              <WorkspaceTabList>
                <WorkspaceTab value="overview">Overview</WorkspaceTab>
                <WorkspaceTab value="people">People</WorkspaceTab>
                <WorkspaceTab value="classes">Classes</WorkspaceTab>
                <WorkspaceTab value="seeding">Seeding</WorkspaceTab>
                <WorkspaceTab value="live">Live</WorkspaceTab>
                {isPlatformLevel ? (
                  <WorkspaceTab value="cost">Cost &amp; runtime</WorkspaceTab>
                ) : null}
              </WorkspaceTabList>

              <WorkspacePanel value="overview">
                <OverviewPanel
                  scope={scope || emptyScope}
                  organizationId={selectedOrgId}
                  activeSessions={activeSessions}
                  readiness={readiness}
                  readinessLoading={readinessLoading}
                  onRefreshReadiness={() => void refreshReadiness()}
                />
              </WorkspacePanel>

              <WorkspacePanel value="people">
                <PeoplePanel
                  token={token}
                  scope={scope || emptyScope}
                  organizationId={selectedOrgId}
                  currentUserId={userId}
                  isPlatformAdmin={isPlatformAdmin}
                  onScope={applyScopeResult}
                />
              </WorkspacePanel>

              <WorkspacePanel value="classes">
                <ClassesPanel
                  token={token}
                  scope={scope || emptyScope}
                  organizationId={selectedOrgId}
                  readiness={readiness}
                  readinessLoading={readinessLoading}
                  onScope={applyScopeResult}
                />
              </WorkspacePanel>

              <WorkspacePanel value="live">
                <section className="rounded-card border border-border bg-depth-card shadow-card">
                  <div className="p-4 sm:p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-title font-medium text-foreground">
                          Live sessions
                          {activeSessions?.length ? (
                            <span className="ml-2 text-body font-normal text-muted-foreground">
                              {activeSessions.length}
                            </span>
                          ) : null}
                        </h2>
                        <p className="mt-1 text-body text-muted-foreground">
                          Students active in the last 30 minutes across your{" "}
                          {isPlatformLevel ? "platform" : "organization"}.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshActiveSessions()}
                        disabled={activeSessionsLoading}
                        className="btn btn-secondary btn-sm shrink-0"
                      >
                        {activeSessionsLoading ? "Refreshing…" : "Refresh"}
                      </button>
                    </div>
                    {activeSessionsError ? (
                      <p className="text-body text-danger">
                        {activeSessionsError}{" "}
                        <button
                          type="button"
                          onClick={() => void refreshActiveSessions()}
                          className="underline hover:no-underline"
                        >
                          Retry
                        </button>
                      </p>
                    ) : activeSessions === null ? (
                      <p className="text-body text-muted-foreground">Loading live sessions…</p>
                    ) : activeSessions.length === 0 ? (
                      <EmptyState icon={Activity}>
                        No students are in a live session right now.
                      </EmptyState>
                    ) : (
                      <div className="grid gap-2">
                        {activeSessions.map((s) => {
                          const struggling =
                            s.status === "needs_retry" || s.status === "needs_rescue";
                          return (
                            <div
                              key={s.session_id}
                              className="flex items-center gap-3 rounded-card border border-border bg-depth-field px-3 py-2.5"
                            >
                              <span className="relative flex h-2 w-2 shrink-0">
                                <span
                                  className={`absolute inline-flex h-full w-full animate-ping rounded-full ${struggling ? "bg-warning/60" : "bg-success/60"}`}
                                />
                                <span
                                  className={`relative inline-flex h-2 w-2 rounded-full ${struggling ? "bg-warning" : "bg-success"}`}
                                />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-body text-foreground">
                                  {s.student_name}
                                </div>
                                <div className="truncate text-meta text-muted-foreground">
                                  {s.lesson_title}
                                  {s.class_name ? ` · ${s.class_name}` : ""}
                                  {s.stage ? ` · ${s.stage}` : ""}
                                </div>
                              </div>
                              {struggling ? (
                                <span className="shrink-0 rounded-full border border-warning/40 px-2 py-0.5 text-overline text-warning">
                                  Needs attention
                                </span>
                              ) : null}
                              <span className="shrink-0 text-meta text-muted-foreground">
                                {liveAgo(s.updated_at)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              </WorkspacePanel>

              <WorkspacePanel value="cost">
                <section className="rounded-card border border-border bg-depth-card shadow-card">
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                          <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
                          AI/runtime operations
                        </div>
                        <h2 className="text-title font-medium text-foreground">
                          Usage, reliability, and model load
                        </h2>
                        <p className="mt-1 max-w-2xl text-meta leading-relaxed text-muted-foreground">
                          {costVisible
                            ? "Platform admins see estimated model cost, tokens, latency, and failure signals across the pilot."
                            : "Org admins see scoped usage and reliability. Dollar-cost totals stay platform-admin only."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshCostDashboard()}
                        disabled={costLoading}
                        className="btn btn-secondary"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${costLoading ? "animate-spin" : ""}`}
                          strokeWidth={1.6}
                        />
                        Refresh metrics
                      </button>
                    </div>

                    {costMessage ? (
                      <div className="rounded-card border border-border bg-depth-sub px-3 py-2 text-meta text-muted-foreground">
                        {costMessage}
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <MetricStat
                        icon={<DollarSign className="h-4 w-4" strokeWidth={1.6} />}
                        label="Estimated cost"
                        value={formatUsd(costDashboard?.totals.estimated_cost_usd)}
                      />
                      <MetricStat
                        icon={<BarChart3 className="h-4 w-4" strokeWidth={1.6} />}
                        label="Total tokens"
                        value={formatCompactNumber(costDashboard?.totals.total_tokens)}
                      />
                      <MetricStat
                        label="Model events"
                        value={formatNumber(costDashboard?.totals.model_event_count)}
                      />
                      <MetricStat
                        label="Avg latency"
                        value={formatMs(costDashboard?.totals.average_latency_ms)}
                      />
                      <MetricStat
                        label="Errors"
                        value={`${formatNumber(costDashboard?.totals.error_count)} · ${formatPercent(
                          costDashboard?.totals.error_rate,
                        )}`}
                      />
                    </div>

                    <div className="rounded-card border border-border/80 bg-depth-sub p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-body font-medium text-foreground">Runtime health</h3>
                          <p className="mt-1 text-meta text-muted-foreground">
                            Engine wakeups, retry recoveries, controlled code errors, and pilot
                            safety limits from recent runtime events.
                          </p>
                        </div>
                        <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                          Last event{" "}
                          {formatDate(costDashboard?.runtime_health?.last_runtime_event_at)}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <MetricStat
                          label="Run failures"
                          value={formatNumber(costDashboard?.runtime_health?.run_failures)}
                        />
                        <MetricStat
                          label="Wake timeouts"
                          value={formatNumber(costDashboard?.runtime_health?.engine_wake_timeouts)}
                        />
                        <MetricStat
                          label="Retry recoveries"
                          value={formatNumber(
                            costDashboard?.runtime_health?.engine_retry_successes,
                          )}
                        />
                        <MetricStat
                          label="Rate limits"
                          value={formatNumber(costDashboard?.runtime_health?.rate_limit_hits)}
                        />
                        <MetricStat
                          label="Controlled errors"
                          value={formatNumber(costDashboard?.runtime_health?.controlled_errors)}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <CostMetricTable
                        title="Model breakdown"
                        rows={costDashboard?.by_model || []}
                        showCost={costVisible}
                        empty="No model usage recorded yet."
                      />
                      <CostMetricTable
                        title="Task type breakdown"
                        rows={costDashboard?.by_task_type || []}
                        showCost={costVisible}
                        empty="No task usage recorded yet."
                      />
                    </div>

                    <CostMetricTable
                      title="Class operating load"
                      rows={costDashboard?.by_class || []}
                      showCost={costVisible}
                      empty="No class-scoped usage recorded yet."
                      wide
                    />

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-card border border-border/80 bg-depth-sub p-4">
                        <h3 className="text-body font-medium text-foreground">
                          Recent model events
                        </h3>
                        <div className="mt-3 space-y-2">
                          {(costDashboard?.recent_model_events || []).slice(0, 6).map((event) => (
                            <div
                              key={event.id}
                              className="border-b border-border/55 pb-2 text-meta"
                            >
                              <div className="text-foreground">
                                {event.model} · {event.task_type.replaceAll("_", " ")}
                              </div>
                              <div className="mt-0.5 text-muted-foreground">
                                {formatCompactNumber(
                                  event.input_tokens + event.output_tokens + event.cached_tokens,
                                )}{" "}
                                tokens · {formatMs(event.latency_ms)} ·{" "}
                                {formatUsd(event.estimated_cost_usd)}
                              </div>
                            </div>
                          ))}
                          {!costDashboard?.recent_model_events.length ? (
                            <div className="text-meta text-muted-foreground">
                              No model events recorded yet.
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-card border border-border/80 bg-depth-sub p-4">
                        <h3 className="text-body font-medium text-foreground">Runtime errors</h3>
                        <div className="mt-3 space-y-2">
                          {(costDashboard?.recent_runtime_errors || []).slice(0, 6).map((event) => (
                            <div
                              key={event.id}
                              className="border-b border-border/55 pb-2 text-meta"
                            >
                              <div className="text-foreground">
                                {event.event_type} · {event.lesson_id || "no lesson"}
                              </div>
                              <div className="mt-0.5 text-muted-foreground">
                                {event.session_id || "no session"} · {formatDate(event.created_at)}
                              </div>
                            </div>
                          ))}
                          {!costDashboard?.recent_runtime_errors.length ? (
                            <div className="text-meta text-muted-foreground">
                              No runtime errors in the current scope.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </WorkspacePanel>

              {/* R51: the Seeding panel now renders for BOTH admin levels — the tab was
                  always visible to org admins, but the panel body was platform-gated,
                  leaving org admins a blank tab. The seeding form itself has handled the
                  org-admin path (seed into your own org) since the pilot rounds. */}
              <WorkspacePanel value="seeding">
                <div className="space-y-5">
                  {isPlatformAdmin ? (
                    <div>
                      <section className="rounded-card border border-border bg-depth-card shadow-card">
                        <div className="space-y-4 p-5">
                          <div>
                            <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                              Demo entry
                            </div>
                            <h2 className="mt-1 text-title font-medium text-foreground">
                              Create demo logins
                            </h2>
                            <p className="mt-1 max-w-2xl text-meta leading-relaxed text-muted-foreground">
                              One click creates (or resets) three test accounts in a "Demo Org" so
                              you can sign in as each role — student, teacher, and org admin. Your
                              own account is the platform admin. All three share the password below.
                            </p>
                          </div>
                          {demoMessage ? (
                            <div className="rounded-card border border-border bg-depth-sub px-3 py-2 text-meta text-muted-foreground">
                              {demoMessage}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[220px]">
                              <Field label="Demo password">
                                <input
                                  type="text"
                                  autoComplete="off"
                                  value={demoPassword}
                                  onChange={(event) => setDemoPassword(event.target.value)}
                                  className="jargon-input"
                                />
                              </Field>
                            </div>
                            <button
                              type="button"
                              onClick={() => void createDemoLogins()}
                              disabled={
                                demoBusy || demoPassword.trim().length < MIN_TEMP_PASSWORD_LENGTH
                              }
                              className="btn btn-primary"
                            >
                              <UserPlus className="h-4 w-4" strokeWidth={1.6} />
                              {demoBusy ? "Creating…" : "Create demo logins"}
                            </button>
                          </div>
                          {demoResult ? (
                            <div className="rounded-card border border-success/30 bg-success/10 p-3 text-meta">
                              <div className="font-medium text-success">
                                Logins ready — password{" "}
                                <span className="font-mono">{demoResult.password}</span>
                              </div>
                              <ul className="mt-2 space-y-1 text-foreground">
                                {demoResult.accounts.map((account) => (
                                  <li key={account.email}>
                                    <span className="text-muted-foreground">{account.role}:</span>{" "}
                                    {account.email}
                                  </li>
                                ))}
                                <li>
                                  <span className="text-muted-foreground">platform_admin:</span>{" "}
                                  your own account
                                </li>
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </section>
                    </div>
                  ) : null}
                  <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
                    <section className="rounded-card border border-border bg-depth-card shadow-card">
                      <div className="space-y-5 p-5">
                        <div>
                          <h2 className="text-title font-medium text-foreground">Class setup</h2>
                          <p className="mt-1 text-meta text-muted-foreground">
                            Use stable names for the real classroom pilot.
                          </p>
                        </div>
                        {isPlatformLevel ? (
                          <>
                            <Field label="Organization name">
                              <input
                                value={orgName}
                                onChange={(event) => {
                                  setOrgName(event.target.value);
                                  if (!orgSlug || orgSlug === slugify(orgName))
                                    setOrgSlug(slugify(event.target.value));
                                }}
                                className="jargon-input"
                              />
                            </Field>
                            <Field label="Organization slug">
                              <input
                                value={orgSlug}
                                onChange={(event) => setOrgSlug(event.target.value)}
                                className="jargon-input"
                              />
                            </Field>
                          </>
                        ) : (
                          <Field label="Organization">
                            <div className="jargon-input flex items-center text-muted-foreground">
                              {selectedOrg?.name || "Your organization"}
                            </div>
                          </Field>
                        )}
                        <Field label="Class name">
                          <input
                            value={className}
                            onChange={(event) => setClassName(event.target.value)}
                            className="jargon-input"
                          />
                        </Field>
                        <Field label="Default temporary password">
                          <input
                            type="password"
                            value={defaultPassword}
                            onChange={(event) => setDefaultPassword(event.target.value)}
                            placeholder="Optional if every row has a password"
                            className={`jargon-input ${hasShortDefaultPassword ? "border-danger/60" : ""}`}
                          />
                          <p
                            className={`mt-1.5 text-meta ${
                              hasShortDefaultPassword ? "text-danger" : "text-muted-foreground"
                            }`}
                          >
                            {hasShortDefaultPassword
                              ? `Use at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`
                              : "Required unless every row has a password override."}
                          </p>
                        </Field>
                        <div className="rounded-card border border-border bg-muted/30 p-3 text-meta leading-relaxed text-muted-foreground">
                          Bootstrap note: the first platform admin is still created manually in
                          Supabase by inserting the signed-in admin user id into{" "}
                          <code>public.platform_admins</code>.
                        </div>
                      </div>
                    </section>

                    <section className="rounded-card border border-border bg-depth-card shadow-card">
                      <div className="space-y-4 p-5">
                        <div>
                          <h2 className="text-title font-medium text-foreground">Roster paste</h2>
                          <p className="mt-1 text-meta text-muted-foreground">
                            Paste CSV or tab-separated rows. Header fields can be email, name, role,
                            grade, password.
                          </p>
                        </div>
                        <textarea
                          value={pasteText}
                          onChange={(event) => setPasteText(event.target.value)}
                          placeholder={
                            "email,name,role,grade,password\nteacher@example.com,Teacher Name,teacher,,temporary123\nstudent@example.com,Student Name,student,Grade 4,temporary123"
                          }
                          className="min-h-[170px] w-full resize-y rounded-card border border-border bg-depth-field p-3 text-body leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-foreground/50"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={applyPaste} className="btn btn-primary">
                            Load pasted roster
                          </button>
                          <button
                            type="button"
                            onClick={() => setRows((current) => [...current, blankRow()])}
                            className="btn btn-secondary"
                          >
                            <Plus className="h-4 w-4" strokeWidth={1.6} /> Add row
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>

                  <section className="rounded-card border border-border bg-depth-card shadow-card">
                    <div className="p-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-title font-medium text-foreground">Roster rows</h2>
                          <p className="mt-1 text-meta text-muted-foreground">
                            {validRows.length} ready{" "}
                            {validRows.length === 1 ? "account" : "accounts"}.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={seedRoster}
                          disabled={!canSeed}
                          title={formErrors[0] || "Seed classroom"}
                          className="btn btn-primary"
                        >
                          {submitting ? "Seeding..." : "Seed classroom"}
                        </button>
                      </div>
                      <div className="table-scroll">
                        <table className="min-w-[820px] w-full border-collapse text-left text-body">
                          <thead className="border-b border-border text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                            <tr>
                              <th className="py-2 pr-3 font-medium">Role</th>
                              <th className="py-2 pr-3 font-medium">Email</th>
                              <th className="py-2 pr-3 font-medium">Name</th>
                              <th className="py-2 pr-3 font-medium">Grade</th>
                              <th className="py-2 pr-3 font-medium">Password override</th>
                              <th className="py-2 font-medium" />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.rowId} className="border-b border-border/60">
                                <td className="py-2 pr-3">
                                  <select
                                    value={row.role}
                                    onChange={(event) =>
                                      updateRow(row.rowId, {
                                        role: event.target.value as PilotRole,
                                      })
                                    }
                                    className="jargon-input min-w-[110px]"
                                  >
                                    <option value="student">student</option>
                                    <option value="teacher">teacher</option>
                                  </select>
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="space-y-1">
                                    <input
                                      value={row.email}
                                      onChange={(event) =>
                                        updateRow(row.rowId, { email: event.target.value })
                                      }
                                      className={`jargon-input min-w-[220px] ${
                                        emailErrors[row.rowId] ? "border-danger/60" : ""
                                      }`}
                                    />
                                    {emailErrors[row.rowId] ? (
                                      <div className="text-meta text-danger">
                                        {emailErrors[row.rowId]}
                                      </div>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="space-y-1">
                                    <input
                                      value={row.name}
                                      onChange={(event) =>
                                        updateRow(row.rowId, { name: event.target.value })
                                      }
                                      className={`jargon-input min-w-[180px] ${
                                        nameErrors[row.rowId] ? "border-danger/60" : ""
                                      }`}
                                    />
                                    {nameErrors[row.rowId] ? (
                                      <div className="text-meta text-danger">
                                        {nameErrors[row.rowId]}
                                      </div>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  <input
                                    value={row.grade || ""}
                                    onChange={(event) =>
                                      updateRow(row.rowId, { grade: event.target.value })
                                    }
                                    className="jargon-input min-w-[120px]"
                                  />
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="space-y-1">
                                    <input
                                      type="password"
                                      value={row.password || ""}
                                      onChange={(event) =>
                                        updateRow(row.rowId, { password: event.target.value })
                                      }
                                      className={`jargon-input min-w-[180px] ${
                                        passwordErrors[row.rowId] ? "border-danger/60" : ""
                                      }`}
                                    />
                                    {passwordErrors[row.rowId] ? (
                                      <div className="text-meta text-danger">
                                        {passwordErrors[row.rowId]}
                                      </div>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeRow(row.rowId)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    aria-label="Remove roster row"
                                  >
                                    <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>

                  {(message || results.length > 0) && (
                    <section className="rounded-card border border-border bg-depth-card shadow-card">
                      <div className="space-y-4 p-5">
                        {message && (
                          <div className="flex items-start gap-2 text-body text-muted-foreground">
                            {results.some((result) => result.status === "failed") ? (
                              <AlertCircle
                                className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                                strokeWidth={1.7}
                              />
                            ) : (
                              <CheckCircle2
                                className="mt-0.5 h-4 w-4 shrink-0 text-success"
                                strokeWidth={1.7}
                              />
                            )}
                            <span>
                              {message}
                              {batchId ? (
                                <span className="ml-2 text-muted-foreground/70">
                                  Batch {batchId}
                                </span>
                              ) : null}
                            </span>
                          </div>
                        )}
                        {results.length > 0 && (
                          <div className="table-scroll">
                            <table className="min-w-[680px] w-full border-collapse text-left text-body">
                              <thead className="border-b border-border text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                                <tr>
                                  <th className="py-2 pr-3 font-medium">Status</th>
                                  <th className="py-2 pr-3 font-medium">Role</th>
                                  <th className="py-2 pr-3 font-medium">Email</th>
                                  <th className="py-2 font-medium">Detail</th>
                                </tr>
                              </thead>
                              <tbody>
                                {results.map((result) => (
                                  <tr
                                    key={`${result.email}-${result.role}`}
                                    className="border-b border-border/60"
                                  >
                                    <td
                                      className={`py-2 pr-3 font-medium ${resultTone(result.status)}`}
                                    >
                                      {result.status}
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground">
                                      {result.role}
                                    </td>
                                    <td className="py-2 pr-3 text-foreground">{result.email}</td>
                                    <td className="py-2 text-muted-foreground">
                                      {result.error || result.user_id || ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </WorkspacePanel>
            </Tabs>
          </>
        )}
      </main>
    </AdminShell>
  );
}

function AdminShell({
  email,
  home,
  children,
}: {
  email: string;
  home: "/admin" | "/platform";
  children?: React.ReactNode;
}) {
  return (
    // admin-wash = the neutral page mixed a step toward the info blue: the cooler admin
    // tint (DESIGN_V6 §2/§6). Ambient held at the 0.22 working-surface intensity (§2), its
    // wash tinted toward the cooler --ambient-admin token to match.
    <div className="admin-wash relative flex min-h-screen flex-col overflow-hidden">
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1240px] items-center justify-between gap-2 px-3 sm:px-6">
            <Link to={home} className="font-serif text-[22px] tracking-tight text-foreground">
              Jargon
            </Link>
            {email ? <SettingsMenu email={email} /> : null}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-overline font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function MetricStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-border/75 bg-depth-sub p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-overline uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className="mt-2 text-[22px] font-semibold tabular-nums leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}

function CostMetricTable({
  title,
  rows,
  showCost,
  empty,
  wide = false,
}: {
  title: string;
  rows: CostModelMetric[];
  showCost: boolean;
  empty: string;
  wide?: boolean;
}) {
  return (
    <div className="rounded-card border border-border/80 bg-depth-sub p-4">
      <h3 className="text-body font-medium text-foreground">{title}</h3>
      <div className="table-scroll mt-3">
        <table
          className={`${wide ? "min-w-[860px]" : "min-w-[620px]"} w-full border-collapse text-left text-meta`}
        >
          <thead className="border-b border-border text-overline uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Scope</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Tokens</th>
              <th className="py-2 pr-3 font-medium">Events</th>
              <th className="py-2 pr-3 font-medium">Latency</th>
              <th className="py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, wide ? 12 : 8).map((row) => (
              <tr key={row.key} className="border-b border-border/55">
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{row.label}</div>
                  <div className="mt-0.5 text-meta text-muted-foreground">
                    {row.completion_count} completions · {row.session_count} sessions
                  </div>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {row.model || row.task_type?.replaceAll("_", " ") || "mixed"}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {formatCompactNumber(row.total_tokens)}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {formatNumber(
                    row.model_event_count + row.runtime_event_count + row.speech_event_count,
                  )}
                  {row.error_count ? (
                    <span className="ml-1 text-warning">
                      ({row.error_count} error{row.error_count === 1 ? "" : "s"})
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {formatMs(row.average_latency_ms)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {showCost ? formatUsd(row.estimated_cost_usd) : "Hidden"}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="py-4 text-muted-foreground" colSpan={6}>
                  {empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
