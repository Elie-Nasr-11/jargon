# Lesson/rubric templates and the bulk importer — archived 2026-09-03 (R102)

**Was:** five actions in `supabase/functions/curriculum-admin/index.ts`.
**Now:** `archive/curriculum-templates/actions.ts`.

## What they did

- **`save_template` / `list_templates` / `instantiate_template` / `archive_template`** — save
  a lesson (or a rubric) as a reusable template, list them, stamp a new lesson out of one,
  retire one. Backed by `lesson_templates` and `rubric_templates`.
- **`import_curriculum`** — a bulk importer: take a structured curriculum payload and create
  the whole subject → course → version → unit → lesson tree in one call. This is the
  ancestor of the `import_key` column that still marks book-imported lessons.

## Why they left

None of the five had a caller in `frontend/src`. Both tables hold zero rows. The authoring
rebuild (R74/R75) replaced "instantiate from a template" with "build from material", which
generates a lesson package with a model instead of stamping a stored shape — a different and
more useful answer to the same need.

`import_curriculum` is the one with a live descendant: the IT Frontiers books were imported
through the R73 book path, and `lessons.import_key` still records that. If you ever need to
ingest a whole curriculum from a file again, read this first — it already solved the
ordering and id-namespacing problems.

## What is still live that they need

All of `curriculum-admin`'s helpers — authorization, the node writers, the publication-status
rules — are unchanged and still exported within that file. The 27 remaining actions cover
everything the studio does today.

## To restore

1. Paste the handlers from `actions.ts` back into
   `supabase/functions/curriculum-admin/index.ts` above its router.
2. Re-add the router lines, which read exactly:
   ```ts
       if (action === "save_template") return await saveTemplate(config, actorId, record);
       if (action === "list_templates") return await listTemplates(config, actorId, record);
       if (action === "instantiate_template") return await instantiateTemplate(config, actorId, record);
       if (action === "archive_template") return await archiveTemplate(config, actorId, record);
       if (action === "import_curriculum") return await importCurriculum(config, actorId, record);
   ```
   (the first four sit together; `import_curriculum` sat further down, in the import block.)
3. Their tables still exist and are empty — no migration needed.
4. Write the UI, and check first whether "build from material" already does what you want.
