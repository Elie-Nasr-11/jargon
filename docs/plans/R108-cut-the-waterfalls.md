# R108 — cut the waterfalls (code only)

## Context

Owner: *"everything takes so long to load … please go over everything and make sure that all of
the logic is there for it to load smoothly."* Decisions: no region migration, no compute change,
**code work only.**

Why code is worth it even in Sydney: each sequential call from Beirut costs ~330ms of distance
(`OVERNIGHT-2026-09-05.md` §1). The audit found the app spends its time in *chains* of such
calls. Cutting a chain from 11 to 3 is a 2.6s win per lesson open on its own; it is also the
only lever that pays regardless of region.

The nine contributors, ranked (agent report 2026-09-04, line refs verified where marked ✓):

| # | contributor | class |
|---|---|---|
| 1 | `/` route `beforeLoad` blocks first paint on `fetchPrimaryRole` → admin-ops edge call → 2 serial DB reads; uncached; fired again by `TeacherConsole.tsx:118` and `login.tsx:31,87` ✓ | code |
| 2 | entry critical path 223KB gz (R82: 115KB): all of `lib/api.ts` + supabase-js in a preloaded chunk; `katex.min.css` + four `@fontsource` CSS in the blocking stylesheet (`main.tsx:12-19`) | code |
| 3 | lesson open ≈ 11 serial round trips: `fetchLessons` (`api.ts:478-544`) is lessons → units → course_versions → courses → subjects, run twice (catalog + class_lessons), uncached; then `loadLesson` in 3 waves; `StudentApp.tsx:370-395` has a per-class N+1 | code |
| 4 | teacher dashboard: `getSession` → `fetchPrimaryRole` (again) → `fetchTeacherDashboard` = 7 waves / ~30 queries, `refetchInterval: 30_000` (`TeacherConsole.tsx:145` ✓); `ClassRoomPanel` fires `class_view` in a bare `useEffect` with no cache | code |
| 5 | Postgres on `t4g.micro` (R55 incident) | **infra — declined** |
| 6 | chat turn: ~8 serial hops before the first token; `loadContext` is 4 waves | code |
| 7 | 443KB single-module chat cold start | both |
| 8 | `surfaceCache` is an in-memory Map: cold on every reload; §6(a) one-call-per-surface and §6(d) localStorage snapshot never built (`BRAIN_FIRST_SCOPE.md` §6) ✓ | code |
| 9 | index gaps: `lesson_attempts(session_id, activity_id)`; user-keyed telemetry reads on session-keyed indexes | code |

Plus, from the advisors (2026-09-04): **97 `auth_rls_initplan`** policies (re-evaluating
`auth.uid()` per row), 207 unindexed FKs, 47 multiple-permissive-policy tables. And from the
edge logs: `resource_interactions` p50 **1150ms**, `quiz_items` **1030ms**, `lesson_resources`
**815ms** at the origin — those are not geography; they are RLS and index work.

## Slices, in order. a–e ship in the first pass (row 3 of the run); f–i last (row 8).

### a. The entry gate — S
- `frontend/src/lib/api.ts:314-321` `fetchPrimaryRole`: run `fetchAdminScope` and
  `fetchTeacherClasses` with `Promise.all`; cache the result per user in `localStorage`
  (`jargon.role:<userId>`, TTL 24h) *and* the surface cache. `routes/index.tsx` reads the cache
  first and redirects immediately; the fetch refreshes in the background.
- `TeacherConsole.tsx:118` and `login.tsx:31,87` use the same cached function — one lookup per
  session, not three.
- `router.tsx`: `defaultPreload: "intent"` so the role-home chunk downloads while `beforeLoad`
  runs.
- Pin: `fetchPrimaryRole` contains one `Promise.all` and a cache read; `routes/index.tsx` does
  not `await` a network call before it can redirect from cache.

### b. The catalog in one request — M
- Replace the five-hop `fetchLessons` with **one PostgREST embedded select** — the FK chain
  exists (`0005_curriculum_hierarchy.sql:29,42,52`; `courses.subject_id` per `0009`):
  `lessons?select=*,units!inner(*,course_versions!inner(*,courses!inner(*,subjects(*))))`
  with the same filters. Verify the embedding resolves (a single 200 with nested rows) against
  production **read-only** before writing code; if a hop lacks a declared FK, add the FK in the
  migration (additive) rather than fall back to the chain.
- `fetchStudentCatalog` (`api.ts:556`): `Promise.all([fetchLessons(), memberships+links])` —
  two waves become one.
- `StudentApp.tsx:370-395`: the per-class loop becomes one `class_courses?class_id=in.(…)` read.
- Pin: the catalog path has exactly one `.from("lessons")` and no `.from("units")` /
  `.from("course_versions")` / `.from("courses")` / `.from("subjects")` chained after it.

### c. Lesson open in one wave — M
- `useConversation.ts:460-540` `loadLesson`: read the latest session **with its turns embedded**
  (`learning_sessions?…&select=*,learning_turns(*)&learning_turns.order=created_at&learning_turns.limit=…`)
  in parallel with `fetchLessonActivities` and `fetchTeacherLiveComments`. Three waves → one.
- Keep `prefetchLesson` (`api.ts:4128`, wired at `LessonTree.tsx:101`) and make it warm the
  same key the one-wave read uses.
- Pin: `loadLesson` has one `Promise.all` and no `await` that feeds a later fetch's filter.

