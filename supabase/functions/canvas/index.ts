// Canvas LMS integration v1 (C1: connect + import).
// Read-only OAuth2, course/roster preview, and roster import into Jargon classes.
// Canvas is per-institution, so each connection stores the institution base_url
// (e.g. https://school.instructure.com). Canvas tokens + the client secret stay
// server-side in this Edge Function. The grade-passback (push_grades) and
// scheduled (sync) actions are reserved for later phases (C3/C4).
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
  canvasClientId: string;
  canvasClientSecret: string;
  canvasRedirectUri: string;
  canvasScopes: string[];
  tokenKey: string;
};

type ActorAccess = {
  level: "platform_admin" | "org_admin" | "teacher";
  organizationIds: string[];
};

type CanvasProfile = {
  id?: number | string;
  name?: string;
  primary_email?: string;
  login_id?: string;
};

type CanvasUser = {
  id?: number | string;
  name?: string;
  email?: string;
  login_id?: string;
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

function resolveTokenKey(): string {
  return (
    Deno.env.get("CANVAS_TOKEN_ENCRYPTION_KEY") ||
    Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") ||
    ""
  );
}

function canvasSecretStatus() {
  return {
    CANVAS_CLIENT_ID: Boolean(Deno.env.get("CANVAS_CLIENT_ID")),
    CANVAS_CLIENT_SECRET: Boolean(Deno.env.get("CANVAS_CLIENT_SECRET")),
    CANVAS_REDIRECT_URI: Boolean(Deno.env.get("CANVAS_REDIRECT_URI")),
    CANVAS_TOKEN_ENCRYPTION_KEY: Boolean(resolveTokenKey()),
  };
}

function missingCanvasSecrets(): string[] {
  return Object.entries(canvasSecretStatus())
    .filter(([, configured]) => !configured)
    .map(([key]) => key);
}

function parseScopes(): string[] {
  const raw = Deno.env.get("CANVAS_SCOPES") || "";
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function envConfig(req: Request, options: { requireCanvas?: boolean } = {}): Config {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const canvasClientId = Deno.env.get("CANVAS_CLIENT_ID");
  const canvasClientSecret = Deno.env.get("CANVAS_CLIENT_SECRET");
  const canvasRedirectUri = Deno.env.get("CANVAS_REDIRECT_URI");
  const tokenKey = resolveTokenKey();
  const authorization = req.headers.get("Authorization") || "";

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  const requireCanvas = options.requireCanvas !== false;
  if (requireCanvas && (!canvasClientId || !canvasClientSecret || !canvasRedirectUri || !tokenKey)) {
    throw new Error(
      "Canvas OAuth is not configured. Set CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REDIRECT_URI, and CANVAS_TOKEN_ENCRYPTION_KEY (or GOOGLE_TOKEN_ENCRYPTION_KEY).",
    );
  }
  if (!authorization) throw new Error("Authentication is required.");

  return {
    url,
    anonKey,
    serviceRoleKey,
    authorization,
    canvasClientId: canvasClientId || "",
    canvasClientSecret: canvasClientSecret || "",
    canvasRedirectUri: canvasRedirectUri || "",
    canvasScopes: parseScopes(),
    tokenKey: tokenKey || "",
  };
}

function cleanText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function cleanId(value: unknown): string {
  return cleanText(value);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeBaseUrl(value: unknown): string {
  let raw = cleanText(value);
  if (!raw) throw new Error("Canvas base URL is required (e.g. https://school.instructure.com).");
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Canvas base URL is invalid. Use the form https://school.instructure.com.");
  }
  if (parsed.protocol !== "https:") throw new Error("Canvas base URL must use https.");
  return `${parsed.protocol}//${parsed.host}`;
}

function actorAccessPayload(access: ActorAccess): DbRow {
  return {
    level: access.level,
    organization_ids: access.organizationIds,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signState(config: Config, payload: DbRow): Promise<string> {
  const encodedPayload = base64UrlEncode(textToBytes(JSON.stringify(payload)));
  const key = await hmacKey(config.tokenKey);
  const signature = await crypto.subtle.sign("HMAC", key, textToBytes(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyState(config: Config, state: string): Promise<DbRow> {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid OAuth state.");
  const key = await hmacKey(config.tokenKey);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signature),
    textToBytes(encodedPayload),
  );
  if (!valid) throw new Error("Invalid OAuth state signature.");
  const payload = JSON.parse(bytesToText(base64UrlDecode(encodedPayload))) as DbRow;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (!exp || Date.now() > exp) throw new Error("OAuth state expired. Start again.");
  return payload;
}

async function encryptionKey(config: Config): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", textToBytes(config.tokenKey));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptToken(config: Config, token: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(config);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textToBytes(token),
  );
  return {
    cipher: base64UrlEncode(new Uint8Array(encrypted)),
    iv: base64UrlEncode(iv),
  };
}

async function decryptToken(config: Config, cipher: string, iv: string): Promise<string> {
  const key = await encryptionKey(config);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(iv) },
    key,
    base64UrlDecode(cipher),
  );
  return bytesToText(new Uint8Array(decrypted));
}

function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map((value) => encodeURIComponent(value)).join(",")})`;
}

async function userFetch(config: Config, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.anonKey);
  headers.set("Authorization", config.authorization);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
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
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
  return data;
}

function errorFromData(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const row = data as DbRow;
    if (typeof row.message === "string") return row.message;
    if (typeof row.error_description === "string") return row.error_description;
    if (typeof row.error === "string") return row.error;
    if (Array.isArray(row.errors) && row.errors.length) {
      const first = row.errors[0];
      if (first && typeof first === "object" && typeof (first as DbRow).message === "string") {
        return (first as DbRow).message as string;
      }
    }
  }
  return fallback;
}

async function fetchCurrentUser(config: Config): Promise<DbRow> {
  const data = await userFetch(config, "/auth/v1/user");
  if (!data || typeof data !== "object" || typeof (data as DbRow).id !== "string") {
    throw new Error("Could not identify authenticated user.");
  }
  return data as DbRow;
}

async function selectRows(config: Config, path: string): Promise<DbRow[]> {
  const data = await serviceFetch(config, `/rest/v1/${path}`);
  return Array.isArray(data)
    ? (data.filter((row) => row && typeof row === "object") as DbRow[])
    : [];
}

async function selectFirst(config: Config, path: string): Promise<DbRow | null> {
  const rows = await selectRows(config, path);
  return rows[0] || null;
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

async function patchRows(config: Config, path: string, row: DbRow): Promise<DbRow[]> {
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
  const data = await serviceFetch(
    config,
    `/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`,
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
  const data = await serviceFetch(config, `/auth/v1/admin/users?page=${page}&per_page=1000`);
  if (Array.isArray(data)) return data.filter(Boolean) as DbRow[];
  const users = data && typeof data === "object" ? (data as DbRow).users : null;
  return Array.isArray(users) ? (users.filter(Boolean) as DbRow[]) : [];
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

async function fetchActorAccess(config: Config, userId: string): Promise<ActorAccess> {
  const platformData = await selectRows(
    config,
    `platform_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  );
  if (platformData[0]) return { level: "platform_admin", organizationIds: [] };

  const orgAdminData = await selectRows(
    config,
    `organization_memberships?user_id=eq.${encodeURIComponent(userId)}&role=eq.org_admin&status=eq.active&select=organization_id`,
  );
  const orgAdminIds = orgAdminData.map((row) => cleanId(row.organization_id)).filter(Boolean);
  if (orgAdminIds.length) {
    return { level: "org_admin", organizationIds: Array.from(new Set(orgAdminIds)) };
  }

  const classMemberships = await selectRows(
    config,
    `class_memberships?user_id=eq.${encodeURIComponent(userId)}&role=eq.teacher&status=eq.active&select=class_id`,
  );
  const classIds = classMemberships.map((row) => cleanId(row.class_id)).filter(Boolean);
  if (!classIds.length) throw new Error("Canvas admin or teacher access is required.");

  const classes = await selectRows(
    config,
    `classes?${inFilter("id", classIds)}&select=organization_id`,
  );
  const organizationIds = Array.from(
    new Set(classes.map((row) => cleanId(row.organization_id)).filter(Boolean)),
  );
  if (!organizationIds.length) throw new Error("Canvas admin or teacher access is required.");
  return { level: "teacher", organizationIds };
}

