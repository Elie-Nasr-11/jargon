// Google Classroom integration v1.
// Read-only OAuth, course/roster preview, and roster import into Jargon classes.
// Google tokens and client secrets stay server-side in this Edge Function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
];

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLASSROOM_API = "https://classroom.googleapis.com/v1";

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
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  tokenKey: string;
};

type ActorAccess = {
  level: "platform_admin" | "org_admin" | "teacher";
  organizationIds: string[];
};

type GoogleProfile = {
  id: string;
  name?: {
    fullName?: string;
  };
  emailAddress?: string;
};

type GoogleCourse = {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
  alternateLink?: string;
};

type GoogleRosterPerson = {
  profile?: GoogleProfile;
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

function googleSecretStatus() {
  return {
    GOOGLE_CLASSROOM_CLIENT_ID: Boolean(Deno.env.get("GOOGLE_CLASSROOM_CLIENT_ID")),
    GOOGLE_CLASSROOM_CLIENT_SECRET: Boolean(Deno.env.get("GOOGLE_CLASSROOM_CLIENT_SECRET")),
    GOOGLE_CLASSROOM_REDIRECT_URI: Boolean(Deno.env.get("GOOGLE_CLASSROOM_REDIRECT_URI")),
    GOOGLE_TOKEN_ENCRYPTION_KEY: Boolean(Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")),
  };
}

function missingGoogleSecrets(): string[] {
  return Object.entries(googleSecretStatus())
    .filter(([, configured]) => !configured)
    .map(([key]) => key);
}

function envConfig(req: Request, options: { requireGoogle?: boolean } = {}): Config {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleClientId = Deno.env.get("GOOGLE_CLASSROOM_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLASSROOM_CLIENT_SECRET");
  const googleRedirectUri = Deno.env.get("GOOGLE_CLASSROOM_REDIRECT_URI");
  const tokenKey = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const authorization = req.headers.get("Authorization") || "";

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  const requireGoogle = options.requireGoogle !== false;
  if (requireGoogle && (!googleClientId || !googleClientSecret || !googleRedirectUri || !tokenKey)) {
    throw new Error(
      "Google Classroom OAuth is not configured. Set GOOGLE_CLASSROOM_CLIENT_ID, GOOGLE_CLASSROOM_CLIENT_SECRET, GOOGLE_CLASSROOM_REDIRECT_URI, and GOOGLE_TOKEN_ENCRYPTION_KEY.",
    );
  }
  if (!authorization) throw new Error("Authentication is required.");

  return {
    url,
    anonKey,
    serviceRoleKey,
    authorization,
    googleClientId: googleClientId || "",
    googleClientSecret: googleClientSecret || "",
    googleRedirectUri: googleRedirectUri || "",
    tokenKey: tokenKey || "",
  };
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

function nowIso() {
  return new Date().toISOString();
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
  if (!classIds.length) throw new Error("Google Classroom admin or teacher access is required.");

  const classes = await selectRows(
    config,
    `classes?${inFilter("id", classIds)}&select=organization_id`,
  );
  const organizationIds = Array.from(
    new Set(classes.map((row) => cleanId(row.organization_id)).filter(Boolean)),
  );
  if (!organizationIds.length) throw new Error("Google Classroom admin or teacher access is required.");
  return { level: "teacher", organizationIds };
}

function hasOrganizationAccess(access: ActorAccess, organizationId: string): boolean {
  return access.level === "platform_admin" || access.organizationIds.includes(organizationId);
}

function requireOrganizationAccess(access: ActorAccess, organizationId: string): void {
  if (!organizationId || !hasOrganizationAccess(access, organizationId)) {
    throw new Error("Google Classroom access for this organization is required.");
  }
}

function orgFilter(access: ActorAccess, requestedOrganizationId = ""): string {
  if (access.level === "platform_admin") {
    return requestedOrganizationId ? `organization_id=eq.${encodeURIComponent(requestedOrganizationId)}&` : "";
  }
  const ids = requestedOrganizationId
    ? access.organizationIds.filter((id) => id === requestedOrganizationId)
    : access.organizationIds;
  if (!ids.length) throw new Error("Google Classroom access for this organization is required.");
  return `${inFilter("organization_id", ids)}&`;
}

async function googleFetch(accessToken: string, path: string): Promise<unknown> {
  const res = await fetch(`${CLASSROOM_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
  return data;
}

async function googlePostToken(params: URLSearchParams): Promise<DbRow> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await res.json()) as DbRow;
  if (!res.ok) throw new Error(errorFromData(data, res.statusText));
  return data;
}

async function refreshGoogleAccessToken(config: Config, connection: DbRow): Promise<string> {
  const refreshToken = await decryptToken(
    config,
    cleanText(connection.encrypted_refresh_token),
    cleanText(connection.refresh_token_iv),
  );
  const token = await googlePostToken(
    new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  );
  const accessToken = cleanText(token.access_token);
  if (!accessToken) throw new Error("Google did not return an access token.");
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3600;
  await patchRows(
    config,
    `google_classroom_connections?id=eq.${encodeURIComponent(cleanId(connection.id))}`,
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
    `google_classroom_connections?id=eq.${encodeURIComponent(connectionId)}&select=*`,
  );
  if (!connection) throw new Error("Google Classroom connection not found.");
  requireOrganizationAccess(access, cleanId(connection.organization_id));
  if (cleanText(connection.status) !== "active") {
    throw new Error("Google Classroom connection is not active.");
  }
  return connection;
}

function redactedConnection(row: DbRow): DbRow {
  return {
    id: row.id,
    organization_id: row.organization_id,
    connected_by: row.connected_by,
    google_user_id: row.google_user_id,
    google_email: row.google_email,
    google_name: row.google_name,
    scopes: row.scopes,
    status: row.status,
    last_error: row.last_error,
    last_refreshed_at: row.last_refreshed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeCourse(raw: DbRow): DbRow {
  return {
    id: cleanId(raw.id),
    name: cleanText(raw.name, "Untitled course"),
    section: cleanText(raw.section),
    course_state: cleanText(raw.courseState),
    alternate_link: cleanText(raw.alternateLink),
    raw,
  };
}

function normalizeRosterPerson(raw: GoogleRosterPerson, role: "student" | "teacher"): DbRow {
  const profile = raw.profile || {};
  return {
    google_user_id: cleanId(profile.id),
    email: normalizeEmail(profile.emailAddress),
    display_name: cleanText(profile.name?.fullName),
    role,
    raw_profile: profile as unknown as DbRow,
  };
}

async function listPagedGoogle(
  accessToken: string,
  path: string,
  key: "courses" | "students" | "teachers",
): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await googleFetch(
      accessToken,
      `${path}${pageToken ? `${separator}pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    );
    const record = data && typeof data === "object" ? (data as DbRow) : {};
    const items = Array.isArray(record[key]) ? (record[key] as DbRow[]) : [];
    rows.push(...items);
    pageToken = cleanText(record.nextPageToken);
    if (!pageToken) break;
  }
  return rows;
}

async function fetchGoogleCourseAndRoster(accessToken: string, courseId: string) {
  const course = (await googleFetch(
    accessToken,
    `/courses/${encodeURIComponent(courseId)}`,
  )) as DbRow;
  const [teacherRows, studentRows] = await Promise.all([
    listPagedGoogle(
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/teachers?pageSize=100`,
      "teachers",
    ),
    listPagedGoogle(
      accessToken,
      `/courses/${encodeURIComponent(courseId)}/students?pageSize=100`,
      "students",
    ),
  ]);
  return {
    course: normalizeCourse(course),
    teachers: teacherRows
      .map((row) => normalizeRosterPerson(row as unknown as GoogleRosterPerson, "teacher"))
      .filter((row) => row.google_user_id || row.email),
    students: studentRows
      .map((row) => normalizeRosterPerson(row as unknown as GoogleRosterPerson, "student"))
      .filter((row) => row.google_user_id || row.email),
  };
}

async function logSyncRun(
  config: Config,
  input: {
    organizationId: string;
    connectionId?: string | null;
    courseMappingId?: string | null;
    classId?: string | null;
    actorId: string;
    action: string;
    status: "success" | "partial" | "failed";
    counts?: DbRow;
    errors?: unknown[];
    metadata?: DbRow;
  },
) {
  await insertRow(config, "google_classroom_sync_runs", {
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
  const state = await signState(config, {
    organization_id: organizationId,
    actor_id: actorId,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: "code",
    scope: CLASSROOM_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      auth_url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
      scopes: CLASSROOM_SCOPES,
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
  if (stateActorId !== actorId) throw new Error("OAuth state belongs to a different user.");
  requireOrganizationAccess(access, organizationId);

  const token = await googlePostToken(
    new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      code,
      grant_type: "authorization_code",
    }),
  );
  const accessToken = cleanText(token.access_token);
  if (!accessToken) throw new Error("Google did not return an access token.");

  const profile = (await googleFetch(accessToken, "/userProfiles/me")) as GoogleProfile;
  const googleUserId = cleanId(profile.id);
  const googleEmail = normalizeEmail(profile.emailAddress);
  if (!googleUserId || !googleEmail) {
    throw new Error("Google Classroom profile email was not available.");
  }

  const existing = await selectFirst(
    config,
    `google_classroom_connections?organization_id=eq.${encodeURIComponent(organizationId)}&connected_by=eq.${encodeURIComponent(actorId)}&google_user_id=eq.${encodeURIComponent(googleUserId)}&select=*`,
  );
  const refreshToken = cleanText(token.refresh_token);
  if (!refreshToken && !existing) {
    throw new Error("Google did not return a refresh token. Start connection again and approve offline access.");
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
    "google_classroom_connections",
    "organization_id,connected_by,google_user_id",
    {
      organization_id: organizationId,
      connected_by: actorId,
      google_user_id: googleUserId,
      google_email: googleEmail,
      google_name: cleanText(profile.name?.fullName),
      scopes: cleanText(token.scope).split(/\s+/).filter(Boolean),
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
      metadata: { google_email: googleEmail },
    }),
    audit(config, {
      actorId,
      organizationId,
      eventType: "google_classroom_connected",
      entityType: "google_classroom_connection",
      entityId: cleanId(connection.id),
      payload: { google_email: googleEmail },
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
  const [connections, courseMappings, userMappings, syncRuns] = await Promise.all([
    selectRows(
      config,
      `google_classroom_connections?${filter}select=*&order=updated_at.desc&limit=30`,
    ),
    selectRows(
      config,
      `google_classroom_course_mappings?${filter}select=*&order=updated_at.desc&limit=80`,
    ),
    selectRows(
      config,
      `google_classroom_user_mappings?${filter}select=*&order=updated_at.desc&limit=200`,
    ),
    selectRows(
      config,
      `google_classroom_sync_runs?${filter}select=*&order=started_at.desc&limit=40`,
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
  const accessToken = await refreshGoogleAccessToken(config, connection);
  const courseRows = await listPagedGoogle(
    accessToken,
    "/courses?courseStates=ACTIVE&courseStates=PROVISIONED&pageSize=100",
    "courses",
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
  const googleCourseId = cleanId(body.google_course_id);
  if (!googleCourseId) throw new Error("google_course_id is required.");
  const accessToken = await refreshGoogleAccessToken(config, connection);
  const roster = await fetchGoogleCourseAndRoster(accessToken, googleCourseId);
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
    metadata: { google_course_id: googleCourseId },
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
  const name = cleanText(course.name, "Imported Google Classroom");
  const section = cleanText(course.section);
  return section ? `${name} - ${section}` : name;
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

async function handleImportCourse(
  config: Config,
  actorId: string,
  access: ActorAccess,
  body: DbRow,
) {
  const connection = await fetchConnection(config, access, cleanId(body.connection_id));
  const organizationId = cleanId(connection.organization_id);
  const googleCourseId = cleanId(body.google_course_id);
  const requestedClassId = cleanId(body.class_id);
  if (!googleCourseId) throw new Error("google_course_id is required.");

  const accessToken = await refreshGoogleAccessToken(config, connection);
  const roster = await fetchGoogleCourseAndRoster(accessToken, googleCourseId);
  const existingMapping = await selectFirst(
    config,
    `google_classroom_course_mappings?organization_id=eq.${encodeURIComponent(organizationId)}&google_course_id=eq.${encodeURIComponent(googleCourseId)}&select=*`,
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
    "google_classroom_course_mappings",
    "organization_id,google_course_id",
    {
      organization_id: organizationId,
      connection_id: cleanId(connection.id),
      google_course_id: googleCourseId,
      google_course_name: cleanText(roster.course.name, "Untitled course"),
      google_course_section: cleanText(roster.course.section) || null,
      google_course_state: cleanText(roster.course.course_state) || null,
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
  let missing = 0;
  let memberships = 0;

  for (const person of people) {
    const email = normalizeEmail(person.email);
    const user = authByEmail.get(email);
    const userId = cleanId(user?.id) || null;
    if (userId) {
      matched += 1;
      await ensureOrganizationMembership(config, organizationId, userId, person.role as "student" | "teacher");
      await ensureClassMembership(config, classId, userId, person.role as "student" | "teacher");
      memberships += 1;
    } else {
      missing += 1;
    }
    await upsertByConflict(
      config,
      "google_classroom_user_mappings",
      "organization_id,google_user_id,role",
      {
        organization_id: organizationId,
        course_mapping_id: cleanId(courseMapping.id),
        google_course_id: googleCourseId,
        google_user_id: cleanId(person.google_user_id) || `${person.role}:${email}`,
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

  const status = missing ? "partial" : "success";
  await Promise.all([
    logSyncRun(config, {
      organizationId,
      connectionId: cleanId(connection.id),
      courseMappingId: cleanId(courseMapping.id),
      classId,
      actorId,
      action: "import_course",
      status,
      counts: {
        teachers: roster.teachers.length,
        students: roster.students.length,
        matched,
        missing,
        memberships,
      },
      metadata: { google_course_id: googleCourseId },
    }),
    audit(config, {
      actorId,
      organizationId,
      classId,
      eventType: "google_classroom_course_imported",
      entityType: "google_classroom_course_mapping",
      entityId: cleanId(courseMapping.id),
      payload: { google_course_id: googleCourseId, matched, missing },
    }),
  ]);

  return json({
    status: "ok",
    data: {
      actor_access: actorAccessPayload(access),
      class_id: classId,
      course_mapping: courseMapping,
      counts: { teachers: roster.teachers.length, students: roster.students.length, matched, missing, memberships },
      missing_users: people.filter((person) => !authByEmail.get(normalizeEmail(person.email))),
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
      `google_classroom_connections?id=eq.${encodeURIComponent(connectionId)}`,
      { status: "revoked", updated_at: nowIso() },
    ),
    patchRows(
      config,
      `google_classroom_course_mappings?connection_id=eq.${encodeURIComponent(connectionId)}`,
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
      eventType: "google_classroom_disconnected",
      entityType: "google_classroom_connection",
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
    config = envConfig(req, { requireGoogle: cleanText(body.action) !== "diagnose" });
  } catch (error) {
    const message = errorMessage(error);
    return errorResponse(message, message.includes("Authentication") ? 401 : 500);
  }

  try {
    const actor = await fetchCurrentUser(config);
    const actorId = cleanId(actor.id);
    const actorAccess = await fetchActorAccess(config, actorId);

    const action = cleanText(body.action);
    if (action === "diagnose") {
      return json({
        status: "ok",
        data: {
          actor_access: actorAccessPayload(actorAccess),
          configured: googleSecretStatus(),
          missing: missingGoogleSecrets(),
          redirect_uri: Deno.env.get("GOOGLE_CLASSROOM_REDIRECT_URI") || null,
          scopes: CLASSROOM_SCOPES,
          write_scopes_enabled: false,
          next_step: missingGoogleSecrets().length
            ? "Set the missing Google OAuth secrets before starting OAuth."
            : "Google Classroom OAuth secrets are present. Start OAuth from /admin.",
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
    if (action === "export_coursework" || action === "passback_grade") {
      return errorResponse(
        "Google Classroom write sync is not enabled yet. Add coursework/grade scopes and enable this action after roster import is accepted.",
        409,
      );
    }

    return errorResponse("Unsupported Google Classroom action.", 400);
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
