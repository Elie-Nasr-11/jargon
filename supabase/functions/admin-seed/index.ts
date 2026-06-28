// Jargon admin pilot seeding.
// Platform admins (any org) or organization admins (their own org only):
// creates/reuses Auth users, profiles, org/class memberships,
// and seed audit rows for classroom pilots.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbRow = Record<string, unknown>;

type SeedUser = {
  email: string;
  name: string;
  role: "student" | "teacher";
  grade?: string;
  password?: string;
};

type SeedResult = {
  email: string;
  role: "student" | "teacher";
  status: "created" | "reused" | "failed" | "skipped";
  user_id?: string;
  error?: string;
};

type Config = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  authorization: string;
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
  return json({ status: "error", results: [], error: message }, status);
}

function envConfig(req: Request): Config {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization") || "";

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  if (!authorization) throw new Error("Authentication is required.");
  return { url, anonKey, serviceRoleKey, authorization };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanRole(value: unknown): "student" | "teacher" | null {
  const role = cleanText(value).toLowerCase();
  return role === "student" || role === "teacher" ? role : null;
}

async function userFetch(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? String((data as DbRow).message)
      : res.statusText;
    throw new Error(message);
  }
  return data;
}

async function serviceFetch(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? String((data as DbRow).message)
      : res.statusText;
    throw new Error(message);
  }
  return data;
}

async function fetchCurrentUser(config: Config): Promise<DbRow> {
  const data = await userFetch(config, "/auth/v1/user");
  if (!data || typeof data !== "object" || typeof (data as DbRow).id !== "string") {
    throw new Error("Could not identify authenticated user.");
  }
  return data as DbRow;
}

type ActorAccess = { level: "platform_admin" | "org_admin"; organizationIds: string[] };

// Platform admins, or org admins scoped to the org(s) they administer.
async function resolveActorAccess(config: Config, userId: string): Promise<ActorAccess> {
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
          row && typeof row === "object" ? cleanText((row as DbRow).organization_id) : "",
        )
        .filter(Boolean)
    : [];
  if (!organizationIds.length) {
    throw new Error("Admin access is required.");
  }
  return { level: "org_admin", organizationIds: Array.from(new Set(organizationIds)) };
}

// Resolve the seed target org, enforcing the org-admin boundary: org admins may
// only seed into an existing org they administer, never create a new org.
async function resolveSeedOrganization(
  config: Config,
  access: ActorAccess,
  input: DbRow,
): Promise<DbRow> {
  if (access.level === "org_admin") {
    const id = cleanText(input.id);
    if (!id || !access.organizationIds.includes(id)) {
      throw new Error("Organization admins can only seed into their own organization.");
    }
    const org = await selectFirst(
      config,
      `organizations?id=eq.${encodeURIComponent(id)}&select=*`,
    );
    if (!org) throw new Error("Organization not found.");
    return org;
  }
  return await upsertOrganization(config, input);
}

async function selectFirst(config: Config, path: string): Promise<DbRow | null> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as DbRow;
}

