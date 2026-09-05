# R109 — the note to the tutor

## Context

Owner: *"the teacher … has very detailed breakdowns of all of the thinking of the student, but
she doesn't have much ability to do anything with it. If there was a way to post a note to the
mentor, that would be good."*

Decisions: **per student, per class**; **free text the mentor FOLLOWS** — it rides beside §19's
moves, outranks the default help level, same never-say rule; one live note at a time, with
history; lives until the teacher clears or replaces it; the student never sees it.

What exists (agent report, verified):
- **No teacher-written text reaches the mentor.** `grep teacher_note\|teacher_live_comment
  supabase/functions/` → zero hits. `teacher_notes` (0006_learning_records.sql:107-119) is fully
  built — `(student_id, teacher_id, class_id, lesson_id, note, visibility ∈ {teacher_private,
  student_visible})` — read by two dashboards and nobody else; **zero rows ever**.
- **The seat for it exists.** `chat/index.ts:8091` builds `learner: learnerSteer(…)`; the prompt
  consumes it at `:195-204` (HOW THIS STUDENT THINKS), granting it authority over the default
  help level with the never-say rule; `"learner"` is in `MENTOR_STABLE_PAYLOAD_KEYS`
  (`:1909-1923`) so it rides the cached prefix. A `teacher` key beside it is the minimal change.
- **Chat does not know the class.** `loadContext` reads `lesson_subjects` for the subject only
  (`:5070`); nothing resolves which class a lesson is being taken in. The note is per class, so
  the scoping join has to happen somewhere — and it must cost nothing for the 99% of turns with
  no note.

## Files

- `supabase/migrations/20261106000000_r109_note_to_the_tutor.sql` — visibility value,
  `cleared_at`, the one-live-note index, the `tutor_notes_for_lesson` view.
- `.github/workflows/deploy-backend.yml` — append the migration.
- `supabase/functions/chat/index.ts` — one read in `loadContext` wave 1; `teacher` in the
  payload + stable keys; the prompt block; a guard that the envelope never carries it.
- `frontend/src/lib/api.ts` — `TeacherNote` gains `cleared_at`; `createTeacherNote` accepts
  `visibility: "tutor"`; new `fetchTutorNotes`, `clearTutorNote`.
- `frontend/src/features/teacher/console/NoteToTutor.tsx` — **new**: the composer + active note.
- `frontend/src/features/teacher/console/StudentDetail.tsx` — mount it on the transcript tab
  (R111 re-mounts the same component on the review surface).
- `frontend/src/features/teacher/console/CognitionPanel.tsx` — one link under the reading:
  "Write a note to the tutor →" (switches to the transcript tab).
- `tests/test_r109_note_to_the_tutor.py`; `tests/flow_core.test.ts` (prompt-shape pins only —
  the payload builder is not unit-testable).