function hasOrganizationAccess(access: ActorAccess, organizationId: string): boolean {
  return access.level === "platform_admin" || access.organizationIds.includes(organizationId);
}

function requireOrganizationAccess(access: ActorAccess, organizationId: string): void {
  if (!organizationId || !hasOrganizationAccess(access, organizationId)) {
    throw new Error("Canvas access for this organization is required.");
  }
}

function orgFilter(access: ActorAccess, requestedOrganizationId = ""): string {
  if (access.level === "platform_admin") {
    return requestedOrganizationId ? `organization_id=eq.${encodeURIComponent(requestedOrganizationId)}&` : "";
  }
  const ids = requestedOrganizationId
    ? access.organizationIds.filter((id) => id === requestedOrganizationId)
    : access.organizationIds;
  if (!ids.length) throw new Error("Canvas access for this organization is required.");
  return `${inFilter("organization_id", ids)}&`;
}

function parseNextLink(header: string | null): string {
  if (!header) return "";
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (match) return match[1];
  }
  return "";
}

async function canvasApiFetch(baseUrl: string, accessToken: string, path: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
  return data;
}

async function canvasFetchPaged(baseUrl: string, accessToken: string, path: string): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  let url = `${baseUrl}/api/v1${path}`;
  for (let page = 0; page < 30; page += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(errorFromData(data, res.statusText));
    if (Array.isArray(data)) {
      rows.push(...(data.filter((row) => row && typeof row === "object") as DbRow[]));
    }
    const next = parseNextLink(res.headers.get("Link") || res.headers.get("link"));
    if (!next) break;
    url = next;
  }
  return rows;
}