async function insertRow(config: Config, table: string, row: DbRow): Promise<DbRow> {
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

async function patchRows(config: Config, path: string, row: DbRow): Promise<void> {
  await serviceFetch(config, `/rest/v1/${path}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
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

async function upsertOrganization(config: Config, input: DbRow): Promise<DbRow> {
  const name = cleanText(input.name);
  const slug = slugify(cleanText(input.slug) || name);
  const id = cleanText(input.id);
  if (!name || !slug) throw new Error("Organization name and slug are required.");

  const existing = id
    ? await selectFirst(config, `organizations?id=eq.${encodeURIComponent(id)}&select=*`)
    : await selectFirst(config, `organizations?slug=eq.${encodeURIComponent(slug)}&select=*`);

  if (existing) {
    await patchRows(config, `organizations?id=eq.${encodeURIComponent(String(existing.id))}`, {
      name,
      slug,
      status: "active",
      updated_at: new Date().toISOString(),
    });
    return { ...existing, name, slug, status: "active" };
  }

  return await insertRow(config, "organizations", {
    name,
    slug,
    organization_type: "school",
    status: "active",
  });
}

async function upsertClass(config: Config, input: DbRow, organizationId: string, createdBy: string): Promise<DbRow> {
  const name = cleanText(input.name);
  const id = cleanText(input.id);
  if (!name) throw new Error("Class name is required.");

  const existing = id
    ? await selectFirst(config, `classes?id=eq.${encodeURIComponent(id)}&select=*`)
    : await selectFirst(
      config,
      `classes?organization_id=eq.${encodeURIComponent(organizationId)}&name=eq.${encodeURIComponent(name)}&select=*`,
    );

  if (existing) {
    await patchRows(config, `classes?id=eq.${encodeURIComponent(String(existing.id))}`, {
      name,
      status: "active",
      updated_at: new Date().toISOString(),
    });
    return { ...existing, name, status: "active" };
  }

  return await insertRow(config, "classes", {
    organization_id: organizationId,
    name,
    status: "active",
    created_by: createdBy,
  });
}

async function listAuthUsers(config: Config, page = 1): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/auth/v1/admin/users?page=${page}&per_page=1000`);
  if (Array.isArray(data)) return data.filter((row) => row && typeof row === "object") as DbRow[];
  const users = data && typeof data === "object" ? (data as DbRow).users : null;
  return Array.isArray(users) ? users.filter((row) => row && typeof row === "object") as DbRow[] : [];
}

async function findAuthUserByEmail(config: Config, email: string): Promise<DbRow | null> {
  for (let page = 1; page <= 10; page += 1) {
    const users = await listAuthUsers(config, page);
    const match = users.find((user) => normalizeEmail(user.email) === email);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  return null;
}

async function createAuthUser(config: Config, user: SeedUser, password: string): Promise<DbRow> {
  const data = await serviceFetch(config, "/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: {
        name: user.name,
        grade: user.grade || "",
      },
      app_metadata: {
        jargon_seeded_role: user.role,
      },
    }),
  });
  if (!data || typeof data !== "object" || typeof (data as DbRow).id !== "string") {
    throw new Error("Auth user creation returned no user id.");
  }
  return data as DbRow;
}

