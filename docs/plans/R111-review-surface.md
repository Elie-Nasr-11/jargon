# R111 — the review surface

## Context

Owner: *"the whole transcript view and thinking view are good for what they are, but they're not
good for what the teacher can DO."* Decision: **one review surface** — every session of the
student, chronological; each student turn carrying its S-level chip and the judge's one-line
note; markers resolved; register labelled; the note-to-the-tutor composer pinned at the bottom;
any turn quotable into it.

What exists (agent report, verified line refs):
- The tab is `StudentDetail.tsx:266` **"Transcript & notes"**, panel at `:287-524`. It has **no
  fetch of its own**: it slices the class dashboard — `dashboard.turns.filter(t => t.session_id
  === selectedSession.id)` (`:130-132`) — and the dashboard reads `learning_turns` with
  `.limit(600)` **across every session of every student in the class** (`api.ts:2352`). On a
  real class the selected session renders partial or empty, with no indication.
- Per turn it renders role · stage · modality pill · time · raw `content` (`:386-418`). Raw means
  the `[[figure:…]]` / `[[material:…]]` markers the student saw resolved show as brackets; the
  register (lesson / practice / discuss) is not shown; there is no per-turn lesson label and no
  cross-session view.
- Controls: session chips (active / completed), live tip input + Send (student sees it; the
  mentor does not), Note textarea + visibility (private / student-visible) + Save, and in the
  header Watch live / Pause mentor.
- The judge's per-response reading lives on the other tab, lesson scope only
  (`CognitionPanel.tsx:608-640`, via the `profile` action).

## Files

- `frontend/src/features/teacher/console/ReviewPanel.tsx` — **new**; replaces the body of the
  transcript tab. The tab keeps the word **Transcript** (LEXICON: no new word; "review" is what
  the surface is *for*, the transcript is what it *is*).
- `frontend/src/lib/api.ts` — `fetchStudentTranscript` (paged, per student), `fetchReviewTurns`
  (the scorer action).
- `frontend/src/lib/markers.tsx` — **new**: the marker → card resolver extracted from
  `student/Transcript.tsx`'s `MessageBody` (`~:594-700`) so both apps render the same thing.
- `supabase/functions/cognition-scorer/index.ts` — new action `review_turns`.
- `frontend/src/features/teacher/console/StudentDetail.tsx` — mounts `ReviewPanel`; the old
  transcript body is removed; Watch/Pause stay in the header; the private/student-visible Note
  panel moves inside `ReviewPanel` below the composer (secondary).
- `tests/test_r111_review_surface.py`; `tests/test_r101_thinking_view.py` (the student_view
  "never a quote" rule must still hold — `review_turns` is a *separate* action).
- `scratchpad/mock_backend.py` (+ `review_turns`, + per-student turns), `walk_r111.mjs`.
- `docs/COGNITION.md` (the two views become "the teacher's two views, and where she acts"),
  HANDOFF, DECISIONS.

## Design

### Data — per student, paged, never the class-wide cap
`fetchStudentTranscript({ studentId, before?: string, limit = 150 })`:
```
learning_turns?select=*,learning_sessions!inner(id,lesson_id,user_id,created_at,status)
  &learning_sessions.user_id=eq.<studentId>&order=created_at.desc&limit=150[&created_at=lt.<before>]
```
Under the teacher's JWT. **Check first, read-only, that the `learning_turns` RLS admits a
teacher via the session's student** (the dashboard already reads `learning_turns` for the class's
sessions, so a policy exists; confirm it is not keyed on `session_id in (…)` supplied by the
client). If it is, add an additive policy using `public.can_view_student(learning_sessions.user_id)`
through a join — in the same migration as nothing else.

"Load earlier" pages backwards by `created_at`. The dashboard's 600-cap read stays for the live
strip only; the transcript no longer depends on it (pin).