### d. The dashboard's cadence — M
- `fetchTeacherDashboard` (`api.ts:2095-2483`): take the cached role/classes instead of re-running
  `fetchTeacherClasses`; use the one-call `fetchLessons`; merge waves 5 and 6 into one
  `Promise.all`; **drop the three telemetry reads nothing renders** — `transcript_heatmap_events`
  (`:2251`), `runtime_events` (`:2259`), `model_usage_events` (`:2267`) have zero consumers in
  `features/` or `components/` (grep 2026-09-04); `resource_interactions` (`:2235`) has one —
  keep it. Verify each before deleting; if a consumer appears, move the read to that screen.
- Split the "live now" strip into its own light query with `refetchInterval: 30_000`; the heavy
  bundle gets `staleTime: 5 * 60_000`, `refetchOnWindowFocus: true`, no interval.
- `ClassRoomPanel.tsx:60-84` → `useQuery({ queryKey: ["classRoom", classId], staleTime: 60_000 })`
  (the R101 posture for `studentThinking`).
- Pin: `refetchInterval` appears only on the live query; the dashboard has no
  `from("transcript_heatmap_events")` etc.; `ClassRoomPanel` uses `useQuery`.

### e. A snapshot for first paint — S
- `surfaceCache.ts`: a `snapshot(key)` layer for exactly two keys — the catalog and the role —
  backed by `localStorage`, keyed by user id, cleared on `SIGNED_OUT`/user change. The boot path
  paints from the snapshot and replaces it when the fresh read lands (a component-level
  subscription exists there: `useConversation`'s `setLessons`). Everything else stays
  fresh-or-fetch, as the file's own comment argues.
- Pin: only the two named keys use the snapshot; a different user id never reads another's.

### f. The bundle — M (last)
- Split `lib/api.ts`: `lib/auth.ts` (session, role, `roleHomeNav`) imported by the entry route;
  the rest stays behind the route chunks. Target: entry critical path ≤ 130KB gz (measure with
  `vite build` output + gzip).
- `main.tsx:12-19`: `katex.min.css` moves to a dynamic import where math renders
  (`Transcript.tsx`'s `renderRunWithMath`); keep Inter + Geist Mono, drop unused fontsource weights.
- `StudentHome.tsx:4`: `BrainGraph` becomes `lazy()`.
- Gate: tsc/eslint/build + the mock walk on Home, Learn, teacher Today — no missing styles, no
  page errors.

### g. Indexes — S (last)
Migration `20261106100000_r108_indexes.sql`: `lesson_attempts (session_id, activity_id)`;
`ideas (status)`, `vocab_terms (status)`, `curriculum_links (status)`; and, only if slice d kept
them, `runtime_events (user_id, created_at desc)` / `transcript_heatmap_events (user_id, created_at desc)`.
All `create index if not exists`. Append to the deploy list.

### h. Hot-table RLS: `auth.uid()` → `(select auth.uid())` — M (last, most careful)
- Scope: policies on `learning_turns`, `learning_sessions`, `lessons`, `profiles`,
  `class_memberships`, `lesson_resources`, `notifications`, `cognition_profiles`,
  `cognition_turn_scores`, `teacher_notes`, `student_mastery`, `quiz_items`,
  `resource_interactions`. The rewrite is semantically identical; it stops the planner
  re-evaluating the function per row.
- Method: generate the migration FROM the live catalog (`select policyname, cmd, roles, qual,
  with_check from pg_policies where tablename in (…)`), emitting `drop policy … ; create policy …`
  pairs with only the substitution applied. Keep the pre-change dump in the migration header.
- Verify after apply: `pg_policies` count and names unchanged for those tables; each `qual`
  differs from the dump only by the substitution (a script diff, in the HANDOFF).
- Then re-run the edge-log query for `resource_interactions`/`quiz_items`/`lesson_resources`
  origin p50 once a teacher has used the console.

### i. Notifications cadence — S (last)
`/rest/v1/notifications` was the most-called path (238 requests in 24h from one user).
`NotificationsMenu.tsx` has a realtime channel (`:51-80`) *and* `fetchNotifications` — find what
refetches (a focus/mount effect at `:40`/`:84`?) and make the realtime event the trigger, with a
single fetch on mount. Pin: no `setInterval`/`refetchInterval` on notifications.

## Measurement — before and after, the same way

- **Round trips per screen** on the mock: a Playwright walk that counts `page.on("request")`
  hits to `127.0.0.1:8787` from navigation start to network idle for: cold `/` → home; open a
  lesson; teacher `/teacher` → class Today; open a student. Record before (this week's build)
  and after in `docs/PERFORMANCE.md`. Counts transfer across regions; timings from this sandbox
  do not.
- **Live**, next day, read-only: the edge-log query from the brief, grouped by `request.cf.colo`
  and path, for the owner's next session. Expect the *count* of `/rest/v1/*` calls per minute
  of use to fall, and `lessons`/`profiles` p50 to be unchanged (geography) — which is the honest
  statement of what code can and cannot do here.
- `docs/PERFORMANCE.md` (new) carries: the geography table, the origin-time table, the advisor
  counts, the before/after request counts, and the two declined levers with their prices, so
  the region/compute decision can be revisited from a read.

## Tests

`tests/test_r108_waterfalls.py` — the pins under each slice, plus: no `refetchInterval` below
30s anywhere; `surfaceCache` still clears on auth change; the catalog embed string names every
hop in the chain (so a future "just add a subjects fetch" fails loudly).

## Risks

- Embedding depends on declared FKs; check live before coding (slice b).
- RLS rewrite (h) is the only change here that can lock someone out. Generated from the catalog,
  verified against the catalog, hot tables only, last in the night, and skipped if the diff shows
  anything other than the substitution.
- Dropping telemetry reads (d) is safe only if the grep stays at zero consumers at execution time.

## Est. a–e 3h · f–i 2.5h
