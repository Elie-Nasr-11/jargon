# Feature inventory — what is alive, what is thin, what is dead

Written 2026-09-03, at the owner's request: *"lets remove the weekly digest for now. focus
energy on core features. actually, make a list of all features so that we can decide what
to trim down."*

This is that list. Nothing here is trimmed yet, except where noted as decided.

## How to read the evidence

Every entry carries two independent facts, and they are **not** equally strong.

- **Reachable?** — whether a person can get to it at all: a route, a nav item, a caller, a
  cron. This is checked by grep and it is *strong* evidence. "Nothing calls this action" is
  a fact about the code, and deleting an unreachable feature costs only the delete.
- **Rows ever written** — production row counts, read 2026-09-03. This is *weak* evidence
  about demand. The platform holds one school's worth of seeded accounts, a demo class, and
  four days of real cognition data. A zero on a reachable feature may mean "nobody wants
  this" or "nobody has been asked to use it yet" — `teacher_notes` is fully built, reachable
  from the student detail screen, and has zero rows, which says nothing about whether
  teachers would use it once they have real students in front of them.

**So: trim freely on "unreachable". Trim on "zero rows" only with a product reason beside
it.** The one exception is where a feature is both unreachable *and* empty, which is most of
section 2.

## The shape of the thing

| | |
|---|---|
| Tables | **110**, of which **36 hold zero rows** |
| Edge functions | **13** (9,575 lines of the 27,153 are `chat` alone) |
| Frontend | ~36,000 lines across three portals (student 12,051 · teacher 17,572 · admin 2,779) |
| Routes | **7** (login, index, learn, teacher, teacher/class, teacher/class/lesson, teacher/class/student, admin, platform) |
| Backend actions | **105** across the routers; **48 have no caller anywhere** |

---

## 1. Core — this is the product

Everything here is reachable, exercised, and load-bearing. Rows are production counts.

| Feature | Where | Evidence | Size |
|---|---|---|---|
| **The lesson loop** — the mentor conversation, steps, offers, mode switching, flow state | `supabase/functions/chat`, `student/useConversation.ts`, `student/ChatWindow.tsx` | 963 turns · 1,278 sessions · 651 model calls | 9,575 + ~4,000 |
| **Mastery** — per-skill and per-idea, the EMA that decides what is solid | `chat`, `student_mastery`, `student_idea_mastery` | **2,351** + **953** rows | in `chat` |
| **The cognition ledger** — the rubric judge, the sweep, the Thinking tab | `cognition-scorer`, `features/teacher/cognition/**`, `console/CognitionPanel.tsx` | 132 scored responses · 19 profiles · 271 sweep runs | 1,534 + 1,374 |
| **Curriculum** — subjects, courses, versions, units, lessons, milestones | `curriculum-admin`, `features/teacher/course/**`, `lesson/**` | 129 lessons · 129 milestones · 40 units · 23 courses | 4,189 + 4,183 |
| **Resources** — the book PDFs, figures, placement in lessons | `resource-processing` (2 live actions), `console/ResourceManager.tsx` | **1,643 interactions** · 215 resources · 125 figures | ~800 |
| **Lesson activities** — quizzes and practice inside a lesson | `chat`, `quiz_items`, `lesson_activities` | 615 activities · 180 quiz items · 18 attempts | in `chat` |
| **Voice** — speak-and-listen in a lesson | `voice-session`, `student/VoicePanel.tsx` | **325 interaction events** · 16 realtime sessions | 629 + ~400 |
| **Vocabulary / My Jargon** | `chat`, `student/KnowledgeCard.tsx` | 135 terms · 53 collected | ~600 |
| **Evidence + attempts** — what a lesson recorded | `chat`, `learning_evidence`, `lesson_attempts` | 1,052 + **1,298** rows | in `chat` |
| **Teacher console** — Today, People, Course, Lesson, Thinking, Room | `features/teacher/**` | 28 classes · 267 memberships · 178 course links | 17,572 |
| **Admin window** — setup, people, classes, health | `features/admin/**`, `admin-ops` (19 live actions) | 204 profiles · 3 orgs · 13 audit events | 2,779 + 3,163 |
| **Artifacts** — decks and sims the mentor builds | `artifact-live`, `run` | reachable; 957 + 310 lines | 1,267 |

