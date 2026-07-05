// Jargon admin operations.
// Platform admins have global access; org admins are scoped to their own organization.
// Service-role access stays inside this Edge Function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;

type Config = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  authorization: string;
};

type MembershipType = "organization" | "class";

type ActorAccess = {
  level: "platform_admin" | "org_admin";
  organizationIds: string[];
};

type ReadinessStatus = "ready" | "needs_setup" | "needs_attention" | "blocked";

type ReadinessIssue = {
  severity: "setup" | "attention" | "blocked";
  message: string;
};

type ReadinessChecklistItem = {
  label: string;
  status: "ok" | "missing" | "attention";
};

type CostMetric = {
  key: string;
  label: string;
  organization_id?: string | null;
  class_id?: string | null;
  user_id?: string | null;
  model?: string | null;
  task_type?: string | null;
  model_event_count: number;
  runtime_event_count: number;
  speech_event_count: number;
  session_count: number;
  completion_count: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  latency_count: number;
  latency_total_ms: number;
  average_latency_ms: number | null;
  error_count: number;
  error_rate: number | null;
};

type RuntimeHealthSummary = {
  run_failures: number;
  engine_wake_timeouts: number;
  engine_retry_successes: number;
  rate_limit_hits: number;
  controlled_errors: number;
  last_runtime_event_at: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorResponse(message: string, status = 500): Response {
  return json({ status: "error", error: message }, status);
}

function envConfig(req: Request): Config {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization") || "";

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }
  if (!authorization) throw new Error("Authentication is required.");
  return { url, anonKey, serviceRoleKey, authorization };
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanId(value: unknown): string {
  return cleanText(value);
}

function numericDate(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function membershipType(value: unknown): MembershipType | null {
  const text = cleanText(value).toLowerCase();
  if (text === "organization" || text === "class") return text;
  return null;
}

async function userFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as DbRow).message)
        : res.statusText;
    throw new Error(message);
  }
  return data;
}

async function serviceFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as DbRow).message)
        : res.statusText;
    throw new Error(message);
  }
  return data;
}

async function fetchCurrentUser(config: Config): Promise<DbRow> {
  const data = await userFetch(config, "/auth/v1/user");
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as DbRow).id !== "string"
  ) {
    throw new Error("Could not identify authenticated user.");
  }
  return data as DbRow;
}

async function fetchActorAccess(
  config: Config,
  userId: string,
): Promise<ActorAccess> {
  const platformData = await serviceFetch(
    config,
    `/rest/v1/platform_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  );
  if (Array.isArray(platformData) && platformData[0]) {
    return { level: "platform_admin", organizationIds: [] };
  }

  const orgData = await serviceFetch(
    config,
    `/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(userId)}&role=eq.org_admin&status=eq.active&select=organization_id`,
  );
  const organizationIds = Array.isArray(orgData)
    ? orgData
        .map((row) =>
          row && typeof row === "object"
            ? cleanId((row as DbRow).organization_id)
            : "",
        )
        .filter(Boolean)
    : [];
  if (!organizationIds.length) throw new Error("Admin access is required.");
  return {
    level: "org_admin",
    organizationIds: Array.from(new Set(organizationIds)),
  };
}

function actorAccessPayload(access: ActorAccess): DbRow {
  return {
    level: access.level,
    organization_ids: access.organizationIds,
  };
}

function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map((value) => encodeURIComponent(value)).join(",")})`;
}

function idsFrom(rows: DbRow[], key: string): string[] {
  return Array.from(
    new Set(rows.map((row) => cleanId(row[key])).filter(Boolean)),
  );
}

function rowsByKey(rows: DbRow[], key: string): Map<string, DbRow[]> {
  const map = new Map<string, DbRow[]>();
  for (const row of rows) {
    const value = cleanId(row[key]);
    if (!value) continue;
    const items = map.get(value) || [];
    items.push(row);
    map.set(value, items);
  }
  return map;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function csvFromRows(
  rows: DbRow[],
  columns: Array<{ key: string; label: string }>,
): string {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => csvEscape(row[column.key])).join(",")
  );
  return [header, ...body].join("\n");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string): { headers: string[]; rows: DbRow[] } {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase().replaceAll(" ", "_")
  );
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: DbRow = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    return row;
  });
  return { headers, rows };
}

function normalizedRosterRow(row: DbRow): DbRow {
  // Accept both the simple Jargon shape (email,name,role,grade) and the OneRoster
  // users.csv shape (givenName,familyName,role,grades,email,username). parseCsv
  // lowercases headers and turns spaces into underscores, so OneRoster columns
  // arrive as givenname/familyname/grades/username.
  const username = cleanText(row.username);
  const email = normalizeEmail(row.email || row.email_address || row.user_email) ||
    (username.includes("@") ? normalizeEmail(username) : "");
  const roleText = cleanText(row.role, "student").toLowerCase();
  const role = roleText === "teacher" ? "teacher" : "student";
  const oneRosterName = [cleanText(row.givenname), cleanText(row.familyname)]
    .filter(Boolean)
    .join(" ");
  const grades = row.grades;
  const oneRosterGrade = Array.isArray(grades)
    ? cleanText(grades[0])
    : cleanText(grades);
  return {
    email,
    name: cleanText(row.name || row.full_name || row.display_name) || oneRosterName,
    role,
    grade: cleanText(row.grade || row.year || row.level) || oneRosterGrade,
  };
}

function safeFilenamePart(value: unknown, fallback = "export"): string {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || fallback;
}

function readinessStatusFromIssues(issues: ReadinessIssue[]): ReadinessStatus {
  if (issues.some((issue) => issue.severity === "blocked")) return "blocked";
  if (issues.some((issue) => issue.severity === "attention"))
    return "needs_attention";
  if (issues.some((issue) => issue.severity === "setup")) return "needs_setup";
  return "ready";
}

function worstStatus(statuses: ReadinessStatus[]): ReadinessStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("needs_attention")) return "needs_attention";
  if (statuses.includes("needs_setup")) return "needs_setup";
  return "ready";
}

function emptyCostMetric(input: {
  key: string;
  label: string;
  organizationId?: string | null;
  classId?: string | null;
  userId?: string | null;
  model?: string | null;
  taskType?: string | null;
}): CostMetric {
  return {
    key: input.key,
    label: input.label,
    organization_id: input.organizationId || null,
    class_id: input.classId || null,
    user_id: input.userId || null,
    model: input.model || null,
    task_type: input.taskType || null,
    model_event_count: 0,
    runtime_event_count: 0,
    speech_event_count: 0,
    session_count: 0,
    completion_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    latency_count: 0,
    latency_total_ms: 0,
    average_latency_ms: null,
    error_count: 0,
    error_rate: null,
  };
}

function finishCostMetric(metric: CostMetric, showCost: boolean): CostMetric {
  const totalEvents =
    metric.model_event_count + metric.runtime_event_count + metric.speech_event_count;
  return {
    ...metric,
    total_tokens: metric.input_tokens + metric.output_tokens + metric.cached_tokens,
    estimated_cost_usd: showCost ? metric.estimated_cost_usd || 0 : null,
    average_latency_ms: metric.latency_count
      ? Math.round(metric.latency_total_ms / metric.latency_count)
      : null,
    error_rate: totalEvents ? metric.error_count / totalEvents : null,
  };
}

function sortedMetrics(metrics: Map<string, CostMetric>, showCost: boolean): CostMetric[] {
  return Array.from(metrics.values())
    .map((metric) => finishCostMetric(metric, showCost))
    .sort((a, b) => {
      const aCost = a.estimated_cost_usd || 0;
      const bCost = b.estimated_cost_usd || 0;
      return bCost - aCost || b.total_tokens - a.total_tokens || b.error_count - a.error_count;
    });
}

function hasOrganizationAccess(
  access: ActorAccess,
  organizationId: string,
): boolean {
  return (
    access.level === "platform_admin" ||
    access.organizationIds.includes(organizationId)
  );
}

function requireOrganizationAccess(
  access: ActorAccess,
  organizationId: string,
): void {
  if (!organizationId || !hasOrganizationAccess(access, organizationId)) {
    throw new Error("Admin access for this organization is required.");
  }
}

async function fetchClassOrganizationId(
  config: Config,
  classId: string,
): Promise<string> {
  const classRow = await selectFirst(
    config,
    `classes?id=eq.${encodeURIComponent(classId)}&select=id,organization_id`,
  );
  const organizationId = classRow ? cleanId(classRow.organization_id) : "";
  if (!organizationId) throw new Error("Class not found.");
  return organizationId;
}

async function requireMembershipAccess(
  config: Config,
  access: ActorAccess,
  type: MembershipType,
  membership: DbRow,
  options: { allowOrgAdminOrgMembership?: boolean } = {},
): Promise<{ organizationId: string | null; classId: string | null }> {
  if (type === "organization") {
    const organizationId = cleanId(membership.organization_id);
    requireOrganizationAccess(access, organizationId);
    if (
      access.level !== "platform_admin" &&
      cleanText(membership.role) === "org_admin" &&
      !options.allowOrgAdminOrgMembership
    ) {
      throw new Error("Only platform admins may manage org-admin memberships.");
    }
    return { organizationId, classId: null };
  }

  const classId = cleanId(membership.class_id);
  const organizationId = await fetchClassOrganizationId(config, classId);
  requireOrganizationAccess(access, organizationId);
  return { organizationId, classId };
}

async function fetchAccessibleOrgMembershipsForUser(
  config: Config,
  access: ActorAccess,
  userId: string,
): Promise<DbRow[]> {
  const scopedFilter =
    access.level === "platform_admin"
      ? ""
      : `&${inFilter("organization_id", access.organizationIds)}`;
  return selectRows(
    config,
    `organization_memberships?user_id=eq.${encodeURIComponent(userId)}${scopedFilter}&select=*`,
  );
}

async function scopeResponse(
  config: Config,
  access: ActorAccess,
  extra: DbRow = {},
): Promise<DbRow> {
  return {
    actor_access: actorAccessPayload(access),
    scope: await loadAdminScope(config, access),
    ...extra,
  };
}

async function selectRows(config: Config, path: string): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  return Array.isArray(data)
    ? (data.filter((row) => row && typeof row === "object") as DbRow[])
    : [];
}

async function selectFirst(
  config: Config,
  path: string,
): Promise<DbRow | null> {
  const rows = await selectRows(config, path);
  return rows[0] || null;
}

