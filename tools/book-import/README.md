# Book import pipeline

Turns a Teacher Edition PDF into the live curriculum: extracted (structured, with
the book's red-printed answer key), composed into import envelopes (book-faithful —
no model calls, no invented answers), validated, and imported through
`curriculum-admin`'s `import_curriculum` action. Page images for diagram pages
render into `frontend/public/books/` and bind to their steps as external-URL
resources.

Run from the repo root (playwright-core is needed for render-pages; `npm i
playwright-core` somewhere on the resolution path or symlink a node_modules into
this directory — the symlink is gitignored):

```bash
# 1. Extract both books into fresh dirs (always fresh — stale files mislead).
node tools/book-import/extract.mjs "IT Frontiers - Advanced - Book A1 - Teacher Edition.pdf" a1 /tmp/out-a1
node tools/book-import/extract.mjs "IT Frontiers - Advanced - Book A2 - Teacher Edition.pdf" a2 /tmp/out-a2

# 2. Pick + render the visual pages (raster census + vector line-art census —
#    A1's diagrams are drawn, not rastered; cap 12 per lesson).
node tools/book-import/select-pages.mjs "<A1 pdf>" /tmp/out-a1 books/itf-a1/pages.json
node tools/book-import/render-pages.mjs "<A1 pdf>" books/itf-a1/pages.json frontend/public
#    (repeat for a2)

# 2b. The book PDFs themselves (R62) live in frontend/public/books/pdf/:
#     <slug>.pdf per lesson, a1-ch1.pdf etc. per chapter (both from split.mjs),
#     a1-book.pdf / a2-book.pdf (copies of the repo-root Teacher Editions).
#     Regenerate the splits with:
#       node tools/book-import/split.mjs "<A1 pdf>" /tmp/out-a1/index.json <outRoot> a1
#     then copy chapters/lessons into frontend/public/books/pdf/ under those names.

# 3. Compose the four chapter envelopes (splices books/itf-a1/lesson-1-authored.json
#    verbatim as A1 ch1 lesson 1 — it is live in prod; --raw emits the mechanical
#    version beside it for diffing).
node tools/book-import/compose.mjs /tmp/out-a1 /tmp/out-a2 .

# 4. Validate — refuses anything the book does not back.
node tools/book-import/validate.mjs /tmp/out-a1 /tmp/out-a2 .

# 5. Import (owner machine; see scripts/import-curriculum.mjs and
#    docs/CURRICULUM_IMPORT.md).
node scripts/import-curriculum.mjs --dir books/itf-a1
node scripts/import-curriculum.mjs --dir books/itf-a2
```

What the extractor knows (v2, R61):

- The answer key is printed in THREE reds (`#ff5739`, `#ff4227`, `#ff7657` — the
  AI chapter is set almost entirely in the second). Red is marked per text item:
  answers never enter student-facing text, and each answer attaches to the question
  it follows in reading order — the two-column scramble pairs correctly because the
  answers ride WITH their questions; questions are never re-sorted.
- An MCQ's red run IS the correct option's text: the letter is recorded and the
  option kept (and restored when trailing prose polluted it).
- Activities are structured (`tf | mcq | match | open | project`), `(continued)`
  page-break re-emissions merge, T/F grid letters come from the op-level runs.
- The Appendix/glossary splits off the final lesson into `glossary.json`
  (committed under `books/itf-*/`, not imported — future vocab work).
- `survey.mjs`, `sections.mjs`, `colors.mjs` are read-only diagnostics.

What the composer guarantees: only `lesson.quiz[]` carries graded questions (the
importer's quiz_items trap), every correct answer traces to a red run (merged
question buckets are recovered by the id-sequence restart or skipped — never
guessed), applied practice is explicit (`mode_type: "applied"`), and the teacher
edition's model answers land as MENTOR guidance ("never read them out").
