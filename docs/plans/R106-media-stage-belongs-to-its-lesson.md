# R106 — the media stage belongs to the lesson that raised it

## Context

Owner: *"if I open a PDF or any media in one lesson, and then I switch to the other lesson, that
window of media stays open. It should close."*

This was fixed once (R33b, commit `84cac3a`): `StudentApp.tsx:417-424` closes the stage whenever
`conversation.lesson.id` changes. The fix is correct and **hangs off the wrong signal** — the
lesson id fails to change during three gestures a student calls "switching lessons":

1. **`openLesson` silently no-ops** (`useConversation.ts:689-691`):
   - `if (sendingRef.current) return;` — and the send lock is held **until the paced reply
     settles** (`:856-874`, `:918-923`), many seconds after text is on screen. The tree rows are
     disabled in that window (`LessonTree.tsx:97`) but the Home / class-summary / brain-graph
     open buttons are not (`StudentApp.tsx:908-921`, `StudentHome.tsx:505,647`,
     `ClassSummary.tsx:164,290`, `BrainGraph.tsx:1181,1214`). Worse, `StudentApp.openLesson`
     (`:437-444`) calls `onSelectSection("learn")` *before* the refused switch — the UI jumps to
     Learn while the lesson, and the PDF, stay exactly as they were.
   - `if (!target …)` — `lessonsRef.current` is the boot-time catalog (`:556-566`), never
     refreshed, filtered by linked courses (`api.ts:578-582`); the tree renders `classLessons`
     (`StudentApp.tsx:484`), which returns *every* lesson for an unlinked class
     (`api.ts:902-911`). A lesson in the tree but not in the catalog = silent no-op.
2. **Switching class is not switching lesson.** `ClassSwitcher` (`StudentApp.tsx:460-467`)
   rewrites `?class=` only; `conversation.lesson` is untouched; the effect never fires.
3. **The ref tracks the wrong thing.** `stageLessonRef` records "the last lesson the effect
   saw", not "the lesson that raised the stage".

Structurally: the stage is shell state (`MediaStage.tsx:46`, instantiated once at
`StudentApp.tsx:410`) that does not know which lesson it belongs to. Give it that fact.

## Files

- `frontend/src/student/MediaStage.tsx` — `MediaStageState` gains `lessonId`; the controller
  stamps it at `open`.
- `frontend/src/student/StudentApp.tsx` — render guard; close on class change; `openLesson`
  navigates only on an accepted switch; the lookup covers `classLessons`.
- `frontend/src/student/useConversation.ts` — `openLesson` takes the `Lesson` object (or falls
  back to a lookup the caller supplies), refuses only while a **request is in flight**, returns
  whether it switched.
- Callers: `LessonTree.tsx`, `StudentHome.tsx`, `ClassSummary.tsx`, `BrainGraph.tsx` — pass
  through `StudentApp.openLesson`; only its signature may need the object.
- `tests/test_r33b_tester_fixes.py:36-43` — re-expressed; `tests/test_r106_media_stage.py` — new.
- `scratchpad/walk_r106.mjs` — the mock walk.
- `docs/PLATFORM.md` §11 (one paragraph), HANDOFF, DECISIONS.

## Design

**1. The stage knows its lesson.** `MediaStageState = { resource, mode, lessonId: string | null }`
(`MediaStage.tsx:31-32`). `useMediaStageController(liveLessonId)` — the hook takes the live id
and `open(resource, mode)` stamps `lessonId: liveLessonId` (`:47-55`). No caller changes;
`MediaStageScope` still provides `open/setMode/close`.

**2. Render is guarded, not just reset.** In `StudentApp.tsx`, the layout branch (`:929-967`)
reads `const stage = mediaStage.stage && mediaStage.stage.lessonId === liveLessonId ? mediaStage.stage : null`.
A stale stage can never paint even for one frame. The R33b effect stays as the *cleanup*
(so the resource and its signed URL are dropped), rewritten to the same predicate:
`if (stage && stage.lessonId !== liveLessonId) stageClose()`. Both keyed on `liveLessonId`.

**3. Class change closes it.** A second effect keyed on `scopeClassId`: on change, `stageClose()`.
The previous class's PDF has no business beside the new class's lessons even before a lesson is
picked.

**4. A refused switch does not lie.** `conversation.openLesson(target: Lesson): Promise<boolean>`.
`StudentApp.openLesson(lessonId)` resolves the object from `classLessons ?? catalog` (the tree's
own list, so anything the tree can show can be opened), then:
```ts
const switched = await conversation.openLesson(target);
if (switched) { closeDrawer(); onSelectSection("learn"); }
```
No navigation on refusal; the stage guard makes the close automatic on success.

**5. The lock that refuses is the request, not the reveal.** `sendingRef` stays as the Send
gate (R33: held until settle). A new `requestInFlightRef` is set when the turn's fetch starts and
cleared when the **envelope lands** (the session pointer is committed at that moment —
`PLATFORM.md` §11.3: *"The session pointer lands the instant the envelope arrives"*).
`openLesson` refuses on `requestInFlightRef` only. Switching during the paced reveal is allowed;
`pacerCleanupRef` (`useConversation.ts:348-349, :456, :875-884`) already stops the previous
lesson's reply from settling into the new transcript — that is what
`test_conversation_smoothness_r33.py::test_lesson_switch_kills_the_pacer` pins, and it holds.

## Tests

- **Re-express** `test_stage_closes_when_the_lesson_changes` (pins fragments of the old effect)
  as the rule: the stage state type carries `lessonId`; the controller stamps it at open; the
  render path selects the stage through a `lessonId === liveLessonId` guard; a class change
  closes it.
- **New** `test_r106_media_stage.py`: `openLesson` returns a boolean and `StudentApp` navigates
  only when it is true; the refusal predicate is `requestInFlightRef`, not `sendingRef`;
  `requestInFlightRef` is cleared where the envelope is applied, not where the pacer drains;
  the lookup for a lesson to open includes `classLessons`.
- **Mock walk** (`walk_r106.mjs`, desktop + 390px): open a PDF in lesson A (side) → click lesson
  B in the tree → panel gone, chat shows B. Open in A → switch class → panel gone. Open in A →
  send a turn → during the paced reveal click B from the tree AND from Home → switch happens,
  panel gone, no A text lands in B. Open a lesson that is in the class tree but not the boot
  catalog → it opens.

## Verification

Gate items 2–6. Live: after deploy, the owner reproduces his original gesture; nothing else
here is observable server-side.

## Risks

- `openLesson`'s signature change touches four callers — `tsc` catches every one.
- Allowing a switch during the reveal relies on `pacerCleanupRef` being run on switch; it is
  (`:456`), and the R33 pin holds it.

## Est. 1.5h