async function insertRow(
  config: Config,
  table: string,
  row: DbRow,
): Promise<DbRow> {
  const data = await serviceFetch(config, `/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error(`Insert into ${table} returned no row.`);
  }
  return data[0] as DbRow;
}

async function patchRows(
  config: Config,
  path: string,
  row: DbRow,
): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return Array.isArray(data)
    ? (data.filter((item) => item && typeof item === "object") as DbRow[])
    : [];
}

async function upsertByConflict(
  config: Config,
  table: string,
  conflict: string,
  row: DbRow,
): Promise<DbRow> {
  const conflictParam = conflict
    .split(",")
    .map((part) => encodeURIComponent(part.trim()))
    .join(",");
  const data = await serviceFetch(
    config,
    `/rest/v1/${table}?on_conflict=${conflictParam}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    },
  );
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
    throw new Error(`Upsert into ${table} returned no row.`);
  }
  return data[0] as DbRow;
}

async function audit(
  config: Config,
  input: {
    actorId: string;
    organizationId?: string | null;
    classId?: string | null;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    payload?: DbRow;
  },
) {
  await insertRow(config, "audit_events", {
    actor_id: input.actorId,
    organization_id: input.organizationId || null,
    class_id: input.classId || null,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    payload: input.payload || {},
  });
}

async function listAuthUsers(config: Config, page = 1): Promise<DbRow[]> {
  const data = await serviceFetch(
    config,
    `/auth/v1/admin/users?page=${page}&per_page=1000`,
  );
  if (Array.isArray(data))
    return data.filter((row) => row && typeof row === "object") as DbRow[];
  const users = data && typeof data === "object" ? (data as DbRow).users : null;
  return Array.isArray(users)
    ? (users.filter((row) => row && typeof row === "object") as DbRow[])
    : [];
}

async function listAllAuthUsers(config: Config): Promise<DbRow[]> {
  const users: DbRow[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const pageUsers = await listAuthUsers(config, page);
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
  }
  return users;
}

async function loadAdminScope(
  config: Config,
  access: ActorAccess,
): Promise<DbRow> {
  const orgFilter =
    access.level === "platform_admin"
      ? ""
      : `${inFilter("id", access.organizationIds)}&`;
  const organizations = await selectRows(
    config,
    `organizations?${orgFilter}select=id,name,slug,organization_type,status,created_at,updated_at&order=name.asc`,
  );
  const organizationIds = organizations
    .map((row) => cleanId(row.id))
    .filter(Boolean);
  if (access.level === "org_admin" && !organizationIds.length) {
    return {
      organizations: [],
      classes: [],
      organization_memberships: [],
      class_memberships: [],
      profiles: [],
      seed_batches: [],
      audit_events: [],
      users: [],
    };
  }

  const scopedOrgQuery =
    access.level === "platform_admin"
      ? ""
      : `${inFilter("organization_id", organizationIds)}&`;
  const [classes, organizationMemberships, seedBatches, auditEvents] =
    await Promise.all([
      selectRows(
        config,
        `classes?${scopedOrgQuery}select=id,organization_id,name,class_code,status,created_by,created_at,updated_at&order=name.asc`,
      ),
      selectRows(
        config,
        `organization_memberships?${scopedOrgQuery}select=id,organization_id,user_id,role,status,created_at,updated_at&order=created_at.desc`,
      ),
      selectRows(
        config,
        `admin_account_seed_batches?${scopedOrgQuery}select=id,label,status,summary,created_at,updated_at,organization_id,class_id&order=created_at.desc&limit=30`,
      ),
      selectRows(
        config,
        `audit_events?${scopedOrgQuery}select=id,actor_id,organization_id,class_id,event_type,entity_type,entity_id,payload,created_at&order=created_at.desc&limit=100`,
      ),
    ]);

  const classIds = classes.map((row) => cleanId(row.id)).filter(Boolean);
  const classMemberships = classIds.length
    ? await selectRows(
        config,
        `class_memberships?${inFilter("class_id", classIds)}&select=id,class_id,user_id,role,status,created_at,updated_at&order=created_at.desc`,
      )
    : [];

  const memberIds = new Set<string>();
  for (const row of [...organizationMemberships, ...classMemberships]) {
    if (typeof row.user_id === "string") memberIds.add(row.user_id);
  }

  const memberIdList = Array.from(memberIds);
  const [profiles, authUsers] = await Promise.all([
    memberIdList.length
      ? selectRows(
          config,
          `profiles?${inFilter("id", memberIdList)}&select=id,name,grade`,
        )
      : [],
    listAllAuthUsers(config),
  ]);

  const users = authUsers
    .filter(
      (user) => typeof user.id === "string" && memberIds.has(String(user.id)),
    )
    .map((user) => ({
      id: user.id,
      email: normalizeEmail(user.email),
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      banned_until: user.banned_until || null,
    }));

  return {
    organizations,
    classes,
    organization_memberships: organizationMemberships,
    class_memberships: classMemberships,
    profiles,
    seed_batches: seedBatches,
    audit_events: auditEvents,
    users,
  };
}

async function handleListAdminScope(
  config: Config,
  access: ActorAccess,
): Promise<Response> {
  return json({ status: "ok", data: await scopeResponse(config, access) });
}

// v4.0 Phase 5: the admin "Live" fleet — learning sessions currently in progress across the
// admin's scope. Reuses loadAdminScope (org-gated) for the accessible student set + names, reads
// active sessions (service role), and joins lesson titles. Poll-based; no realtime.
async function handleListActiveSessions(
  config: Config,
  access: ActorAccess,
): Promise<Response> {
  const scope = await loadAdminScope(config, access);
  const classes = Array.isArray(scope.classes) ? (scope.classes as DbRow[]) : [];
  const memberships = Array.isArray(scope.class_memberships)
    ? (scope.class_memberships as DbRow[])
    : [];
  const profiles = Array.isArray(scope.profiles) ? (scope.profiles as DbRow[]) : [];
  const studentMemberships = memberships.filter(
    (row) => cleanText(row.role) === "student" && cleanText(row.status) === "active",
  );
  const studentIds = idsFrom(studentMemberships, "user_id");
  const now = new Date().toISOString();
  if (!studentIds.length) return json({ status: "ok", data: { sessions: [], generated_at: now } });

  // "Live" = a non-terminal session (active OR a struggling needs_retry/needs_rescue — those are
  // exactly who an admin wants to watch) that was touched recently (a session left open + abandoned
  // stays 'active' forever, so gate on recency rather than trusting a terminal transition).
  const recentIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const sessions = await selectRows(
    config,
    `learning_sessions?${inFilter("user_id", studentIds)}&status=in.(active,needs_retry,needs_rescue)&updated_at=gte.${encodeURIComponent(recentIso)}&select=id,user_id,lesson_id,stage,status,updated_at&order=updated_at.desc&limit=200`,
  );
  const lessonIds = idsFrom(sessions, "lesson_id");
  const lessons = lessonIds.length
    ? await selectRows(config, `lessons?${inFilter("id", lessonIds)}&select=id,title`)
    : [];

  const nameById = new Map(profiles.map((p) => [cleanId(p.id), cleanText(p.name)]));
  const lessonTitleById = new Map(lessons.map((l) => [cleanId(l.id), cleanText(l.title)]));
  const classNameById = new Map(classes.map((c) => [cleanId(c.id), cleanText(c.name)]));
  const studentClassName = new Map<string, string>();
  for (const m of studentMemberships) {
    const uid = cleanId(m.user_id);
    const cid = cleanId(m.class_id);
    if (uid && cid && !studentClassName.has(uid)) {
      studentClassName.set(uid, classNameById.get(cid) || "");
    }
  }

  const rows = sessions.map((s) => {
    const uid = cleanId(s.user_id);
    return {
      session_id: cleanId(s.id),
      user_id: uid,
      student_name: nameById.get(uid) || "Student",
      lesson_title: lessonTitleById.get(cleanId(s.lesson_id)) || "a lesson",
      stage: cleanText(s.stage),
      status: cleanText(s.status),
      class_name: studentClassName.get(uid) || "",
      updated_at: s.updated_at,
    };
  });
  return json({ status: "ok", data: { sessions: rows, generated_at: now } });
}

async function loadPilotReadinessData(
  config: Config,
  access: ActorAccess,
): Promise<{
  scope: DbRow;
  lessons: DbRow[];
  sessions: DbRow[];
  assignments: DbRow[];
  assignmentRecipients: DbRow[];
  resources: DbRow[];
  runtimeEvents: DbRow[];
  interventionAlerts: DbRow[];
}> {
  const scope = await loadAdminScope(config, access);
  const classes = Array.isArray(scope.classes) ? scope.classes as DbRow[] : [];
  const memberships = Array.isArray(scope.class_memberships)
    ? scope.class_memberships as DbRow[]
    : [];
  const classIds = idsFrom(classes, "id");
  const studentIds = idsFrom(
    memberships.filter((row) => cleanText(row.role) === "student"),
    "user_id",
  );

  const [lessons, sessions, assignments, resources, runtimeByClass, runtimeByUser, alertsByClass, alertsByUser] =
    await Promise.all([
      selectRows(
        config,
        "lessons?select=id,title,publication_status,module,level&limit=1000",
      ),
      studentIds.length
        ? selectRows(
            config,
            `learning_sessions?${inFilter("user_id", studentIds)}&select=id,user_id,lesson_id,stage,status,score,retry_count,rescue_count,created_at,updated_at&order=updated_at.desc&limit=1000`,
          )
        : [],
      classIds.length
        ? selectRows(
            config,
            `assignments?${inFilter("class_id", classIds)}&select=id,organization_id,class_id,lesson_id,title,status,due_at,created_at,updated_at&order=updated_at.desc&limit=1000`,
          )
        : [],
      classIds.length
        ? selectRows(
            config,
            `lesson_resources?${inFilter("class_id", classIds)}&select=id,organization_id,class_id,lesson_id,title,resource_type,status,visibility,created_at,updated_at&order=created_at.desc&limit=1000`,
          )
        : [],
      classIds.length
        ? selectRows(
            config,
            `runtime_events?${inFilter("class_id", classIds)}&select=id,user_id,organization_id,class_id,session_id,lesson_id,event_type,status,latency_ms,payload,created_at&order=created_at.desc&limit=500`,
          )
        : [],
      studentIds.length
        ? selectRows(
            config,
            `runtime_events?${inFilter("user_id", studentIds)}&select=id,user_id,organization_id,class_id,session_id,lesson_id,event_type,status,latency_ms,payload,created_at&order=created_at.desc&limit=500`,
          )
        : [],
      classIds.length
        ? selectRows(
            config,
            `intervention_alerts?${inFilter("class_id", classIds)}&select=id,student_id,class_id,session_id,lesson_id,alert_type,severity,title,message,status,created_at,updated_at&order=created_at.desc&limit=500`,
          )
        : [],
      studentIds.length
        ? selectRows(
            config,
            `intervention_alerts?${inFilter("student_id", studentIds)}&select=id,student_id,class_id,session_id,lesson_id,alert_type,severity,title,message,status,created_at,updated_at&order=created_at.desc&limit=500`,
          )
        : [],
    ]);

  const assignmentIds = idsFrom(assignments, "id");
  const assignmentRecipients = assignmentIds.length
    ? await selectRows(
        config,
        `assignment_recipients?${inFilter("assignment_id", assignmentIds)}&select=id,assignment_id,user_id,status,score,assigned_at,completed_at,updated_at&order=updated_at.desc&limit=1500`,
      )
    : [];

  const seenRuntime = new Map<string, DbRow>();
  for (const row of [...runtimeByClass, ...runtimeByUser]) {
    const id = cleanId(row.id);
    if (id) seenRuntime.set(id, row);
  }
  const seenAlerts = new Map<string, DbRow>();
  for (const row of [...alertsByClass, ...alertsByUser]) {
    const id = cleanId(row.id);
    if (id) seenAlerts.set(id, row);
  }

  return {
    scope,
    lessons,
    sessions,
    assignments,
    assignmentRecipients,
    resources,
    runtimeEvents: Array.from(seenRuntime.values()),
    interventionAlerts: Array.from(seenAlerts.values()),
  };
}

