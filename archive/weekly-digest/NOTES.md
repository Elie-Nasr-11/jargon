# The weekly evidence digest — archived 2026-09-03 (R102)

**Was:** R71. `frontend/src/features/teacher/ClassDigestCard.tsx`, the
`teacher_class_digest` action in `supabase/functions/admin-ops/index.ts`, a fetcher in
`lib/api.ts`, two types in `lib/types.ts`, and `tests/test_r71_class_digest.py`.
**Now:** all of it here.

## Read this before restoring: it never worked

`buildClassDigest` asks PostgREST for `profiles?id=in.(...)&select=id,full_name`.

**There is no `full_name` column on `profiles`.** The column is `name`. (The full set is
`id, name, grade, created_at, avatar_url, preferences, preferred_name, mentor_instructions`.)

PostgREST answers **400** to that select, every time. Because the four reads run inside one
`Promise.all`, the whole digest request fails. It was observed failing twice on the day it
was archived — 08:17 and 09:19 UTC on 2026-09-03 — and there is no reason to think it ever
succeeded since R71 shipped.

So this feature was cut for two independent reasons: the owner did not want it, and it did
not work. **If you bring it back, fix that select first** — `select=id,name` — and check
whether anything downstream reads `full_name` off the returned rows.

## What it did

One card on the class Today screen: pick a window (7 / 14 / 30 days) and get, for that
class only:

- how many enrolled students were active in the window,
- totals (turns, study minutes, evidence),
- **movers** — students whose mastery rose,
- **stalled** — students with sessions but little evidence,
- **reteach** — skills that went badly across enough students to be a teaching problem
  rather than a tutoring one.

Its stated design rule, worth keeping if it returns: *the digest never converts thin data
into confident claims* — a class with two data points says so instead of ranking anyone.

## Two things worth taking from it even if the feature stays dead

1. **`studyMinutes(timestamps)`** — infers sittings from the spacing of turns, counting gaps
   of ten minutes or less as continuous, and deliberately under-estimates. That is a
   reasonable definition of "time on task" and nothing else in the codebase has one.
2. **`classLessonIds(config, classId)`** — a second implementation of the three-hop
   `class_courses -> course_versions -> units -> lessons` walk. The live one is
   `lessonsOfCourses` in `cognition-scorer`. Having two was a drift risk; deleting the
   digest removed the copy. **Do not paste this one back** — call the scorer's rule or
   extract a shared one.

## To restore

1. `git mv archive/weekly-digest/ClassDigestCard.tsx frontend/src/features/teacher/ClassDigestCard.tsx`
2. Paste `admin-ops-digest.ts` back into `supabase/functions/admin-ops/index.ts`,
   **fixing the `full_name` select**.
3. Re-add the router branch:
   ```ts
       if (action === "teacher_class_digest")
         return await handleTeacherClassDigest(config, actorId, record);
   ```
4. Re-add `"teacher_class_digest"` to the `AdminOpsAction` union in `lib/types.ts`, and the
   types in `types.ts` here.
5. Re-add `fetchClassDigest` to `lib/api.ts` (it is quoted at the top of `api-fetcher.ts`
   in this folder).
6. Mount it: `<ClassDigestCard classId={classId} />` in
   `features/teacher/today/TodayScreen.tsx`.
7. `git mv archive/weekly-digest/test_r71_class_digest.py tests/` — and add a pin that the
   profiles select names only columns that exist, so this cannot regress.