---

## 2. Dead by construction — delete freely

**Strong evidence.** No route, no caller, no cron. Each line here was verified by grepping
the whole repo for the action string or the component name.

### Two whole integrations, never wired

| Feature | Size | Evidence |
|---|---|---|
| **Canvas LMS** — OAuth, roster import, course mapping, grade push, sync runs | **2,046 lines** + 5 tables | **all 16 actions have no caller**; zero frontend references (the 12 "canvas" hits in the frontend are the HTML `<canvas>` element); all 5 tables hold **0 rows** |
| **Google Classroom** — OAuth, roster import, coursework export, grade passback | **1,189 lines** + 6 tables | **all 10 actions have no caller**; zero frontend references; all 6 tables hold **0 rows** |

Together: **3,235 lines of backend and 11 tables that no user can reach.** They also carry
OAuth client secrets in env vars for services nobody is connected to.

### The PDF chunk / OCR / transcription pipeline

`resource-processing` is 1,707 lines and **11 of its 13 actions have no caller**. Only
`read_image_material` and `read_url_material` are live. Dead: `extract_pdf_chunks`,
`ocr_pdf_pages`, `save_pdf_page_assets`, `transcribe_media_resource`, `list_resource_chunks`,
`approve_chunks`, `reject_chunks`, `delete_chunks`, `save_chunk_edits`,
`create_curriculum_import_draft`, `list_curriculum_import_job`.

This was the R58/R59 chapter-import path. The book content it produced is already in the
lessons (50 text chunks, 80 page assets), so the *output* is live while the *machinery* is
not. `curriculum_import_jobs` and `curriculum_import_suggestions` hold 0 rows.

### Other actions with no caller

- `curriculum-admin`: `save_template`, `list_templates`, `instantiate_template`,
  `archive_template`, `import_curriculum` (5 of 32) — `lesson_templates` and
  `rubric_templates` both hold 0 rows
- `admin-seed`: `list_seed_batches`, `upsert_org_class`
- `cognition-scorer`: `list_lessons` (never had a frontend caller); `score_lesson` (dead as
  of R101 by design — kept deliberately as a rig API, documented)
- three `diagnose` actions (`canvas`, `google-classroom`, `voice-session`)

### Schema with no code at all

Tables with **no frontend reference, no backend writer, and 0–2 rows**. Pure debt:

`session_holds` · `dm_channels` · `dm_messages` · `chat_messages` · `student_uploads` ·
`material_comments` · `entity_comments` · `grade_overrides` · `intervention_alerts` ·
`review_sessions` · `rubric_templates` · `lesson_templates` · `code_submissions` ·
`parent_guardian_links` · `platform_consent_settings` · `class_settings` ·
`organization_settings` · `feature_flags` · `admin_csv_import_batches` ·
`admin_csv_import_rows` · `admin_data_export_requests` · `admin_data_retention_requests` ·
`student_progress_reports` · `speech_usage_events` · `canvas_*` (5) · `google_classroom_*` (6)

Note `code_submissions`: the student *can* run code, but nothing writes that table — code
rides in `learning_turns.payload.code` instead. The table is a leftover.

### Smaller orphans

- Three edge functions live in production with **no source in this repo**:
  `key-probe-oneoff`, `ops-probe-r49`, `deploy-probe-r90`. Inert probes from earlier
  releases. Removal is one CLI call each.
- Six unused shadcn primitives (`ui/tooltip`, `ui/toggle`, `ui/label`, `ui/input`,
  `ui/skeleton`, `ui/separator`) — 148 lines
- Thirteen exported functions in `lib/api.ts` with no importer: `archiveCurriculumNode`,
  `computeReviewDue`, `deleteStudentUpload`, `fetchClassCourses`, `fetchStudentEvidence`,
  `fetchStudentMastery`, `fetchStudentProgressSummary`, `fetchStudentTeacherNotes`,
  `getLessonResourceThumbnailSignedUrl`, `getStudentUploadSignedUrl`, `invokeAdminOps`,
  `signUp`, `upsertProfile`

---

## 3. Decided cut — the weekly evidence digest