async function buildPilotReadiness(
  config: Config,
  access: ActorAccess,
): Promise<{ scope: DbRow; readiness: DbRow }> {
  const data = await loadPilotReadinessData(config, access);
  const organizations = Array.isArray(data.scope.organizations)
    ? data.scope.organizations as DbRow[]
    : [];
  const classes = Array.isArray(data.scope.classes)
    ? data.scope.classes as DbRow[]
    : [];
  const classMemberships = Array.isArray(data.scope.class_memberships)
    ? data.scope.class_memberships as DbRow[]
    : [];
  const auditEvents = Array.isArray(data.scope.audit_events)
    ? data.scope.audit_events as DbRow[]
    : [];
  const profiles = Array.isArray(data.scope.profiles)
    ? data.scope.profiles as DbRow[]
    : [];
  const users = Array.isArray(data.scope.users) ? data.scope.users as DbRow[] : [];

  const lessonsAvailable = data.lessons.filter((lesson) => {
    const status = cleanText(lesson.publication_status || "published");
    return status === "" || status === "published";
  });
  const lessonCount = lessonsAvailable.length;
  const membershipsByClass = rowsByKey(classMemberships, "class_id");
  const sessionsByUser = rowsByKey(data.sessions, "user_id");
  const assignmentsByClass = rowsByKey(data.assignments, "class_id");
  const resourcesByClass = rowsByKey(data.resources, "class_id");
  const runtimeByClass = rowsByKey(data.runtimeEvents, "class_id");
  const alertsByClass = rowsByKey(data.interventionAlerts, "class_id");
  const auditByClass = rowsByKey(auditEvents, "class_id");
  const profileById = new Map(profiles.map((profile) => [cleanId(profile.id), profile]));
  const userById = new Map(users.map((user) => [cleanId(user.id), user]));
  const recentCutoff = Date.now() - 1000 * 60 * 60 * 24 * 14;

  const classReadiness = classes.map((classRow) => {
    const classId = cleanId(classRow.id);
    const organizationId = cleanId(classRow.organization_id);
    const members = membershipsByClass.get(classId) || [];
    const activeMembers = members.filter((row) => cleanText(row.status) === "active");
    const activeTeachers = activeMembers.filter((row) => cleanText(row.role) === "teacher");
    const activeStudents = activeMembers.filter((row) => cleanText(row.role) === "student");
    const studentIds = new Set(activeStudents.map((row) => cleanId(row.user_id)).filter(Boolean));
    const classSessions = Array.from(studentIds).flatMap((studentId) =>
      sessionsByUser.get(studentId) || []
    );
    const completedSessions = classSessions.filter(
      (session) => cleanText(session.status) === "complete",
    );
    const recentCompletions = completedSessions.filter(
      (session) => numericDate(session.updated_at) >= recentCutoff,
    );
    const classAssignments = assignmentsByClass.get(classId) || [];
    const assignedAssignments = classAssignments.filter(
      (assignment) => cleanText(assignment.status) === "assigned",
    );
    const classResources = resourcesByClass.get(classId) || [];
    const publishedResources = classResources.filter(
      (resource) => cleanText(resource.status) === "published",
    );
    const classErrors = (runtimeByClass.get(classId) || []).filter(
      (event) => cleanText(event.status) === "error",
    );
    const classAlerts = (alertsByClass.get(classId) || []).filter((alert) =>
      ["open", "acknowledged"].includes(cleanText(alert.status)),
    );
    const issues: ReadinessIssue[] = [];
    if (!activeTeachers.length) {
      issues.push({ severity: "blocked", message: "No active teacher in this class." });
    }
    if (!activeStudents.length) {
      issues.push({ severity: "blocked", message: "No active students in this class." });
    }
    if (!lessonCount) {
      issues.push({ severity: "setup", message: "No published lessons are available." });
    }
    if (!assignedAssignments.length && !publishedResources.length) {
      issues.push({
        severity: "setup",
        message: "No assigned work or published resources are prepared yet.",
      });
    }
    if (classErrors.length) {
      issues.push({
        severity: "attention",
        message: `${classErrors.length} recent runtime error${classErrors.length === 1 ? "" : "s"}.`,
      });
    }
    if (classAlerts.length) {
      issues.push({
        severity: "attention",
        message: `${classAlerts.length} open intervention alert${classAlerts.length === 1 ? "" : "s"}.`,
      });
    }
    const status = readinessStatusFromIssues(issues);
    const rosterRows = activeMembers.map((membership) => {
      const userId = cleanId(membership.user_id);
      const profile = profileById.get(userId) || {};
      const user = userById.get(userId) || {};
      return {
        user_id: userId,
        role: membership.role,
        status: membership.status,
        name: profile.name || "",
        grade: profile.grade || "",
        email: user.email || "",
        last_sign_in_at: user.last_sign_in_at || null,
      };
    });
    return {
      class_id: classId,
      organization_id: organizationId,
      class_name: classRow.name || "Untitled class",
      organization_name:
        organizations.find((org) => cleanId(org.id) === organizationId)?.name ||
        "Organization",
      status,
      teacher_count: activeTeachers.length,
      student_count: activeStudents.length,
      active_membership_count: activeMembers.length,
      disabled_membership_count: members.filter((row) => cleanText(row.status) !== "active").length,
      published_lesson_count: lessonCount,
      completed_session_count: completedSessions.length,
      recent_completion_count: recentCompletions.length,
      assignment_count: assignedAssignments.length,
      resource_count: publishedResources.length,
      open_alert_count: classAlerts.length,
      recent_error_count: classErrors.length,
      audit_event_count: (auditByClass.get(classId) || []).length,
      checklist: [
        {
          label: "Active teacher",
          status: activeTeachers.length ? "ok" : "missing",
        },
        {
          label: "Active students",
          status: activeStudents.length ? "ok" : "missing",
        },
        {
          label: "Published lessons",
          status: lessonCount ? "ok" : "missing",
        },
        {
          label: "Work/resources prepared",
          status: assignedAssignments.length || publishedResources.length ? "ok" : "missing",
        },
        {
          label: "Recent completion",
          status: recentCompletions.length ? "ok" : "attention",
        },
        {
          label: "No open alerts/errors",
          status: classAlerts.length || classErrors.length ? "attention" : "ok",
        },
      ] as ReadinessChecklistItem[],
      issues,
      roster: rosterRows,
    };
  });

  const classReadinessByOrg = rowsByKey(classReadiness as DbRow[], "organization_id");
  const organizationReadiness = organizations.map((org) => {
    const rows = (classReadinessByOrg.get(cleanId(org.id)) || []) as Array<
      DbRow & { status: ReadinessStatus }
    >;
    const statuses = rows.map((row) => row.status);
    return {
      organization_id: org.id,
      organization_name: org.name || "Organization",
      status: rows.length ? worstStatus(statuses) : "needs_setup",
      class_count: rows.length,
      ready_class_count: rows.filter((row) => row.status === "ready").length,
      needs_setup_class_count: rows.filter((row) => row.status === "needs_setup").length,
      needs_attention_class_count: rows.filter((row) => row.status === "needs_attention").length,
      blocked_class_count: rows.filter((row) => row.status === "blocked").length,
    };
  });

  return {
    scope: data.scope,
    readiness: {
      generated_at: new Date().toISOString(),
      organizations: organizationReadiness,
      classes: classReadiness,
      recent_errors: data.runtimeEvents
        .filter((event) => cleanText(event.status) === "error")
        .sort((a, b) => numericDate(b.created_at) - numericDate(a.created_at))
        .slice(0, 25),
      open_alerts: data.interventionAlerts
        .filter((alert) => ["open", "acknowledged"].includes(cleanText(alert.status)))
        .sort((a, b) => numericDate(b.created_at) - numericDate(a.created_at))
        .slice(0, 25),
    },
  };
}

async function handleListPilotReadiness(
  config: Config,
  access: ActorAccess,
): Promise<Response> {
  const data = await buildPilotReadiness(config, access);
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      scope: data.scope,
      readiness: data.readiness,
    },
  });
}

