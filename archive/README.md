# The archive

Code that was **removed from the running product but deliberately kept**, so that bringing
any of it back is a reading exercise rather than an archaeology one.

Nothing in this directory is compiled, deployed, imported, or tested. The build does not see
it. It exists to be read.

Created 2026-09-03 (R102), after the audit in [`docs/FEATURE_INVENTORY.md`](../docs/FEATURE_INVENTORY.md)
found that 48 of the platform's 105 backend actions had no caller anywhere.

## What is in here

| Folder | What it was | Why it left | Lines |
|---|---|---|---|
| [`canvas-lms/`](canvas-lms/) | Canvas LMS integration: OAuth, roster import, course mapping, grade push | All 16 actions unreachable; no frontend ever called it; all 5 tables empty | 2,046 |
| [`google-classroom/`](google-classroom/) | Google Classroom integration: OAuth, roster import, coursework export, grade passback | All 10 actions unreachable; no frontend ever called it; all 6 tables empty | 1,189 |
| [`resource-chunk-pipeline/`](resource-chunk-pipeline/) | PDF text extraction, media transcription, the chunk review workflow, curriculum import drafts | Owner kept the OCR path and archived the rest | 457 |
| [`curriculum-templates/`](curriculum-templates/) | Lesson/rubric templates and the bulk curriculum importer | 5 actions unreachable; both tables empty | 608 |
| [`weekly-digest/`](weekly-digest/) | The teacher's weekly evidence digest (R71) | Owner cut it. It had also **never worked** — see its NOTES | 480 |

Each folder has a `NOTES.md` that says what the feature did, what it depended on, what is
still in the live codebase that would support it, and the ordered steps to restore it.

## Three things that are true of everything here

**1. No tables were dropped.** Every archived feature's tables still exist in production,
empty. That is deliberate: a restore needs no migration, no backfill, and no data recovery.
The `canvas_*` and `google_classroom_*` tables and their RLS policies are still created by
`supabase/migrations/20260628000000_canvas_integration.sql` and its Classroom counterpart,
and those migrations are still in the deploy list, so a fresh environment still gets the
schema. If you decide these are gone for good, dropping the tables is a separate, deliberate
and **irreversible** step — ask for it explicitly.

**2. Canvas and Google Classroom are still DEPLOYED, on purpose.** Archiving their source
and dropping them from the deploy workflow stopped them being *updated*; it did not undeploy
them. Both still answer requests at their function URLs (canvas v17, google-classroom v18),
and their OAuth client secrets are still set as environment variables on the project.

**That is the owner's decision, taken 2026-09-03**: keep them running rather than delete
them. So these two are not "archived" in the sense the other three are — their source has
left the repo, but the last-deployed build is live and armed. The practical effect is that
restoring either one is even cheaper than the steps below (the function is already there),
and that anyone with the URL and a valid JWT can still reach them. If that trade ever stops
being worth it, deleting a deployed function needs an account access token, which lives only
as a repository secret — do it through a manual-dispatch workflow, the way the three orphan
probe functions were removed on the same day.

**3. Git history is the other copy.** Everything here is also in the history at commit
`a9ded0b` and its parents. This directory exists because "it's in git somewhere" is not a
plan you can act on eighteen months from now — the NOTES are.

## Restoring something

The shape is the same for each:

1. Read that folder's `NOTES.md` end to end, especially "what changed underneath it" — the
   platform kept moving after these left, and a verbatim paste may reference helpers,
   tables or auth patterns that have since changed.
2. Move the code back to the path the NOTES name.
3. Re-add its router branches (the NOTES quote them verbatim).
4. For an edge function: re-add its path filter and its `supabase functions deploy` line to
   `.github/workflows/deploy-backend.yml`.
5. For a frontend surface: re-add the fetcher to `lib/api.ts`, the types to `lib/types.ts`,
   and the mount the NOTES names.
6. Write the tests back. The archived test files come with their features where they
   existed.
7. Run the usual gate: `tsc`, `eslint src`, `vite build`, the python suite, the deno
   harnesses, and `deno check` on any touched edge function.
