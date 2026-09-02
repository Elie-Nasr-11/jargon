/**
 * The school (admin) window — people, classes, health.
 *
 * R82 moved it out of routes/admin.tsx so /admin and /platform can load it on
 * demand: it is a portal most sessions never open, and it was riding in the
 * bundle every teacher and student downloaded before anything rendered.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Tabs, WorkspaceTab, WorkspaceTabList, WorkspacePanel } from "@/components/WorkspaceTabs";
import { Breadcrumb } from "@/components/Breadcrumb";
import { notifyErr } from "@/lib/feedback";
import { RouteLoader } from "@/components/RouteLoader";
import {
  fetchAdminScope,
  fetchTeacherClasses,
  roleHomeNav,
  fetchCostModelDashboard,
  fetchActiveSessions,
  fetchPilotReadiness,
  getSession,
} from "@/lib/api";
import type {
  AdminActorAccess,
  AdminScope,
  AdminScopeResult,
  CostModelDashboard,
  ActiveSession,
  PilotReadiness,
} from "@/lib/types";
import { DeveloperCorner } from "@/features/admin/DeveloperCorner";
import { HealthPanel } from "@/features/admin/HealthPanel";
import { RosterImport } from "@/features/admin/RosterImport";
import { SetupPanel } from "@/features/admin/SetupPanel";
import { PeoplePanel } from "@/features/admin/PeoplePanel";
import { ClassesPanel } from "@/features/admin/ClassesPanel";

// Org + active tab live in the URL (?org=&tab=) so context is set once and is
// deep-linkable. Unknown params are preserved. Shared by the /admin (org admin)
// and /platform (platform admin) portals.

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

/**
 * Old ?tab= values keep landing. R51's six tabs (and the R84 names) map onto the
 * screen that now owns their content, so a bookmarked link or an emailed deep link
 * never dumps an admin on a screen that has nothing to do with what they clicked.
 */
export function normalizeAdminTab(tab: string | undefined, visible: string[]): string {
  const legacy: Record<string, string> = {
    overview: "setup",
    seeding: "setup",
    live: "health",
    cost: "health",
    runtime: "health",
  };
  const resolved = tab ? (legacy[tab] ?? tab) : "";
  return visible.includes(resolved) ? resolved : "setup";
}

export function AdminPage() {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
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

  // R84 tab set: Setup / People / Classes / Health, the same four for every admin
  // level. Cost is no longer a TAB gated on platform level — Health renders what
  // admin-ops chooses to send, and admin-ops already withholds dollar totals from
  // org admins server-side. A tab that appears for some people and not others made
  // the window's shape depend on who you are, which is a worse thing to explain
  // than a section that shows fewer numbers.
  const visibleTabs = ["setup", "people", "classes", "health"];
  const adminTab = normalizeAdminTab(search.tab, visibleTabs);
  const setAdminTab = (tab: string) =>
    navigate({ to: adminHome, search: (prev: Record<string, unknown>) => ({ ...prev, tab }) });

  // Keep the Live fleet current while its tab is open: load on first open, then poll every 30s
  // (foreground only) so the session list + the "Xm ago" labels stay live. The panel keeps its
  // manual Refresh too. R51: Overview shows the same fleet count, so it shares the loop.
  useEffect(() => {
    if (adminTab !== "health" || !token) return;
    if (activeSessions === null && !activeSessionsLoading) {
      void refreshActiveSessions(token);
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshActiveSessions(token);
    }, 30 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, token]);

  // Readiness lazy-loads the first time Setup (its home) or Classes opens.
  useEffect(() => {
    if (adminTab !== "setup" && adminTab !== "classes") return;
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
            <h1 className="font-serif mt-2 text-display text-foreground">Manage classrooms.</h1>
            {/* R84: this described the old six tabs — including the "seeding" that no
                longer exists — so it named jobs an admin could not find. It names the
                four screens, in the order they are worked. */}
            <p className="mt-2 max-w-2xl text-body leading-relaxed text-muted-foreground">
              Get a class ready, manage its people, and watch it run
              {isPlatformLevel ? " across the platform" : " inside your organization"}. Passwords go
              straight to the sign-in service; Jargon never stores them.
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
              Refresh
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
                {/* R84: this line listed the old six tabs, so it went on advertising
                    "seeding" after the tab died. It names the four screens now. */}
                {isPlatformLevel
                  ? "Pick an organization to set it up, manage its people and classes, and watch its health."
                  : "Pick an organization to set it up, manage its people and classes, and watch its health."}
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

            {/* R84 — the brief's admin, in the order an admin works: get it ready,
                manage the people, manage the classes, watch it run. Six tabs became
                four; "Seeding" is gone, its three unrelated jobs sent to the screen
                that owns each. */}
            <Tabs value={adminTab} onValueChange={setAdminTab}>
              <WorkspaceTabList>
                <WorkspaceTab value="setup">Setup</WorkspaceTab>
                <WorkspaceTab value="people">People</WorkspaceTab>
                <WorkspaceTab value="classes">Classes</WorkspaceTab>
                <WorkspaceTab value="health">Health</WorkspaceTab>
              </WorkspaceTabList>

              <WorkspacePanel value="setup">
                <SetupPanel
                  scope={scope || emptyScope}
                  organizationId={selectedOrgId}
                  readiness={readiness}
                  readinessLoading={readinessLoading}
                  onRefreshReadiness={() => void refreshReadiness()}
                  developerCorner={isPlatformAdmin ? <DeveloperCorner token={token} /> : null}
                />
              </WorkspacePanel>

              <WorkspacePanel value="people">
                <div className="grid gap-4">
                  <PeoplePanel
                    token={token}
                    scope={scope || emptyScope}
                    organizationId={selectedOrgId}
                    currentUserId={userId}
                    isPlatformAdmin={isPlatformAdmin}
                    onScope={applyScopeResult}
                    rosterImport={
                      <RosterImport
                        token={token}
                        scope={scope || emptyScope}
                        organizationId={selectedOrgId}
                        onSeeded={() => void refreshScope()}
                      />
                    }
                  />
                </div>
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

              <WorkspacePanel value="health">
                <HealthPanel
                  scope={scope || emptyScope}
                  organizationId={selectedOrgId}
                  isPlatformLevel={isPlatformLevel}
                  activeSessions={activeSessions}
                  activeSessionsLoading={activeSessionsLoading}
                  activeSessionsError={activeSessionsError}
                  onRefreshActiveSessions={() => void refreshActiveSessions()}
                  costDashboard={costDashboard}
                  costLoading={costLoading}
                  costMessage={costMessage}
                  costVisible={costVisible}
                  onRefreshCostDashboard={() => void refreshCostDashboard()}
                  liveAgo={liveAgo}
                />
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