async function handleExportClassSnapshot(
  config: Config,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const classId = cleanId(body.class_id);
  if (!classId) throw new Error("class_id is required.");
  const organizationId = await fetchClassOrganizationId(config, classId);
  requireOrganizationAccess(access, organizationId);
  const data = await loadPilotReadinessData(config, access);
  const scope = data.scope;
  const classes = Array.isArray(scope.classes) ? scope.classes as DbRow[] : [];
  const targetClass = classes.find((row) => cleanId(row.id) === classId);
  if (!targetClass) throw new Error("Class is not available in admin scope.");
  const organizations = Array.isArray(scope.organizations)
    ? scope.organizations as DbRow[]
    : [];
  const memberships = (Array.isArray(scope.class_memberships)
    ? scope.class_memberships as DbRow[]
    : []).filter((row) => cleanId(row.class_id) === classId);
  const profiles = Array.isArray(scope.profiles) ? scope.profiles as DbRow[] : [];
  const users = Array.isArray(scope.users) ? scope.users as DbRow[] : [];
  const profileById = new Map(profiles.map((profile) => [cleanId(profile.id), profile]));
  const userById = new Map(users.map((user) => [cleanId(user.id), user]));
  const lessonsById = new Map(data.lessons.map((lesson) => [cleanId(lesson.id), lesson]));
  const studentIds = new Set(
    memberships
      .filter((membership) => cleanText(membership.role) === "student")
      .map((membership) => cleanId(membership.user_id))
      .filter(Boolean),
  );
  const assignments = data.assignments.filter((row) => cleanId(row.class_id) === classId);
  const assignmentsById = new Map(assignments.map((row) => [cleanId(row.id), row]));
  const recipientsByUser = rowsByKey(
    data.assignmentRecipients.filter((row) => assignmentsById.has(cleanId(row.assignment_id))),
    "user_id",
  );
  const sessionsByUser = rowsByKey(
    data.sessions.filter((row) => studentIds.has(cleanId(row.user_id))),
    "user_id",
  );
  const alertsByUser = rowsByKey(
    data.interventionAlerts.filter((row) => studentIds.has(cleanId(row.student_id))),
    "student_id",
  );
  const orgName =
    organizations.find((org) => cleanId(org.id) === organizationId)?.name || "";

  const rows = memberships.map((membership) => {
    const userId = cleanId(membership.user_id);
    const profile = profileById.get(userId) || {};
    const user = userById.get(userId) || {};
    const sessions = sessionsByUser.get(userId) || [];
    const completedLessons = Array.from(
      new Set(
        sessions
          .filter((session) => cleanText(session.status) === "complete")
          .map((session) => cleanText(lessonsById.get(cleanId(session.lesson_id))?.title || session.lesson_id))
          .filter(Boolean),
      ),
    );
    const latestSession = sessions.sort(
      (a, b) => numericDate(b.updated_at) - numericDate(a.updated_at),
    )[0];
    const recipients = recipientsByUser.get(userId) || [];
    const submittedCount = recipients.filter((recipient) =>
      ["submitted", "returned", "complete"].includes(cleanText(recipient.status))
    ).length;
    const completeCount = recipients.filter(
      (recipient) => cleanText(recipient.status) === "complete",
    ).length;
    const openAlerts = (alertsByUser.get(userId) || []).filter((alert) =>
      ["open", "acknowledged"].includes(cleanText(alert.status)),
    ).length;
    return {
      organization: orgName,
      class: targetClass.name || "",
      role: membership.role,
      membership_status: membership.status,
      email: user.email || "",
      name: profile.name || "",
      grade: profile.grade || "",
      last_sign_in_at: user.last_sign_in_at || "",
      completed_lessons: completedLessons.join("; "),
      completed_lesson_count: completedLessons.length,
      active_session_count: sessions.filter((session) => cleanText(session.status) === "active")
        .length,
      latest_session_status: latestSession ? latestSession.status : "",
      latest_session_lesson: latestSession
        ? cleanText(lessonsById.get(cleanId(latestSession.lesson_id))?.title || latestSession.lesson_id)
        : "",
      assignments_total: recipients.length,
      assignments_submitted: submittedCount,
      assignments_complete: completeCount,
      open_alerts: openAlerts,
    };
  });

  const safeClass = cleanText(targetClass.name || "class")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "class";
  const csv = csvFromRows(rows, [
    { key: "organization", label: "Organization" },
    { key: "class", label: "Class" },
    { key: "role", label: "Role" },
    { key: "membership_status", label: "Membership status" },
    { key: "email", label: "Email" },
    { key: "name", label: "Name" },
    { key: "grade", label: "Grade" },
    { key: "last_sign_in_at", label: "Last sign-in" },
    { key: "completed_lessons", label: "Completed lessons" },
    { key: "completed_lesson_count", label: "Completed lesson count" },
    { key: "active_session_count", label: "Active sessions" },
    { key: "latest_session_status", label: "Latest session status" },
    { key: "latest_session_lesson", label: "Latest session lesson" },
    { key: "assignments_total", label: "Assignments total" },
    { key: "assignments_submitted", label: "Assignments submitted" },
    { key: "assignments_complete", label: "Assignments complete" },
    { key: "open_alerts", label: "Open alerts" },
  ]);

  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      export: {
        filename: `${safeClass}-snapshot.csv`,
        content_type: "text/csv",
        body: csv,
      },
    },
  });
}

async function handlePreviewCsvImport(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  const classId = cleanId(body.class_id);
  const payload = body.payload && typeof body.payload === "object" ? body.payload as DbRow : {};
  const csvText = cleanText(payload.csv_text);
  const filename = cleanText(payload.filename, "roster.csv");
  const importType = cleanText(payload.import_type, "roster") || "roster";
  if (!organizationId) throw new Error("organization_id is required.");
  requireOrganizationAccess(access, organizationId);
  if (classId) {
    const classOrganizationId = await fetchClassOrganizationId(config, classId);
    if (classOrganizationId !== organizationId) {
      throw new Error("Class does not belong to the selected organization.");
    }
  }
  if (!csvText) throw new Error("CSV text is required.");

  const parsed = parseCsv(csvText);
  if (!parsed.headers.includes("email")) {
    throw new Error("CSV must include an email column.");
  }

  const authUsers = await listAllAuthUsers(config);
  const userByEmail = new Map(
    authUsers.map((user) => [normalizeEmail(user.email), user]).filter(([email]) => email),
  );
  const seenEmails = new Set<string>();
  const normalizedRows = parsed.rows.map((row, index) => {
    const normalized = normalizedRosterRow(row);
    const email = cleanText(normalized.email);
    const matchedUser = email ? userByEmail.get(email) : null;
    let status = "ready";
    let error = "";
    if (!email) {
      status = "error";
      error = "Missing email.";
    } else if (seenEmails.has(email)) {
      status = "duplicate";
      error = "Duplicate email in CSV.";
    } else if (!matchedUser) {
      status = "needs_seed";
      error = "No existing Jargon account with this email.";
    }
    seenEmails.add(email);
    return {
      row_index: index + 1,
      raw_row: row,
      normalized_row: normalized,
      matched_user_id: matchedUser ? matchedUser.id : null,
      status,
      error,
    };
  });

  const summary = {
    total: normalizedRows.length,
    ready: normalizedRows.filter((row) => row.status === "ready").length,
    needs_seed: normalizedRows.filter((row) => row.status === "needs_seed").length,
    duplicate: normalizedRows.filter((row) => row.status === "duplicate").length,
    error: normalizedRows.filter((row) => row.status === "error").length,
  };
  const batch = await insertRow(config, "admin_csv_import_batches", {
    organization_id: organizationId,
    class_id: classId || null,
    created_by: actorId,
    import_type: importType,
    status: "previewed",
    filename,
    headers: parsed.headers,
    row_count: normalizedRows.length,
    summary,
    errors: normalizedRows.filter((row) => row.error).map((row) => ({
      row_index: row.row_index,
      error: row.error,
    })),
  });
  for (const row of normalizedRows) {
    await insertRow(config, "admin_csv_import_rows", {
      batch_id: batch.id,
      ...row,
    });
  }
  await audit(config, {
    actorId,
    organizationId,
    classId: classId || null,
    eventType: "admin.csv_import_previewed",
    entityType: "admin_csv_import_batch",
    entityId: cleanId(batch.id),
    payload: { import_type: importType, summary, filename },
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, {
      csv_import: {
        batch,
        rows: normalizedRows,
      },
    }),
  });
}

async function handleApplyCsvRosterImport(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const batchId = cleanId(body.payload && typeof body.payload === "object" ? (body.payload as DbRow).batch_id : body.id);
  if (!batchId) throw new Error("batch_id is required.");
  const batch = await selectFirst(
    config,
    `admin_csv_import_batches?id=eq.${encodeURIComponent(batchId)}&select=*`,
  );
  if (!batch) throw new Error("CSV import batch not found.");
  const organizationId = cleanId(batch.organization_id);
  const classId = cleanId(batch.class_id);
  requireOrganizationAccess(access, organizationId);
  if (!classId) throw new Error("Roster imports need a class_id.");
  const classOrganizationId = await fetchClassOrganizationId(config, classId);
  if (classOrganizationId !== organizationId) {
    throw new Error("Class does not belong to the import organization.");
  }

  const rows = await selectRows(
    config,
    `admin_csv_import_rows?batch_id=eq.${encodeURIComponent(batchId)}&select=*&order=row_index.asc`,
  );
  const applied: DbRow[] = [];
  const skipped: DbRow[] = [];
  for (const row of rows) {
    const status = cleanText(row.status);
    const userId = cleanId(row.matched_user_id);
    const normalized = row.normalized_row && typeof row.normalized_row === "object"
      ? row.normalized_row as DbRow
      : {};
    const role = cleanText(normalized.role, "student") === "teacher" ? "teacher" : "student";
    if (status !== "ready" || !userId) {
      skipped.push(row);
      continue;
    }
    await upsertByConflict(config, "organization_memberships", "organization_id,user_id", {
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "active",
      updated_at: new Date().toISOString(),
    });
    const membership = await upsertByConflict(config, "class_memberships", "class_id,user_id", {
      class_id: classId,
      user_id: userId,
      role,
      status: "active",
      updated_at: new Date().toISOString(),
    });
    await patchRows(
      config,
      `admin_csv_import_rows?id=eq.${encodeURIComponent(cleanId(row.id))}`,
      { status: "applied" },
    );
    applied.push(membership);
  }
  const summary = {
    total: rows.length,
    applied: applied.length,
    skipped: skipped.length,
  };
  const patchedBatch = await patchRows(
    config,
    `admin_csv_import_batches?id=eq.${encodeURIComponent(batchId)}`,
    {
      status: skipped.length ? "failed" : "applied",
      summary,
      updated_at: new Date().toISOString(),
    },
  );
  await audit(config, {
    actorId,
    organizationId,
    classId,
    eventType: "admin.csv_roster_import_applied",
    entityType: "admin_csv_import_batch",
    entityId: batchId,
    payload: summary,
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, {
      csv_import: {
        batch: patchedBatch[0] || batch,
        applied,
        skipped_count: skipped.length,
      },
    }),
  });
}