async function canvasPostToken(baseUrl: string, params: URLSearchParams): Promise<DbRow> {
  const res = await fetch(`${baseUrl}/login/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await res.json()) as DbRow;
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
  return data;
}

async function refreshCanvasAccessToken(config: Config, connection: DbRow): Promise<string> {
  const baseUrl = normalizeBaseUrl(connection.base_url);
  const refreshToken = await decryptToken(
    config,
    cleanText(connection.encrypted_refresh_token),
    cleanText(connection.refresh_token_iv),
  );
  const token = await canvasPostToken(
    baseUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.canvasClientId,
      client_secret: config.canvasClientSecret,
      redirect_uri: config.canvasRedirectUri,
      refresh_token: refreshToken,
    }),
  );
  const accessToken = cleanText(token.access_token);
  if (!accessToken) throw new Error("Canvas did not return an access token.");
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3600;
  await patchRows(
    config,
    `canvas_connections?id=eq.${encodeURIComponent(cleanId(connection.id))}`,
    {
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      last_refreshed_at: nowIso(),
      last_error: null,
      status: "active",
      updated_at: nowIso(),
    },
  );
  return accessToken;
}

async function fetchConnection(
  config: Config,
  access: ActorAccess,
  connectionId: string,
): Promise<DbRow> {
  const connection = await selectFirst(
    config,
    `canvas_connections?id=eq.${encodeURIComponent(connectionId)}&select=*`,
  );
  if (!connection) throw new Error("Canvas connection not found.");
  requireOrganizationAccess(access, cleanId(connection.organization_id));
  if (cleanText(connection.status) !== "active") {
    throw new Error("Canvas connection is not active.");
  }
  return connection;
}

function connectionAutoSync(row: DbRow): boolean {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as DbRow) : {};
  return metadata.auto_sync !== false;
}

function redactedConnection(row: DbRow): DbRow {
  return {
    id: row.id,
    organization_id: row.organization_id,
    connected_by: row.connected_by,
    base_url: row.base_url,
    canvas_user_id: row.canvas_user_id,
    canvas_login_id: row.canvas_login_id,
    canvas_name: row.canvas_name,
    scopes: row.scopes,
    status: row.status,
    last_error: row.last_error,
    token_expires_at: row.token_expires_at,
    last_refreshed_at: row.last_refreshed_at,
    auto_sync: connectionAutoSync(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeCourse(raw: DbRow): DbRow {
  return {
    id: cleanId(raw.id),
    name: cleanText(raw.name, "Untitled course"),
    course_code: cleanText(raw.course_code),
    workflow_state: cleanText(raw.workflow_state),
    raw,
  };
}

function normalizeRosterPerson(raw: CanvasUser, role: "student" | "teacher"): DbRow {
  const directEmail = normalizeEmail(raw.email);
  const loginId = cleanText(raw.login_id);
  const email = directEmail || (looksLikeEmail(loginId.toLowerCase()) ? loginId.toLowerCase() : "");
  return {
    canvas_user_id: cleanId(raw.id),
    email,
    display_name: cleanText(raw.name),
    role,
    raw_profile: raw as unknown as DbRow,
  };
}

async function fetchCanvasCourseAndRoster(baseUrl: string, accessToken: string, courseId: string) {
  const course = (await canvasApiFetch(
    baseUrl,
    accessToken,
    `/courses/${encodeURIComponent(courseId)}?include[]=course_code`,
  )) as DbRow;
  const [teacherRows, studentRows] = await Promise.all([
    canvasFetchPaged(
      baseUrl,
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/users?enrollment_type[]=teacher&enrollment_type[]=ta&include[]=email&per_page=100`,
    ),
    canvasFetchPaged(
      baseUrl,
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/users?enrollment_type[]=student&include[]=email&per_page=100`,
    ),
  ]);
  return {
    course: normalizeCourse(course),
    teachers: teacherRows
      .map((row) => normalizeRosterPerson(row as unknown as CanvasUser, "teacher"))
      .filter((row) => row.canvas_user_id || row.email),
    students: studentRows
      .map((row) => normalizeRosterPerson(row as unknown as CanvasUser, "student"))
      .filter((row) => row.canvas_user_id || row.email),
  };
}

async function logSyncRun(
  config: Config,
  input: {
    organizationId: string;
    connectionId?: string | null;
    courseMappingId?: string | null;
    classId?: string | null;
    actorId: string | null;
    action: string;
    status: "success" | "partial" | "failed";
    counts?: DbRow;
    errors?: unknown[];
    metadata?: DbRow;
  },
) {
  await insertRow(config, "canvas_sync_runs", {
    organization_id: input.organizationId,
    connection_id: input.connectionId || null,
    course_mapping_id: input.courseMappingId || null,
    class_id: input.classId || null,
    triggered_by: input.actorId,
    action: input.action,
    status: input.status,
    counts: input.counts || {},
    errors: input.errors || [],
    metadata: input.metadata || {},
    completed_at: nowIso(),
  });
}

async function handleStartOauth(config: Config, actorId: string, access: ActorAccess, body: DbRow) {
  const organizationId = cleanId(body.organization_id);
  requireOrganizationAccess(access, organizationId);
  const baseUrl = normalizeBaseUrl(body.base_url);
  const state = await signState(config, {
    organization_id: organizationId,
    actor_id: actorId,
    base_url: baseUrl,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: config.canvasClientId,
    response_type: "code",
    redirect_uri: config.canvasRedirectUri,
    state,
  });
  if (config.canvasScopes.length) params.set("scope", config.canvasScopes.join(" "));
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      auth_url: `${baseUrl}/login/oauth2/auth?${params.toString()}`,
      base_url: baseUrl,
      scopes: config.canvasScopes,
    },
  });
}

async function handleOauthCallback(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const code = cleanText(body.code);
  const state = cleanText(body.state);
  if (!code || !state) throw new Error("OAuth code and state are required.");
  const payload = await verifyState(config, state);
  const organizationId = cleanId(payload.organization_id);
  const stateActorId = cleanId(payload.actor_id);
  const baseUrl = normalizeBaseUrl(payload.base_url);
  if (stateActorId !== actorId) throw new Error("OAuth state belongs to a different user.");
  requireOrganizationAccess(access, organizationId);

  const token = await canvasPostToken(
    baseUrl,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.canvasClientId,
      client_secret: config.canvasClientSecret,
      redirect_uri: config.canvasRedirectUri,
      code,
    }),
  );
  const accessToken = cleanText(token.access_token);
  if (!accessToken) throw new Error("Canvas did not return an access token.");

  const profile = (await canvasApiFetch(baseUrl, accessToken, "/users/self/profile")) as CanvasProfile;
  const tokenUser = (token.user && typeof token.user === "object" ? token.user : {}) as CanvasProfile;
  const canvasUserId = cleanId(profile.id) || cleanId(tokenUser.id);
  const canvasEmail = normalizeEmail(profile.primary_email);
  const canvasLogin = cleanText(profile.login_id);
  if (!canvasUserId) {
    throw new Error("Canvas profile id was not available.");
  }

  const existing = await selectFirst(
    config,
    `canvas_connections?organization_id=eq.${encodeURIComponent(organizationId)}&connected_by=eq.${encodeURIComponent(actorId)}&canvas_user_id=eq.${encodeURIComponent(canvasUserId)}&select=*`,
  );
  const refreshToken = cleanText(token.refresh_token);
  if (!refreshToken && !existing) {
    throw new Error("Canvas did not return a refresh token. Start the connection again and approve access.");
  }
  const encrypted = refreshToken
    ? await encryptToken(config, refreshToken)
    : {
      cipher: cleanText(existing?.encrypted_refresh_token),
      iv: cleanText(existing?.refresh_token_iv),
    };
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3600;
  const connection = await upsertByConflict(
    config,
    "canvas_connections",
    "organization_id,connected_by,canvas_user_id",
    {
      organization_id: organizationId,
      connected_by: actorId,
      base_url: baseUrl,
      canvas_user_id: canvasUserId,
      canvas_login_id: canvasLogin || canvasEmail,
      canvas_name: cleanText(profile.name) || cleanText(tokenUser.name),
      scopes: config.canvasScopes,
      encrypted_refresh_token: encrypted.cipher,
      refresh_token_iv: encrypted.iv,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      status: "active",
      last_error: null,
      last_refreshed_at: nowIso(),
      updated_at: nowIso(),
    },
  );
  await Promise.all([
    logSyncRun(config, {
      organizationId,
      connectionId: cleanId(connection.id),
      actorId,
      action: "oauth_connect",
      status: "success",
      counts: { connected: 1 },
      metadata: { base_url: baseUrl, canvas_login_id: canvasLogin || canvasEmail },
    }),
    audit(config, {
      actorId,
      organizationId,
      eventType: "canvas_connected",
      entityType: "canvas_connection",
      entityId: cleanId(connection.id),
      payload: { base_url: baseUrl, canvas_login_id: canvasLogin || canvasEmail },
    }),
  ]);
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      connection: redactedConnection(connection),
    },
  });
}

async function handleListMappings(
  config: Config,
  access: ActorAccess,
  body: DbRow,
) {
  const requestedOrg = cleanId(body.organization_id);
  const filter = orgFilter(access, requestedOrg);
  const [connections, courseMappings, userMappings, syncRuns, gradeLinks] = await Promise.all([
    selectRows(
      config,
      `canvas_connections?${filter}select=*&order=updated_at.desc&limit=30`,
    ),
    selectRows(
      config,
      `canvas_course_mappings?${filter}select=*&order=updated_at.desc&limit=80`,
    ),
    selectRows(
      config,
      `canvas_user_mappings?${filter}select=*&order=updated_at.desc&limit=200`,
    ),
    selectRows(
      config,
      `canvas_sync_runs?${filter}select=*&order=started_at.desc&limit=40`,
    ),
    selectRows(
      config,
      `canvas_grade_links?${filter}select=*&order=updated_at.desc&limit=200`,
    ),
  ]);
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      connections: connections.map(redactedConnection),
      course_mappings: courseMappings,
      user_mappings: userMappings,
      sync_runs: syncRuns,
      grade_links: gradeLinks,
    },
  });
}

async function handleListCourses(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connection = await fetchConnection(config, access, cleanId(body.connection_id));
  const baseUrl = normalizeBaseUrl(connection.base_url);
  const accessToken = await refreshCanvasAccessToken(config, connection);
  const courseRows = await canvasFetchPaged(
    baseUrl,
    accessToken,
    "/courses?enrollment_state=active&include[]=course_code&per_page=100",
  );
  const courses = courseRows.map(normalizeCourse).filter((course) => course.id);
  await logSyncRun(config, {
    organizationId: cleanId(connection.organization_id),
    connectionId: cleanId(connection.id),
    actorId,
    action: "list_courses",
    status: "success",
    counts: { courses: courses.length },
  });
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      courses,
    },
  });
}

async function handlePreviewRoster(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connection = await fetchConnection(config, access, cleanId(body.connection_id));
  const baseUrl = normalizeBaseUrl(connection.base_url);
  const canvasCourseId = cleanId(body.canvas_course_id);
  if (!canvasCourseId) throw new Error("canvas_course_id is required.");
  const accessToken = await refreshCanvasAccessToken(config, connection);
  const roster = await fetchCanvasCourseAndRoster(baseUrl, accessToken, canvasCourseId);
  const authUsers = await listAllAuthUsers(config);
  const authByEmail = new Map(authUsers.map((user) => [normalizeEmail(user.email), user]));
  const mapped = [...roster.teachers, ...roster.students].map((person) => {
    const user = authByEmail.get(normalizeEmail(person.email));
    return { ...person, user_id: cleanId(user?.id) || null, matched: Boolean(user) };
  });
  await logSyncRun(config, {
    organizationId: cleanId(connection.organization_id),
    connectionId: cleanId(connection.id),
    actorId,
    action: "preview_roster",
    status: "success",
    counts: {
      teachers: roster.teachers.length,
      students: roster.students.length,
      matched: mapped.filter((row) => row.matched).length,
      missing: mapped.filter((row) => !row.matched).length,
    },
    metadata: { canvas_course_id: canvasCourseId },
  });
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      course: roster.course,
      teachers: mapped.filter((row) => row.role === "teacher"),
      students: mapped.filter((row) => row.role === "student"),
    },
  });
}

function classNameFromCourse(course: DbRow): string {
  const name = cleanText(course.name, "Imported Canvas course");
  const code = cleanText(course.course_code);
  if (code && !name.toLowerCase().includes(code.toLowerCase())) return `${name} (${code})`;
  return name;
}

async function ensureOrganizationMembership(
  config: Config,
  organizationId: string,
  userId: string,
  role: "student" | "teacher",
) {
  const existing = await selectFirst(
    config,
    `organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  );
  if (!existing) {
    await insertRow(config, "organization_memberships", {
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "active",
    });
    return;
  }
  const existingRole = cleanText(existing.role);
  const nextRole =
    existingRole === "org_admin" ? "org_admin" : existingRole === "teacher" || role === "teacher"
      ? "teacher"
      : "student";
  if (cleanText(existing.status) !== "active" || existingRole !== nextRole) {
    await patchRows(
      config,
      `organization_memberships?id=eq.${encodeURIComponent(cleanId(existing.id))}`,
      { role: nextRole, status: "active", updated_at: nowIso() },
    );
  }
}

