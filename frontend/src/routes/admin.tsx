import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  Archive,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Download,
  DollarSign,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Tabs, WorkspaceTab, WorkspaceTabList, WorkspacePanel } from "@/components/WorkspaceTabs";
import { Breadcrumb } from "@/components/Breadcrumb";
import { notifyOk, notifyErr } from "@/lib/feedback";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PlaceSwitcher } from "@/components/PlaceSwitcher";
import {
  applyCsvRosterImport,
  exportClassSnapshot,
  exportStudentArchive,
  fetchAdminScope,
  fetchCostModelDashboard,
  fetchGoogleClassroomCourses,
  fetchGoogleClassroomMappings,
  fetchPilotReadiness,
  generateProgressReport,
  getSession,
  importGoogleClassroomCourse,
  invokeAdminOps,
  invokeAdminSeed,
  previewCsvImport,
  previewGoogleClassroomRoster,
  requestDataRetention,
  startGoogleClassroomOAuth,
  completeGoogleClassroomOAuth,
  disconnectGoogleClassroom,
  diagnoseGoogleClassroom,
  fetchCanvasCourses,
  fetchCanvasMappings,
  importCanvasCourse,
  previewCanvasRoster,
  startCanvasOAuth,
  completeCanvasOAuth,
  disconnectCanvas,
  diagnoseCanvas,
  fetchCanvasGradeTargets,
  upsertCanvasGradeLink,
  deleteCanvasGradeLink,
  pushCanvasGrades,
  syncCanvas,
  setCanvasSyncEnabled,
  upsertConsentSettings,
} from "@/lib/api";
import type {
  AdminActorAccess,
  AdminClass,
  AdminCsvImportRow,
  AdminScope,
  AdminSeedResult,
  AdminSeedUser,
  ClassReadiness,
  CostModelDashboard,
  CostModelMetric,
  GoogleClassroomCourse,
  GoogleClassroomIntegrationState,
  GoogleClassroomPerson,
  CanvasCourse,
  CanvasGradeTargets,
  CanvasIntegrationState,
  CanvasPerson,
  PilotReadiness,
  PilotRole,
  ReadinessStatus,
  TeacherClassMembership,
} from "@/lib/types";

export const Route = createFileRoute("/admin")({
  // Org + active tab live in the URL (?org=&tab=) so context is set once and is
  // deep-linkable. Unknown params (e.g. Google OAuth code/state) are preserved.
  validateSearch: (
    search: Record<string, unknown>,
  ): Record<string, unknown> & { org?: string; tab?: string; view?: string } => ({
    ...search,
    org: typeof search.org === "string" ? search.org : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    view: search.view === "organization" ? "organization" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pilot Admin - Jargon" },
      { name: "description", content: "Seed pilot classrooms for Jargon." },
    ],
  }),
  component: AdminPage,
});

type RosterRow = AdminSeedUser & { rowId: string };
type OrganizationRole = "student" | "teacher" | "org_admin";

const MIN_TEMP_PASSWORD_LENGTH = 6;

const blankRow = (): RosterRow => ({
  rowId: Math.random().toString(36).slice(2),
  email: "",
  name: "",
  role: "student",
  grade: "",
  password: "",
});

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

function classStatusLabel(status: string) {
  if (status === "removed") return "disabled";
  return status;
}

function readinessLabel(status: ReadinessStatus) {
  if (status === "ready") return "Ready";
  if (status === "needs_setup") return "Needs setup";
  if (status === "needs_attention") return "Needs attention";
  return "Blocked";
}