async function buildStudentArchive(
  config: Config,
  userId: string,
): Promise<DbRow> {
  const [
    profile,
    sessions,
    turns,
    lessonAttempts,
    quizAttempts,
    evidence,
    mastery,
    assignmentRecipients,
    assignmentSubmissions,
    assessmentRecipients,
    assessmentAttempts,
    voiceEvents,
  ] = await Promise.all([
    selectFirst(config, `profiles?id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `learning_sessions?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `learning_turns?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `lesson_attempts?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `quiz_attempts?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `learning_evidence?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `student_mastery?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `assignment_recipients?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `assignment_submissions?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `assessment_recipients?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `assessment_attempts?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    selectRows(config, `voice_interaction_events?user_id=eq.${encodeURIComponent(userId)}&select=*`),
  ]);
  return {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile,
    learning_sessions: sessions,
    learning_turns: turns,
    lesson_attempts: lessonAttempts,
    quiz_attempts: quizAttempts,
    learning_evidence: evidence,
    student_mastery: mastery,
    assignment_recipients: assignmentRecipients,
    assignment_submissions: assignmentSubmissions,
    assessment_recipients: assessmentRecipients,
    assessment_attempts: assessmentAttempts,
    voice_interaction_events: voiceEvents,
  };
}

async function handleExportStudentArchive(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const userId = cleanId(body.user_id);
  if (!userId) throw new Error("user_id is required.");
  const memberships = await fetchAccessibleOrgMembershipsForUser(config, access, userId);
  if (access.level !== "platform_admin" && !memberships.length) {
    throw new Error("Student is outside your organization scope.");
  }
  const organizationId = access.level === "platform_admin"
    ? cleanId(body.organization_id) || cleanId(memberships[0]?.organization_id)
    : cleanId(memberships[0]?.organization_id);
  const archive = await buildStudentArchive(config, userId);
  const request = await insertRow(config, "admin_data_export_requests", {
    organization_id: organizationId || null,
    target_user_id: userId,
    requested_by: actorId,
    export_type: "student_archive",
    status: "complete",
    filename: `student-${safeFilenamePart(userId)}-archive.json`,
    content_type: "application/json",
    result: archive,
    completed_at: new Date().toISOString(),
  });
  await audit(config, {
    actorId,
    organizationId,
    eventType: "admin.student_archive_exported",
    entityType: "admin_data_export_request",
    entityId: cleanId(request.id),
    payload: { target_user_id: userId },
  });
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      export_request: request,
      export: {
        filename: request.filename,
        content_type: request.content_type,
        body: JSON.stringify(archive, null, 2),
      },
    },
  });
}

async function handleRequestDataRetention(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const payload = body.payload && typeof body.payload === "object" ? body.payload as DbRow : {};
  const organizationId = cleanId(body.organization_id || payload.organization_id);
  const classId = cleanId(body.class_id || payload.class_id);
  const targetUserId = cleanId(body.user_id || payload.target_user_id);
  const requestType = cleanText(payload.request_type, "anonymize") === "delete" ? "delete" : "anonymize";
  if (!organizationId) throw new Error("organization_id is required.");
  requireOrganizationAccess(access, organizationId);
  const request = await insertRow(config, "admin_data_retention_requests", {
    organization_id: organizationId,
    class_id: classId || null,
    target_user_id: targetUserId || null,
    requested_by: actorId,
    request_type: requestType,
    status: "requested",
    reason: cleanText(payload.reason),
    plan: {
      dry_run: true,
      note:
        "This request records the governance workflow. Actual destructive deletion/anonymization must be approved and executed separately.",
    },
  });
  await audit(config, {
    actorId,
    organizationId,
    classId: classId || null,
    eventType: `admin.data_${requestType}_requested`,
    entityType: "admin_data_retention_request",
    entityId: cleanId(request.id),
    payload: { target_user_id: targetUserId || null },
  });
  return json({
    status: "ok",
    data: await scopeResponse(config, access, { retention_request: request }),
  });
}

async function handleUpsertConsentSettings(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const payload = body.payload && typeof body.payload === "object" ? body.payload as DbRow : {};
  const scope = cleanText(payload.scope, "organization");
  const organizationId = cleanId(body.organization_id || payload.organization_id);
  const classId = cleanId(body.class_id || payload.class_id);
  const userId = cleanId(body.user_id || payload.user_id);
  if (scope === "organization") requireOrganizationAccess(access, organizationId);
  if (scope === "class") {
    const classOrganizationId = await fetchClassOrganizationId(config, classId);
    requireOrganizationAccess(access, classOrganizationId);
  }
  if (scope === "student" && access.level !== "platform_admin") {
    const memberships = await fetchAccessibleOrgMembershipsForUser(config, access, userId);
    if (!memberships.length) throw new Error("Student is outside your organization scope.");
  }
  const settings = payload.settings && typeof payload.settings === "object"
    ? payload.settings as DbRow
    : {};
  const row = await insertRow(config, "platform_consent_settings", {
    organization_id: organizationId || null,
    class_id: classId || null,
    user_id: userId || null,
    scope,
    settings,
    updated_by: actorId,
  });
  await audit(config, {
    actorId,
    organizationId: organizationId || null,
    classId: classId || null,
    eventType: "admin.consent_settings_updated",
    entityType: "platform_consent_settings",
    entityId: cleanId(row.id),
    payload: { scope, settings },
  });
  return json({
    status: "ok",
    data: await scopeResponse(config, access, { consent_settings: row }),
  });
}

// Read or update per-org external links stored in
// organization_settings.resource_settings (currently: campus_live_url). Called
// with an empty payload to read, or with a payload key to update — merges into
// the existing resource_settings so other keys are preserved.
async function handleOrganizationLinks(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  if (!organizationId) throw new Error("organization_id is required.");
  requireOrganizationAccess(access, organizationId);
  const payload = body.payload && typeof body.payload === "object" ? body.payload as DbRow : {};

  const existing = await selectFirst(
    config,
    `organization_settings?organization_id=eq.${encodeURIComponent(organizationId)}&select=resource_settings`,
  );
  const resourceSettings = existing?.resource_settings && typeof existing.resource_settings === "object"
    ? { ...(existing.resource_settings as DbRow) }
    : {};

  let changed = false;
  if ("campus_live_url" in payload) {
    const raw = cleanText(payload.campus_live_url);
    // Store a normalized https URL, or clear the key when blank/invalid.
    let normalized = "";
    if (raw) {
      const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const url = new URL(withProtocol);
        if (url.protocol === "http:" || url.protocol === "https:") {
          normalized = url.toString();
        }
      } catch {
        throw new Error("Campus Live URL is invalid. Use a full link like https://www.campus.live/.");
      }
    }
    if (normalized) resourceSettings.campus_live_url = normalized;
    else delete resourceSettings.campus_live_url;
    changed = true;
  }

  if (changed) {
    await upsertByConflict(config, "organization_settings", "organization_id", {
      organization_id: organizationId,
      resource_settings: resourceSettings,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    });
    await audit(config, {
      actorId,
      organizationId,
      eventType: "admin.organization_links_updated",
      entityType: "organization_settings",
      entityId: organizationId,
      payload: { resource_settings: resourceSettings },
    });
  }

  return json({
    status: "ok",
    data: { resource_settings: resourceSettings },
  });
}

// Shared report builder used by BOTH the admin (org-scoped) and teacher (class-scoped) paths. The
// CALLER is responsible for authorization before calling this — it performs no access check.
async function buildProgressReport(
  config: Config,
  params: {
    actorId: string;
    organizationId: string;
    classId: string;
    studentId: string;
    payload: DbRow | undefined;
  },
): Promise<DbRow> {
  const { actorId, organizationId, classId, studentId, payload } = params;
  const archive = await buildStudentArchive(config, studentId);
  const sessions = Array.isArray(archive.learning_sessions) ? archive.learning_sessions as DbRow[] : [];
  const evidence = Array.isArray(archive.learning_evidence) ? archive.learning_evidence as DbRow[] : [];
  const mastery = Array.isArray(archive.student_mastery) ? archive.student_mastery as DbRow[] : [];
  const reportBody = {
    generated_at: new Date().toISOString(),
    completed_lessons: sessions.filter((session) => cleanText(session.status) === "complete").length,
    active_lessons: sessions.filter((session) => cleanText(session.status) === "active").length,
    evidence_count: evidence.length,
    mastery: mastery.map((row) => ({
      skill_key: row.skill_key,
      mastery_score: row.mastery_score,
      confidence: row.confidence,
      updated_at: row.updated_at,
    })),
  };
  const report = await insertRow(config, "student_progress_reports", {
    organization_id: organizationId || null,
    class_id: classId || null,
    student_id: studentId,
    generated_by: actorId,
    report_type: cleanText(payload?.report_type, "parent"),
    title: cleanText(payload?.title, "Student progress report"),
    status: "draft",
    summary: {
      completed_lessons: reportBody.completed_lessons,
      evidence_count: reportBody.evidence_count,
      mastery_count: mastery.length,
    },
    body: reportBody,
    visibility: "teacher_private",
  });
  await audit(config, {
    actorId,
    organizationId: organizationId || null,
    classId: classId || null,
    eventType: "admin.progress_report_generated",
    entityType: "student_progress_report",
    entityId: cleanId(report.id),
    payload: { student_id: studentId },
  });
  return report;
}

function progressReportExport(studentId: string, report: DbRow): DbRow {
  return {
    filename: `student-${safeFilenamePart(studentId)}-progress-report.json`,
    content_type: "application/json",
    body: JSON.stringify(report, null, 2),
  };
}

async function handleGenerateProgressReport(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  const classId = cleanId(body.class_id);
  const studentId = cleanId(body.user_id);
  if (!studentId) throw new Error("user_id is required.");
  if (organizationId) requireOrganizationAccess(access, organizationId);
  const report = await buildProgressReport(config, {
    actorId,
    organizationId,
    classId,
    studentId,
    payload: body.payload as DbRow | undefined,
  });
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      progress_report: report,
      export: progressReportExport(studentId, report),
    },
  });
}

// Active class_ids the actor teaches (role=teacher, status=active) — mirrors the is_class_teacher
// RLS predicate exactly (role='teacher' and status='active') so the service-role read grants the
// same scope a teacher would have under RLS, never broader.
async function fetchTeacherClassIds(
  config: Config,
  userId: string,
): Promise<string[]> {
  const rows = await selectRows(
    config,
    `class_memberships?user_id=eq.${encodeURIComponent(userId)}&role=eq.teacher&status=eq.active&select=class_id`,
  );
  return Array.isArray(rows)
    ? Array.from(new Set(rows.map((row) => cleanId(row.class_id)).filter(Boolean)))
    : [];
}

// Teacher-scoped progress report. Authorized via class_memberships (role=teacher), NOT admin
// access. Strictly validates the actor teaches THIS class AND the target user is an ACTIVE student
// in THAT SAME class, so a teacher can only ever report on a student they actually teach.
async function handleTeacherGenerateProgressReport(
  config: Config,
  actorId: string,
  body: DbRow,
): Promise<Response> {
  const classId = cleanId(body.class_id);
  const studentId = cleanId(body.user_id);
  if (!classId) throw new Error("class_id is required.");
  if (!studentId) throw new Error("user_id is required.");
  const teacherClassIds = await fetchTeacherClassIds(config, actorId);
  if (!teacherClassIds.length) throw new Error("Teacher access is required.");
  if (!teacherClassIds.includes(classId)) {
    throw new Error("You do not teach this class.");
  }
  const enrollment = await selectRows(
    config,
    `class_memberships?class_id=eq.${encodeURIComponent(classId)}&user_id=eq.${encodeURIComponent(studentId)}&role=eq.student&status=eq.active&select=user_id&limit=1`,
  );
  if (!Array.isArray(enrollment) || !enrollment.length) {
    throw new Error("That student is not enrolled in this class.");
  }
  const organizationId = await fetchClassOrganizationId(config, classId);
  const report = await buildProgressReport(config, {
    actorId,
    organizationId,
    classId,
    studentId,
    payload: body.payload as DbRow | undefined,
  });
  return json({
    status: "ok",
    data: {
      progress_report: report,
      export: progressReportExport(studentId, report),
    },
  });
}

// Teacher-scoped class snapshot CSV. Authorized via class_memberships (role=teacher), NOT admin
// access. Reads ONLY public tables the teacher already sees under RLS (is_class_teacher /
// can_view_student), scoped to THIS class's students — deliberately NO auth-admin access (no email /
// last_sign_in), so the teacher tier touches zero auth surface. Mirrors the admin class-snapshot
// columns minus the auth-only fields.
async function handleTeacherExportClassSnapshot(
  config: Config,
  actorId: string,
  body: DbRow,
): Promise<Response> {
  const classId = cleanId(body.class_id);
  if (!classId) throw new Error("class_id is required.");
  const teacherClassIds = await fetchTeacherClassIds(config, actorId);
  if (!teacherClassIds.length) throw new Error("Teacher access is required.");
  if (!teacherClassIds.includes(classId)) {
    throw new Error("You do not teach this class.");
  }

  const classRow = await selectFirst(
    config,
    `classes?id=eq.${encodeURIComponent(classId)}&select=id,name,organization_id`,
  );
  if (!classRow) throw new Error("Class not found.");
  const organizationId = cleanId(classRow.organization_id);
  const orgRow = organizationId
    ? await selectFirst(
        config,
        `organizations?id=eq.${encodeURIComponent(organizationId)}&select=id,name`,
      )
    : null;
  const orgName = orgRow ? cleanText(orgRow.name) : "";

  const memberships = await selectRows(
    config,
    `class_memberships?class_id=eq.${encodeURIComponent(classId)}&role=eq.student&select=user_id,role,status,created_at&order=created_at.asc`,
  );
  const studentIds = Array.from(
    new Set(memberships.map((row) => cleanId(row.user_id)).filter(Boolean)),
  );

  const [profiles, sessions, assignments] = await Promise.all([
    studentIds.length
      ? selectRows(
          config,
          `profiles?${inFilter("id", studentIds)}&select=id,name,grade`,
        )
      : [],
    studentIds.length
      ? selectRows(
          config,
          `learning_sessions?${inFilter("user_id", studentIds)}&select=id,user_id,lesson_id,status,updated_at&order=updated_at.desc&limit=1000`,
        )
      : [],
    selectRows(
      config,
      `assignments?class_id=eq.${encodeURIComponent(classId)}&select=id,lesson_id,title,status&order=updated_at.desc&limit=1000`,
    ),
  ]);

  const assignmentIds = assignments
    .map((row) => cleanId(row.id))
    .filter(Boolean);
  const [recipients, alerts, lessons] = await Promise.all([
    assignmentIds.length
      ? selectRows(
          config,
          `assignment_recipients?${inFilter("assignment_id", assignmentIds)}&select=assignment_id,user_id,status&limit=2000`,
        )
      : [],
    studentIds.length
      ? selectRows(
          config,
          `intervention_alerts?${inFilter("student_id", studentIds)}&select=id,student_id,status&limit=1000`,
        )
      : [],
    selectRows(config, `lessons?select=id,title&limit=1000`),
  ]);

  const profileById = new Map(
    profiles.map((profile) => [cleanId(profile.id), profile]),
  );
  const lessonsById = new Map(
    lessons.map((lesson) => [cleanId(lesson.id), lesson]),
  );
  const sessionsByUser = rowsByKey(sessions, "user_id");
  const recipientsByUser = rowsByKey(recipients, "user_id");
  const alertsByUser = rowsByKey(alerts, "student_id");
  const className = cleanText(classRow.name);

  const rows = memberships.map((membership) => {
    const userId = cleanId(membership.user_id);
    const profile = profileById.get(userId) || {};
    const userSessions = sessionsByUser.get(userId) || [];
    const completedLessons = Array.from(
      new Set(
        userSessions
          .filter((session) => cleanText(session.status) === "complete")
          .map((session) =>
            cleanText(
              lessonsById.get(cleanId(session.lesson_id))?.title ||
                session.lesson_id,
            ),
          )
          .filter(Boolean),
      ),
    );
    const latestSession = [...userSessions].sort(
      (a, b) => numericDate(b.updated_at) - numericDate(a.updated_at),
    )[0];
    const recips = recipientsByUser.get(userId) || [];
    const submittedCount = recips.filter((recipient) =>
      ["submitted", "returned", "complete"].includes(cleanText(recipient.status)),
    ).length;
    const completeCount = recips.filter(
      (recipient) => cleanText(recipient.status) === "complete",
    ).length;
    const openAlerts = (alertsByUser.get(userId) || []).filter((alert) =>
      ["open", "acknowledged"].includes(cleanText(alert.status)),
    ).length;
    return {
      organization: orgName,
      class: className,
      role: membership.role,
      membership_status: membership.status,
      name: profile.name || "",
      grade: profile.grade || "",
      completed_lessons: completedLessons.join("; "),
      completed_lesson_count: completedLessons.length,
      active_session_count: userSessions.filter(
        (session) => cleanText(session.status) === "active",
      ).length,
      latest_session_status: latestSession ? latestSession.status : "",
      latest_session_lesson: latestSession
        ? cleanText(
            lessonsById.get(cleanId(latestSession.lesson_id))?.title ||
              latestSession.lesson_id,
          )
        : "",
      assignments_total: recips.length,
      assignments_submitted: submittedCount,
      assignments_complete: completeCount,
      open_alerts: openAlerts,
    };
  });

  const safeClass =
    className
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "class";
  const csv = csvFromRows(rows, [
    { key: "organization", label: "Organization" },
    { key: "class", label: "Class" },
    { key: "role", label: "Role" },
    { key: "membership_status", label: "Membership status" },
    { key: "name", label: "Name" },
    { key: "grade", label: "Grade" },
    { key: "completed_lessons", label: "Completed lessons" },
    { key: "completed_lesson_count", label: "Completed lesson count" },
    { key: "active_session_count", label: "Active sessions" },
    { key: "latest_session_status", label: "Latest session status" },
    { key: "latest_session_lesson", label: "Latest session lesson" },
    { key: "assignments_total", label: "Assignments total" },
    { key: "assignments_submitted", label: "Assignments submitted" },
    { key: "assignments_complete", label: "Assignments complete" },
    { key: "open_alerts", label: "Open alerts" },
  ]);

  return json({
    status: "ok",
    data: {
      export: {
        filename: `${safeClass}-snapshot.csv`,
        content_type: "text/csv",
        body: csv,
      },
    },
  });
}

async function selectScopedTelemetryRows(
  config: Config,
  table: string,
  select: string,
  access: ActorAccess,
  organizationIds: string[],
  classIds: string[],
  userIds: string[],
  limit = 1500,
): Promise<DbRow[]> {
  if (access.level === "platform_admin") {
    return selectRows(
      config,
      `${table}?select=${select}&order=created_at.desc&limit=${limit}`,
    );
  }
  const queries: Promise<DbRow[]>[] = [];
  if (organizationIds.length) {
    queries.push(
      selectRows(
        config,
        `${table}?${inFilter("organization_id", organizationIds)}&select=${select}&order=created_at.desc&limit=${limit}`,
      ),
    );
  }
  if (classIds.length) {
    queries.push(
      selectRows(
        config,
        `${table}?${inFilter("class_id", classIds)}&select=${select}&order=created_at.desc&limit=${limit}`,
      ),
    );
  }
  if (userIds.length) {
    queries.push(
      selectRows(
        config,
        `${table}?${inFilter("user_id", userIds)}&select=${select}&order=created_at.desc&limit=${limit}`,
      ),
    );
  }
  const results = await Promise.all(queries);
  const seen = new Map<string, DbRow>();
  for (const row of results.flat()) {
    const id = cleanId(row.id);
    if (id) seen.set(id, row);
  }
  return Array.from(seen.values()).sort(
    (a, b) => numericDate(b.created_at) - numericDate(a.created_at),
  );
}

async function buildCostModelDashboard(
  config: Config,
  access: ActorAccess,
): Promise<{ scope: DbRow; dashboard: DbRow }> {
  const scope = await loadAdminScope(config, access);
  const organizations = Array.isArray(scope.organizations)
    ? scope.organizations as DbRow[]
    : [];
  const classes = Array.isArray(scope.classes) ? scope.classes as DbRow[] : [];
  const classMemberships = Array.isArray(scope.class_memberships)
    ? scope.class_memberships as DbRow[]
    : [];
  const profiles = Array.isArray(scope.profiles) ? scope.profiles as DbRow[] : [];
  const users = Array.isArray(scope.users) ? scope.users as DbRow[] : [];
  const organizationIds = idsFrom(organizations, "id");
  const classIds = idsFrom(classes, "id");
  const userIds = idsFrom(classMemberships, "user_id");
  const showCost = access.level === "platform_admin";

  const [
    modelEvents,
    runtimeEvents,
    speechEvents,
    sessions,
    lessons,
  ] = await Promise.all([
    selectScopedTelemetryRows(
      config,
      "model_usage_events",
      "id,user_id,organization_id,class_id,session_id,lesson_id,provider,model,task_type,input_tokens,output_tokens,cached_tokens,estimated_cost_usd,latency_ms,status,created_at",
      access,
      organizationIds,
      classIds,
      userIds,
    ),
    selectScopedTelemetryRows(
      config,
      "runtime_events",
      "id,user_id,organization_id,class_id,session_id,lesson_id,event_type,status,latency_ms,payload,created_at",
      access,
      organizationIds,
      classIds,
      userIds,
    ),
    selectScopedTelemetryRows(
      config,
      "speech_usage_events",
      "id,user_id,organization_id,class_id,session_id,provider,task_type,duration_seconds,character_count,estimated_cost_usd,status,created_at",
      access,
      organizationIds,
      classIds,
      userIds,
    ),
    access.level === "platform_admin"
      ? selectRows(
          config,
          "learning_sessions?select=id,user_id,lesson_id,stage,status,score,created_at,updated_at&order=updated_at.desc&limit=1500",
        )
      : userIds.length
        ? selectRows(
            config,
            `learning_sessions?${inFilter("user_id", userIds)}&select=id,user_id,lesson_id,stage,status,score,created_at,updated_at&order=updated_at.desc&limit=1500`,
          )
        : [],
    selectRows(config, "lessons?select=id,title,module,level,publication_status&limit=1000"),
  ]);

  const orgById = new Map(organizations.map((row) => [cleanId(row.id), row]));
  const classById = new Map(classes.map((row) => [cleanId(row.id), row]));
  const profileById = new Map(profiles.map((row) => [cleanId(row.id), row]));
  const userById = new Map(users.map((row) => [cleanId(row.id), row]));
  const lessonById = new Map(lessons.map((row) => [cleanId(row.id), row]));
  const classOrgById = new Map(
    classes.map((row) => [cleanId(row.id), cleanId(row.organization_id)]),
  );
  const userClassById = new Map<string, string>();
  for (const membership of classMemberships) {
    if (cleanText(membership.status) !== "active") continue;
    const userId = cleanId(membership.user_id);
    const classId = cleanId(membership.class_id);
    if (userId && classId && !userClassById.has(userId)) {
      userClassById.set(userId, classId);
    }
  }

  const resolveScope = (row: DbRow) => {
    const userId = cleanId(row.user_id);
    const classId = cleanId(row.class_id) || (userId ? userClassById.get(userId) || "" : "");
    const organizationId = cleanId(row.organization_id) || (classId ? classOrgById.get(classId) || "" : "");
    return { userId, classId, organizationId };
  };

  const total = emptyCostMetric({ key: "total", label: "All usage" });
  const byOrganization = new Map<string, CostMetric>();
  const byClass = new Map<string, CostMetric>();
  const byStudent = new Map<string, CostMetric>();
  const byModel = new Map<string, CostMetric>();
  const byTaskType = new Map<string, CostMetric>();
  const byLesson = new Map<string, CostMetric>();

  const touch = (
    map: Map<string, CostMetric>,
    key: string,
    input: Parameters<typeof emptyCostMetric>[0],
  ) => {
    const existing = map.get(key);
    if (existing) return existing;
    const metric = emptyCostMetric(input);
    map.set(key, metric);
    return metric;
  };

  const metricsForRow = (row: DbRow, model?: string, taskType?: string) => {
    const { userId, classId, organizationId } = resolveScope(row);
    const metrics = [total];
    if (organizationId) {
      const org = orgById.get(organizationId);
      metrics.push(
        touch(byOrganization, organizationId, {
          key: organizationId,
          label: cleanText(org?.name) || "Organization",
          organizationId,
        }),
      );
    }
    if (classId) {
      const classRow = classById.get(classId);
      metrics.push(
        touch(byClass, classId, {
          key: classId,
          label: cleanText(classRow?.name) || "Class",
          organizationId,
          classId,
        }),
      );
    }
    if (userId) {
      const profile = profileById.get(userId);
      const user = userById.get(userId);
      metrics.push(
        touch(byStudent, userId, {
          key: userId,
          label: cleanText(profile?.name) || normalizeEmail(user?.email) || "Student",
          organizationId,
          classId,
          userId,
        }),
      );
    }
    if (model) {
      metrics.push(
        touch(byModel, model, {
          key: model,
          label: model,
          model,
        }),
      );
    }
    if (taskType) {
      metrics.push(
        touch(byTaskType, taskType, {
          key: taskType,
          label: taskType.replaceAll("_", " "),
          taskType,
        }),
      );
    }
    const lessonId = cleanId(row.lesson_id);
    if (lessonId) {
      const lesson = lessonById.get(lessonId);
      metrics.push(
        touch(byLesson, lessonId, {
          key: lessonId,
          label: cleanText(lesson?.title) || lessonId,
          organizationId,
          classId,
        }),
      );
    }
    return metrics;
  };

  const addLatency = (metric: CostMetric, value: unknown) => {
    const latency = numberValue(value);
    if (latency > 0) {
      metric.latency_count += 1;
      metric.latency_total_ms += latency;
    }
  };

  for (const row of modelEvents) {
    const model = cleanText(row.model, "unknown-model");
    const taskType = cleanText(row.task_type, "unknown_task");
    for (const metric of metricsForRow(row, model, taskType)) {
      metric.model_event_count += 1;
      metric.input_tokens += numberValue(row.input_tokens);
      metric.output_tokens += numberValue(row.output_tokens);
      metric.cached_tokens += numberValue(row.cached_tokens);
      metric.estimated_cost_usd =
        (metric.estimated_cost_usd || 0) + numberValue(row.estimated_cost_usd);
      addLatency(metric, row.latency_ms);
      if (cleanText(row.status) === "error") metric.error_count += 1;
    }
  }

  for (const row of runtimeEvents) {
    const taskType = cleanText(row.event_type, "runtime");
    for (const metric of metricsForRow(row, undefined, taskType)) {
      metric.runtime_event_count += 1;
      addLatency(metric, row.latency_ms);
      if (cleanText(row.status) === "error") metric.error_count += 1;
    }
  }

  for (const row of speechEvents) {
    const taskType = cleanText(row.task_type, "speech");
    for (const metric of metricsForRow(row, cleanText(row.provider, "speech"), taskType)) {
      metric.speech_event_count += 1;
      metric.estimated_cost_usd =
        (metric.estimated_cost_usd || 0) + numberValue(row.estimated_cost_usd);
      if (cleanText(row.status) === "error") metric.error_count += 1;
    }
  }

  for (const row of sessions) {
    for (const metric of metricsForRow(row)) {
      metric.session_count += 1;
      if (cleanText(row.status) === "complete") metric.completion_count += 1;
    }
  }

  const runtimeHealth: RuntimeHealthSummary = {
    run_failures: 0,
    engine_wake_timeouts: 0,
    engine_retry_successes: 0,
    rate_limit_hits: 0,
    controlled_errors: 0,
    last_runtime_event_at: null,
  };
  for (const row of runtimeEvents) {
    const payload = row.payload && typeof row.payload === "object" ? row.payload as DbRow : {};
    const reason = cleanText(payload.reason);
    const eventType = cleanText(row.event_type);
    if (!runtimeHealth.last_runtime_event_at && typeof row.created_at === "string") {
      runtimeHealth.last_runtime_event_at = row.created_at;
    }
    if (eventType === "run_failure") runtimeHealth.run_failures += 1;
    if (reason.includes("engine_wake_timeout")) runtimeHealth.engine_wake_timeouts += 1;
    if (reason === "engine_retry_success") runtimeHealth.engine_retry_successes += 1;
    if (reason.includes("rate_limit")) runtimeHealth.rate_limit_hits += 1;
    if (eventType === "controlled_error") runtimeHealth.controlled_errors += 1;
  }

  const sanitizeModelEvent = (row: DbRow) => ({
    id: row.id,
    user_id: row.user_id || null,
    organization_id: row.organization_id || null,
    class_id: row.class_id || null,
    session_id: row.session_id || null,
    lesson_id: row.lesson_id || null,
    provider: row.provider || "openai",
    model: row.model || "unknown",
    task_type: row.task_type || "mentor_turn",
    input_tokens: numberValue(row.input_tokens),
    output_tokens: numberValue(row.output_tokens),
    cached_tokens: numberValue(row.cached_tokens),
    estimated_cost_usd: showCost ? numberValue(row.estimated_cost_usd) : null,
    latency_ms: row.latency_ms || null,
    status: row.status || "ok",
    created_at: row.created_at || null,
  });

  return {
    scope,
    dashboard: {
      generated_at: new Date().toISOString(),
      visibility: showCost ? "full_cost" : "scoped_usage",
      totals: finishCostMetric(total, showCost),
      by_organization: sortedMetrics(byOrganization, showCost),
      by_class: sortedMetrics(byClass, showCost),
      by_student: sortedMetrics(byStudent, showCost).slice(0, 40),
      by_model: sortedMetrics(byModel, showCost),
      by_task_type: sortedMetrics(byTaskType, showCost),
      by_lesson: sortedMetrics(byLesson, showCost).slice(0, 40),
      runtime_health: runtimeHealth,
      recent_model_events: modelEvents.slice(0, 30).map(sanitizeModelEvent),
      recent_runtime_errors: runtimeEvents
        .filter((row) => cleanText(row.status) === "error")
        .slice(0, 30),
      recent_speech_events: speechEvents.slice(0, 30).map((row) => ({
        id: row.id,
        user_id: row.user_id || null,
        organization_id: row.organization_id || null,
        class_id: row.class_id || null,
        session_id: row.session_id || null,
        provider: row.provider || "browser",
        task_type: row.task_type || "speech",
        duration_seconds: numberValue(row.duration_seconds),
        character_count: numberValue(row.character_count),
        estimated_cost_usd: showCost ? numberValue(row.estimated_cost_usd) : null,
        status: row.status || "ok",
        created_at: row.created_at || null,
      })),
    },
  };
}

async function handleListCostModelDashboard(
  config: Config,
  access: ActorAccess,
): Promise<Response> {
  const data = await buildCostModelDashboard(config, access);
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      scope: data.scope,
      cost_model_dashboard: data.dashboard,
    },
  });
}

async function handleCreateClass(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as DbRow)
      : {};
  const name = cleanText(payload.name || body.class_name);
  if (!organizationId) throw new Error("organization_id is required.");
  requireOrganizationAccess(access, organizationId);
  if (!name) throw new Error("Class name is required.");

  const classRow = await insertRow(config, "classes", {
    organization_id: organizationId,
    name,
    status: "active",
    created_by: actorId,
  });
  await audit(config, {
    actorId,
    organizationId,
    classId: String(classRow.id),
    eventType: "admin.class_created",
    entityType: "class",
    entityId: String(classRow.id),
    payload: { name },
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, { class: classRow }),
  });
}

async function handleUpdateClass(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const classId = cleanId(body.class_id);
  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as DbRow)
      : {};
  if (!classId) throw new Error("class_id is required.");

  const existing = await selectFirst(
    config,
    `classes?id=eq.${encodeURIComponent(classId)}&select=*`,
  );
  if (!existing) throw new Error("Class not found.");
  requireOrganizationAccess(access, cleanId(existing.organization_id));

  const patch: DbRow = { updated_at: new Date().toISOString() };
  const name = cleanText(payload.name);
  const status = cleanText(payload.status);
  if (name) patch.name = name;
  if (status) {
    if (!["active", "archived"].includes(status))
      throw new Error("Class status must be active or archived.");
    patch.status = status;
  }
  if (!name && !status)
    throw new Error("Provide a class name or status to update.");

  const updated = await patchRows(
    config,
    `classes?id=eq.${encodeURIComponent(classId)}`,
    patch,
  );
  await audit(config, {
    actorId,
    organizationId:
      typeof existing.organization_id === "string"
        ? existing.organization_id
        : null,
    classId,
    eventType: "admin.class_updated",
    entityType: "class",
    entityId: classId,
    payload: patch,
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, { class: updated[0] || null }),
  });
}

async function handleResetPassword(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const userId = cleanId(body.user_id);
  const password = cleanText(body.temporary_password);
  if (!userId) throw new Error("user_id is required.");
  if (password.length < 6)
    throw new Error(
      "A temporary password of at least 6 characters is required.",
    );

  const memberships = await fetchAccessibleOrgMembershipsForUser(
    config,
    access,
    userId,
  );
  if (access.level !== "platform_admin" && !memberships.length) {
    throw new Error("Admin access for this user is required.");
  }

  await serviceFetch(
    config,
    `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ password }),
    },
  );
  await audit(config, {
    actorId,
    organizationId:
      memberships.length > 0 ? cleanId(memberships[0].organization_id) : null,
    eventType: "admin.password_reset",
    entityType: "auth_user",
    entityId: userId,
    payload: { password_supplied: true },
  });

  return json({ status: "ok", data: await scopeResponse(config, access) });
}

