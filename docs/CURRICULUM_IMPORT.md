# Curriculum Import (R58)

The contract for putting a **whole book** into Jargon as a course, without hand
entry and without a browser tab staying open for an hour.

One JSON document describes one **chapter** (a unit and its lessons). A book is a
directory of them, imported in order. Everything lands as **drafts** — publishing
stays a human act, exactly as with hand-authored curriculum.

## Why a file format at all

R56/R57 generate curriculum inside the app, which is right for a teacher working
from a handout. A textbook is different: it is long, it is worth doing carefully,
and it is worth being able to redo. A file lets the authoring (an agent reading the
book chapter by chapter, or the in-app generator) be separated from the landing (this
importer), so either side can be redone without the other.

## Idempotency — the rule that makes re-imports safe

Every node carries a stable `id` **you** choose, derived from the book and its
position: `ict-f-ch3`, `ict-f-ch3-l2`, `ict-f-ch3-l2-s1`. Re-importing the same
chapter **updates those rows in place**. It never duplicates, and it never touches a
row it did not create — imported rows are stamped with `import_key`, so a teacher's
own lessons in the same unit survive a re-import untouched.

Change a lesson's `id` and you get a new lesson; the old one stays until someone
archives it. That is deliberate: an importer that deletes is an importer that eats
a teacher's edits.

## Shape

```jsonc
{
  "import_key": "ict-f",              // the book. Stamps every row this run writes.
  "course": {
    "id": "course-ict-f",             // existing course id, or a new stable one
    "title": "ICT Book F",
    "subject": "ICT",                 // matched by title to an existing subject
    "level": "Grade 7"
  },
  "unit": {
    "id": "ict-f-ch3",
    "title": "Chapter 3 · Inside a computer",
    "summary": "What the parts do and how they talk to each other.",
    "position": 3
  },
  "lessons": [
    {
      "id": "ict-f-ch3-l1",
      "title": "The processor",
      "level": "Grade 7",
      "objective": "Explain what a CPU does in one sentence.",
      // How the mentor opens and carries the lesson. Second person, no meta-talk.
      "tutor_prompt": "Open by asking what they think is doing the thinking…",
      "steps": [
        {
          "mode": "explanation",      // explanation|media|reflection|practice|inquiry|assessment|revision|assignment
          "mode_type": "",            // practice: code|applied · assessment: mcq|open_ended
          "title": "A tiny, fast worker",
          "prompt": "The CPU follows instructions one at a time, very fast…",
          "choices": [],              // assessment/mcq only, ids a,b,c,d
          "correct_choice_id": ""
        }
      ],
      // The wrap-up check. Lands as assessment STEPS (R56 precedent) — no roster
      // needed, and R48's step-work strip turns any of them into graded classwork
      // in one click.
      "quiz": [
        {
          "question_type": "multiple_choice",
          "prompt": "What does the CPU do?",
          "choices": [{ "id": "a", "text": "Follows instructions" }],
          "correct_choice_id": "a"
        }
      ],
      "assignment": {
        "title": "Spot the processor",
        "instructions": "Find a device at home and describe…",
        "success_criteria": ["Names the device", "Says what it processes"]
      },
      // Diagrams lifted from the book. Upload the image first (the CLI does this),
      // then reference the object path it returns.
      "figures": [
        {
          "id": "ict-f-ch3-l1-fig1",
          "title": "Inside the case",
          "caption": "The CPU sits under the fan.",
          "alt_text": "Photograph of an opened desktop computer…",
          "storage_path": "figures/ict-f/ch3/l1-fig1.png",
          "source_page": 41
        }
      ]
    }
  ]
}
```

Every field except `id`, `title`, and `steps` is optional. Omit what the book does
not give you rather than inventing it.

## Figures

Figures do **not** travel inside the JSON. The CLI uploads each image to the private
`lesson-resources` bucket and writes the returned object path into `storage_path`;
the student's browser signs it at render time, like every other private resource.
Base64 in the document would blow the edge function's body limit at book scale and
would make re-imports re-upload every image.

Legacy figures that use a static `image_url` keep working — `storage_path` simply
wins when both are present.

A figure's `id` in the document is an import-time handle only: `lesson_figures.id`
is a database-generated uuid, and the runtime's `[[figure:...]]` markers carry the
row's own id, never the document's. Re-imports find their rows by
`(lesson_id, import_key, position)` — the document's figure order is the identity,
so keep it stable across re-imports of the same chapter.

## Running it

```bash
# One chapter
node scripts/import-curriculum.mjs --file books/ict-f/ch3.json

# A whole book, in order, resuming where it stopped
node scripts/import-curriculum.mjs --dir books/ict-f
```

The CLI signs in as a teacher or admin (the same credentials the app uses — no
service-role key on a laptop), uploads that chapter's figures, posts the document,
and prints what it created, updated, and skipped. Re-run it as often as you like.

## Materials (R61): page images bound to steps

A lesson may carry `materials` — images shown to the student when a given step
opens (the media-stage path). The importer writes them as `lesson_resources` rows
bound to the step's activity:

```json
"materials": [
  {
    "id": "itf-a2-ch2-l1-p160",
    "title": "Book page 160 — Types of Learning",
    "external_url": "/books/a2-ch2-l1/p160.jpg",
    "step": 1,
    "source_page": 160
  }
]
```

- `external_url` is required — a relative URL resolves against the app's own
  origin (the page files live in `frontend/public/books/`), an absolute URL is
  passed through untouched. No storage upload is involved.
- `step` is **optional** (R62). When present it is the 1-based position among the
  lesson's authored `steps[]` — quiz and assignment steps are appended after
  them, so a step binding always lands on a teaching step, and out-of-range
  bindings are skipped with a warning. When absent the row is **lesson-level**
  (no `activity_id`): it never auto-shows on a step, but the student browses it
  in the Resources panel and the mentor can hand it out on request.
- `type` is **optional** (R62): `"pdf"` makes the row a PDF (`resource_type
  'pdf'`, `mime_type application/pdf` — renders in-app in an iframe); anything
  else is an image. `student_instructions` passes through (clamped to 400).
- A lesson may also carry `documents` — the same entry shape, processed by the
  same loop with the same idempotency. The convention (R62) is three PDFs per
  lesson: the lesson's own pages, its chapter, and the whole book
  (`<lessonId>-doc-lesson|-doc-chapter|-doc-book`, files under
  `frontend/public/books/pdf/`).
- Keep a lesson's total rows (materials + documents) at **15 or fewer** — the
  chat runtime fetches at most 16 resources per lesson, and rows past that are
  invisible to the mentor.
- Idempotency: `lesson_resources.id` is a generated uuid, so ownership rides in
  `metadata.material_id` + `metadata.import_key`. A resource someone else created
  is left alone with a warning; re-imports patch in place. Nothing is deleted —
  a re-import that drops a material leaves the old row behind (archive it in the
  studio if it should go).
- Materials land as drafts and publish with `publish_lesson`, like everything else.

## What the importer will refuse

- A lesson with no steps (an empty lesson is worse than no lesson).
- A `mode` outside the platform's vocabulary, or an mcq step with no correct choice.
- A figure whose `storage_path` is not under `figures/`.
- Writing into an organization the signed-in user cannot author in — the importer
  runs through the same `assertCanAuthor` guard as every other authoring action.