async function updateAuthUser(config: Config, userId: string, user: SeedUser, password: string | null): Promise<void> {
  const body: DbRow = {
    user_metadata: {
      name: user.name,
      grade: user.grade || "",
    },
    app_metadata: {
      jargon_seeded_role: user.role,
    },
  };
  if (password) body.password = password;

  await serviceFetch(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function upsertProfile(config: Config, userId: string, user: SeedUser): Promise<void> {
  await upsertByConflict(config, "profiles", "id", {
    id: userId,
    name: user.name,
    grade: user.grade || null,
  });
}

async function upsertOrganizationMembership(
  config: Config,
  organizationId: string,
  userId: string,
  role: "student" | "teacher",
): Promise<void> {
  await upsertByConflict(config, "organization_memberships", "organization_id,user_id", {
    organization_id: organizationId,
    user_id: userId,
    role,
    status: "active",
    updated_at: new Date().toISOString(),
  });
}

async function upsertClassMembership(
  config: Config,
  classId: string,
  userId: string,
  role: "student" | "teacher",
): Promise<void> {
  await upsertByConflict(config, "class_memberships", "class_id,user_id", {
    class_id: classId,
    user_id: userId,
    role,
    status: "active",
    updated_at: new Date().toISOString(),
  });
}

async function insertSeedEntry(
  config: Config,
  batchId: string,
  organizationId: string,
  classId: string,
  user: SeedUser,
  result: SeedResult,
): Promise<void> {
  await insertRow(config, "admin_account_seed_entries", {
    batch_id: batchId,
    organization_id: organizationId,
    class_id: classId,
    user_id: result.user_id || null,
    email: user.email,
    display_name: user.name,
    grade: user.grade || null,
    role: user.role,
    status: result.status === "reused" ? "skipped" : result.status,
    error_message: result.error || null,
    metadata: {
      result_status: result.status,
      password_supplied: Boolean(user.password),
    },
  });
}

function normalizeSeedUsers(raw: unknown[]): SeedUser[] {
  return raw.map((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as DbRow : {};
    const role = cleanRole(row.role);
    return {
      email: normalizeEmail(row.email),
      name: cleanText(row.name),
      role: role || "student",
      grade: cleanText(row.grade),
      password: cleanText(row.password),
    };
  });
}

function summarize(results: SeedResult[]): DbRow {
  return results.reduce(
    (summary, result) => {
      summary.total += 1;
      summary[result.status] += 1;
      return summary;
    },
    { total: 0, created: 0, reused: 0, failed: 0, skipped: 0 } as Record<SeedResult["status"] | "total", number>,
  );
}

async function handleSeedRoster(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organization = await resolveSeedOrganization(config, access, (body.organization as DbRow) || {});
  // Org admins cannot target a class by id (could belong to another org); they
  // create/reuse a class by name within their own org.
  const classInput =
    access.level === "org_admin"
      ? { name: ((body.class as DbRow) || {}).name }
      : (body.class as DbRow) || {};
  const classRow = await upsertClass(config, classInput, String(organization.id), actorId);
  const defaultPassword = cleanText(body.default_password);
  const rawUsers = Array.isArray(body.users) ? body.users : [];
  const users = normalizeSeedUsers(rawUsers);
  if (!users.length) throw new Error("At least one roster user is required.");

  const batch = await insertRow(config, "admin_account_seed_batches", {
    organization_id: organization.id,
    class_id: classRow.id,
    created_by: actorId,
    label: `${String(classRow.name)} roster seed`,
    status: "processing",
    summary: { total: users.length },
  });

  const results: SeedResult[] = [];
  for (const user of users) {
    let result: SeedResult = { email: user.email || "(missing email)", role: user.role, status: "failed" };
    try {
      if (!user.email || !user.email.includes("@")) throw new Error("Valid email is required.");
      if (!user.name) throw new Error("Name is required.");
      const password = user.password || defaultPassword;
      if (!password || password.length < 6) throw new Error("A temporary password of at least 6 characters is required.");

      const existing = await findAuthUserByEmail(config, user.email);
      const authUser = existing || await createAuthUser(config, user, password);
      const userId = String(authUser.id);
      if (existing) await updateAuthUser(config, userId, user, password);

      await upsertProfile(config, userId, user);
      await upsertOrganizationMembership(config, String(organization.id), userId, user.role);
      await upsertClassMembership(config, String(classRow.id), userId, user.role);

      result = {
        email: user.email,
        role: user.role,
        status: existing ? "reused" : "created",
        user_id: userId,
      };
    } catch (error) {
      result = {
        email: user.email || "(missing email)",
        role: user.role,
        status: "failed",
        error: errorMessage(error),
      };
    }
    results.push(result);
    await insertSeedEntry(config, String(batch.id), String(organization.id), String(classRow.id), user, result);
  }

  const summary = summarize(results);
  await patchRows(config, `admin_account_seed_batches?id=eq.${encodeURIComponent(String(batch.id))}`, {
    status: "complete",
    summary,
    updated_at: new Date().toISOString(),
  });

  return json({
    status: "ok",
    batch_id: batch.id,
    organization_id: organization.id,
    class_id: classRow.id,
    results,
  });
}

async function handleListSeedBatches(config: Config, access: ActorAccess): Promise<Response> {
  const orgFilter =
    access.level === "org_admin"
      ? `&organization_id=in.(${access.organizationIds.map((id) => encodeURIComponent(id)).join(",")})`
      : "";
  const data = await serviceFetch(
    config,
    `/rest/v1/admin_account_seed_batches?select=id,label,status,summary,created_at,organization_id,class_id&order=created_at.desc&limit=20${orgFilter}`,
  );
  return json({ status: "ok", batches: Array.isArray(data) ? data : [], results: [] });
}

async function handleUpsertOrgClass(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  const organization = await resolveSeedOrganization(config, access, (body.organization as DbRow) || {});
  const classInput =
    access.level === "org_admin"
      ? { name: ((body.class as DbRow) || {}).name }
      : (body.class as DbRow) || {};
  const classRow = await upsertClass(config, classInput, String(organization.id), actorId);
  return json({
    status: "ok",
    organization_id: organization.id,
    class_id: classRow.id,
    results: [],
  });
}

async function ensureDemoUser(
  config: Config,
  input: { email: string; name: string; authRole: "student" | "teacher"; password: string },
): Promise<string> {
  const seedUser: SeedUser = { email: input.email, name: input.name, role: input.authRole };
  const existing = await findAuthUserByEmail(config, input.email);
  const authUser = existing || await createAuthUser(config, seedUser, input.password);
  const userId = String(authUser.id);
  if (existing) await updateAuthUser(config, userId, seedUser, input.password);
  await upsertProfile(config, userId, seedUser);
  return userId;
}

// Platform-admin-only: create (or reset) three demo logins in a clearly-named
// "Demo Org" so the user can test each portal — student, teacher, org-admin.
// (The platform-admin login is the caller's own account.) Idempotent.
async function handleSeedDemoLogins(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
): Promise<Response> {
  if (access.level !== "platform_admin") {
    throw new Error("Platform admin access is required to create demo logins.");
  }
  const password = cleanText(body.default_password) || "JargonDemo123!";
  if (password.length < 6) {
    throw new Error("A demo password of at least 6 characters is required.");
  }

  const organization = await upsertOrganization(config, { name: "Demo Org", slug: "demo-org" });
  const organizationId = String(organization.id);
  const classRow = await upsertClass(config, { name: "Demo Class" }, organizationId, actorId);
  const classId = String(classRow.id);

  const studentId = await ensureDemoUser(config, {
    email: "demo-student@example.com",
    name: "Demo Student",
    authRole: "student",
    password,
  });
  await upsertOrganizationMembership(config, organizationId, studentId, "student");
  await upsertClassMembership(config, classId, studentId, "student");

  const teacherId = await ensureDemoUser(config, {
    email: "demo-teacher@example.com",
    name: "Demo Teacher",
    authRole: "teacher",
    password,
  });
  await upsertOrganizationMembership(config, organizationId, teacherId, "teacher");
  await upsertClassMembership(config, classId, teacherId, "teacher");

  const orgAdminId = await ensureDemoUser(config, {
    email: "demo-admin@example.com",
    name: "Demo Admin",
    authRole: "teacher",
    password,
  });
  await upsertByConflict(config, "organization_memberships", "organization_id,user_id", {
    organization_id: organizationId,
    user_id: orgAdminId,
    role: "org_admin",
    status: "active",
    updated_at: new Date().toISOString(),
  });

  return json({
    status: "ok",
    organization_id: organizationId,
    class_id: classId,
    password,
    accounts: [
      { email: "demo-student@example.com", role: "student", user_id: studentId },
      { email: "demo-teacher@example.com", role: "teacher", user_id: teacherId },
      { email: "demo-admin@example.com", role: "org_admin", user_id: orgAdminId },
    ],
    results: [],
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    const access = await resolveActorAccess(config, String(actor.id));

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }

    const record = body as DbRow;
    const action = cleanText(record.action);
    if (action === "seed_roster")
      return await handleSeedRoster(config, String(actor.id), access, record);
    if (action === "list_seed_batches") return await handleListSeedBatches(config, access);
    if (action === "upsert_org_class")
      return await handleUpsertOrgClass(config, String(actor.id), access, record);
    if (action === "seed_demo_logins")
      return await handleSeedDemoLogins(config, String(actor.id), access, record);
    return errorResponse("Unsupported admin-seed action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status =
      message.includes("Admin access") ||
      message.includes("Platform admin") ||
      message.includes("Organization admins")
        ? 403
        : message.includes("authenticated") || message.includes("Authentication")
          ? 401
          : 500;
    return errorResponse(message, status);
  }
});