### The judge's line — a separate, authorized, listed read
New scorer action `review_turns { user_id, turn_ids: string[] }` (≤ 200 ids):
`assertCanViewStudent`, then `cognition_turn_scores?turn_id=in.(…)&user_id=eq.U&select=turn_id,scaffold_level,note,` + DIMENSIONS.
Returns `{ turn_id, scaffold_level, note, dims }`. **Never** `evidence` or `signals` — the
quotes are the student's own words, already on screen; the signals are §12 underlay. R101's
`student_view` and its "never a quote" pin are untouched; this is a second action with its own
pin. Router: after `fetchCurrentUser`, beside `profile`/`student_view`.

The panel requests it for the turns currently loaded (one call per page), caches per turn id
in React Query, and shows *"not read yet"* under a student turn with no row.

### Render
Chronological, oldest at the top, newest at the bottom (a transcript reads downward; "Jump to
latest" on load).

- **Session divider** between sessions: `Lesson title · 3 Sep, 14:10 · 14 turns · 32 min`
  (from `learning_sessions` + first/last turn). Lesson title via `lessonsById`.
- **Turn row**: role tone as today (student right in ink, mentor left on depth-sub, teacher
  live tips as the info bubble); a register label when the turn's `payload.flow?.register`
  (or `turn_mode`) is not `lesson` — `practice` / `discuss` in the mono micro-label voice; the
  modality pill; time on hover.
- **Body**: through `markers.tsx` — figures and materials become the same compact cards the
  student saw; `[[action:…]]` pills render as their label, inert. No raw `[[` ever (pin).
- **Under each student turn**: a compact strip — the `S{n}` chip (the existing chip style from
  `CognitionPanel.tsx:608-640`) + the judge's `note` in one line; or *"not read yet"*. Clicking
  the chip expands the eight dims as pips (no evidence quotes — the answer is right there).
- **Quote in note**: a small `<button>` on every turn → prefixes the composer with
  `> "<first 140 chars>"` on its own line. The rubric's §8 evidence, written by the teacher.
- **Composer**: R109's `NoteToTutor`, `position: sticky; bottom: 0` inside the panel, above the
  secondary private/student-visible Note panel (kept, collapsed by default).
- Empty state: *"No lesson work yet."* — as today.

### Removed
The session-chips-then-one-session model. The `dashboard.turns.filter(...)` slice. The raw
`content` render.

## Tests

`test_r111_review_surface.py`:
- The transcript tab does not read `dashboard.turns` (grep `ReviewPanel` + the tab's body for
  `dashboard.turns` — absent); `fetchStudentTranscript` filters on `learning_sessions.user_id`
  and has no `.limit(600)`; paging is by `created_at`.
- `review_turns`: is a read (no POST/PATCH to tables); resolves a person first (router order
  pin, the R92 shape); its select names no `evidence`/`signals`; caps `turn_ids` by a named
  constant; `student_view`'s select is unchanged (the R101 pin stands).
- `markers.tsx` is imported by both `student/Transcript.tsx` and `ReviewPanel.tsx`; the teacher
  render path has no raw-marker fallback that prints brackets.
- The register label reads `flow.register`/`turn_mode`; the S-chip strip renders from
  `review_turns` data only; "Quote in note" writes into `NoteToTutor`'s draft (a shared
  `draftRef`/prop).
- Mock walk (1440 + 390): two sessions render with a divider; a mentor turn with a figure
  marker shows a card, not brackets; a student turn shows `S2` + a note; "Quote in note" fills
  the composer; `scrollWidth === innerWidth`.

## Verification

Gate 2–6, deploy (scorer changes → version bump; read back for `review_turns`). Live,
read-only: the owner opens a real student's Transcript — every session listed, S-chips present
on scored turns, no brackets. The 600-cap bug is only visible on a class with >600 turns; the
fix is structural and pinned rather than demonstrated live tonight.

## Risks

- RLS on `learning_turns` for a teacher-side per-student read — verify before coding; the
  fallback policy is additive.
- Extracting `MessageBody`'s resolver touches the student transcript — the R33/R32 pins on
  `Transcript.tsx` (marker stripping, no re-animation) must all still pass; the extraction is a
  move, not a rewrite.
- Payload size: 150 turns × full `payload` jsonb can be large; select only the columns rendered
  (`id, session_id, role, stage, content, created_at, payload->flow, payload->input_modality,
  payload->figures`) once the shape is confirmed.

## Est. 3.5h