function readinessTone(status: ReadinessStatus) {
  if (status === "ready") return "border-success/45 text-success";
  if (status === "needs_attention") return "border-warning/45 text-warning";
  if (status === "needs_setup") return "border-info/45 text-info";
  return "border-danger/45 text-danger";
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

function downloadTextFile(filename: string, body: string, contentType: string) {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function AdminPage() {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState("");
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
  const [opsMessage, setOpsMessage] = useState("");
  const [opsBusy, setOpsBusy] = useState("");
  const search = useSearch({ strict: false }) as { org?: string; tab?: string; view?: string };
  const selectedOrgId = search.org ?? "";
  const setSelectedOrgId = (orgId: string) =>
    navigate({
      to: "/admin",
      search: (prev: Record<string, unknown>) => ({ ...prev, org: orgId || undefined }),
    });
  const [selectedClassId, setSelectedClassId] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [renameClassName, setRenameClassName] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [existingUserId, setExistingUserId] = useState("");
  const [existingUserRole, setExistingUserRole] = useState<PilotRole>("student");
  const [readiness, setReadiness] = useState<PilotReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessMessage, setReadinessMessage] = useState("");
  const [costDashboard, setCostDashboard] = useState<CostModelDashboard | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costMessage, setCostMessage] = useState("");
  const [classroom, setClassroom] = useState<GoogleClassroomIntegrationState | null>(null);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [classroomMessage, setClassroomMessage] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [classroomCourses, setClassroomCourses] = useState<GoogleClassroomCourse[]>([]);
  const [selectedGoogleCourseId, setSelectedGoogleCourseId] = useState("");
  const [rosterPreview, setRosterPreview] = useState<{
    course: GoogleClassroomCourse | null;
    teachers: GoogleClassroomPerson[];
    students: GoogleClassroomPerson[];
  } | null>(null);
  const [canvas, setCanvas] = useState<CanvasIntegrationState | null>(null);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("");
  const [canvasBaseUrl, setCanvasBaseUrl] = useState("");
  const [selectedCanvasConnectionId, setSelectedCanvasConnectionId] = useState("");
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[]>([]);
  const [selectedCanvasCourseId, setSelectedCanvasCourseId] = useState("");
  const [canvasCreateAccounts, setCanvasCreateAccounts] = useState(false);
  const [canvasDefaultPassword, setCanvasDefaultPassword] = useState("");
  const [canvasRosterPreview, setCanvasRosterPreview] = useState<{
    course: CanvasCourse | null;
    teachers: CanvasPerson[];
    students: CanvasPerson[];
  } | null>(null);
  const [selectedGradeMappingId, setSelectedGradeMappingId] = useState("");
  const [gradeTargets, setGradeTargets] = useState<CanvasGradeTargets | null>(null);
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeMessage, setGradeMessage] = useState("");
  const [newGradeJargon, setNewGradeJargon] = useState("");
  const [newGradeCanvasAssignment, setNewGradeCanvasAssignment] = useState("");
  const [oauthHandled, setOauthHandled] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState<AdminCsvImportRow[]>([]);
  const [csvBatchId, setCsvBatchId] = useState("");
  const [schoolOpsMessage, setSchoolOpsMessage] = useState("");
  const [schoolOpsBusy, setSchoolOpsBusy] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [retentionReason, setRetentionReason] = useState("");
  const [consentSettings, setConsentSettings] = useState({
    voice_enabled: true,
    media_processing_enabled: true,
    external_sync_enabled: false,
    ai_enabled: true,
    quiz_voice_enabled: false,
  });

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
        if (allowed) {
          void refreshReadiness(session.access_token, true);
          void refreshCostDashboard(session.access_token, true);
        }
        if (!alive) return;
        setEmail(session.user.email || "");
        setToken(session.access_token);
        setAuthorized(allowed);
        setMessage(allowed ? "" : "This area is available only to admins.");
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

  useEffect(() => {
    if (!token || !authorized || oauthHandled) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return;
    setOauthHandled(true);
    // Google and Canvas both return ?code&state to this page. A provider hint
    // stored before redirect tells us which completion to run (defaults to Google
    // for backward compatibility with existing connection flows).
    const provider = window.sessionStorage.getItem("jargon_oauth_provider") || "google";
    window.sessionStorage.removeItem("jargon_oauth_provider");
    if (provider === "canvas") {
      setCanvasLoading(true);
      setCanvasMessage("Finishing Canvas connection...");
      completeCanvasOAuth(token, code, state)
        .then((connection) => {
          setCanvasMessage(
            `Connected Canvas as ${connection.canvas_login_id || connection.canvas_name}.`,
          );
          window.history.replaceState({}, document.title, window.location.pathname);
          return refreshCanvasMappings(token, connection.organization_id, true);
        })
        .catch((error) => {
          setCanvasMessage((error as Error).message || "Could not finish Canvas connection.");
        })
        .finally(() => setCanvasLoading(false));
      return;
    }
    setClassroomLoading(true);
    setClassroomMessage("Finishing Google Classroom connection...");
    completeGoogleClassroomOAuth(token, code, state)
      .then((connection) => {
        setClassroomMessage(`Connected Google Classroom as ${connection.google_email}.`);
        window.history.replaceState({}, document.title, window.location.pathname);
        return refreshGoogleClassroomMappings(token, connection.organization_id, true);
      })
      .catch((error) => {
        setClassroomMessage((error as Error).message || "Could not finish Google connection.");
      })
      .finally(() => setClassroomLoading(false));
    // OAuth callback should run only once for the current URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, oauthHandled, token]);

  useEffect(() => {
    if (!token || !authorized || !selectedOrgId) return;
    void refreshGoogleClassroomMappings(token, selectedOrgId, true);
    void refreshCanvasMappings(token, selectedOrgId, true);
    // Classroom + Canvas mappings refresh explicitly when the selected org changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, selectedOrgId, token]);

  const refreshScope = async (accessToken = token) => {
    if (!accessToken) return false;
    setScopeLoading(true);
    try {
      const data = await fetchAdminScope(accessToken);
      setActorAccess(data.actorAccess);
      setScope(data.scope);
      // Org selection lives in the URL (?org=); the home shows a picker, so we no
      // longer auto-select the first org. The class default follows the URL org.
      const orgClasses = data.scope.classes.filter(
        (item) => item.organization_id === selectedOrgId,
      );
      const nextClass =
        selectedClassId && orgClasses.some((item) => item.id === selectedClassId)
          ? selectedClassId
          : orgClasses[0]?.id || "";
      setSelectedClassId(nextClass);
      if (!renameClassName && nextClass) {
        setRenameClassName(data.scope.classes.find((item) => item.id === nextClass)?.name || "");
      }
      return true;
    } catch (error) {
      setOpsMessage((error as Error).message || "Could not load admin operations.");
      return false;
    } finally {
      setScopeLoading(false);
    }
  };

  const refreshReadiness = async (accessToken = token, silent = false) => {
    if (!accessToken) return false;
    setReadinessLoading(true);
    if (!silent) setReadinessMessage("");
    try {
      const data = await fetchPilotReadiness(accessToken);
      setActorAccess(data.actorAccess);
      setScope(data.scope);
      setReadiness(data.readiness);
      if (!silent) setReadinessMessage("Pilot readiness refreshed.");
      return true;
    } catch (error) {
      setReadinessMessage((error as Error).message || "Could not load pilot readiness.");
      return false;
    } finally {
      setReadinessLoading(false);
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

  const refreshGoogleClassroomMappings = async (
    accessToken = token,
    organizationId = selectedOrgId,
    silent = false,
  ) => {
    if (!accessToken || !organizationId) return false;
    setClassroomLoading(true);
    if (!silent) setClassroomMessage("");
    try {
      const data = await fetchGoogleClassroomMappings(accessToken, organizationId);
      setClassroom(data);
      const activeConnections = data.connections.filter(
        (connection) =>
          connection.organization_id === organizationId && connection.status === "active",
      );
      const nextConnection =
        selectedConnectionId &&
        activeConnections.some((connection) => connection.id === selectedConnectionId)
          ? selectedConnectionId
          : activeConnections[0]?.id || "";
      setSelectedConnectionId(nextConnection);
      if (!activeConnections.length) {
        setClassroomCourses([]);
        setSelectedGoogleCourseId("");
        setRosterPreview(null);
      }
      if (!silent) setClassroomMessage("Google Classroom mappings refreshed.");
      return true;
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not load Google Classroom data.");
      return false;
    } finally {
      setClassroomLoading(false);
    }
  };

  const refreshCanvasMappings = async (
    accessToken = token,
    organizationId = selectedOrgId,
    silent = false,
  ) => {
    if (!accessToken || !organizationId) return false;
    setCanvasLoading(true);
    if (!silent) setCanvasMessage("");
    try {
      const data = await fetchCanvasMappings(accessToken, organizationId);
      setCanvas(data);
      const activeConnections = data.connections.filter(
        (connection) =>
          connection.organization_id === organizationId && connection.status === "active",
      );
      const nextConnection =
        selectedCanvasConnectionId &&
        activeConnections.some((connection) => connection.id === selectedCanvasConnectionId)
          ? selectedCanvasConnectionId
          : activeConnections[0]?.id || "";
      setSelectedCanvasConnectionId(nextConnection);
      if (!activeConnections.length) {
        setCanvasCourses([]);
        setSelectedCanvasCourseId("");
        setCanvasRosterPreview(null);
      }
      if (!silent) setCanvasMessage("Canvas mappings refreshed.");
      return true;
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not load Canvas data.");
      return false;
    } finally {
      setCanvasLoading(false);
    }
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
  const adminTab = search.tab ?? "readiness";
  const setAdminTab = (tab: string) =>
    navigate({ to: "/admin", search: (prev: Record<string, unknown>) => ({ ...prev, tab }) });
  const isPlatformAdmin = actorAccess?.level === "platform_admin";
  // "Platform admin" is the real role; "platform view" is that role NOT currently on
  // the scoped organization page. Platform admins switch between the two pages via the
  // nav; org admins are always in the organization view. Every level-gated surface
  // below keys off `isPlatformLevel` = platform view, so it flips with the toggle.
  const isPlatformLevel = isPlatformAdmin && search.view !== "organization";
  const adminLevelLabel = isPlatformLevel ? "Platform admin" : "Organization admin";

  const selectedOrg = useMemo(
    () => scope?.organizations.find((organization) => organization.id === selectedOrgId) || null,
    [scope, selectedOrgId],
  );
  const orgClasses = useMemo(
    () => (scope?.classes || []).filter((item) => item.organization_id === selectedOrgId),
    [scope, selectedOrgId],
  );
  const selectedClass = useMemo(
    () => scope?.classes.find((item) => item.id === selectedClassId) || null,
    [scope, selectedClassId],
  );
  const classMemberships = useMemo(
    () => (scope?.class_memberships || []).filter((item) => item.class_id === selectedClassId),
    [scope, selectedClassId],
  );
  const profileById = useMemo(
    () => new Map((scope?.profiles || []).map((profile) => [profile.id, profile])),
    [scope],
  );
  const userById = useMemo(
    () => new Map((scope?.users || []).map((user) => [user.id, user])),
    [scope],
  );
  const organizationMembershipByUser = useMemo(() => {
    const map = new Map<string, AdminScope["organization_memberships"][number]>();
    (scope?.organization_memberships || [])
      .filter((membership) => membership.organization_id === selectedOrgId)
      .forEach((membership) => map.set(membership.user_id, membership));
    return map;
  }, [scope, selectedOrgId]);
  const classMemberIds = useMemo(
    () => new Set(classMemberships.map((membership) => membership.user_id)),
    [classMemberships],
  );
  const classStudentUsers = useMemo(
    () =>
      classMemberships
        .filter((membership) => membership.role === "student")
        .map((membership) => {
          const profile = profileById.get(membership.user_id);
          const user = userById.get(membership.user_id);
          return {
            id: membership.user_id,
            label: profile?.name || user?.email || membership.user_id,
            email: user?.email || "",
          };
        }),
    [classMemberships, profileById, userById],
  );
  useEffect(() => {
    if (!classStudentUsers.length) {
      setSelectedStudentId("");
      return;
    }
    if (!classStudentUsers.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(classStudentUsers[0].id);
    }
  }, [classStudentUsers, selectedStudentId]);
  const addableUsers = useMemo(
    () => (scope?.users || []).filter((user) => !classMemberIds.has(user.id)),
    [classMemberIds, scope],
  );
  const activeTeacherCount = classMemberships.filter(
    (membership) => membership.role === "teacher" && membership.status === "active",
  ).length;
  const activeStudentCount = classMemberships.filter(
    (membership) => membership.role === "student" && membership.status === "active",
  ).length;
  const selectedClassReadiness = useMemo(
    () => readiness?.classes.find((item) => item.class_id === selectedClassId) || null,
    [readiness, selectedClassId],
  );
  const readinessCounts = useMemo(() => {
    const classes = readiness?.classes || [];
    return {
      ready: classes.filter((item) => item.status === "ready").length,
      needsSetup: classes.filter((item) => item.status === "needs_setup").length,
      needsAttention: classes.filter((item) => item.status === "needs_attention").length,
      blocked: classes.filter((item) => item.status === "blocked").length,
    };
  }, [readiness]);
  const costVisible = costDashboard?.visibility === "full_cost";
  const activeClassroomConnections = useMemo(
    () =>
      (classroom?.connections || []).filter(
        (connection) =>
          connection.organization_id === selectedOrgId && connection.status === "active",
      ),
    [classroom, selectedOrgId],
  );
  const selectedClassroomConnection = useMemo(
    () =>
      activeClassroomConnections.find((connection) => connection.id === selectedConnectionId) ||
      null,
    [activeClassroomConnections, selectedConnectionId],
  );
  const selectedGoogleCourse = useMemo(
    () => classroomCourses.find((course) => course.id === selectedGoogleCourseId) || null,
    [classroomCourses, selectedGoogleCourseId],
  );
  const selectedCourseMapping = useMemo(
    () =>
      (classroom?.course_mappings || []).find(
        (mapping) =>
          mapping.organization_id === selectedOrgId &&
          mapping.google_course_id === selectedGoogleCourseId,
      ) || null,
    [classroom, selectedGoogleCourseId, selectedOrgId],
  );
  const activeCanvasConnections = useMemo(
    () =>
      (canvas?.connections || []).filter(
        (connection) =>
          connection.organization_id === selectedOrgId && connection.status === "active",
      ),
    [canvas, selectedOrgId],
  );
  const selectedCanvasConnection = useMemo(
    () =>
      activeCanvasConnections.find((connection) => connection.id === selectedCanvasConnectionId) ||
      null,
    [activeCanvasConnections, selectedCanvasConnectionId],
  );
  const selectedCanvasCourse = useMemo(
    () => canvasCourses.find((course) => course.id === selectedCanvasCourseId) || null,
    [canvasCourses, selectedCanvasCourseId],
  );
  const selectedCanvasCourseMapping = useMemo(
    () =>
      (canvas?.course_mappings || []).find(
        (mapping) =>
          mapping.organization_id === selectedOrgId &&
          mapping.canvas_course_id === selectedCanvasCourseId,
      ) || null,
    [canvas, selectedCanvasCourseId, selectedOrgId],
  );
  const gradableCanvasMappings = useMemo(
    () =>
      (canvas?.course_mappings || []).filter(
        (mapping) =>
          mapping.organization_id === selectedOrgId &&
          mapping.status === "active" &&
          mapping.class_id,
      ),
    [canvas, selectedOrgId],
  );

  const copyLoginInstructions = async (item: ClassReadiness | null) => {
    if (!item) {
      setReadinessMessage("Choose a class before copying login instructions.");
      return;
    }
    const lines = [
      `Jargon class: ${item.class_name}`,
      "Student app: https://jargon-9bv5.onrender.com/login",
      "Use the email address assigned by your teacher or admin.",
      "If your temporary password does not work, ask your teacher/admin to reset it.",
      "",
      "Roster:",
      ...item.roster.map(
        (row) =>
          `- ${row.role}: ${row.name || row.email || row.user_id}${row.email ? ` <${row.email}>` : ""}`,
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setReadinessMessage("Login instructions copied without passwords.");
    } catch {
      setReadinessMessage("Could not copy login instructions.");
    }
  };

  const exportSelectedClass = async () => {
    if (!selectedClassId || !token) {
      setReadinessMessage("Choose a class before exporting.");
      return;
    }
    setReadinessLoading(true);
    try {
      const file = await exportClassSnapshot(token, selectedClassId);
      downloadTextFile(file.filename, file.body, file.content_type);
      setReadinessMessage("Class snapshot exported.");
    } catch (error) {
      setReadinessMessage((error as Error).message || "Could not export class snapshot.");
    } finally {
      setReadinessLoading(false);
    }
  };

  const connectGoogleClassroom = async () => {
    if (!token || !selectedOrgId) {
      setClassroomMessage("Choose an organization before connecting Google Classroom.");
      return;
    }
    setClassroomLoading(true);
    setClassroomMessage("");
    try {
      const authUrl = await startGoogleClassroomOAuth(token, selectedOrgId);
      window.location.href = authUrl;
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not start Google Classroom OAuth.");
      setClassroomLoading(false);
    }
  };

  const diagnoseClassroom = async () => {
    if (!token) return;
    setClassroomLoading(true);
    setClassroomMessage("");
    try {
      const data = await diagnoseGoogleClassroom(token, selectedOrgId);
      const missing = data?.missing || [];
      setClassroomMessage(
        missing.length
          ? `Google Classroom needs: ${missing.join(", ")}.`
          : data?.next_step || "Google Classroom OAuth configuration looks ready.",
      );
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not diagnose Google Classroom.");
    } finally {
      setClassroomLoading(false);
    }
  };

  const loadGoogleCourses = async () => {
    if (!token || !selectedConnectionId) {
      setClassroomMessage("Connect Google Classroom first.");
      return;
    }
    setClassroomLoading(true);
    setClassroomMessage("");
    try {
      const courses = await fetchGoogleClassroomCourses(token, selectedConnectionId);
      setClassroomCourses(courses);
      setSelectedGoogleCourseId((current) =>
        current && courses.some((course) => course.id === current) ? current : courses[0]?.id || "",
      );
      setRosterPreview(null);
      setClassroomMessage(
        `Loaded ${courses.length} Google Classroom course${courses.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not load Google Classroom courses.");
    } finally {
      setClassroomLoading(false);
    }
  };

  const previewGoogleRoster = async () => {
    if (!token || !selectedConnectionId || !selectedGoogleCourseId) {
      setClassroomMessage("Choose a Google course first.");
      return;
    }
    setClassroomLoading(true);
    setClassroomMessage("");
    try {
      const preview = await previewGoogleClassroomRoster(
        token,
        selectedConnectionId,
        selectedGoogleCourseId,
      );
      setRosterPreview(preview);
      const people = preview.teachers.length + preview.students.length;
      const matched = [...preview.teachers, ...preview.students].filter(
        (person) => person.matched,
      ).length;
      setClassroomMessage(
        `Previewed ${people} roster rows. ${matched} already match Jargon users.`,
      );
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not preview Google roster.");
    } finally {
      setClassroomLoading(false);
    }
  };

  const importGoogleCourse = async () => {
    if (!token || !selectedConnectionId || !selectedGoogleCourseId) {
      setClassroomMessage("Choose a Google course first.");
      return;
    }
    setClassroomLoading(true);
    setClassroomMessage("");
    try {
      const data = await importGoogleClassroomCourse({
        accessToken: token,
        connectionId: selectedConnectionId,
        googleCourseId: selectedGoogleCourseId,
      });
      await Promise.all([
        refreshScope(token),
        refreshReadiness(token, true),
        refreshGoogleClassroomMappings(token, selectedOrgId, true),
      ]);
      const counts = data?.counts || {};
      const missing = typeof counts.missing === "number" ? counts.missing : 0;
      setClassroomMessage(
        missing
          ? `Imported course with ${missing} unmapped roster row${missing === 1 ? "" : "s"}. Seed missing accounts, then import again.`
          : "Imported Google Classroom course into Jargon.",
      );
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not import Google Classroom course.");
    } finally {
      setClassroomLoading(false);
    }
  };

  const disconnectSelectedGoogleClassroom = async () => {
    if (!token || !selectedConnectionId) return;
    setClassroomLoading(true);
    setClassroomMessage("");
    try {
      await disconnectGoogleClassroom(token, selectedConnectionId);
      setSelectedConnectionId("");
      setClassroomCourses([]);
      setSelectedGoogleCourseId("");
      setRosterPreview(null);
      await refreshGoogleClassroomMappings(token, selectedOrgId, true);
      setClassroomMessage("Google Classroom connection disconnected.");
    } catch (error) {
      setClassroomMessage((error as Error).message || "Could not disconnect Google Classroom.");
    } finally {
      setClassroomLoading(false);
    }
  };

  const connectCanvas = async () => {
    if (!token || !selectedOrgId) {
      setCanvasMessage("Choose an organization before connecting Canvas.");
      return;
    }
    if (!canvasBaseUrl.trim()) {
      setCanvasMessage("Enter your Canvas base URL (e.g. https://school.instructure.com).");
      return;
    }
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      const authUrl = await startCanvasOAuth(token, selectedOrgId, canvasBaseUrl.trim());
      window.sessionStorage.setItem("jargon_oauth_provider", "canvas");
      window.location.href = authUrl;
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not start Canvas OAuth.");
      setCanvasLoading(false);
    }
  };

  const diagnoseCanvasFn = async () => {
    if (!token) return;
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      const data = await diagnoseCanvas(token, selectedOrgId);
      const missing = data?.missing || [];
      setCanvasMessage(
        missing.length
          ? `Canvas needs: ${missing.join(", ")}.`
          : data?.next_step || "Canvas OAuth configuration looks ready.",
      );
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not diagnose Canvas.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const loadCanvasCourses = async () => {
    if (!token || !selectedCanvasConnectionId) {
      setCanvasMessage("Connect Canvas first.");
      return;
    }
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      const courses = await fetchCanvasCourses(token, selectedCanvasConnectionId);
      setCanvasCourses(courses);
      setSelectedCanvasCourseId((current) =>
        current && courses.some((course) => course.id === current) ? current : courses[0]?.id || "",
      );
      setCanvasRosterPreview(null);
      setCanvasMessage(`Loaded ${courses.length} Canvas course${courses.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not load Canvas courses.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const previewCanvasRosterFn = async () => {
    if (!token || !selectedCanvasConnectionId || !selectedCanvasCourseId) {
      setCanvasMessage("Choose a Canvas course first.");
      return;
    }
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      const preview = await previewCanvasRoster(
        token,
        selectedCanvasConnectionId,
        selectedCanvasCourseId,
      );
      setCanvasRosterPreview(preview);
      const people = preview.teachers.length + preview.students.length;
      const matched = [...preview.teachers, ...preview.students].filter(
        (person) => person.matched,
      ).length;
      setCanvasMessage(`Previewed ${people} roster rows. ${matched} already match Jargon users.`);
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not preview Canvas roster.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const importCanvasCourseFn = async () => {
    if (!token || !selectedCanvasConnectionId || !selectedCanvasCourseId) {
      setCanvasMessage("Choose a Canvas course first.");
      return;
    }
    if (canvasCreateAccounts && canvasDefaultPassword.trim().length < MIN_TEMP_PASSWORD_LENGTH) {
      setCanvasMessage(
        `Set a temporary password of at least ${MIN_TEMP_PASSWORD_LENGTH} characters to create missing accounts.`,
      );
      return;
    }
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      const data = await importCanvasCourse({
        accessToken: token,
        connectionId: selectedCanvasConnectionId,
        canvasCourseId: selectedCanvasCourseId,
        createMissingAccounts: canvasCreateAccounts,
        defaultPassword: canvasCreateAccounts ? canvasDefaultPassword.trim() : undefined,
      });
      await Promise.all([
        refreshScope(token),
        refreshReadiness(token, true),
        refreshCanvasMappings(token, selectedOrgId, true),
      ]);
      const counts = data?.counts || {};
      const created = typeof counts.created === "number" ? counts.created : 0;
      const missing = typeof counts.missing === "number" ? counts.missing : 0;
      const createdNote = created
        ? ` Created ${created} new account${created === 1 ? "" : "s"} with the temporary password.`
        : "";
      setCanvasMessage(
        missing
          ? `Imported course with ${missing} unmapped roster row${missing === 1 ? "" : "s"}.${createdNote} Seed remaining accounts, then import again.`
          : `Imported Canvas course into Jargon.${createdNote}`,
      );
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not import Canvas course.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const disconnectSelectedCanvas = async () => {
    if (!token || !selectedCanvasConnectionId) return;
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      await disconnectCanvas(token, selectedCanvasConnectionId);
      setSelectedCanvasConnectionId("");
      setCanvasCourses([]);
      setSelectedCanvasCourseId("");
      setCanvasRosterPreview(null);
      await refreshCanvasMappings(token, selectedOrgId, true);
      setCanvasMessage("Canvas connection disconnected.");
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not disconnect Canvas.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const syncCanvasNow = async () => {
    if (!token || !selectedCanvasConnectionId) {
      setCanvasMessage("Choose a Canvas connection first.");
      return;
    }
    setCanvasLoading(true);
    setCanvasMessage("Syncing rosters and grades from Canvas...");
    try {
      const data = await syncCanvas(token, selectedCanvasConnectionId);
      const counts = data?.counts || {};
      const courses = typeof counts.courses === "number" ? counts.courses : 0;
      const memberships = typeof counts.memberships === "number" ? counts.memberships : 0;
      const gradesPushed = typeof counts.grades_pushed === "number" ? counts.grades_pushed : 0;
      await Promise.all([
        refreshScope(token),
        refreshReadiness(token, true),
        refreshCanvasMappings(token, selectedOrgId, true),
      ]);
      setCanvasMessage(
        `Synced ${courses} course${courses === 1 ? "" : "s"} (${memberships} memberships) and pushed ${gradesPushed} grade${gradesPushed === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not sync Canvas.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const toggleCanvasAutoSync = async (enabled: boolean) => {
    if (!token || !selectedCanvasConnectionId) return;
    setCanvasLoading(true);
    setCanvasMessage("");
    try {
      await setCanvasSyncEnabled(token, selectedCanvasConnectionId, enabled);
      await refreshCanvasMappings(token, selectedOrgId, true);
      setCanvasMessage(
        enabled
          ? "Scheduled auto-sync enabled for this connection."
          : "Scheduled auto-sync disabled for this connection.",
      );
    } catch (error) {
      setCanvasMessage((error as Error).message || "Could not update auto-sync.");
    } finally {
      setCanvasLoading(false);
    }
  };

  const loadGradeTargets = async (mappingId = selectedGradeMappingId) => {
    if (!token || !mappingId) {
      setGradeTargets(null);
      return;
    }
    setGradeLoading(true);
    setGradeMessage("");
    try {
      const targets = await fetchCanvasGradeTargets(token, mappingId);
      setGradeTargets(targets);
      setNewGradeJargon("");
      setNewGradeCanvasAssignment("");
    } catch (error) {
      setGradeTargets(null);
      setGradeMessage((error as Error).message || "Could not load Canvas grade targets.");
    } finally {
      setGradeLoading(false);
    }
  };

  const createGradeLink = async () => {
    if (!token || !selectedGradeMappingId) {
      setGradeMessage("Choose an imported Canvas course first.");
      return;
    }
    const separator = newGradeJargon.indexOf(":");
    const jargonKind = separator > 0 ? newGradeJargon.slice(0, separator) : "";
    const jargonId = separator > 0 ? newGradeJargon.slice(separator + 1) : "";
    if (
      (jargonKind !== "assessment" && jargonKind !== "assignment") ||
      !jargonId ||
      !newGradeCanvasAssignment
    ) {
      setGradeMessage("Choose a Jargon item and a Canvas assignment to link.");
      return;
    }
    setGradeLoading(true);
    setGradeMessage("");
    try {
      await upsertCanvasGradeLink({
        accessToken: token,
        courseMappingId: selectedGradeMappingId,
        jargonKind,
        jargonId,
        canvasAssignmentId: newGradeCanvasAssignment,
      });
      await Promise.all([
        loadGradeTargets(selectedGradeMappingId),
        refreshCanvasMappings(token, selectedOrgId, true),
      ]);
      setGradeMessage("Linked Jargon item to a Canvas assignment.");
    } catch (error) {
      setGradeMessage((error as Error).message || "Could not link grades.");
    } finally {
      setGradeLoading(false);
    }
  };

  const removeGradeLink = async (gradeLinkId: string) => {
    if (!token || !gradeLinkId) return;
    setGradeLoading(true);
    setGradeMessage("");
    try {
      await deleteCanvasGradeLink(token, gradeLinkId);
      await Promise.all([
        loadGradeTargets(selectedGradeMappingId),
        refreshCanvasMappings(token, selectedOrgId, true),
      ]);
      setGradeMessage("Removed grade link.");
    } catch (error) {
      setGradeMessage((error as Error).message || "Could not remove grade link.");
    } finally {
      setGradeLoading(false);
    }
  };

  const pushGrades = async (gradeLinkId?: string) => {
    if (!token) return;
    if (!gradeLinkId && !selectedGradeMappingId) {
      setGradeMessage("Choose an imported Canvas course first.");
      return;
    }
    setGradeLoading(true);
    setGradeMessage("");
    try {
      const data = await pushCanvasGrades({
        accessToken: token,
        gradeLinkId: gradeLinkId || undefined,
        courseMappingId: gradeLinkId ? undefined : selectedGradeMappingId,
      });
      const counts = data?.counts || {};
      const pushed = typeof counts.pushed === "number" ? counts.pushed : 0;
      const skipped = typeof counts.skipped === "number" ? counts.skipped : 0;
      const failed = typeof counts.failed === "number" ? counts.failed : 0;
      await Promise.all([
        loadGradeTargets(selectedGradeMappingId),
        refreshCanvasMappings(token, selectedOrgId, true),
      ]);
      setGradeMessage(
        `Pushed ${pushed} grade${pushed === 1 ? "" : "s"} to Canvas. ${skipped} skipped, ${failed} failed.`,
      );
    } catch (error) {
      setGradeMessage((error as Error).message || "Could not push grades to Canvas.");
    } finally {
      setGradeLoading(false);
    }
  };

  const runAdminOp = async (busyKey: string, success: string, operation: () => Promise<void>) => {
    if (!token) return;
    setOpsBusy(busyKey);
    setOpsMessage("");
    try {
      await operation();
      void refreshReadiness(token, true);
      setOpsMessage(success);
      notifyOk(success);
    } catch (error) {
      setOpsMessage((error as Error).message || "Admin operation failed.");
      notifyErr(error, "Admin operation failed.");
    } finally {
      setOpsBusy("");
    }
  };

  const applyScopeFromResponse = (response: Awaited<ReturnType<typeof invokeAdminOps>>) => {
    if (response.data?.actor_access) setActorAccess(response.data.actor_access);
    if (response.data?.scope) setScope(response.data.scope);
  };

  const createClass = async () => {
    if (!selectedOrgId || !newClassName.trim()) {
      setOpsMessage("Choose an organization and enter a class name.");
      return;
    }
    await runAdminOp("create-class", "Class created.", async () => {
      const response = await invokeAdminOps({
        accessToken: token,
        action: "create_class",
        organizationId: selectedOrgId,
        payload: { name: newClassName.trim() },
      });
      applyScopeFromResponse(response);
      const created = response.data?.class as AdminClass | undefined;
      if (created?.id) {
        setSelectedClassId(created.id);
        setRenameClassName(created.name);
      }
      setNewClassName("");
    });
  };

  const updateSelectedClass = async (status?: "active" | "archived") => {
    if (!selectedClassId) return;
    const name = renameClassName.trim();
    await runAdminOp(
      "update-class",
      status === "archived" ? "Class archived." : "Class updated.",
      async () => {
        const response = await invokeAdminOps({
          accessToken: token,
          action: "update_class",
          classId: selectedClassId,
          payload: { name: name || selectedClass?.name, status },
        });
        applyScopeFromResponse(response);
      },
    );
  };

  const updateMembershipStatus = async (
    membership: TeacherClassMembership,
    status: "active" | "disabled",
  ) => {
    await runAdminOp(
      `status-${membership.id}`,
      status === "active" ? "Membership reactivated." : "Membership disabled.",
      async () => {
        const response = await invokeAdminOps({
          accessToken: token,
          action: "update_membership_status",
          membershipId: membership.id,
          status,
          payload: { membership_type: "class" },
        });
        applyScopeFromResponse(response);
      },
    );
  };

  const updateMembershipRole = async (membership: TeacherClassMembership, role: PilotRole) => {
    await runAdminOp(`role-${membership.id}`, "Membership role updated.", async () => {
      const response = await invokeAdminOps({
        accessToken: token,
        action: "update_membership_role",
        membershipId: membership.id,
        role,
        payload: { membership_type: "class" },
      });
      applyScopeFromResponse(response);
    });
  };

  const updateOrganizationMembershipRole = async (
    membership: AdminScope["organization_memberships"][number],
    role: OrganizationRole,
  ) => {
    await runAdminOp(`org-role-${membership.id}`, "Organization role updated.", async () => {
      const response = await invokeAdminOps({
        accessToken: token,
        action: "update_membership_role",
        membershipId: membership.id,
        role,
        payload: { membership_type: "organization" },
      });
      applyScopeFromResponse(response);
    });
  };

  const resetUserPassword = async (userId: string) => {
    const password = (resetPasswords[userId] || "").trim();
    if (password.length < MIN_TEMP_PASSWORD_LENGTH) {
      setOpsMessage(`Temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`);
      return;
    }
    await runAdminOp(`reset-${userId}`, "Temporary password reset.", async () => {
      const response = await invokeAdminOps({
        accessToken: token,
        action: "reset_user_password",
        userId,
        temporaryPassword: password,
      });
      applyScopeFromResponse(response);
      setResetPasswords((current) => ({ ...current, [userId]: "" }));
    });
  };

  const addExistingUser = async () => {
    if (!selectedOrgId || !selectedClassId || !existingUserId) {
      setOpsMessage("Choose a class and user first.");
      return;
    }
    await runAdminOp("add-user", "User added to class.", async () => {
      const response = await invokeAdminOps({
        accessToken: token,
        action: "add_existing_user_to_class",
        organizationId: selectedOrgId,
        classId: selectedClassId,
        userId: existingUserId,
        role: existingUserRole,
      });
      applyScopeFromResponse(response);
      setExistingUserId("");
    });
  };

  const runSchoolOp = async (busyKey: string, success: string, operation: () => Promise<void>) => {
    setSchoolOpsBusy(busyKey);
    setSchoolOpsMessage("");
    try {
      await operation();
      setSchoolOpsMessage(success);
      notifyOk(success);
    } catch (error) {
      setSchoolOpsMessage((error as Error).message || "School data operation failed.");
      notifyErr(error, "School data operation failed.");
    } finally {
      setSchoolOpsBusy("");
    }
  };

  const previewCsv = async () => {
    if (!selectedOrgId || !csvText.trim()) {
      setSchoolOpsMessage("Choose an organization and paste CSV roster text.");
      return;
    }
    await runSchoolOp("csv-preview", "CSV roster preview created.", async () => {
      const result = await previewCsvImport({
        accessToken: token,
        organizationId: selectedOrgId,
        classId: selectedClassId || undefined,
        csvText,
      });
      setCsvRows(result.rows || []);
      const batchId = String(result.batch?.id || "");
      setCsvBatchId(batchId);
    });
  };

  const applyCsvImport = async () => {
    if (!csvBatchId) {
      setSchoolOpsMessage("Preview a CSV roster before applying it.");
      return;
    }
    await runSchoolOp("csv-apply", "CSV roster applied to existing users.", async () => {
      const result = await applyCsvRosterImport(token, csvBatchId);
      setCsvRows([]);
      setCsvBatchId("");
      setCsvText("");
      setSchoolOpsMessage(
        `CSV roster applied: ${result.applied?.length || 0} memberships, ${
          result.skipped_count || 0
        } skipped.`,
      );
      await refreshScope();
      await refreshReadiness(token, true);
    });
  };

  const exportSelectedStudentArchive = async () => {
    if (!selectedStudentId) {
      setSchoolOpsMessage("Choose a student first.");
      return;
    }
    await runSchoolOp("student-archive", "Student archive exported.", async () => {
      const file = await exportStudentArchive({
        accessToken: token,
        organizationId: selectedOrgId,
        userId: selectedStudentId,
      });
      downloadTextFile(file.filename, file.body, file.content_type);
    });
  };

  const requestRetention = async (requestType: "anonymize" | "delete") => {
    if (!selectedOrgId || !selectedStudentId) {
      setSchoolOpsMessage("Choose an organization and student first.");
      return;
    }
    await runSchoolOp(
      `retention-${requestType}`,
      `${requestType === "delete" ? "Deletion" : "Anonymization"} request recorded.`,
      async () => {
        await requestDataRetention({
          accessToken: token,
          organizationId: selectedOrgId,
          classId: selectedClassId,
          userId: selectedStudentId,
          requestType,
          reason: retentionReason,
        });
      },
    );
  };

  const saveConsentSettings = async () => {
    if (!selectedOrgId) {
      setSchoolOpsMessage("Choose an organization first.");
      return;
    }
    await runSchoolOp("consent", "Consent and feature settings saved.", async () => {
      await upsertConsentSettings({
        accessToken: token,
        organizationId: selectedOrgId,
        classId: selectedClassId || undefined,
        scope: selectedClassId ? "class" : "organization",
        settings: consentSettings,
      });
    });
  };

  const generateStudentReport = async () => {
    if (!selectedStudentId) {
      setSchoolOpsMessage("Choose a student first.");
      return;
    }
    await runSchoolOp("progress-report", "Progress report generated.", async () => {
      const result = await generateProgressReport({
        accessToken: token,
        organizationId: selectedOrgId,
        classId: selectedClassId,
        userId: selectedStudentId,
      });
      downloadTextFile(result.export.filename, result.export.body, result.export.content_type);
    });
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

  if (booting) {
    return <AdminShell email={email} message="Checking admin access..." />;
  }

  if (!authorized) {
    return (
      <AdminShell email={email} message={message || "Admin access is required."}>
        <Link
          to="/chat"
          className="mt-4 inline-flex text-[13px] text-muted-foreground hover:text-foreground"
        >
          Return to Jargon
        </Link>
      </AdminShell>
    );
  }

  return (
    <AdminShell email={email}>
      <main className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-5 py-8">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              {adminLevelLabel}
            </div>
            <h1 className="font-serif mt-2 text-[38px] leading-tight tracking-tight text-foreground">
              Manage pilot classrooms.
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              {isPlatformLevel
                ? "Create and seed classes, manage memberships, reset temporary passwords, and inspect account operations."
                : "Manage classes, memberships, and account support inside your organization."}{" "}
              Passwords are sent only to Supabase Auth and are not stored in Jargon tables.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshScope()}
              disabled={scopeLoading}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${scopeLoading ? "animate-spin" : ""}`}
                strokeWidth={1.6}
              />
              Refresh ops
            </button>
            <Link
              to="/teacher"
              className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
            >
              Open teacher shell
            </Link>
          </div>
        </section>

        {isPlatformAdmin ? (
          <div className="flex w-fit items-center gap-1 rounded-pill border border-border bg-surface-1 p-0.5">
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/admin",
                  search: (prev: Record<string, unknown>) => ({ ...prev, view: undefined }),
                })
              }
              className={`rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                isPlatformLevel
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Platform admin
            </button>
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/admin",
                  search: (prev: Record<string, unknown>) => ({ ...prev, view: "organization" }),
                })
              }
              className={`rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                !isPlatformLevel
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Organization admin
            </button>
          </div>
        ) : null}

        {!selectedOrgId ? (
          <GradientCard>
            <div className="p-5">
              <div className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
                {isPlatformLevel ? "Organizations" : "Your organizations"}
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {isPlatformLevel
                  ? "Pick an organization to manage its readiness, roster, Google Classroom, cost, and operations."
                  : "Pick an organization to manage its readiness, roster, Google Classroom, and operations."}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(scope?.organizations || []).map((organization) => {
                  const orgClassCount = (scope?.classes || []).filter(
                    (item) => item.organization_id === organization.id,
                  ).length;
                  const orgReadiness = readiness?.organizations.find(
                    (o) => o.organization_id === organization.id,
                  );
                  const flagged = orgReadiness
                    ? orgReadiness.blocked_class_count + orgReadiness.needs_attention_class_count
                    : 0;
                  return (
                    <button
                      key={organization.id}
                      type="button"
                      onClick={() =>
                        navigate({
                          to: "/admin",
                          search: (prev: Record<string, unknown>) => ({
                            ...prev,
                            org: organization.id,
                            tab: flagged > 0 ? "readiness" : prev.tab,
                          }),
                        })
                      }
                      className="rounded-2xl border border-border bg-background/35 p-3.5 text-left transition-colors hover:bg-muted"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[14px] font-medium text-foreground">
                          {organization.name}
                        </div>
                        {orgReadiness ? (
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${readinessTone(
                              orgReadiness.status,
                            )}`}
                          >
                            {flagged > 0
                              ? `${flagged} need fixing`
                              : readinessLabel(orgReadiness.status)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {organization.status || "active"} · {orgClassCount} classes
                      </div>
                    </button>
                  );
                })}
                {(scope?.organizations || []).length === 0 ? (
                  <div className="text-[13px] text-muted-foreground">
                    No organizations in scope yet.
                  </div>
                ) : null}
              </div>
            </div>
          </GradientCard>
        ) : (
          <>
            <Breadcrumb
              segments={[
                { label: "Admin", onClick: () => navigate({ to: "/admin", search: {} }) },
                { label: selectedOrg?.name || "Organization" },
              ]}
            />

            <Tabs value={adminTab} onValueChange={setAdminTab}>
              <WorkspaceTabList>
                <WorkspaceTab value="readiness">Readiness</WorkspaceTab>
                <WorkspaceTab value="school">School data</WorkspaceTab>
                <WorkspaceTab value="google">Google Classroom</WorkspaceTab>
                <WorkspaceTab value="canvas">Canvas</WorkspaceTab>
                {isPlatformLevel ? (
                  <WorkspaceTab value="cost">Cost &amp; runtime</WorkspaceTab>
                ) : null}
                <WorkspaceTab value="ops">Operations</WorkspaceTab>
                <WorkspaceTab value="seeding">Seeding</WorkspaceTab>
              </WorkspaceTabList>

              <WorkspacePanel value="readiness">
                <GradientCard>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.7} />
                          Pilot Readiness
                        </div>
                        <h2 className="text-[18px] font-medium text-foreground">
                          Classroom launch command center
                        </h2>
                        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                          Check whether classes can run tomorrow: roster health, lesson
                          availability, recent completions, assignments/resources, errors, alerts,
                          and support activity.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void refreshReadiness()}
                          disabled={readinessLoading}
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${readinessLoading ? "animate-spin" : ""}`}
                            strokeWidth={1.6}
                          />
                          Refresh readiness
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportSelectedClass()}
                          disabled={!selectedClassId || readinessLoading}
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" strokeWidth={1.6} />
                          Export CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyLoginInstructions(selectedClassReadiness)}
                          disabled={!selectedClassReadiness}
                          className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Copy login instructions
                        </button>
                      </div>
                    </div>

                    {readinessMessage ? (
                      <div className="rounded-2xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground">
                        {readinessMessage}
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-4">
                      <Stat label="Ready" value={readinessCounts.ready} />
                      <Stat label="Needs setup" value={readinessCounts.needsSetup} />
                      <Stat label="Needs attention" value={readinessCounts.needsAttention} />
                      <Stat label="Blocked" value={readinessCounts.blocked} />
                    </div>

                    {selectedClassReadiness ? (
                      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-[14px] font-medium text-foreground">
                                {selectedClassReadiness.class_name}
                              </h3>
                              <p className="mt-1 text-[12px] text-muted-foreground">
                                {selectedClassReadiness.organization_name} ·{" "}
                                {selectedClassReadiness.teacher_count} teacher
                                {selectedClassReadiness.teacher_count === 1 ? "" : "s"} ·{" "}
                                {selectedClassReadiness.student_count} student
                                {selectedClassReadiness.student_count === 1 ? "" : "s"}
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-3 py-1.5 text-[11.5px] ${readinessTone(
                                selectedClassReadiness.status,
                              )}`}
                            >
                              {readinessLabel(selectedClassReadiness.status)}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {selectedClassReadiness.checklist.map((item) => (
                              <div
                                key={item.label}
                                className="rounded-2xl border border-border/60 bg-background/45 px-3 py-2"
                              >
                                <div className="text-[12px] text-foreground">{item.label}</div>
                                <div
                                  className={`mt-1 text-[11px] uppercase tracking-[0.09em] ${
                                    item.status === "ok"
                                      ? "text-success"
                                      : item.status === "attention"
                                        ? "text-warning"
                                        : "text-info"
                                  }`}
                                >
                                  {item.status}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 space-y-2">
                            {selectedClassReadiness.issues.length ? (
                              selectedClassReadiness.issues.map((issue) => (
                                <div
                                  key={`${issue.severity}-${issue.message}`}
                                  className="rounded-2xl border border-border/60 bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground"
                                >
                                  <span
                                    className={`mr-2 font-medium ${
                                      issue.severity === "blocked"
                                        ? "text-danger"
                                        : issue.severity === "attention"
                                          ? "text-warning"
                                          : "text-info"
                                    }`}
                                  >
                                    {issue.severity}
                                  </span>
                                  {issue.message}
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-success/30 bg-success/10 px-3 py-2 text-[12.5px] text-success">
                                No readiness blockers found.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">
                            Roster/account health
                          </h3>
                          <div className="mt-3 max-h-[260px] overflow-auto pr-1">
                            <table className="min-w-[640px] w-full border-collapse text-left text-[12px]">
                              <thead className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                <tr>
                                  <th className="py-2 pr-3 font-medium">Person</th>
                                  <th className="py-2 pr-3 font-medium">Role</th>
                                  <th className="py-2 pr-3 font-medium">Status</th>
                                  <th className="py-2 font-medium">Last sign-in</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedClassReadiness.roster.map((row) => (
                                  <tr key={row.user_id} className="border-b border-border/55">
                                    <td className="py-2 pr-3">
                                      <div className="font-medium text-foreground">
                                        {row.name || row.email || row.user_id}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground">
                                        {row.email || "No email loaded"} · grade{" "}
                                        {row.grade || "n/a"}
                                      </div>
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground">{row.role}</td>
                                    <td className="py-2 pr-3 text-muted-foreground">
                                      {classStatusLabel(row.status)}
                                    </td>
                                    <td className="py-2 text-muted-foreground">
                                      {formatDate(row.last_sign_in_at)}
                                    </td>
                                  </tr>
                                ))}
                                {!selectedClassReadiness.roster.length ? (
                                  <tr>
                                    <td className="py-4 text-muted-foreground" colSpan={4}>
                                      No active roster rows found.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4 text-[12.5px] text-muted-foreground">
                        Choose a class and refresh readiness to see launch status.
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="min-w-[940px] w-full border-collapse text-left text-[12.5px]">
                        <thead className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Class</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 pr-3 font-medium">Roster</th>
                            <th className="py-2 pr-3 font-medium">Learning</th>
                            <th className="py-2 pr-3 font-medium">Work/media</th>
                            <th className="py-2 font-medium">Support</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(readiness?.classes || []).map((item) => (
                            <tr
                              key={item.class_id}
                              className="cursor-pointer border-b border-border/60 align-top transition-colors hover:bg-muted/40"
                              onClick={() => {
                                setSelectedOrgId(item.organization_id);
                                setSelectedClassId(item.class_id);
                                setRenameClassName(item.class_name);
                              }}
                            >
                              <td className="py-3 pr-3">
                                <div className="font-medium text-foreground">{item.class_name}</div>
                                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                  {item.organization_name}
                                </div>
                              </td>
                              <td className="py-3 pr-3">
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-[11px] ${readinessTone(
                                    item.status,
                                  )}`}
                                >
                                  {readinessLabel(item.status)}
                                </span>
                              </td>
                              <td className="py-3 pr-3 text-muted-foreground">
                                {item.teacher_count} teachers · {item.student_count} students
                                {item.disabled_membership_count ? (
                                  <div className="mt-0.5 text-warning">
                                    {item.disabled_membership_count} inactive memberships
                                  </div>
                                ) : null}
                              </td>
                              <td className="py-3 pr-3 text-muted-foreground">
                                {item.completed_session_count} completions ·{" "}
                                {item.recent_completion_count} recent
                                <div className="mt-0.5">
                                  {item.published_lesson_count} lessons available
                                </div>
                              </td>
                              <td className="py-3 pr-3 text-muted-foreground">
                                {item.assignment_count} assigned · {item.resource_count} resources
                              </td>
                              <td className="py-3 text-muted-foreground">
                                {item.open_alert_count} alerts · {item.recent_error_count} errors ·{" "}
                                {item.audit_event_count} audit events
                              </td>
                            </tr>
                          ))}
                          {!readiness?.classes.length ? (
                            <tr>
                              <td className="py-5 text-muted-foreground" colSpan={6}>
                                No readiness data loaded yet.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                        <h3 className="text-[14px] font-medium text-foreground">Recent errors</h3>
                        <div className="mt-3 space-y-2">
                          {(readiness?.recent_errors || []).slice(0, 5).map((event) => (
                            <div
                              key={event.id}
                              className="border-b border-border/55 pb-2 text-[12px]"
                            >
                              <div className="text-foreground">
                                {event.event_type} · {event.lesson_id || "no lesson"}
                              </div>
                              <div className="mt-0.5 text-muted-foreground">
                                {formatDate(event.created_at)}
                              </div>
                            </div>
                          ))}
                          {!readiness?.recent_errors.length ? (
                            <div className="text-[12px] text-muted-foreground">
                              No recent runtime errors in scope.
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                        <h3 className="text-[14px] font-medium text-foreground">
                          Open interventions
                        </h3>
                        <div className="mt-3 space-y-2">
                          {(readiness?.open_alerts || []).slice(0, 5).map((alert) => (
                            <div
                              key={alert.id}
                              className="border-b border-border/55 pb-2 text-[12px]"
                            >
                              <div className="text-foreground">{alert.title}</div>
                              <div className="mt-0.5 text-muted-foreground">
                                {alert.severity} · {alert.status} · {formatDate(alert.created_at)}
                              </div>
                            </div>
                          ))}
                          {!readiness?.open_alerts.length ? (
                            <div className="text-[12px] text-muted-foreground">
                              No open intervention alerts in scope.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </GradientCard>
              </WorkspacePanel>

              <WorkspacePanel value="school">
                <GradientCard>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.7} />
                          School data ops
                        </div>
                        <h2 className="text-[18px] font-medium text-foreground">
                          CSV fallback, exports, retention, and consent
                        </h2>
                        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                          Run school operations without OAuth: preview roster CSV files, map
                          existing users, export student records, record retention requests, and
                          store class-level feature controls. CSV import does not create accounts or
                          expose passwords.
                        </p>
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {selectedOrg?.name || "Choose an organization"}
                        {selectedClass ? ` · ${selectedClass.name}` : ""}
                      </div>
                    </div>

                    {schoolOpsMessage ? (
                      <div className="rounded-2xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground">
                        {schoolOpsMessage}
                      </div>
                    ) : null}

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                        <h3 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                          <FileSpreadsheet className="h-4 w-4" strokeWidth={1.6} />
                          CSV roster import
                        </h3>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          Paste columns `email,name,role,grade`. Existing Jargon users are mapped;
                          missing users are marked `needs seed` and must be created through account
                          seeding.
                        </p>
                        <textarea
                          value={csvText}
                          onChange={(event) => setCsvText(event.target.value)}
                          rows={6}
                          placeholder={
                            "email,name,role,grade\nstudent@example.com,Student Name,student,Grade 5"
                          }
                          className="jargon-input mt-3 min-h-[130px] font-mono text-[12px]"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void previewCsv()}
                            disabled={
                              !selectedOrgId || !csvText.trim() || schoolOpsBusy === "csv-preview"
                            }
                            className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            Preview CSV
                          </button>
                          <button
                            type="button"
                            onClick={() => void applyCsvImport()}
                            disabled={!csvBatchId || schoolOpsBusy === "csv-apply"}
                            className="rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                          >
                            Apply mapped rows
                          </button>
                        </div>
                        {csvRows.length ? (
                          <div className="mt-4 max-h-[220px] overflow-auto">
                            <table className="min-w-[560px] w-full border-collapse text-left text-[12px]">
                              <thead className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                <tr>
                                  <th className="py-2 pr-3 font-medium">Row</th>
                                  <th className="py-2 pr-3 font-medium">Email</th>
                                  <th className="py-2 pr-3 font-medium">Role</th>
                                  <th className="py-2 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {csvRows.map((row) => (
                                  <tr key={row.row_index} className="border-b border-border/55">
                                    <td className="py-2 pr-3 text-muted-foreground">
                                      {row.row_index}
                                    </td>
                                    <td className="py-2 pr-3 text-foreground">
                                      {String(row.normalized_row.email || "")}
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground">
                                      {String(row.normalized_row.role || "student")}
                                    </td>
                                    <td
                                      className={`py-2 ${
                                        row.status === "ready" || row.status === "applied"
                                          ? "text-success"
                                          : row.status === "needs_seed"
                                            ? "text-warning"
                                            : "text-danger"
                                      }`}
                                    >
                                      {row.status}
                                      {row.error ? (
                                        <div className="text-[11px] text-muted-foreground">
                                          {row.error}
                                        </div>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                        <h3 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                          <FileDown className="h-4 w-4" strokeWidth={1.6} />
                          Student records and reports
                        </h3>
                        <div className="mt-3 grid gap-3">
                          <Field label="Student">
                            <select
                              value={selectedStudentId}
                              onChange={(event) => setSelectedStudentId(event.target.value)}
                              className="jargon-input"
                            >
                              <option value="">Choose a student</option>
                              {classStudentUsers.map((student) => (
                                <option key={student.id} value={student.id}>
                                  {student.label}
                                  {student.email ? ` · ${student.email}` : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => void exportSelectedStudentArchive()}
                              disabled={!selectedStudentId || schoolOpsBusy === "student-archive"}
                              className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              Export archive
                            </button>
                            <button
                              type="button"
                              onClick={() => void generateStudentReport()}
                              disabled={!selectedStudentId || schoolOpsBusy === "progress-report"}
                              className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              Generate progress report
                            </button>
                          </div>
                          <textarea
                            value={retentionReason}
                            onChange={(event) => setRetentionReason(event.target.value)}
                            rows={3}
                            placeholder="Retention/anonymization request reason"
                            className="jargon-input"
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => void requestRetention("anonymize")}
                              disabled={
                                !selectedStudentId || schoolOpsBusy === "retention-anonymize"
                              }
                              className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              Request anonymization
                            </button>
                            <ConfirmButton
                              onConfirm={() => void requestRetention("delete")}
                              disabled={!selectedStudentId || schoolOpsBusy === "retention-delete"}
                              className="rounded-full border border-danger/35 px-4 py-2 text-[12.5px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                              title="Request data deletion?"
                              description="This requests permanent deletion of the selected student's learning records. This cannot be undone."
                              confirmLabel="Request deletion"
                            >
                              Request deletion
                            </ConfirmButton>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                      <h3 className="text-[14px] font-medium text-foreground">
                        Class consent and feature controls
                      </h3>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        Stored for policy enforcement and teacher visibility. Runtime enforcement
                        can grow against these settings as pilot policy gets stricter.
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        {(
                          [
                            ["voice_enabled", "Voice"],
                            ["media_processing_enabled", "Media processing"],
                            ["external_sync_enabled", "External sync"],
                            ["ai_enabled", "AI mentor"],
                            ["quiz_voice_enabled", "Voice in quizzes"],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/45 px-3 py-2 text-[12.5px] text-foreground"
                          >
                            <span>{label}</span>
                            <input
                              type="checkbox"
                              checked={Boolean(consentSettings[key])}
                              onChange={(event) =>
                                setConsentSettings((current) => ({
                                  ...current,
                                  [key]: event.target.checked,
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveConsentSettings()}
                        disabled={!selectedOrgId || schoolOpsBusy === "consent"}
                        className="mt-4 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                      >
                        Save settings
                      </button>
                    </div>
                  </div>
                </GradientCard>
              </WorkspacePanel>

              <WorkspacePanel value="google">
                <GradientCard>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
                          Google Classroom
                        </div>
                        <h2 className="text-[18px] font-medium text-foreground">
                          Course and roster import
                        </h2>
                        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                          Connect a teacher or org-admin Google Classroom account, preview courses
                          and rosters, then import matched users into Jargon classes. This is
                          read-only: assignments, grades, and mastery stay authoritative in Jargon.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void refreshGoogleClassroomMappings()}
                          disabled={classroomLoading || !selectedOrgId}
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${classroomLoading ? "animate-spin" : ""}`}
                            strokeWidth={1.6}
                          />
                          Refresh Classroom
                        </button>
                        <button
                          type="button"
                          onClick={() => void diagnoseClassroom()}
                          disabled={classroomLoading}
                          className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Diagnose
                        </button>
                        <button
                          type="button"
                          onClick={() => void connectGoogleClassroom()}
                          disabled={classroomLoading || !selectedOrgId}
                          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={1.6} />
                          Connect Google
                        </button>
                      </div>
                    </div>

                    {classroomMessage ? (
                      <div className="rounded-2xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground">
                        {classroomMessage}
                      </div>
                    ) : null}

                    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">Connection</h3>
                          <div className="mt-3 space-y-3">
                            <Field label="Google account">
                              <select
                                value={selectedConnectionId}
                                onChange={(event) => {
                                  setSelectedConnectionId(event.target.value);
                                  setClassroomCourses([]);
                                  setSelectedGoogleCourseId("");
                                  setRosterPreview(null);
                                }}
                                className="jargon-input"
                              >
                                <option value="">
                                  {activeClassroomConnections.length
                                    ? "Choose a Google Classroom connection"
                                    : "No active Google connection"}
                                </option>
                                {activeClassroomConnections.map((connection) => (
                                  <option key={connection.id} value={connection.id}>
                                    {connection.google_email}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            {selectedClassroomConnection ? (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px] text-muted-foreground">
                                <div className="font-medium text-foreground">
                                  {selectedClassroomConnection.google_name ||
                                    selectedClassroomConnection.google_email}
                                </div>
                                <div className="mt-1">
                                  Last refreshed{" "}
                                  {formatDate(selectedClassroomConnection.last_refreshed_at)}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void disconnectSelectedGoogleClassroom()}
                                  disabled={classroomLoading}
                                  className="mt-3 rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                >
                                  Disconnect
                                </button>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px] text-muted-foreground">
                                Connect Google Classroom with read-only course, roster, and
                                profile-email scopes. Google secrets and refresh tokens are never
                                sent to the browser.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-[14px] font-medium text-foreground">Courses</h3>
                            <button
                              type="button"
                              onClick={() => void loadGoogleCourses()}
                              disabled={!selectedConnectionId || classroomLoading}
                              className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                            >
                              Load courses
                            </button>
                          </div>
                          <div className="mt-3 space-y-3">
                            <Field label="Google course">
                              <select
                                value={selectedGoogleCourseId}
                                onChange={(event) => {
                                  setSelectedGoogleCourseId(event.target.value);
                                  setRosterPreview(null);
                                }}
                                className="jargon-input"
                              >
                                <option value="">
                                  {classroomCourses.length
                                    ? "Choose a course"
                                    : "Load courses first"}
                                </option>
                                {classroomCourses.map((course) => (
                                  <option key={course.id} value={course.id}>
                                    {course.name}
                                    {course.section ? ` - ${course.section}` : ""}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            {selectedGoogleCourse ? (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px] text-muted-foreground">
                                <div className="font-medium text-foreground">
                                  {selectedGoogleCourse.name}
                                </div>
                                <div className="mt-1">
                                  {selectedGoogleCourse.section || "No section"} ·{" "}
                                  {selectedGoogleCourse.course_state || "unknown state"}
                                </div>
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void previewGoogleRoster()}
                                disabled={!selectedGoogleCourseId || classroomLoading}
                                className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                              >
                                Preview roster
                              </button>
                              <button
                                type="button"
                                onClick={() => void importGoogleCourse()}
                                disabled={!selectedGoogleCourseId || classroomLoading}
                                className="rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                              >
                                Import into Jargon
                              </button>
                            </div>
                            {selectedCourseMapping ? (
                              <div className="rounded-2xl border border-success/30 bg-success/10 p-3 text-[12px] text-success">
                                Mapped to Jargon class{" "}
                                {scope?.classes.find(
                                  (item) => item.id === selectedCourseMapping.class_id,
                                )?.name ||
                                  selectedCourseMapping.class_id ||
                                  "unknown"}{" "}
                                · last sync {formatDate(selectedCourseMapping.last_synced_at)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">
                            Roster preview
                          </h3>
                          {rosterPreview ? (
                            <div className="mt-3 space-y-4">
                              <div className="grid gap-3 sm:grid-cols-4">
                                <MiniStat
                                  label="Teachers"
                                  value={String(rosterPreview.teachers.length)}
                                />
                                <MiniStat
                                  label="Students"
                                  value={String(rosterPreview.students.length)}
                                />
                                <MiniStat
                                  label="Matched"
                                  value={String(
                                    [...rosterPreview.teachers, ...rosterPreview.students].filter(
                                      (person) => person.matched,
                                    ).length,
                                  )}
                                />
                                <MiniStat
                                  label="Missing"
                                  value={String(
                                    [...rosterPreview.teachers, ...rosterPreview.students].filter(
                                      (person) => !person.matched,
                                    ).length,
                                  )}
                                />
                              </div>
                              <RosterPreviewTable
                                title="Teachers"
                                people={rosterPreview.teachers}
                              />
                              <RosterPreviewTable
                                title="Students"
                                people={rosterPreview.students}
                              />
                            </div>
                          ) : (
                            <div className="mt-3 rounded-2xl border border-border/70 bg-background/55 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                              Preview before importing. Existing Jargon users are matched by email.
                              Missing users are not created here; seed them through the existing
                              roster tools and import again.
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">
                            Recent Classroom syncs
                          </h3>
                          <div className="mt-3 space-y-2">
                            {(classroom?.sync_runs || []).slice(0, 6).map((run) => (
                              <div
                                key={run.id}
                                className="border-b border-border/55 pb-2 text-[12px]"
                              >
                                <div className="text-foreground">
                                  {run.action.replaceAll("_", " ")} · {run.status}
                                </div>
                                <div className="mt-0.5 text-muted-foreground">
                                  {formatDate(run.started_at)} · {JSON.stringify(run.counts)}
                                </div>
                              </div>
                            ))}
                            {!classroom?.sync_runs.length ? (
                              <div className="text-[12px] text-muted-foreground">
                                No Classroom sync runs yet.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </GradientCard>
              </WorkspacePanel>

              <WorkspacePanel value="canvas">
                <GradientCard>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
                          Canvas LMS
                        </div>
                        <h2 className="text-[18px] font-medium text-foreground">
                          Course and roster import
                        </h2>
                        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                          Connect a teacher or org-admin Canvas account for your institution,
                          preview courses and rosters, then import matched users into Jargon
                          classes. This is read-only: assignments, grades, and mastery stay
                          authoritative in Jargon. Grade passback and scheduled sync arrive in later
                          phases.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void refreshCanvasMappings()}
                          disabled={canvasLoading || !selectedOrgId}
                          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${canvasLoading ? "animate-spin" : ""}`}
                            strokeWidth={1.6}
                          />
                          Refresh Canvas
                        </button>
                        <button
                          type="button"
                          onClick={() => void diagnoseCanvasFn()}
                          disabled={canvasLoading}
                          className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Diagnose
                        </button>
                        <button
                          type="button"
                          onClick={() => void connectCanvas()}
                          disabled={canvasLoading || !selectedOrgId || !canvasBaseUrl.trim()}
                          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={1.6} />
                          Connect Canvas
                        </button>
                      </div>
                    </div>

                    {canvasMessage ? (
                      <div className="rounded-2xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground">
                        {canvasMessage}
                      </div>
                    ) : null}

                    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">Connection</h3>
                          <div className="mt-3 space-y-3">
                            <Field label="Canvas base URL">
                              <input
                                type="url"
                                inputMode="url"
                                placeholder="https://school.instructure.com"
                                value={canvasBaseUrl}
                                onChange={(event) => setCanvasBaseUrl(event.target.value)}
                                className="jargon-input"
                              />
                            </Field>
                            <Field label="Canvas account">
                              <select
                                value={selectedCanvasConnectionId}
                                onChange={(event) => {
                                  setSelectedCanvasConnectionId(event.target.value);
                                  setCanvasCourses([]);
                                  setSelectedCanvasCourseId("");
                                  setCanvasRosterPreview(null);
                                }}
                                className="jargon-input"
                              >
                                <option value="">
                                  {activeCanvasConnections.length
                                    ? "Choose a Canvas connection"
                                    : "No active Canvas connection"}
                                </option>
                                {activeCanvasConnections.map((connection) => (
                                  <option key={connection.id} value={connection.id}>
                                    {connection.canvas_login_id || connection.canvas_name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            {selectedCanvasConnection ? (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px] text-muted-foreground">
                                <div className="font-medium text-foreground">
                                  {selectedCanvasConnection.canvas_name ||
                                    selectedCanvasConnection.canvas_login_id}
                                </div>
                                <div className="mt-1 break-all">
                                  {selectedCanvasConnection.base_url}
                                </div>
                                <div className="mt-1">
                                  Last refreshed{" "}
                                  {formatDate(selectedCanvasConnection.last_refreshed_at)}
                                </div>
                                <label className="mt-3 flex items-center gap-2 text-[11.5px] text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={selectedCanvasConnection.auto_sync}
                                    onChange={(event) =>
                                      void toggleCanvasAutoSync(event.target.checked)
                                    }
                                    disabled={canvasLoading}
                                  />
                                  <span>
                                    Auto-sync on schedule
                                    <span className="ml-1 text-muted-foreground">
                                      (daily roster + grade sync)
                                    </span>
                                  </span>
                                </label>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void syncCanvasNow()}
                                    disabled={canvasLoading}
                                    className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                                  >
                                    Sync now
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void disconnectSelectedCanvas()}
                                    disabled={canvasLoading}
                                    className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                  >
                                    Disconnect
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px] text-muted-foreground">
                                Enter your institution Canvas URL, then connect a teacher or
                                org-admin account. Canvas secrets and refresh tokens are never sent
                                to the browser.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-[14px] font-medium text-foreground">Courses</h3>
                            <button
                              type="button"
                              onClick={() => void loadCanvasCourses()}
                              disabled={!selectedCanvasConnectionId || canvasLoading}
                              className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                            >
                              Load courses
                            </button>
                          </div>
                          <div className="mt-3 space-y-3">
                            <Field label="Canvas course">
                              <select
                                value={selectedCanvasCourseId}
                                onChange={(event) => {
                                  setSelectedCanvasCourseId(event.target.value);
                                  setCanvasRosterPreview(null);
                                }}
                                className="jargon-input"
                              >
                                <option value="">
                                  {canvasCourses.length ? "Choose a course" : "Load courses first"}
                                </option>
                                {canvasCourses.map((course) => (
                                  <option key={course.id} value={course.id}>
                                    {course.name}
                                    {course.course_code ? ` (${course.course_code})` : ""}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            {selectedCanvasCourse ? (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px] text-muted-foreground">
                                <div className="font-medium text-foreground">
                                  {selectedCanvasCourse.name}
                                </div>
                                <div className="mt-1">
                                  {selectedCanvasCourse.course_code || "No course code"} ·{" "}
                                  {selectedCanvasCourse.workflow_state || "unknown state"}
                                </div>
                              </div>
                            ) : null}
                            <div className="rounded-2xl border border-border/70 bg-background/55 p-3">
                              <label className="flex items-start gap-2.5 text-[12.5px] text-foreground">
                                <input
                                  type="checkbox"
                                  checked={canvasCreateAccounts}
                                  onChange={(event) =>
                                    setCanvasCreateAccounts(event.target.checked)
                                  }
                                  className="mt-0.5"
                                />
                                <span>
                                  Create Jargon accounts for unmatched roster members
                                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                                    Missing students/teachers get a new account with the temporary
                                    password below. Existing users are still linked by email.
                                  </span>
                                </span>
                              </label>
                              {canvasCreateAccounts ? (
                                <div className="mt-3">
                                  <Field label="Temporary password for new accounts">
                                    <input
                                      type="text"
                                      autoComplete="off"
                                      placeholder={`At least ${MIN_TEMP_PASSWORD_LENGTH} characters`}
                                      value={canvasDefaultPassword}
                                      onChange={(event) =>
                                        setCanvasDefaultPassword(event.target.value)
                                      }
                                      className="jargon-input"
                                    />
                                  </Field>
                                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                                    Share this password with new users; they should change it after
                                    first sign-in. It is sent only to the server to provision
                                    accounts.
                                  </p>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void previewCanvasRosterFn()}
                                disabled={!selectedCanvasCourseId || canvasLoading}
                                className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                              >
                                Preview roster
                              </button>
                              <button
                                type="button"
                                onClick={() => void importCanvasCourseFn()}
                                disabled={
                                  !selectedCanvasCourseId ||
                                  canvasLoading ||
                                  (canvasCreateAccounts &&
                                    canvasDefaultPassword.trim().length < MIN_TEMP_PASSWORD_LENGTH)
                                }
                                className="rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                              >
                                {canvasCreateAccounts
                                  ? "Import + create accounts"
                                  : "Import into Jargon"}
                              </button>
                            </div>
                            {selectedCanvasCourseMapping ? (
                              <div className="rounded-2xl border border-success/30 bg-success/10 p-3 text-[12px] text-success">
                                Mapped to Jargon class{" "}
                                {scope?.classes.find(
                                  (item) => item.id === selectedCanvasCourseMapping.class_id,
                                )?.name ||
                                  selectedCanvasCourseMapping.class_id ||
                                  "unknown"}{" "}
                                · last sync {formatDate(selectedCanvasCourseMapping.last_synced_at)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">
                            Roster preview
                          </h3>
                          {canvasRosterPreview ? (
                            <div className="mt-3 space-y-4">
                              <div className="grid gap-3 sm:grid-cols-4">
                                <MiniStat
                                  label="Teachers"
                                  value={String(canvasRosterPreview.teachers.length)}
                                />
                                <MiniStat
                                  label="Students"
                                  value={String(canvasRosterPreview.students.length)}
                                />
                                <MiniStat
                                  label="Matched"
                                  value={String(
                                    [
                                      ...canvasRosterPreview.teachers,
                                      ...canvasRosterPreview.students,
                                    ].filter((person) => person.matched).length,
                                  )}
                                />
                                <MiniStat
                                  label="Missing"
                                  value={String(
                                    [
                                      ...canvasRosterPreview.teachers,
                                      ...canvasRosterPreview.students,
                                    ].filter((person) => !person.matched).length,
                                  )}
                                />
                              </div>
                              <RosterPreviewTable
                                title="Teachers"
                                people={canvasRosterPreview.teachers}
                              />
                              <RosterPreviewTable
                                title="Students"
                                people={canvasRosterPreview.students}
                              />
                            </div>
                          ) : (
                            <div className="mt-3 rounded-2xl border border-border/70 bg-background/55 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                              Preview before importing. Existing Jargon users are matched by email.
                              Missing users are not created here; seed them through the existing
                              roster tools and import again.
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <h3 className="text-[14px] font-medium text-foreground">
                            Recent Canvas syncs
                          </h3>
                          <div className="mt-3 space-y-2">
                            {(canvas?.sync_runs || []).slice(0, 6).map((run) => (
                              <div
                                key={run.id}
                                className="border-b border-border/55 pb-2 text-[12px]"
                              >
                                <div className="text-foreground">
                                  {run.action.replaceAll("_", " ")} · {run.status}
                                </div>
                                <div className="mt-0.5 text-muted-foreground">
                                  {formatDate(run.started_at)} · {JSON.stringify(run.counts)}
                                </div>
                              </div>
                            ))}
                            {!canvas?.sync_runs.length ? (
                              <div className="text-[12px] text-muted-foreground">
                                No Canvas sync runs yet.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-[14px] font-medium text-foreground">
                            Grade passback
                          </h3>
                          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                            Link a Jargon assessment or assignment to a Canvas assignment, then push
                            scores. Grades are sent as a percentage of the Canvas assignment&apos;s
                            points. Needs an active connection with grade-write permission on the
                            connected Canvas account.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void pushGrades()}
                          disabled={
                            gradeLoading ||
                            !selectedGradeMappingId ||
                            !(gradeTargets?.grade_links.length ?? 0)
                          }
                          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${gradeLoading ? "animate-spin" : ""}`}
                            strokeWidth={1.6}
                          />
                          Push all grades
                        </button>
                      </div>

                      <div className="mt-3">
                        <Field label="Imported Canvas course">
                          <select
                            value={selectedGradeMappingId}
                            onChange={(event) => {
                              setSelectedGradeMappingId(event.target.value);
                              setGradeTargets(null);
                              setGradeMessage("");
                              if (event.target.value) void loadGradeTargets(event.target.value);
                            }}
                            className="jargon-input"
                          >
                            <option value="">
                              {gradableCanvasMappings.length
                                ? "Choose an imported course"
                                : "Import a Canvas course first"}
                            </option>
                            {gradableCanvasMappings.map((mapping) => (
                              <option key={mapping.id} value={mapping.id}>
                                {mapping.canvas_course_name}
                                {mapping.canvas_course_code
                                  ? ` (${mapping.canvas_course_code})`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      {gradeMessage ? (
                        <div className="mt-3 rounded-2xl border border-border bg-background/55 px-3 py-2 text-[12px] text-muted-foreground">
                          {gradeMessage}
                        </div>
                      ) : null}

                      {selectedGradeMappingId && gradeTargets ? (
                        <div className="mt-4 space-y-4">
                          <div className="space-y-2">
                            {gradeTargets.grade_links.length ? (
                              gradeTargets.grade_links.map((link) => {
                                const jargonTitle =
                                  gradeTargets.jargon_items.find(
                                    (item) =>
                                      item.kind === link.jargon_kind && item.id === link.jargon_id,
                                  )?.title || `${link.jargon_kind} ${link.jargon_id.slice(0, 8)}`;
                                const canvasName =
                                  gradeTargets.canvas_assignments.find(
                                    (assignment) => assignment.id === link.canvas_assignment_id,
                                  )?.name || `Canvas assignment ${link.canvas_assignment_id}`;
                                return (
                                  <div
                                    key={link.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 p-3 text-[12.5px]"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-foreground">
                                        <span className="text-muted-foreground">
                                          {link.jargon_kind}
                                        </span>{" "}
                                        {jargonTitle}{" "}
                                        <span className="text-muted-foreground">→</span>{" "}
                                        {canvasName}
                                      </div>
                                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                        {link.last_pushed_at
                                          ? `Last pushed ${formatDate(link.last_pushed_at)}`
                                          : "Not pushed yet"}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void pushGrades(link.id)}
                                        disabled={gradeLoading}
                                        className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                                      >
                                        Push
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void removeGradeLink(link.id)}
                                        disabled={gradeLoading}
                                        className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-[12px] text-muted-foreground">
                                No grade links yet. Link a Jargon item to a Canvas assignment below.
                              </div>
                            )}
                          </div>

                          <div className="rounded-2xl border border-border/70 bg-background/55 p-3">
                            <h4 className="text-[12.5px] font-medium text-foreground">
                              Link a Jargon item
                            </h4>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <Field label="Jargon graded item">
                                <select
                                  value={newGradeJargon}
                                  onChange={(event) => setNewGradeJargon(event.target.value)}
                                  className="jargon-input"
                                >
                                  <option value="">
                                    {gradeTargets.jargon_items.length
                                      ? "Choose an assessment or assignment"
                                      : "No graded items in this class"}
                                  </option>
                                  {gradeTargets.jargon_items.map((item) => (
                                    <option
                                      key={`${item.kind}:${item.id}`}
                                      value={`${item.kind}:${item.id}`}
                                    >
                                      {item.kind === "assessment" ? "Assessment" : "Assignment"}:{" "}
                                      {item.title}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Canvas assignment">
                                <select
                                  value={newGradeCanvasAssignment}
                                  onChange={(event) =>
                                    setNewGradeCanvasAssignment(event.target.value)
                                  }
                                  className="jargon-input"
                                >
                                  <option value="">
                                    {gradeTargets.canvas_assignments.length
                                      ? "Choose a Canvas assignment"
                                      : "No Canvas assignments found"}
                                  </option>
                                  {gradeTargets.canvas_assignments.map((assignment) => (
                                    <option key={assignment.id} value={assignment.id}>
                                      {assignment.name}
                                      {assignment.points_possible != null
                                        ? ` (${assignment.points_possible} pts)`
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            </div>
                            <button
                              type="button"
                              onClick={() => void createGradeLink()}
                              disabled={
                                gradeLoading || !newGradeJargon || !newGradeCanvasAssignment
                              }
                              className="mt-3 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                            >
                              Link item
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </GradientCard>
              </WorkspacePanel>

              <WorkspacePanel value="cost">
                <GradientCard>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
                          AI/runtime operations
                        </div>
                        <h2 className="text-[18px] font-medium text-foreground">
                          Usage, reliability, and model load
                        </h2>
                        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                          {costVisible
                            ? "Platform admins see estimated model cost, tokens, latency, and failure signals across the pilot."
                            : "Org admins see scoped usage and reliability. Dollar-cost totals stay platform-admin only."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshCostDashboard()}
                        disabled={costLoading}
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${costLoading ? "animate-spin" : ""}`}
                          strokeWidth={1.6}
                        />
                        Refresh metrics
                      </button>
                    </div>

                    {costMessage ? (
                      <div className="rounded-2xl border border-border bg-background/45 px-3 py-2 text-[12.5px] text-muted-foreground">
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

                    <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-[14px] font-medium text-foreground">
                            Runtime health
                          </h3>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Engine wakeups, retry recoveries, controlled code errors, and pilot
                            safety limits from recent runtime events.
                          </p>
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
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
                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                        <h3 className="text-[14px] font-medium text-foreground">
                          Recent model events
                        </h3>
                        <div className="mt-3 space-y-2">
                          {(costDashboard?.recent_model_events || []).slice(0, 6).map((event) => (
                            <div
                              key={event.id}
                              className="border-b border-border/55 pb-2 text-[12px]"
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
                            <div className="text-[12px] text-muted-foreground">
                              No model events recorded yet.
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                        <h3 className="text-[14px] font-medium text-foreground">Runtime errors</h3>
                        <div className="mt-3 space-y-2">
                          {(costDashboard?.recent_runtime_errors || []).slice(0, 6).map((event) => (
                            <div
                              key={event.id}
                              className="border-b border-border/55 pb-2 text-[12px]"
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
                            <div className="text-[12px] text-muted-foreground">
                              No runtime errors in the current scope.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </GradientCard>
              </WorkspacePanel>

              <WorkspacePanel value="ops">
                <GradientCard>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-[16px] font-medium text-foreground">
                          Operations dashboard
                        </h2>
                        <p className="mt-1 text-[12.5px] text-muted-foreground">
                          {isPlatformLevel
                            ? "Platform-admin tools for classroom setup, roster repair, and account support."
                            : "Org-admin tools scoped to your own organization."}
                        </p>
                      </div>
                      {opsMessage ? (
                        <div className="max-w-lg rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground">
                          {opsMessage}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-4">
                      <Stat label="Organizations" value={scope?.organizations.length || 0} />
                      <Stat label="Classes" value={scope?.classes.length || 0} />
                      <Stat label="Users" value={scope?.users.length || 0} />
                      <Stat label="Seed batches" value={scope?.seed_batches.length || 0} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]">
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                          <Field label="Organization">
                            <select
                              value={selectedOrgId}
                              onChange={(event) => {
                                const orgId = event.target.value;
                                const firstClass = (scope?.classes || []).find(
                                  (item) => item.organization_id === orgId,
                                );
                                setSelectedOrgId(orgId);
                                setSelectedClassId(firstClass?.id || "");
                                setRenameClassName(firstClass?.name || "");
                              }}
                              className="jargon-input"
                            >
                              {(scope?.organizations || []).map((organization) => (
                                <option key={organization.id} value={organization.id}>
                                  {organization.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Class">
                            <select
                              value={selectedClassId}
                              onChange={(event) => {
                                const classId = event.target.value;
                                setSelectedClassId(classId);
                                setRenameClassName(
                                  scope?.classes.find((item) => item.id === classId)?.name || "",
                                );
                              }}
                              className="jargon-input"
                            >
                              {orgClasses.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} · {item.status}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
                            <Plus className="h-4 w-4" strokeWidth={1.6} />
                            Create class
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              value={newClassName}
                              onChange={(event) => setNewClassName(event.target.value)}
                              placeholder={
                                selectedOrg ? `New class in ${selectedOrg.name}` : "New class name"
                              }
                              className="jargon-input"
                            />
                            <button
                              type="button"
                              onClick={() => void createClass()}
                              disabled={
                                !selectedOrgId || !newClassName.trim() || opsBusy === "create-class"
                              }
                              className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                            >
                              Create
                            </button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
                            <Archive className="h-4 w-4" strokeWidth={1.6} />
                            Class settings
                          </div>
                          <div className="flex flex-col gap-2">
                            <input
                              value={renameClassName}
                              onChange={(event) => setRenameClassName(event.target.value)}
                              placeholder="Selected class name"
                              className="jargon-input"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void updateSelectedClass()}
                                disabled={
                                  !selectedClassId ||
                                  !renameClassName.trim() ||
                                  opsBusy === "update-class"
                                }
                                className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                              >
                                Save class
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void updateSelectedClass(
                                    selectedClass?.status === "archived" ? "active" : "archived",
                                  )
                                }
                                disabled={!selectedClassId || opsBusy === "update-class"}
                                className="rounded-full border border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                              >
                                {selectedClass?.status === "archived" ? "Reactivate" : "Archive"}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-foreground">
                            <UserPlus className="h-4 w-4" strokeWidth={1.6} />
                            Add existing user
                          </div>
                          <div className="flex flex-col gap-2">
                            <select
                              value={existingUserId}
                              onChange={(event) => setExistingUserId(event.target.value)}
                              className="jargon-input"
                            >
                              <option value="">Choose an existing seeded user</option>
                              {addableUsers.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.email || user.id}
                                </option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <select
                                value={existingUserRole}
                                onChange={(event) =>
                                  setExistingUserRole(event.target.value as PilotRole)
                                }
                                className="jargon-input max-w-[140px]"
                              >
                                <option value="student">student</option>
                                <option value="teacher">teacher</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => void addExistingUser()}
                                disabled={
                                  !existingUserId || !selectedClassId || opsBusy === "add-user"
                                }
                                className="rounded-full border border-border px-4 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h3 className="text-[14px] font-medium text-foreground">
                                {selectedClass?.name || "Choose a class"}
                              </h3>
                              <p className="mt-1 text-[12px] text-muted-foreground">
                                {activeTeacherCount} active teacher
                                {activeTeacherCount === 1 ? "" : "s"} · {activeStudentCount} active
                                student
                                {activeStudentCount === 1 ? "" : "s"}
                              </p>
                            </div>
                            <ShieldCheck
                              className="h-4 w-4 text-muted-foreground"
                              strokeWidth={1.6}
                            />
                          </div>

                          <div className="mt-4 overflow-x-auto">
                            <table className="min-w-[820px] w-full border-collapse text-left text-[12.5px]">
                              <thead className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                <tr>
                                  <th className="py-2 pr-3 font-medium">Person</th>
                                  <th className="py-2 pr-3 font-medium">Role</th>
                                  <th className="py-2 pr-3 font-medium">Status</th>
                                  <th className="py-2 pr-3 font-medium">Password reset</th>
                                  <th className="py-2 font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {classMemberships.map((membership) => {
                                  const user = userById.get(membership.user_id);
                                  const profile = profileById.get(membership.user_id);
                                  const orgMembership = organizationMembershipByUser.get(
                                    membership.user_id,
                                  );
                                  const inactive = membership.status !== "active";
                                  return (
                                    <tr
                                      key={membership.id}
                                      className="border-b border-border/60 align-top"
                                    >
                                      <td className="py-3 pr-3">
                                        <div className="font-medium text-foreground">
                                          {profile?.name || user?.email || membership.user_id}
                                        </div>
                                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                          {user?.email || "No email loaded"} · grade{" "}
                                          {profile?.grade || "n/a"}
                                        </div>
                                        <div className="mt-0.5 text-[11px] text-muted-foreground/75">
                                          Last sign-in {formatDate(user?.last_sign_in_at)}
                                        </div>
                                      </td>
                                      <td className="py-3 pr-3">
                                        <select
                                          value={membership.role}
                                          onChange={(event) =>
                                            void updateMembershipRole(
                                              membership,
                                              event.target.value as PilotRole,
                                            )
                                          }
                                          className="jargon-input min-w-[110px]"
                                        >
                                          <option value="student">student</option>
                                          <option value="teacher">teacher</option>
                                        </select>
                                        <div className="mt-1 text-[11px] text-muted-foreground">
                                          {isPlatformLevel && orgMembership ? (
                                            <label className="mt-2 block">
                                              <span className="mb-1 block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                                Org role
                                              </span>
                                              <select
                                                value={orgMembership.role}
                                                onChange={(event) =>
                                                  void updateOrganizationMembershipRole(
                                                    orgMembership,
                                                    event.target.value as OrganizationRole,
                                                  )
                                                }
                                                className="jargon-input min-w-[132px]"
                                              >
                                                <option value="student">student</option>
                                                <option value="teacher">teacher</option>
                                                <option value="org_admin">org_admin</option>
                                              </select>
                                            </label>
                                          ) : (
                                            <>Org: {orgMembership?.role || "none"}</>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-3 pr-3">
                                        <span
                                          className={`rounded-full border px-2.5 py-1 text-[11px] ${
                                            inactive
                                              ? "border-warning/35 text-warning"
                                              : "border-success/35 text-success"
                                          }`}
                                        >
                                          {classStatusLabel(membership.status)}
                                        </span>
                                      </td>
                                      <td className="py-3 pr-3">
                                        <div className="flex min-w-[230px] gap-2">
                                          <input
                                            type="password"
                                            value={resetPasswords[membership.user_id] || ""}
                                            onChange={(event) =>
                                              setResetPasswords((current) => ({
                                                ...current,
                                                [membership.user_id]: event.target.value,
                                              }))
                                            }
                                            placeholder="New temporary password"
                                            className="jargon-input"
                                          />
                                          <ConfirmButton
                                            onConfirm={() =>
                                              void resetUserPassword(membership.user_id)
                                            }
                                            disabled={opsBusy === `reset-${membership.user_id}`}
                                            ariaLabel="Reset temporary password"
                                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                            title="Reset this user's password?"
                                            description="Sets a new temporary password for this user in Supabase Auth. Make sure you've typed the new password in the field first."
                                            confirmLabel="Reset password"
                                          >
                                            <KeyRound className="h-4 w-4" strokeWidth={1.6} />
                                          </ConfirmButton>
                                        </div>
                                      </td>
                                      <td className="py-3">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void updateMembershipStatus(
                                              membership,
                                              inactive ? "active" : "disabled",
                                            )
                                          }
                                          disabled={opsBusy === `status-${membership.id}`}
                                          className="rounded-full border border-border px-3 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-45"
                                        >
                                          {inactive ? "Reactivate" : "Disable"}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {!classMemberships.length ? (
                                  <tr>
                                    <td className="py-5 text-muted-foreground" colSpan={5}>
                                      No roster rows for this class yet.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                            <h3 className="text-[14px] font-medium text-foreground">
                              Recent seed batches
                            </h3>
                            <div className="mt-3 space-y-2">
                              {(scope?.seed_batches || []).slice(0, 5).map((batch) => (
                                <div
                                  key={batch.id}
                                  className="border-b border-border/55 pb-2 text-[12px]"
                                >
                                  <div className="text-foreground">{batch.label}</div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    {batch.status} · {formatDate(batch.created_at)}
                                  </div>
                                </div>
                              ))}
                              {!scope?.seed_batches.length ? (
                                <div className="text-[12px] text-muted-foreground">
                                  No seed batches yet.
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                            <h3 className="text-[14px] font-medium text-foreground">
                              Recent audit events
                            </h3>
                            <div className="mt-3 space-y-2">
                              {(scope?.audit_events || []).slice(0, 6).map((event) => (
                                <div
                                  key={event.id}
                                  className="border-b border-border/55 pb-2 text-[12px]"
                                >
                                  <div className="text-foreground">{event.event_type}</div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    {event.entity_type} · {formatDate(event.created_at)}
                                  </div>
                                </div>
                              ))}
                              {!scope?.audit_events.length ? (
                                <div className="text-[12px] text-muted-foreground">
                                  No audit events yet.
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </GradientCard>
              </WorkspacePanel>

              {isPlatformLevel ? (
                <WorkspacePanel value="seeding">
                  <>
                    <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
                      <GradientCard>
                        <div className="space-y-5 p-5">
                          <div>
                            <h2 className="text-[16px] font-medium text-foreground">Class setup</h2>
                            <p className="mt-1 text-[12.5px] text-muted-foreground">
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
                              className={`mt-1.5 text-[12px] ${
                                hasShortDefaultPassword ? "text-danger" : "text-muted-foreground"
                              }`}
                            >
                              {hasShortDefaultPassword
                                ? `Use at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`
                                : "Required unless every row has a password override."}
                            </p>
                          </Field>
                          <div className="rounded-2xl border border-border bg-muted/30 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
                            Bootstrap note: the first platform admin is still created manually in
                            Supabase by inserting the signed-in admin user id into{" "}
                            <code>public.platform_admins</code>.
                          </div>
                        </div>
                      </GradientCard>

                      <GradientCard>
                        <div className="space-y-4 p-5">
                          <div>
                            <h2 className="text-[16px] font-medium text-foreground">
                              Roster paste
                            </h2>
                            <p className="mt-1 text-[12.5px] text-muted-foreground">
                              Paste CSV or tab-separated rows. Header fields can be email, name,
                              role, grade, password.
                            </p>
                          </div>
                          <textarea
                            value={pasteText}
                            onChange={(event) => setPasteText(event.target.value)}
                            placeholder={
                              "email,name,role,grade,password\nteacher@example.com,Teacher Name,teacher,,temporary123\nstudent@example.com,Student Name,student,Grade 4,temporary123"
                            }
                            className="min-h-[170px] w-full resize-y rounded-2xl border border-border bg-background/70 p-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-foreground/50"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={applyPaste}
                              className="rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-transform hover:-translate-y-[1px]"
                            >
                              Load pasted roster
                            </button>
                            <button
                              type="button"
                              onClick={() => setRows((current) => [...current, blankRow()])}
                              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
                            >
                              <Plus className="h-4 w-4" strokeWidth={1.6} /> Add row
                            </button>
                          </div>
                        </div>
                      </GradientCard>
                    </div>

                    <GradientCard>
                      <div className="p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-[16px] font-medium text-foreground">Roster rows</h2>
                            <p className="mt-1 text-[12.5px] text-muted-foreground">
                              {validRows.length} ready{" "}
                              {validRows.length === 1 ? "account" : "accounts"}.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={seedRoster}
                            disabled={!canSeed}
                            title={formErrors[0] || "Seed classroom"}
                            className="rounded-full bg-foreground px-5 py-2.5 text-[13px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {submitting ? "Seeding..." : "Seed classroom"}
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-[820px] w-full border-collapse text-left text-[13px]">
                            <thead className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
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
                                        <div className="text-[11px] text-danger">
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
                                        <div className="text-[11px] text-danger">
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
                                        <div className="text-[11px] text-danger">
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
                    </GradientCard>

                    {(message || results.length > 0) && (
                      <GradientCard>
                        <div className="space-y-4 p-5">
                          {message && (
                            <div className="flex items-start gap-2 text-[13px] text-muted-foreground">
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
                            <div className="overflow-x-auto">
                              <table className="min-w-[680px] w-full border-collapse text-left text-[13px]">
                                <thead className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
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
                      </GradientCard>
                    )}
                  </>
                </WorkspacePanel>
              ) : null}
            </Tabs>
          </>
        )}
      </main>
    </AdminShell>
  );
}

function AdminShell({
  email,
  message,
  children,
}: {
  email: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.24} />
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1240px] items-center justify-between gap-2 px-3 sm:px-6">
            <div className="flex items-center gap-4">
              <Link to="/chat" className="font-serif text-[22px] tracking-tight text-foreground">
                Jargon
              </Link>
              <PlaceSwitcher active="admin" />
            </div>
            {email ? <SettingsMenu email={email} /> : null}
          </div>
        </div>
      </header>
      {children || (
        <main className="relative z-10 mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center px-5 text-center">
          <div className="text-[14px] text-muted-foreground">{message}</div>
        </main>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/75 bg-background/45 p-4">
      <div className="text-[24px] font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 px-3 py-2">
      <div className="text-[18px] font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

type RosterPreviewPerson = {
  display_name: string;
  email: string;
  role: "student" | "teacher";
  matched?: boolean;
};

function RosterPreviewTable({ title, people }: { title: string; people: RosterPreviewPerson[] }) {
  return (
    <div>
      <h4 className="text-[12.5px] font-medium text-foreground">{title}</h4>
      <div className="mt-2 max-h-[200px] overflow-auto rounded-2xl border border-border/70 bg-background/45">
        <table className="min-w-[560px] w-full border-collapse text-left text-[12px]">
          <thead className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="py-2 pl-3 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Jargon user</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, index) => (
              <tr
                key={`${person.role}-${person.email || "noemail"}-${index}`}
                className="border-b border-border/55"
              >
                <td className="py-2 pl-3 pr-3 text-foreground">
                  {person.display_name || "Unnamed"}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{person.email || "No email"}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      person.matched
                        ? "border-success/35 text-success"
                        : "border-warning/35 text-warning"
                    }`}
                  >
                    {person.matched ? "matched" : "needs seed"}
                  </span>
                </td>
              </tr>
            ))}
            {!people.length ? (
              <tr>
                <td className="py-4 pl-3 text-muted-foreground" colSpan={3}>
                  No roster rows returned.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
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
    <div className="rounded-2xl border border-border/75 bg-background/45 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10.5px] uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className="mt-2 text-[22px] font-semibold leading-none text-foreground">{value}</div>
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
    <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
      <h3 className="text-[14px] font-medium text-foreground">{title}</h3>
      <div className="mt-3 overflow-x-auto">
        <table
          className={`${wide ? "min-w-[860px]" : "min-w-[620px]"} w-full border-collapse text-left text-[12px]`}
        >
          <thead className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
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
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
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