function membershipTable(type: MembershipType): string {
  return type === "organization"
    ? "organization_memberships"
    : "class_memberships";
}

function normalizeMembershipStatus(
  type: MembershipType,
  value: unknown,
): string {
  const status = cleanText(value).toLowerCase();
  if (type === "organization") {
    if (!["active", "invited", "disabled"].includes(status)) {
      throw new Error(
        "Organization membership status must be active, invited, or disabled.",
      );
    }
    return status;
  }
  const mapped = status === "disabled" ? "removed" : status;
  if (!["active", "invited", "removed"].includes(mapped)) {
    throw new Error(
      "Class membership status must be active, invited, removed, or disabled.",
    );
  }
  return mapped;
}

function normalizeMembershipRole(type: MembershipType, value: unknown): string {
  const role = cleanText(value).toLowerCase();
  if (type === "organization") {
    if (!["student", "teacher", "org_admin"].includes(role)) {
      throw new Error(
        "Organization role must be student, teacher, or org_admin.",
      );
    }
    return role;
  }
  if (!["student", "teacher"].includes(role)) {
    throw new Error("Class role must be student or teacher.");
  }
  return role;
}

async function fetchMembership(
  config: Config,
  type: MembershipType,
  membershipId: string,
): Promise<DbRow> {
  const row = await selectFirst(
    config,
    `${membershipTable(type)}?id=eq.${encodeURIComponent(membershipId)}&select=*`,
  );
  if (!row) throw new Error("Membership not found.");
  return row;
}