Owner's call, 2026-09-03. It is also **broken in production**: `admin-ops/index.ts:1970`
asks `profiles` for `id,full_name`, and that table has no `full_name` column (it is `name`),
so PostgREST answers 400 on every run. Observed failing twice today, 08:17 and 09:19.

Footprint to remove: `features/teacher/ClassDigestCard.tsx` (199) + the `buildClassDigest` /
`digestWindow` / `studyMinutes` / `handleTeacherClassDigest` block in `admin-ops` (~197) +
the mount in `today/TodayScreen.tsx` + the fetcher and types in `lib/api.ts` / `lib/types.ts`
+ `tests/test_r71_class_digest.py` (123). Roughly **550 lines**, and pins in
`test_r73_teacher_realignment.py` and `test_r81_today.py` to re-express.

One thing it holds that is worth keeping: `classLessonIds` in `admin-ops` is a second copy
of the three-hop `class → courses → versions → units → lessons` walk that `cognition-scorer`
also implements. If the digest goes, that copy goes with it — which is a small win, since
two copies of that walk can drift.

---

## 4. Thin — reachable, barely exercised

**Weak evidence.** These work and a person can reach them. The numbers are low because the
platform has not been used in anger yet, so decide these on product judgment.

| Feature | Rows | Note |
|---|---|---|
| **Assignments** — set work, students submit, teacher grades | 13 assignments · 193 recipients · **1 submission** · 0 files | full surface on both sides (`student/AssignmentSurface.tsx`, `AssessmentGrading.tsx`) |
| **Assessments** — formal graded assessments | 17 · 197 recipients · 3 attempts · 11 items · 7 item attempts | `assessment-admin` (866 lines, all 6 actions live) |
| **Checkpoints** — the older quiz-like surface | 53 · 435 recipients · 16 items | overlaps assessments and lesson quizzes; three surfaces for "test them" |
| **Teacher notes** — private or student-visible notes | **0** | fully built, reachable; nobody has written one |
| **Live watching** + hold/resume | 4 viewers · 1 comment · 0 holds | the hold path writes no table at all |
| **Notifications** | 1 | menu exists (`components/NotificationsMenu.tsx`) |
| **Comments on entities/material** | 1 / 0 | two comment systems, neither used |
| **The brain map** | 189 ideas, 953 mastery rows behind it | decision already deferred to R103; still no click telemetry |
| **Misconceptions memory** | 7 | feeds the mentor |
| **Student memory** | 2 | feeds the mentor |
| **Mentor recommendations** | 20 | live |
| **Session summaries** | 9 | live |
| **Transcript heatmap** | 1 | teacher-side analytics |

The pattern worth naming: **there are three ways to test a student** (lesson quizzes,
checkpoints, assessments) and **two ways to comment** (material, entity). That is the
duplication to resolve, and it is a product decision rather than a cleanup.

---

## 5. What I would cut, and what I would keep

**Cut now — no product decision needed** (all unreachable, ~4,000 lines + 30 tables):
1. Canvas LMS, whole (2,046 lines, 5 tables, secrets)
2. Google Classroom, whole (1,189 lines, 6 tables, secrets)
3. The 11 dead `resource-processing` actions and the chunk/import tables
4. The 5 `curriculum-admin` template actions and their 2 tables
5. The schema-with-no-code list
6. The three orphan production functions, the 6 unused primitives, the 13 unused exports
7. The weekly digest (decided)

**Decide, then cut — needs your judgment:**
8. Pick **one** of checkpoints / assessments / lesson quizzes and retire the other two
9. Pick **one** comment system, or drop comments until someone asks
10. Notifications: commit to it or drop the menu
11. Assignments: one submission in production. Keep for the school's sake, or park it?

**Keep, untouched:** the lesson loop, mastery, the cognition ledger and its sweep,
curriculum, resources and figures, voice, vocabulary, the teacher console's six screens,
the admin window, artifacts.

## How to trim safely

Same ritual as every release. For each item: delete the code *and* its tests in one commit,
re-express any pin that was asserting the deleted thing (state the rule, not the shape),
then `tsc` / `eslint` / `vite build` / the python suite / the deno harnesses, and
`deno check` on any touched function. Tables get a migration that drops them, appended to
the hardcoded list in `deploy-backend.yml`. Dropping a table is the one irreversible step —
do those last, and only for the zero-row ones.
