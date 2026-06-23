import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Download,
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
import {
  exportClassSnapshot,
  fetchAdminScope,
  fetchPilotReadiness,
  getSession,
  invokeAdminOps,
  invokeAdminSeed,
} from "@/lib/api";
import type {
  AdminActorAccess,
  AdminClass,
  AdminScope,
  AdminSeedResult,
  AdminSeedUser,
  ClassReadiness,
  PilotReadiness,
  PilotRole,
  ReadinessStatus,
  TeacherClassMembership,
} from "@/lib/types";

export const Route = createFileRoute("/admin")({
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
  if (status === "created") return "text-emerald-500";
  if (status === "reused" || status === "skipped") return "text-sky-500";
  return "text-red-500";
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
  if (status === "ready") return "border-emerald-500/40 text-emerald-500";
  if (status === "needs_attention") return "border-amber-500/45 text-amber-500";
  if (status === "needs_setup") return "border-sky-500/45 text-sky-500";
  return "border-red-500/45 text-red-500";
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
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [renameClassName, setRenameClassName] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [existingUserId, setExistingUserId] = useState("");
  const [existingUserRole, setExistingUserRole] = useState<PilotRole>("student");
  const [readiness, setReadiness] = useState<PilotReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessMessage, setReadinessMessage] = useState("");

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
        if (allowed) void refreshReadiness(session.access_token, true);
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

  const refreshScope = async (accessToken = token) => {
    if (!accessToken) return false;
    setScopeLoading(true);
    try {
      const data = await fetchAdminScope(accessToken);
      setActorAccess(data.actorAccess);
      setScope(data.scope);
      const firstOrg = data.scope.organizations[0]?.id || "";
      const nextOrg =
        selectedOrgId && data.scope.organizations.some((org) => org.id === selectedOrgId)
          ? selectedOrgId
          : firstOrg;
      const orgClasses = data.scope.classes.filter((item) => item.organization_id === nextOrg);
      const nextClass =
        selectedClassId && orgClasses.some((item) => item.id === selectedClassId)
          ? selectedClassId
          : orgClasses[0]?.id || "";
      setSelectedOrgId(nextOrg);
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
    if (!orgName.trim()) errors.push("Organization name is required.");
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
    className,
    emailErrors,
    hasShortDefaultPassword,
    nameErrors,
    orgName,
    passwordErrors,
    validRows.length,
  ]);

  const canSeed = !submitting && formErrors.length === 0;
  const isPlatformLevel = actorAccess?.level === "platform_admin";
  const adminLevelLabel = isPlatformLevel ? "Platform admin" : "Org admin";

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

  const runAdminOp = async (busyKey: string, success: string, operation: () => Promise<void>) => {
    if (!token) return;
    setOpsBusy(busyKey);
    setOpsMessage("");
    try {
      await operation();
      void refreshReadiness(token, true);
      setOpsMessage(success);
    } catch (error) {
      setOpsMessage((error as Error).message || "Admin operation failed.");
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
      if (!orgName.trim()) throw new Error("Organization name is required.");
      if (!className.trim()) throw new Error("Class name is required.");
      if (!validRows.length) throw new Error("Add at least one teacher or student.");

      const response = await invokeAdminSeed({
        accessToken: token,
        organization: {
          name: orgName.trim(),
          slug: slugify(orgSlug || orgName),
        },
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
      <main className="relative z-10 mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-5 px-5 py-8">
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
                  Check whether classes can run tomorrow: roster health, lesson availability, recent
                  completions, assignments/resources, errors, alerts, and support activity.
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
                              ? "text-emerald-500"
                              : item.status === "attention"
                                ? "text-amber-500"
                                : "text-sky-500"
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
                                ? "text-red-500"
                                : issue.severity === "attention"
                                  ? "text-amber-500"
                                  : "text-sky-500"
                            }`}
                          >
                            {issue.severity}
                          </span>
                          {issue.message}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-500">
                        No readiness blockers found.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                  <h3 className="text-[14px] font-medium text-foreground">Roster/account health</h3>
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
                                {row.email || "No email loaded"} · grade {row.grade || "n/a"}
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
                          <div className="mt-0.5 text-amber-500">
                            {item.disabled_membership_count} inactive memberships
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">
                        {item.completed_session_count} completions · {item.recent_completion_count}{" "}
                        recent
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
                    <div key={event.id} className="border-b border-border/55 pb-2 text-[12px]">
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
                <h3 className="text-[14px] font-medium text-foreground">Open interventions</h3>
                <div className="mt-3 space-y-2">
                  {(readiness?.open_alerts || []).slice(0, 5).map((alert) => (
                    <div key={alert.id} className="border-b border-border/55 pb-2 text-[12px]">
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

        <GradientCard>
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-medium text-foreground">Operations dashboard</h2>
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
                          !selectedClassId || !renameClassName.trim() || opsBusy === "update-class"
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
                        onChange={(event) => setExistingUserRole(event.target.value as PilotRole)}
                        className="jargon-input max-w-[140px]"
                      >
                        <option value="student">student</option>
                        <option value="teacher">teacher</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void addExistingUser()}
                        disabled={!existingUserId || !selectedClassId || opsBusy === "add-user"}
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
                        {activeTeacherCount} active teacher{activeTeacherCount === 1 ? "" : "s"} ·{" "}
                        {activeStudentCount} active student{activeStudentCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
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
                            <tr key={membership.id} className="border-b border-border/60 align-top">
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
                                      ? "border-amber-500/35 text-amber-500"
                                      : "border-emerald-500/35 text-emerald-500"
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
                                  <button
                                    type="button"
                                    onClick={() => void resetUserPassword(membership.user_id)}
                                    disabled={opsBusy === `reset-${membership.user_id}`}
                                    aria-label="Reset temporary password"
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
                                  >
                                    <KeyRound className="h-4 w-4" strokeWidth={1.6} />
                                  </button>
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
                    <h3 className="text-[14px] font-medium text-foreground">Recent seed batches</h3>
                    <div className="mt-3 space-y-2">
                      {(scope?.seed_batches || []).slice(0, 5).map((batch) => (
                        <div key={batch.id} className="border-b border-border/55 pb-2 text-[12px]">
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
                    <h3 className="text-[14px] font-medium text-foreground">Recent audit events</h3>
                    <div className="mt-3 space-y-2">
                      {(scope?.audit_events || []).slice(0, 6).map((event) => (
                        <div key={event.id} className="border-b border-border/55 pb-2 text-[12px]">
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

        {isPlatformLevel ? (
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
                      className={`jargon-input ${hasShortDefaultPassword ? "border-red-500/60" : ""}`}
                    />
                    <p
                      className={`mt-1.5 text-[12px] ${
                        hasShortDefaultPassword ? "text-red-500" : "text-muted-foreground"
                      }`}
                    >
                      {hasShortDefaultPassword
                        ? `Use at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`
                        : "Required unless every row has a password override."}
                    </p>
                  </Field>
                  <div className="rounded-2xl border border-border bg-muted/30 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    Bootstrap note: the first platform admin is still created manually in Supabase
                    by inserting the signed-in admin user id into{" "}
                    <code>public.platform_admins</code>.
                  </div>
                </div>
              </GradientCard>

              <GradientCard>
                <div className="space-y-4 p-5">
                  <div>
                    <h2 className="text-[16px] font-medium text-foreground">Roster paste</h2>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
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
                      {validRows.length} ready {validRows.length === 1 ? "account" : "accounts"}.
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
                                updateRow(row.rowId, { role: event.target.value as PilotRole })
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
                                  emailErrors[row.rowId] ? "border-red-500/60" : ""
                                }`}
                              />
                              {emailErrors[row.rowId] ? (
                                <div className="text-[11px] text-red-500">
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
                                  nameErrors[row.rowId] ? "border-red-500/60" : ""
                                }`}
                              />
                              {nameErrors[row.rowId] ? (
                                <div className="text-[11px] text-red-500">
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
                                  passwordErrors[row.rowId] ? "border-red-500/60" : ""
                                }`}
                              />
                              {passwordErrors[row.rowId] ? (
                                <div className="text-[11px] text-red-500">
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
                          className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
                          strokeWidth={1.7}
                        />
                      ) : (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                          strokeWidth={1.7}
                        />
                      )}
                      <span>
                        {message}
                        {batchId ? (
                          <span className="ml-2 text-muted-foreground/70">Batch {batchId}</span>
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
                              <td className={`py-2 pr-3 font-medium ${resultTone(result.status)}`}>
                                {result.status}
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">{result.role}</td>
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
        ) : (
          <GradientCard>
            <div className="p-5 text-[13px] leading-relaxed text-muted-foreground">
              Bulk roster seeding stays platform-admin only for now. Org admins can create classes,
              add existing organization users to classes, reset passwords, disable or reactivate
              memberships, and change class roles inside their own organization.
            </div>
          </GradientCard>
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
      <AmbientCanvas intensity={0.28} />
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1200px] items-center justify-between gap-2 px-3 sm:px-6">
            <Link to="/chat" className="font-serif text-[22px] tracking-tight text-foreground">
              Jargon
            </Link>
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
