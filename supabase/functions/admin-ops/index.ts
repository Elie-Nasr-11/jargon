// Jargon platform admin operations.
// Platform-admin only: uses service-role access for account, membership, and audit operations.
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

async function assertPlatformAdmin(
  config: Config,
  userId: string,
): Promise<void> {
  const data = await serviceFetch(
    config,
    `/rest/v1/platform_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  );
  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Platform admin access is required.");
  }
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

async function loadAdminScope(config: Config): Promise<DbRow> {
  const [
    organizations,
    classes,
    organizationMemberships,
    classMemberships,
    profiles,
    seedBatches,
    auditEvents,
    authUsers,
  ] = await Promise.all([
    selectRows(
      config,
      "organizations?select=id,name,slug,organization_type,status,created_at,updated_at&order=name.asc",
    ),
    selectRows(
      config,
      "classes?select=id,organization_id,name,class_code,status,created_by,created_at,updated_at&order=name.asc",
    ),
    selectRows(
      config,
      "organization_memberships?select=id,organization_id,user_id,role,status,created_at,updated_at&order=created_at.desc",
    ),
    selectRows(
      config,
      "class_memberships?select=id,class_id,user_id,role,status,created_at,updated_at&order=created_at.desc",
    ),
    selectRows(config, "profiles?select=id,name,grade"),
    selectRows(
      config,
      "admin_account_seed_batches?select=id,label,status,summary,created_at,updated_at,organization_id,class_id&order=created_at.desc&limit=30",
    ),
    selectRows(
      config,
      "audit_events?select=id,actor_id,organization_id,class_id,event_type,entity_type,entity_id,payload,created_at&order=created_at.desc&limit=100",
    ),
    listAllAuthUsers(config),
  ]);

  const memberIds = new Set<string>();
  for (const row of [...organizationMemberships, ...classMemberships]) {
    if (typeof row.user_id === "string") memberIds.add(row.user_id);
  }

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

async function handleListAdminScope(config: Config): Promise<Response> {
  return json({ status: "ok", data: await loadAdminScope(config) });
}

async function handleCreateClass(
  config: Config,
  actorId: string,
  body: DbRow,
): Promise<Response> {
  const organizationId = cleanId(body.organization_id);
  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as DbRow)
      : {};
  const name = cleanText(payload.name || body.class_name);
  if (!organizationId) throw new Error("organization_id is required.");
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
    data: { class: classRow, scope: await loadAdminScope(config) },
  });
}

async function handleUpdateClass(
  config: Config,
  actorId: string,
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
    data: { class: updated[0] || null, scope: await loadAdminScope(config) },
  });
}

async function handleResetPassword(
  config: Config,
  actorId: string,
  body: DbRow,
): Promise<Response> {
  const userId = cleanId(body.user_id);
  const password = cleanText(body.temporary_password);
  if (!userId) throw new Error("user_id is required.");
  if (password.length < 6)
    throw new Error(
      "A temporary password of at least 6 characters is required.",
    );

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
    eventType: "admin.password_reset",
    entityType: "auth_user",
    entityId: userId,
    payload: { password_supplied: true },
  });

  return json({ status: "ok", data: { scope: await loadAdminScope(config) } });
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
  const organizationId =
    input.type === "organization"
      ? cleanId(input.membership.organization_id)
      : null;
  const classId =
    input.type === "class" ? cleanId(input.membership.class_id) : null;
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
    data: {
      membership: updated[0] || null,
      scope: await loadAdminScope(config),
    },
  });
}

async function handleUpdateMembershipRole(
  config: Config,
  actorId: string,
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
    data: {
      membership: updated[0] || null,
      scope: await loadAdminScope(config),
    },
  });
}

async function handleAddExistingUser(
  config: Config,
  actorId: string,
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

  const orgMembership = await upsertByConflict(
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
      organization_membership_id: orgMembership.id || null,
    },
  });

  return json({
    status: "ok",
    data: { membership: classMembership, scope: await loadAdminScope(config) },
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
    await assertPlatformAdmin(config, actorId);

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }

    const record = body as DbRow;
    const action = cleanText(record.action);
    if (action === "list_admin_scope")
      return await handleListAdminScope(config);
    if (action === "create_class")
      return await handleCreateClass(config, actorId, record);
    if (action === "update_class")
      return await handleUpdateClass(config, actorId, record);
    if (action === "reset_user_password")
      return await handleResetPassword(config, actorId, record);
    if (action === "update_membership_status") {
      return await handleUpdateMembershipStatus(config, actorId, record);
    }
    if (action === "update_membership_role")
      return await handleUpdateMembershipRole(config, actorId, record);
    if (action === "add_existing_user_to_class")
      return await handleAddExistingUser(config, actorId, record);
    return errorResponse("Unsupported admin-ops action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("Platform admin")
      ? 403
      : message.includes("authenticated") || message.includes("Authentication")
        ? 401
        : 500;
    return errorResponse(message, status);
  }
});
