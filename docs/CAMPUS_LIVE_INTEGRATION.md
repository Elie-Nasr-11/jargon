# Campus Live Integration (no-API fallback)

Status: implemented. Campus Live (campus.live) has **no discoverable public API**,
so a native integration (à la Canvas/Google Classroom) isn't possible. Instead we
provide two provider-agnostic surfaces that also work for any other SIS/LMS:

1. **OneRoster / CSV roster import** — import a roster *exported* from Campus Live
   (or any system) into a Jargon class.
2. **Per-org "Campus Live" link-out** — a configurable URL surfaced to that
   organization's students and teachers.

If Campus Live ever exposes an API/partner access, a native integration would
follow the Canvas pattern (`docs/CANVAS_INTEGRATION.md`).

## 1. OneRoster / CSV roster import

The existing admin CSV roster import (School data tab → "CSV roster import")
already accepts the simple Jargon shape `email,name,role,grade`. It now also
accepts a **OneRoster `users.csv`** without any reformatting.

Mapping happens server-side in `admin-ops` `normalizedRosterRow()` (the single
normalization point, used by both preview and apply). `parseCsv` lowercases
headers and turns spaces into underscores, so OneRoster columns arrive as:

- `email` → email (falls back to `username` only if it looks like an email)
- `givenName` + `familyName` → `givenname` + `familyname` → combined into `name`
- `role` → role (`teacher` → teacher, everything else → student)
- `grades` → grade (first value if the cell is a list)

Behavior is unchanged otherwise: existing Jargon users are linked by email;
unmatched rows are marked `needs_seed` (create them via the Seeding tool, then
re-import). The CSV import does **not** create accounts itself. The CSV must still
include an `email` column (enforced by the preview handler).

No new action or migration — only `normalizedRosterRow()` gained the OneRoster
aliases, and the admin hint text mentions the supported OneRoster columns.

## 2. Per-org Campus Live link-out

Admins set a per-organization Campus Live URL; students and teachers in that org
then see a "Campus Live" item in the Settings menu that opens it in a new tab.

- **Storage:** `organization_settings.resource_settings.campus_live_url` (existing
  org-scoped JSONB; RLS already lets org members SELECT it and org admins write it).
- **Write:** admin-ops action `organization_links` (org-admin/platform-admin
  scoped) — merges `campus_live_url` into `resource_settings` (preserving other
  keys), normalizing/validating it to an `https://` URL; a blank value clears it.
  Called with an empty payload it just returns the current value (used to populate
  the admin field).
- **Admin UI:** School data tab → "Campus Live link-out" card (URL field + Save).
- **Member read:** `fetchCampusLiveLink()` (in `lib/api.ts`) resolves the signed-in
  user's active org via `organization_memberships`, then reads
  `organization_settings.resource_settings.campus_live_url` directly through RLS.
  `useCampusLiveLink()` (React Query hook) feeds the shared `SettingsMenu`, which
  is rendered for students (chat), teachers, and admins (ConsoleShell), so the
  link appears for all roles in one place.

## Files

- `supabase/functions/admin-ops/index.ts` — `normalizedRosterRow()` OneRoster
  aliases; new `organization_links` action (`handleOrganizationLinks`).
- `frontend/src/lib/api.ts` — `fetchOrganizationLinks`, `setOrganizationLinks`,
  `fetchCampusLiveLink`.
- `frontend/src/hooks/useCampusLiveLink.ts` — new hook.
- `frontend/src/components/SettingsMenu.tsx` — "Campus Live" link item.
- `frontend/src/routes/admin.tsx` — School data tab card + CSV hint text.
- `frontend/src/lib/types.ts` — `organization_links` added to `AdminOpsAction`.
- No migration (reuses `organization_settings.resource_settings`).

## Verification

- Frontend: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`.
- Backend deploy of the `admin-ops` edge function is required (Supabase); can't be
  exercised from the build sandbox (egress).
- End-to-end: paste a OneRoster `users.csv` into the CSV import → preview maps
  name/role/grade from `givenName`/`familyName`/`role`/`grades`; set a Campus Live
  URL in the School data tab → a "Campus Live" item appears in the Settings menu
  for that org's students/teachers; clearing the URL removes it.