- `docs/LEXICON.md` (the word), `docs/COGNITION.md` (the diagram gains the arrow; "the teacher's
  two views"), `docs/PRODUCT_ARCHITECTURE.md:9` (make the claim true), HANDOFF, DECISIONS.

## Design

### Schema
```sql
alter table public.teacher_notes drop constraint if exists teacher_notes_visibility_check;
alter table public.teacher_notes add constraint teacher_notes_visibility_check
  check (visibility in ('teacher_private', 'student_visible', 'tutor'));
alter table public.teacher_notes add column if not exists cleared_at timestamptz;
-- One live note to the tutor per (student, class). Replacing = clear the old, insert the new.
create unique index if not exists teacher_notes_one_live_tutor_note
  on public.teacher_notes (student_id, class_id)
  where visibility = 'tutor' and cleared_at is null;
```
Existing RLS (0006:461-484) already lets a teacher insert/update/delete their own notes for
students they can view; `tutor` is just a new value. The student-visible select clause is
unchanged, so **a student can never read a `tutor` note** (pin it).

### The view — one read, zero client logic, free when there is nothing to read
```sql
create or replace view public.tutor_notes_for_lesson with (security_invoker = false) as
select n.id, n.student_id, n.class_id, n.teacher_id, n.note, n.created_at, l.id as lesson_id
from public.teacher_notes n
join public.lessons l on true
where n.visibility = 'tutor' and n.cleared_at is null
  and (
    n.class_id is null
    -- the platform rule: a class with no linked courses scopes to everything
    or not exists (select 1 from public.class_courses cc where cc.class_id = n.class_id)
    or exists (
      select 1 from public.class_courses cc
      join public.course_versions cv on cv.course_id = cc.course_id
      join public.units u on u.course_version_id = cv.id
      where cc.class_id = n.class_id and u.id = l.unit_id
    )
  );
revoke all on public.tutor_notes_for_lesson from anon, authenticated;
grant select on public.tutor_notes_for_lesson to service_role;
```
Chat (service role) reads `tutor_notes_for_lesson?student_id=eq.U&lesson_id=eq.L&order=created_at.desc&limit=3&select=note,created_at,class_id`
in **wave 1 of `loadContext`** (`chat/index.ts:5000-5099`, inside the existing `Promise.all`).
Zero rows for almost every student; the join runs only where a note exists. Teachers never read
the view — they read the table under RLS.

### Prompt
Payload (`chat/index.ts:8091`, beside `learner`):
```ts
teacher: context.tutorNote
  ? { note: clampText(stripMarkers(context.tutorNote.note), TUTOR_NOTE_MAX /* 500 */), since: context.tutorNote.created_at }
  : undefined,
```
`"teacher"` added to `MENTOR_STABLE_PAYLOAD_KEYS` (cached prefix; re-cached only when the note
changes — the right cost profile for something that changes weekly).

Prompt block, immediately after HOW THIS STUDENT THINKS (`:204`):
> WHAT THEIR TEACHER ASKED OF YOU — when "teacher.note" is present it is an instruction from
> this student's own teacher about how to work with THEM, written after reading their work.
> Follow it. Where it conflicts with "learner.moves", the teacher wins; it still obeys
> policy.help_ceiling, EXACTLY ONE ASK and the step's own contract. NEVER SAY ANY OF THIS TO
> THE STUDENT: do not mention the teacher, a note, or that you were asked to do anything. They
> experience only the change. If "teacher" is absent, nothing here applies.

Precedence, stated once: **teacher note > §19 moves > default help level**, all under the
policy ceiling. A human who read the transcript outranks a statistic over it.

### Never to the student
- The `teacher` key is built into the *mentor payload only*; the envelope builder and the
  persisted `learning_turns.payload` must not carry it. Pin: grep the envelope/persist paths
  for `teacher` — absent.
- The note text is teacher-authored prompt input: strip `[[…]]` markers, cap at 500 chars,
  collapse whitespace. It is trusted (a teacher of the class), not sanitized as hostile.

### Frontend
`NoteToTutor` (`features/teacher/console/NoteToTutor.tsx`):
- Props `{ studentId, classId, teacherId }`. `useQuery(["tutorNotes", studentId, classId])` →
  `fetchTutorNotes` (all `visibility='tutor'` rows, newest first).
- **Active note** card: the text, *"since 4 Sep · you"*, a **Clear** button (`clearTutorNote` sets
  `cleared_at`). Below it a collapsed `<details>` **"Earlier notes"** with cleared ones.
- **Composer**: textarea (500 cap with a mono counter), button **"Send to the tutor"**; sending
  clears the current live note and inserts the new one (two writes; the partial unique index is
  the safety net — on a conflict, surface the error, never silently overwrite).
- Copy under the composer, one line: *"The tutor follows this on every turn Ahmed takes in this
  class. He never sees it."*
- Mounted at the bottom of `StudentDetail`'s transcript tab (`:287-524`), above the existing
  private/student-visible Note panel. R111 moves it to the review surface unchanged.
- `CognitionPanel`: under the reading paragraph, a `<button>` *"Write a note to the tutor →"*
  that calls `onOpenTab("transcript")` (thread a prop from `StudentDetail`).

### The word (LEXICON)
| Word | Means, exactly | Never means |
|---|---|---|
| **Note to the tutor** | An instruction a teacher writes for one student in one class. The tutor follows it on every turn; the student never sees it. | A note to the student ("Note", visibility student-visible), a live tip, a comment. |

"Mode" stays reserved for the mentor's register. The existing "Note" (private / student-visible)
keeps its name; the two are distinguished by *whom they are to*.

## Tests

`test_r109_note_to_the_tutor.py`:
- Migration: the check constraint carries `'tutor'`; `cleared_at` exists; the partial unique
  index has `where visibility = 'tutor' and cleared_at is null`; the view revokes
  anon/authenticated and grants service_role; the view carries the no-links rule; the file is in
  the deploy list.
- Chat: the view read is inside wave 1's `Promise.all` (slice the block, assert the string is
  between the `Promise.all([` and its `])`); `"teacher"` is in `MENTOR_STABLE_PAYLOAD_KEYS`; the
  prompt block exists and contains "teacher wins", "NEVER SAY", "help_ceiling"; the payload
  clamps with a named `TUTOR_NOTE_MAX`; the envelope/persist paths do not mention `teacher.note`.
- Frontend: `NoteToTutor` sends `visibility: "tutor"`; Clear sets `cleared_at`; the student
  client never queries `visibility=tutor` (grep `student/` for `teacher_notes` — only the
  student-visible read at `api.ts:723-733`).
- LEXICON has the word. `PRODUCT_ARCHITECTURE.md:9` no longer claims what was not built — it
  states what is.
- `deno check chat`: still 7.

## Verification

Gate 2–6. Live, read-only after deploy: the view exists and returns 0 rows for every current
student (`select count(*) from tutor_notes_for_lesson`); deployed chat carries the block. The
first real proof is the owner writing a note on a real student and reading the next transcript
for the *change* — there is no student traffic tonight to force it.

## Risks

- The view's join per note is three hops; fine at "rows where a note exists", never run
  otherwise. If a class has hundreds of linked lessons it is still one indexed query.
- A note that contradicts the help policy: the block says the policy ceiling still applies, so a
  teacher cannot write "give them the answers" and get it.
- The stable-prefix cache means a note change takes effect on the *next* uncached turn — the
  first turn after the change re-caches. Say so in the composer copy? No — "on every turn" is true
  from the next turn; leave it.

## Est. 2.5h