async function auditMembership(
  config: Config,
  input: {
    actorId: string;
    type: MembershipType;
    eventType: string;
    membership: DbRow;
    patch: DbRow;
  },
) {
  const classId =
    input.type === "class" ? cleanId(input.membership.class_id) : null;
  const organizationId =
    input.type === "organization"
      ? cleanId(input.membership.organization_id)
      : classId
        ? await fetchClassOrganizationId(config, classId)
        : null;
  await audit(config, {
    actorId: input.actorId,
    organizationId,
    classId,
    eventType: input.eventType,
    entityType: `${input.type}_membership`,
    entityId: cleanId(input.membership.id),
    payload: {
      user_id: input.membership.user_id || null,
      previous_role: input.membership.role || null,
      previous_status: input.membership.status || null,
      patch: input.patch,
    },
  });
}

async function handleUpdateMembershipStatus(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as DbRow)
      : {};
  const type = membershipType(payload.membership_type || payload.type);
  const membershipId = cleanId(body.membership_id);
  if (!type)
    throw new Error("payload.membership_type must be organization or class.");
  if (!membershipId) throw new Error("membership_id is required.");

  const membership = await fetchMembership(config, type, membershipId);
  await requireMembershipAccess(config, access, type, membership);
  const status = normalizeMembershipStatus(type, body.status || payload.status);
  const patch = { status, updated_at: new Date().toISOString() };
  const updated = await patchRows(
    config,
    `${membershipTable(type)}?id=eq.${encodeURIComponent(membershipId)}`,
    patch,
  );
  await auditMembership(config, {
    actorId,
    type,
    eventType: "admin.membership_status_updated",
    membership,
    patch,
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, {
      membership: updated[0] || null,
    }),
  });
}