async function ensureClassMembership(
  config: Config,
  classId: string,
  userId: string,
  role: "student" | "teacher",
) {
  const existing = await selectFirst(
    config,
    `class_memberships?class_id=eq.${encodeURIComponent(classId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  );
  if (!existing) {
    await insertRow(config, "class_memberships", {
      class_id: classId,
      user_id: userId,
      role,
      status: "active",
    });
    return;
  }
  const existingRole = cleanText(existing.role);
  const nextRole = existingRole === "teacher" || role === "teacher" ? "teacher" : "student";
  if (cleanText(existing.status) !== "active" || existingRole !== nextRole) {
    await patchRows(
      config,
      `class_memberships?id=eq.${encodeURIComponent(cleanId(existing.id))}`,
      { role: nextRole, status: "active", updated_at: nowIso() },
    );
  }
}

// C2: provision a Jargon Auth user for a Canvas roster row that has no match.
// Mirrors the admin-seed account shape (email-confirmed, seeded-role metadata,
// profile row). The admin supplies the shared temporary password.
async function createCanvasAuthUser(
  config: Config,
  input: { email: string; name: string; role: "student" | "teacher" },
  password: string,
): Promise<DbRow> {
  const data = await serviceFetch(config, "/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password,
      email_confirm: true,
      user_metadata: { name: input.name, grade: "" },
      app_metadata: { jargon_seeded_role: input.role },
    }),
  });
  if (!data || typeof data !== "object" || typeof (data as DbRow).id !== "string") {
    throw new Error("Auth user creation returned no user id.");
  }
  return data as DbRow;
}

async function upsertProfile(config: Config, userId: string, name: string): Promise<void> {
  await upsertByConflict(config, "profiles", "id", {
    id: userId,
    name,
    grade: null,
  });
}

async function handleImportCourse(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connection = await fetchConnection(config, access, cleanId(body.connection_id));
  const organizationId = cleanId(connection.organization_id);
  const baseUrl = normalizeBaseUrl(connection.base_url);
  const canvasCourseId = cleanId(body.canvas_course_id);
  const requestedClassId = cleanId(body.class_id);
  if (!canvasCourseId) throw new Error("canvas_course_id is required.");

  // C2: optionally create accounts for unmatched roster rows. Account creation is
  // admin-only (platform/org admin), never for teacher-level connections, and
  // requires a shared temporary password chosen by the admin.
  const requestedCreate = Boolean(body.create_missing_accounts);
  const defaultPassword = cleanText(body.default_password);
  const canCreateAccounts = requestedCreate && access.level !== "teacher";
  if (canCreateAccounts && defaultPassword.length < 6) {
    throw new Error(
      "A temporary password of at least 6 characters is required to create missing accounts.",
    );
  }

  const accessToken = await refreshCanvasAccessToken(config, connection);
  const roster = await fetchCanvasCourseAndRoster(baseUrl, accessToken, canvasCourseId);
  const existingMapping = await selectFirst(
    config,
    `canvas_course_mappings?organization_id=eq.${encodeURIComponent(organizationId)}&canvas_course_id=eq.${encodeURIComponent(canvasCourseId)}&select=*`,
  );

  let classId = requestedClassId || cleanId(existingMapping?.class_id);
  if (classId) {
    const classRow = await selectFirst(
      config,
      `classes?id=eq.${encodeURIComponent(classId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id`,
    );
    if (!classRow) throw new Error("Selected Jargon class is not in this organization.");
  } else {
    const createdClass = await insertRow(config, "classes", {
      organization_id: organizationId,
      name: classNameFromCourse(roster.course),
      status: "active",
      created_by: actorId,
    });
    classId = cleanId(createdClass.id);
  }

  const courseMapping = await upsertByConflict(
    config,
    "canvas_course_mappings",
    "organization_id,canvas_course_id",
    {
      organization_id: organizationId,
      connection_id: cleanId(connection.id),
      canvas_course_id: canvasCourseId,
      canvas_course_name: cleanText(roster.course.name, "Untitled course"),
      canvas_course_code: cleanText(roster.course.course_code) || null,
      canvas_workflow_state: cleanText(roster.course.workflow_state) || null,
      class_id: classId,
      status: "active",
      raw_course: roster.course,
      imported_by: actorId,
      last_synced_at: nowIso(),
      updated_at: nowIso(),
    },
  );

  const authUsers = await listAllAuthUsers(config);
  const authByEmail = new Map(authUsers.map((user) => [normalizeEmail(user.email), user]));
  const people = [...roster.teachers, ...roster.students];
  let matched = 0;
  let created = 0;
  let missing = 0;
  let memberships = 0;
  const createdAccounts: DbRow[] = [];
  const creationErrors: DbRow[] = [];

  for (const person of people) {
    const email = normalizeEmail(person.email);
    let user = email ? authByEmail.get(email) : undefined;
    let createdNow = false;
    if (!user && canCreateAccounts && email.includes("@")) {
      try {
        const newUser = await createCanvasAuthUser(
          config,
          {
            email,
            name: cleanText(person.display_name) || email,
            role: person.role as "student" | "teacher",
          },
          defaultPassword,
        );
        await upsertProfile(config, cleanId(newUser.id), cleanText(person.display_name) || email);
        user = newUser;
        authByEmail.set(email, newUser);
        createdNow = true;
        created += 1;
        createdAccounts.push({ email, role: person.role, user_id: cleanId(newUser.id) });
      } catch (error) {
        creationErrors.push({ email, role: person.role, error: errorMessage(error) });
      }
    }
    const userId = cleanId(user?.id) || null;
    if (userId) {
      if (!createdNow) matched += 1;
      await ensureOrganizationMembership(config, organizationId, userId, person.role as "student" | "teacher");
      await ensureClassMembership(config, classId, userId, person.role as "student" | "teacher");
      memberships += 1;
    } else {
      missing += 1;
    }
    await upsertByConflict(
      config,
      "canvas_user_mappings",
      "organization_id,canvas_user_id,role",
      {
        organization_id: organizationId,
        course_mapping_id: cleanId(courseMapping.id),
        canvas_course_id: canvasCourseId,
        canvas_user_id: cleanId(person.canvas_user_id) || `${person.role}:${email}`,
        email,
        display_name: cleanText(person.display_name),
        role: person.role,
        user_id: userId,
        raw_profile: person.raw_profile || {},
        last_seen_at: nowIso(),
        updated_at: nowIso(),
      },
    );
  }

  const status = missing || creationErrors.length ? "partial" : "success";
  const counts = {
    teachers: roster.teachers.length,
    students: roster.students.length,
    matched,
    created,
    missing,
    memberships,
  };
  await Promise.all([
    logSyncRun(config, {
      organizationId,
      connectionId: cleanId(connection.id),
      courseMappingId: cleanId(courseMapping.id),
      classId,
      actorId,
      action: "import_course",
      status,
      counts,
      errors: creationErrors,
      metadata: {
        canvas_course_id: canvasCourseId,
        accounts_created: canCreateAccounts,
      },
    }),
    audit(config, {
      actorId,
      organizationId,
      classId,
      eventType: "canvas_course_imported",
      entityType: "canvas_course_mapping",
      entityId: cleanId(courseMapping.id),
      payload: { canvas_course_id: canvasCourseId, matched, created, missing },
    }),
  ]);

  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      class_id: classId,
      course_mapping: courseMapping,
      counts,
      created_accounts: createdAccounts,
      creation_errors: creationErrors,
      missing_users: people.filter((person) => {
        const email = normalizeEmail(person.email);
        return !email || !authByEmail.get(email);
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// C3: grade passback
// ---------------------------------------------------------------------------

// Jargon scores follow the gradebook convention (see formatScore): a value <= 1
// is a 0..1 fraction, a value > 1 is already a 0..100 percent. Canvas accepts a
// percentage string for submission[posted_grade] and converts it against the
// assignment's points_possible, so a percentage is the safe, scale-independent
// value to push for both assessments and assignments.
function scoreToPercentString(score: number): string {
  const pct = score <= 1 ? score * 100 : score;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

async function deleteRows(config: Config, path: string): Promise<void> {
  await serviceFetch(config, `/rest/v1/${path}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function canvasPutGrade(
  baseUrl: string,
  accessToken: string,
  courseId: string,
  assignmentId: string,
  canvasUserId: string,
  postedGrade: string,
): Promise<void> {
  const params = new URLSearchParams();
  params.set("submission[posted_grade]", postedGrade);
  const res = await fetch(
    `${baseUrl}/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(canvasUserId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
}

async function loadCanvasUserMap(config: Config, organizationId: string): Promise<Map<string, string>> {
  const rows = await selectRows(
    config,
    `canvas_user_mappings?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=not.is.null&select=user_id,canvas_user_id`,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const userId = cleanId(row.user_id);
    const canvasUserId = cleanId(row.canvas_user_id);
    if (userId && canvasUserId && !map.has(userId)) map.set(userId, canvasUserId);
  }
  return map;
}

function gradeLinkTables(jargonKind: string): { table: string; idCol: string; scoreCol: string } {
  return jargonKind === "assessment"
    ? { table: "assessment_recipients", idCol: "assessment_id", scoreCol: "final_score" }
    : { table: "assignment_recipients", idCol: "assignment_id", scoreCol: "score" };
}

// Push every graded recipient of one Jargon item to its linked Canvas assignment.
// Shared by manual push (handlePushGrades) and scheduled/manual sync.
async function pushGradesForLink(
  config: Config,
  link: DbRow,
  baseUrl: string,
  accessToken: string,
  userToCanvas: Map<string, string>,
): Promise<{ pushed: number; skipped: number; failed: number; errors: DbRow[] }> {
  const { table, idCol, scoreCol } = gradeLinkTables(cleanText(link.jargon_kind));
  const recipients = await selectRows(
    config,
    `${table}?${idCol}=eq.${encodeURIComponent(cleanId(link.jargon_id))}&select=user_id,${scoreCol},status`,
  );
  let pushed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: DbRow[] = [];
  for (const recipient of recipients) {
    const rawScore = recipient[scoreCol];
    if (typeof rawScore !== "number" || Number.isNaN(rawScore)) {
      skipped += 1;
      continue;
    }
    const userId = cleanId(recipient.user_id);
    const canvasUserId = userId ? userToCanvas.get(userId) : undefined;
    if (!canvasUserId) {
      skipped += 1;
      continue;
    }
    try {
      await canvasPutGrade(
        baseUrl,
        accessToken,
        cleanId(link.canvas_course_id),
        cleanId(link.canvas_assignment_id),
        canvasUserId,
        scoreToPercentString(rawScore),
      );
      pushed += 1;
    } catch (error) {
      failed += 1;
      errors.push({ grade_link_id: cleanId(link.id), user_id: userId, error: errorMessage(error) });
    }
  }
  await patchRows(
    config,
    `canvas_grade_links?id=eq.${encodeURIComponent(cleanId(link.id))}`,
    { last_pushed_at: nowIso(), updated_at: nowIso() },
  );
  return { pushed, skipped, failed, errors };
}

// Link-only roster refresh for an existing course mapping (C4 sync): re-pull the
// Canvas roster and reconcile memberships + user mappings for already-matched
// Jargon users. Unlike import, it never creates classes or accounts.
async function refreshMappingRoster(
  config: Config,
  mapping: DbRow,
  baseUrl: string,
  accessToken: string,
  authByEmail: Map<string, DbRow>,
): Promise<{ matched: number; missing: number; memberships: number }> {
  const organizationId = cleanId(mapping.organization_id);
  const canvasCourseId = cleanId(mapping.canvas_course_id);
  const classId = cleanId(mapping.class_id);
  const roster = await fetchCanvasCourseAndRoster(baseUrl, accessToken, canvasCourseId);
  const people = [...roster.teachers, ...roster.students];
  let matched = 0;
  let missing = 0;
  let memberships = 0;
  for (const person of people) {
    const email = normalizeEmail(person.email);
    const user = email ? authByEmail.get(email) : undefined;
    const userId = cleanId(user?.id) || null;
    if (userId) {
      matched += 1;
      await ensureOrganizationMembership(config, organizationId, userId, person.role as "student" | "teacher");
      if (classId) {
        await ensureClassMembership(config, classId, userId, person.role as "student" | "teacher");
      }
      memberships += 1;
    } else {
      missing += 1;
    }
    await upsertByConflict(
      config,
      "canvas_user_mappings",
      "organization_id,canvas_user_id,role",
      {
        organization_id: organizationId,
        course_mapping_id: cleanId(mapping.id),
        canvas_course_id: canvasCourseId,
        canvas_user_id: cleanId(person.canvas_user_id) || `${person.role}:${email}`,
        email,
        display_name: cleanText(person.display_name),
        role: person.role,
        user_id: userId,
        raw_profile: person.raw_profile || {},
        last_seen_at: nowIso(),
        updated_at: nowIso(),
      },
    );
  }
  await patchRows(
    config,
    `canvas_course_mappings?id=eq.${encodeURIComponent(cleanId(mapping.id))}`,
    { last_synced_at: nowIso(), updated_at: nowIso() },
  );
  return { matched, missing, memberships };
}

// Sync one connection: refresh rosters for its active course mappings, and
// (when includeGrades) re-push grades for its grade links. Records one
// canvas_sync_runs row. Used by both manual sync and the scheduled sweep.
async function syncConnection(
  config: Config,
  connection: DbRow,
  options: { actorId?: string | null; includeGrades: boolean },
): Promise<DbRow> {
  const connectionId = cleanId(connection.id);
  const organizationId = cleanId(connection.organization_id);
  const counts: Record<string, number> = {
    courses: 0,
    memberships: 0,
    grades_pushed: 0,
    grades_skipped: 0,
    grades_failed: 0,
  };
  const errors: DbRow[] = [];
  let status: "success" | "partial" | "failed" = "success";

  let baseUrl = "";
  let accessToken = "";
  try {
    baseUrl = normalizeBaseUrl(connection.base_url);
    accessToken = await refreshCanvasAccessToken(config, connection);
  } catch (error) {
    await patchRows(
      config,
      `canvas_connections?id=eq.${encodeURIComponent(connectionId)}`,
      { status: "error", last_error: errorMessage(error), updated_at: nowIso() },
    );
    await logSyncRun(config, {
      organizationId,
      connectionId,
      actorId: options.actorId || null,
      action: "sync",
      status: "failed",
      counts,
      errors: [{ error: errorMessage(error) }],
    });
    return { connection_id: connectionId, status: "failed", counts, errors: [{ error: errorMessage(error) }] };
  }

  const authUsers = await listAllAuthUsers(config);
  const authByEmail = new Map(authUsers.map((user) => [normalizeEmail(user.email), user]));

  const mappings = await selectRows(
    config,
    `canvas_course_mappings?connection_id=eq.${encodeURIComponent(connectionId)}&status=eq.active&select=*`,
  );
  for (const mapping of mappings) {
    try {
      const result = await refreshMappingRoster(config, mapping, baseUrl, accessToken, authByEmail);
      counts.courses += 1;
      counts.memberships += result.memberships;
    } catch (error) {
      status = "partial";
      errors.push({ course_mapping_id: cleanId(mapping.id), error: errorMessage(error) });
    }
  }

  if (options.includeGrades && mappings.length) {
    const links = await selectRows(
      config,
      `canvas_grade_links?${inFilter("course_mapping_id", mappings.map((m) => cleanId(m.id)))}&select=*`,
    );
    const userToCanvas = links.length ? await loadCanvasUserMap(config, organizationId) : new Map<string, string>();
    for (const link of links) {
      try {
        const result = await pushGradesForLink(config, link, baseUrl, accessToken, userToCanvas);
        counts.grades_pushed += result.pushed;
        counts.grades_skipped += result.skipped;
        counts.grades_failed += result.failed;
        if (result.failed) status = "partial";
        errors.push(...result.errors);
      } catch (error) {
        status = "partial";
        errors.push({ grade_link_id: cleanId(link.id), error: errorMessage(error) });
      }
    }
  }

  await logSyncRun(config, {
    organizationId,
    connectionId,
    actorId: options.actorId || null,
    action: "sync",
    status,
    counts,
    errors,
    metadata: { include_grades: options.includeGrades },
  });
  return { connection_id: connectionId, status, counts, errors };
}

async function handleListGradeTargets(
  config: Config,
  access: ActorAccess,
  body: DbRow,
) {
  const courseMappingId = cleanId(body.course_mapping_id);
  if (!courseMappingId) throw new Error("course_mapping_id is required.");
  const mapping = await selectFirst(
    config,
    `canvas_course_mappings?id=eq.${encodeURIComponent(courseMappingId)}&select=*`,
  );
  if (!mapping) throw new Error("Canvas course mapping not found.");
  const organizationId = cleanId(mapping.organization_id);
  requireOrganizationAccess(access, organizationId);
  const classId = cleanId(mapping.class_id);

  const [assessments, assignments, gradeLinks] = await Promise.all([
    classId
      ? selectRows(
        config,
        `assessments?class_id=eq.${encodeURIComponent(classId)}&select=id,title,status&order=updated_at.desc&limit=200`,
      )
      : Promise.resolve([] as DbRow[]),
    classId
      ? selectRows(
        config,
        `assignments?class_id=eq.${encodeURIComponent(classId)}&select=id,title,status&order=updated_at.desc&limit=200`,
      )
      : Promise.resolve([] as DbRow[]),
    selectRows(
      config,
      `canvas_grade_links?course_mapping_id=eq.${encodeURIComponent(courseMappingId)}&select=*&order=updated_at.desc`,
    ),
  ]);

  const connection = await fetchConnection(config, access, cleanId(mapping.connection_id));
  const baseUrl = normalizeBaseUrl(connection.base_url);
  const accessToken = await refreshCanvasAccessToken(config, connection);
  const canvasAssignmentsRaw = await canvasFetchPaged(
    baseUrl,
    accessToken,
    `/courses/${encodeURIComponent(cleanId(mapping.canvas_course_id))}/assignments?per_page=100`,
  );
  const canvasAssignments = canvasAssignmentsRaw
    .map((raw) => ({
      id: cleanId(raw.id),
      name: cleanText(raw.name, "Untitled assignment"),
      points_possible: typeof raw.points_possible === "number" ? raw.points_possible : null,
      grading_type: cleanText(raw.grading_type) || null,
      published: Boolean(raw.published),
    }))
    .filter((assignment) => assignment.id);

  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      jargon_items: [
        ...assessments.map((row) => ({
          kind: "assessment",
          id: cleanId(row.id),
          title: cleanText(row.title, "Untitled assessment"),
          status: cleanText(row.status),
        })),
        ...assignments.map((row) => ({
          kind: "assignment",
          id: cleanId(row.id),
          title: cleanText(row.title, "Untitled assignment"),
          status: cleanText(row.status),
        })),
      ],
      canvas_assignments: canvasAssignments,
      grade_links: gradeLinks,
    },
  });
}

async function handleUpsertGradeLink(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const courseMappingId = cleanId(body.course_mapping_id);
  const jargonKind = cleanText(body.jargon_kind);
  const jargonId = cleanId(body.jargon_id);
  const canvasAssignmentId = cleanId(body.canvas_assignment_id);
  if (!courseMappingId) throw new Error("course_mapping_id is required.");
  if (jargonKind !== "assessment" && jargonKind !== "assignment") {
    throw new Error("jargon_kind must be 'assessment' or 'assignment'.");
  }
  if (!jargonId) throw new Error("jargon_id is required.");
  if (!canvasAssignmentId) throw new Error("canvas_assignment_id is required.");

  const mapping = await selectFirst(
    config,
    `canvas_course_mappings?id=eq.${encodeURIComponent(courseMappingId)}&select=*`,
  );
  if (!mapping) throw new Error("Canvas course mapping not found.");
  const organizationId = cleanId(mapping.organization_id);
  requireOrganizationAccess(access, organizationId);
  const classId = cleanId(mapping.class_id);

  const itemTable = jargonKind === "assessment" ? "assessments" : "assignments";
  const item = await selectFirst(
    config,
    `${itemTable}?id=eq.${encodeURIComponent(jargonId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id,class_id`,
  );
  if (!item) throw new Error("The selected Jargon item is not in this organization.");
  if (classId && cleanId(item.class_id) && cleanId(item.class_id) !== classId) {
    throw new Error("The selected Jargon item is not in the mapped class.");
  }

  const gradeLink = await upsertByConflict(
    config,
    "canvas_grade_links",
    "organization_id,jargon_kind,jargon_id",
    {
      organization_id: organizationId,
      course_mapping_id: courseMappingId,
      class_id: classId || null,
      jargon_kind: jargonKind,
      jargon_id: jargonId,
      canvas_course_id: cleanId(mapping.canvas_course_id),
      canvas_assignment_id: canvasAssignmentId,
      updated_at: nowIso(),
    },
  );
  await audit(config, {
    actorId,
    organizationId,
    classId: classId || null,
    eventType: "canvas_grade_link_set",
    entityType: "canvas_grade_link",
    entityId: cleanId(gradeLink.id),
    payload: { jargon_kind: jargonKind, jargon_id: jargonId, canvas_assignment_id: canvasAssignmentId },
  });
  return json({
    status: "ok",
    data: { actor_access: actorAccessPayload(access), grade_link: gradeLink },
  });
}

async function handleDeleteGradeLink(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const gradeLinkId = cleanId(body.grade_link_id);
  if (!gradeLinkId) throw new Error("grade_link_id is required.");
  const link = await selectFirst(
    config,
    `canvas_grade_links?id=eq.${encodeURIComponent(gradeLinkId)}&select=*`,
  );
  if (!link) throw new Error("Canvas grade link not found.");
  const organizationId = cleanId(link.organization_id);
  requireOrganizationAccess(access, organizationId);
  await deleteRows(config, `canvas_grade_links?id=eq.${encodeURIComponent(gradeLinkId)}`);
  await audit(config, {
    actorId,
    organizationId,
    classId: cleanId(link.class_id) || null,
    eventType: "canvas_grade_link_removed",
    entityType: "canvas_grade_link",
    entityId: gradeLinkId,
    payload: { jargon_kind: cleanText(link.jargon_kind), jargon_id: cleanId(link.jargon_id) },
  });
  return json({ status: "ok", data: { actor_access: actorAccessPayload(access) } });
}

async function handlePushGrades(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const gradeLinkId = cleanId(body.grade_link_id);
  const courseMappingId = cleanId(body.course_mapping_id);
  let links: DbRow[] = [];
  if (gradeLinkId) {
    const link = await selectFirst(
      config,
      `canvas_grade_links?id=eq.${encodeURIComponent(gradeLinkId)}&select=*`,
    );
    if (!link) throw new Error("Canvas grade link not found.");
    links = [link];
  } else if (courseMappingId) {
    links = await selectRows(
      config,
      `canvas_grade_links?course_mapping_id=eq.${encodeURIComponent(courseMappingId)}&select=*&order=updated_at.desc`,
    );
  } else {
    throw new Error("grade_link_id or course_mapping_id is required.");
  }
  if (!links.length) throw new Error("No Canvas grade links to push.");

  // Resolve each link's connection (token + base URL) once per course mapping,
  // enforcing org access through the connection. Cache tokens by connection id.
  const mappingCache = new Map<string, DbRow>();
  const connectionCache = new Map<string, { baseUrl: string; accessToken: string; connection: DbRow }>();
  const userMapCache = new Map<string, Map<string, string>>();

  let totalPushed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const results: DbRow[] = [];
  const errors: DbRow[] = [];
  let organizationId = "";
  let pushedLinks = 0;

  for (const link of links) {
    const linkCourseMappingId = cleanId(link.course_mapping_id);
    let mapping = linkCourseMappingId ? mappingCache.get(linkCourseMappingId) : undefined;
    if (!mapping && linkCourseMappingId) {
      mapping =
        (await selectFirst(
          config,
          `canvas_course_mappings?id=eq.${encodeURIComponent(linkCourseMappingId)}&select=*`,
        )) || undefined;
      if (mapping) mappingCache.set(linkCourseMappingId, mapping);
    }
    if (!mapping) {
      errors.push({ grade_link_id: cleanId(link.id), error: "Course mapping not found for grade link." });
      continue;
    }
    const connectionId = cleanId(mapping.connection_id);
    let resolved = connectionId ? connectionCache.get(connectionId) : undefined;
    if (!resolved) {
      const connection = await fetchConnection(config, access, connectionId);
      const baseUrl = normalizeBaseUrl(connection.base_url);
      const accessToken = await refreshCanvasAccessToken(config, connection);
      resolved = { baseUrl, accessToken, connection };
      connectionCache.set(connectionId, resolved);
    }
    const linkOrg = cleanId(link.organization_id);
    organizationId = linkOrg || organizationId;
    let userToCanvas = userMapCache.get(linkOrg);
    if (!userToCanvas) {
      userToCanvas = await loadCanvasUserMap(config, linkOrg);
      userMapCache.set(linkOrg, userToCanvas);
    }

    const linkResult = await pushGradesForLink(
      config,
      link,
      resolved.baseUrl,
      resolved.accessToken,
      userToCanvas,
    );
    const { pushed, skipped, failed } = linkResult;
    errors.push(...linkResult.errors);
    totalPushed += pushed;
    totalSkipped += skipped;
    totalFailed += failed;
    pushedLinks += 1;
    results.push({
      grade_link_id: cleanId(link.id),
      jargon_kind: cleanText(link.jargon_kind),
      jargon_id: cleanId(link.jargon_id),
      canvas_assignment_id: cleanId(link.canvas_assignment_id),
      pushed,
      skipped,
      failed,
    });
  }

  const status = totalFailed ? "partial" : "success";
  await Promise.all([
    logSyncRun(config, {
      organizationId,
      actorId,
      action: "push_grades",
      status,
      counts: { links: pushedLinks, pushed: totalPushed, skipped: totalSkipped, failed: totalFailed },
      errors,
      metadata: { grade_link_id: gradeLinkId || null, course_mapping_id: courseMappingId || null },
    }),
    audit(config, {
      actorId,
      organizationId,
      eventType: "canvas_grades_pushed",
      entityType: "canvas_grade_link",
      entityId: gradeLinkId || courseMappingId || null,
      payload: { links: pushedLinks, pushed: totalPushed, skipped: totalSkipped, failed: totalFailed },
    }),
  ]);

  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      counts: { links: pushedLinks, pushed: totalPushed, skipped: totalSkipped, failed: totalFailed },
      results,
      errors,
    },
  });
}

// C4: user-triggered "Sync now". Syncs one connection (connection_id) or every
// active connection in an org the actor can access (organization_id).
async function handleSync(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connectionId = cleanId(body.connection_id);
  let connections: DbRow[] = [];
  if (connectionId) {
    connections = [await fetchConnection(config, access, connectionId)];
  } else {
    const requestedOrg = cleanId(body.organization_id);
    const filter = orgFilter(access, requestedOrg);
    connections = await selectRows(
      config,
      `canvas_connections?${filter}status=eq.active&select=*`,
    );
  }
  if (!connections.length) throw new Error("No active Canvas connection to sync.");

  const results: DbRow[] = [];
  for (const connection of connections) {
    results.push(await syncConnection(config, connection, { actorId, includeGrades: true }));
  }
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      counts: aggregateSyncCounts(results),
      results,
    },
  });
}

// C4: scheduler-triggered sweep. Authenticated by the service-role key as the
// Bearer token (see Deno.serve). Syncs every active connection that has not
// opted out via metadata.auto_sync === false. No per-user actor.
async function handleSystemSync(config: Config, _body: DbRow) {
  const connections = await selectRows(
    config,
    `canvas_connections?status=eq.active&select=*&order=updated_at.desc&limit=500`,
  );
  const eligible = connections.filter(connectionAutoSync);
  const results: DbRow[] = [];
  for (const connection of eligible) {
    try {
      results.push(await syncConnection(config, connection, { actorId: null, includeGrades: true }));
    } catch (error) {
      results.push({
        connection_id: cleanId(connection.id),
        status: "failed",
        errors: [{ error: errorMessage(error) }],
      });
    }
  }
  return json({
    status: "ok",
    data: {
      system: true,
      connections_total: connections.length,
      connections_synced: eligible.length,
      connections_skipped: connections.length - eligible.length,
      counts: aggregateSyncCounts(results),
      results,
    },
  });
}

function aggregateSyncCounts(results: DbRow[]): DbRow {
  const totals: Record<string, number> = {
    connections: results.length,
    courses: 0,
    memberships: 0,
    grades_pushed: 0,
    grades_skipped: 0,
    grades_failed: 0,
    failed_connections: 0,
  };
  for (const result of results) {
    if (cleanText(result.status) === "failed") totals.failed_connections += 1;
    const counts = result.counts && typeof result.counts === "object" ? (result.counts as DbRow) : {};
    for (const key of ["courses", "memberships", "grades_pushed", "grades_skipped", "grades_failed"]) {
      const value = counts[key];
      if (typeof value === "number") totals[key] += value;
    }
  }
  return totals;
}

// C4: toggle a connection's auto-sync opt-out (metadata.auto_sync).
async function handleSetSyncEnabled(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connection = await fetchConnection(config, access, cleanId(body.connection_id));
  const enabled = body.enabled !== false;
  const metadata = connection.metadata && typeof connection.metadata === "object"
    ? (connection.metadata as DbRow)
    : {};
  const updated = await patchRows(
    config,
    `canvas_connections?id=eq.${encodeURIComponent(cleanId(connection.id))}`,
    { metadata: { ...metadata, auto_sync: enabled }, updated_at: nowIso() },
  );
  await audit(config, {
    actorId,
    organizationId: cleanId(connection.organization_id),
    eventType: "canvas_auto_sync_set",
    entityType: "canvas_connection",
    entityId: cleanId(connection.id),
    payload: { auto_sync: enabled },
  });
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      connection: redactedConnection(updated[0] || { ...connection, metadata: { ...metadata, auto_sync: enabled } }),
    },
  });
}

async function handleDisconnect(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connection = await fetchConnection(config, access, cleanId(body.connection_id));
  const connectionId = cleanId(connection.id);
  const organizationId = cleanId(connection.organization_id);
  await Promise.all([
    patchRows(
      config,
      `canvas_connections?id=eq.${encodeURIComponent(connectionId)}`,
      { status: "revoked", updated_at: nowIso() },
    ),
    patchRows(
      config,
      `canvas_course_mappings?connection_id=eq.${encodeURIComponent(connectionId)}`,
      { status: "disconnected", updated_at: nowIso() },
    ),
  ]);
  await Promise.all([
    logSyncRun(config, {
      organizationId,
      connectionId,
      actorId,
      action: "disconnect",
      status: "success",
      counts: { disconnected: 1 },
    }),
    audit(config, {
      actorId,
      organizationId,
      eventType: "canvas_disconnected",
      entityType: "canvas_connection",
      entityId: connectionId,
      payload: {},
    }),
  ]);
  return json({
    status: "ok",
    data: { actor_access: actorAccessPayload(access) },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  let config: Config;
  let body: DbRow;
  try {
    body = (await req.json()) as DbRow;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }
    config = envConfig(req, { requireCanvas: cleanText(body.action) !== "diagnose" });
  } catch (error) {
    const message = errorMessage(error);
    return errorResponse(message, message.includes("Authentication") ? 401 : 500);
  }

  try {
    const action = cleanText(body.action);

    // System (scheduler) path: the Supabase gateway accepts the service-role key
    // as a Bearer JWT, and we treat that exact bearer as the system caller. Only
    // the cross-connection sweep is allowed without a user actor.
    if (action === "sync" && config.authorization === `Bearer ${config.serviceRoleKey}`) {
      return await handleSystemSync(config, body);
    }

    const actor = await fetchCurrentUser(config);
    const actorId = cleanId(actor.id);
    const actorAccess = await fetchActorAccess(config, actorId);

    if (action === "diagnose") {
      return json({
        status: "ok",
        data: {
          actor_access: actorAccessPayload(actorAccess),
          configured: canvasSecretStatus(),
          missing: missingCanvasSecrets(),
          redirect_uri: Deno.env.get("CANVAS_REDIRECT_URI") || null,
          scopes: parseScopes(),
          scope_enforcement: parseScopes().length > 0,
          write_scopes_enabled: false,
          next_step: missingCanvasSecrets().length
            ? "Set the missing Canvas OAuth secrets before starting OAuth."
            : "Canvas OAuth secrets are present. Start OAuth from /admin with your institution base URL.",
        },
      });
    }
    if (action === "start_oauth")
      return await handleStartOauth(config, actorId, actorAccess, body);
    if (action === "oauth_callback")
      return await handleOauthCallback(config, actorId, actorAccess, body);
    if (action === "list_mappings")
      return await handleListMappings(config, actorAccess, body);
    if (action === "list_courses")
      return await handleListCourses(config, actorId, actorAccess, body);
    if (action === "preview_roster")
      return await handlePreviewRoster(config, actorId, actorAccess, body);
    if (action === "import_course")
      return await handleImportCourse(config, actorId, actorAccess, body);
    if (action === "disconnect")
      return await handleDisconnect(config, actorId, actorAccess, body);
    if (action === "list_grade_targets")
      return await handleListGradeTargets(config, actorAccess, body);
    if (action === "upsert_grade_link")
      return await handleUpsertGradeLink(config, actorId, actorAccess, body);
    if (action === "delete_grade_link")
      return await handleDeleteGradeLink(config, actorId, actorAccess, body);
    if (action === "push_grades")
      return await handlePushGrades(config, actorId, actorAccess, body);
    if (action === "sync")
      return await handleSync(config, actorId, actorAccess, body);
    if (action === "set_sync_enabled")
      return await handleSetSyncEnabled(config, actorId, actorAccess, body);

    return errorResponse("Unsupported Canvas action.", 400);
  } catch (error) {
    const message = errorMessage(error);
    const status =
      message.includes("Authentication") || message.includes("authenticated")
        ? 401
        : message.includes("access") ||
            message.includes("different user") ||
            message.includes("Invalid OAuth")
          ? 403
          : message.includes("required") || message.includes("not found")
            ? 400
            : 500;
    return errorResponse(message, status);
  }
});