async function handleUpdateMembershipRole(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as DbRow)
      : {};
  const type = membershipType(payload.membership_type || payload.type);
  const membershipId = cleanId(body.membership_id);
  if (!type)
    throw new Error("payload.membership_type must be organization or class.");
  if (!membershipId) throw new Error("membership_id is required.");

  const membership = await fetchMembership(config, type, membershipId);
  if (type === "organization" && access.level !== "platform_admin") {
    throw new Error("Only platform admins may change organization roles.");
  }
  await requireMembershipAccess(config, access, type, membership, {
    allowOrgAdminOrgMembership:
      type === "organization" && access.level === "platform_admin",
  });
  const role = normalizeMembershipRole(type, body.role || payload.role);
  const patch = { role, updated_at: new Date().toISOString() };
  const updated = await patchRows(
    config,
    `${membershipTable(type)}?id=eq.${encodeURIComponent(membershipId)}`,
    patch,
  );
  await auditMembership(config, {
    actorId,
    type,
    eventType: "admin.membership_role_updated",
    membership,
    patch,
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, {
      membership: updated[0] || null,
    }),
  });
}

async function handleAddExistingUser(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  const classId = cleanId(body.class_id);
  const userId = cleanId(body.user_id);
  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as DbRow)
      : {};
  const role = normalizeMembershipRole("class", body.role || payload.role);
  if (!organizationId || !classId || !userId) {
    throw new Error("organization_id, class_id, and user_id are required.");
  }
  requireOrganizationAccess(access, organizationId);
  const classOrganizationId = await fetchClassOrganizationId(config, classId);
  if (classOrganizationId !== organizationId) {
    throw new Error("Class does not belong to the selected organization.");
  }

  let orgMembership: DbRow | null = null;
  const existingOrgMembership = await selectFirst(
    config,
    `organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  );
  if (access.level === "platform_admin") {
    if (existingOrgMembership) {
      const patched = await patchRows(
        config,
        `organization_memberships?id=eq.${encodeURIComponent(cleanId(existingOrgMembership.id))}`,
        { status: "active", updated_at: new Date().toISOString() },
      );
      orgMembership = patched[0] || existingOrgMembership;
    } else {
      orgMembership = await upsertByConflict(
        config,
        "organization_memberships",
        "organization_id,user_id",
        {
          organization_id: organizationId,
          user_id: userId,
          role,
          status: "active",
          updated_at: new Date().toISOString(),
        },
      );
    }
  } else {
    if (!existingOrgMembership || existingOrgMembership.status !== "active") {
      throw new Error(
        "Org admins may add only existing active organization users to classes.",
      );
    }
    orgMembership = existingOrgMembership;
  }
  const classMembership = await upsertByConflict(
    config,
    "class_memberships",
    "class_id,user_id",
    {
      class_id: classId,
      user_id: userId,
      role,
      status: "active",
      updated_at: new Date().toISOString(),
    },
  );

  await audit(config, {
    actorId,
    organizationId,
    classId,
    eventType: "admin.user_added_to_class",
    entityType: "class_membership",
    entityId: String(classMembership.id),
    payload: {
      user_id: userId,
      role,
      organization_membership_id: orgMembership?.id || null,
    },
  });

  return json({
    status: "ok",
    data: await scopeResponse(config, access, { membership: classMembership }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  let config: Config;
  try {
    config = envConfig(req);
  } catch (error) {
    const status = errorMessage(error).includes("Authentication") ? 401 : 500;
    return errorResponse(errorMessage(error), status);
  }

  try {
    const actor = await fetchCurrentUser(config);
    const actorId = String(actor.id);

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }

    const record = body as DbRow;
    const action = cleanText(record.action);

    // Teacher-scoped actions authorize via class_memberships (role=teacher), so they must be
    // dispatched BEFORE fetchActorAccess, which throws for anyone who is not a platform/org admin.
    if (action === "teacher_generate_progress_report")
      return await handleTeacherGenerateProgressReport(config, actorId, record);
    if (action === "teacher_export_class_snapshot")
      return await handleTeacherExportClassSnapshot(config, actorId, record);

    const actorAccess = await fetchActorAccess(config, actorId);
    if (action === "list_admin_scope")
      return await handleListAdminScope(config, actorAccess);
    if (action === "list_pilot_readiness")
      return await handleListPilotReadiness(config, actorAccess);
    if (action === "list_active_sessions")
      return await handleListActiveSessions(config, actorAccess);
    if (action === "list_cost_model_dashboard")
      return await handleListCostModelDashboard(config, actorAccess);
    if (action === "export_class_snapshot")
      return await handleExportClassSnapshot(config, actorAccess, record);
    if (action === "preview_csv_import")
      return await handlePreviewCsvImport(config, actorId, actorAccess, record);
    if (action === "apply_csv_roster_import")
      return await handleApplyCsvRosterImport(config, actorId, actorAccess, record);
    if (action === "export_student_archive")
      return await handleExportStudentArchive(config, actorId, actorAccess, record);
    if (action === "request_data_retention")
      return await handleRequestDataRetention(config, actorId, actorAccess, record);
    if (action === "upsert_consent_settings")
      return await handleUpsertConsentSettings(config, actorId, actorAccess, record);
    if (action === "organization_links")
      return await handleOrganizationLinks(config, actorId, actorAccess, record);
    if (action === "generate_progress_report")
      return await handleGenerateProgressReport(config, actorId, actorAccess, record);
    if (action === "create_class")
      return await handleCreateClass(config, actorId, actorAccess, record);
    if (action === "update_class")
      return await handleUpdateClass(config, actorId, actorAccess, record);
    if (action === "reset_user_password")
      return await handleResetPassword(config, actorId, actorAccess, record);
    if (action === "update_membership_status") {
      return await handleUpdateMembershipStatus(
        config,
        actorId,
        actorAccess,
        record,
      );
    }
    if (action === "update_membership_role")
      return await handleUpdateMembershipRole(
        config,
        actorId,
        actorAccess,
        record,
      );
    if (action === "add_existing_user_to_class")
      return await handleAddExistingUser(config, actorId, actorAccess, record);
    return errorResponse("Unsupported admin-ops action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status =
      message.includes("Admin access") ||
      message.includes("platform admins") ||
      message.includes("org-admin") ||
      message.includes("Teacher access") ||
      message.includes("do not teach") ||
      message.includes("not enrolled in this class")
        ? 403
        : message.includes("authenticated") ||
            message.includes("Authentication")
          ? 401
          : 500;
    return errorResponse(message, status);
  }
});
