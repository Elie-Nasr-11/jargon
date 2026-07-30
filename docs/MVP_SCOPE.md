# MVP Scope — Authoritative Keep/Cut Inventory

Status: canonical for the MVP strip-down pass (product-owner decisions, 2026-07-30).
This branch (`claude/project-scope-mvp-o7ox0y`) contains ONLY what this document keeps.
`main` remains the full archive — nothing is lost, it is just not on this branch.

Owner decisions this encodes:
1. No live users; everything is free to change.
2. The MVP branch keeps only surviving code (cut = removed from this branch, archived on main).
3. Student chat gets seven student-facing modes: **open, lesson, practice, discuss, quiz,
   assessment, resources** (resources debatable — shipped as the elevated launcher first).
4. Teacher keeps: lesson authoring with the AI drafter (studio-lite), formal assessments,
   resource upload.
5. A small multi-subject demo catalog is added.
6. Memory v1 = per-session summaries + rolling narrative profile, prompt-fed, student-visible.
7. Voice is in the MVP with the best available server voices.
8. Entry story = seeded demo logins.

Legend: **KEEP** (as-is or light touch) · **REWORK** (survives, changes shape) ·
**CUT** (removed from this branch) · **BACKEND-ONLY** (stays in repo/deployed, no frontend).

---

## 1. Frontend routes (`frontend/src/routes/`)

| File | Decision | Notes |
|---|---|---|
| `__root.tsx` | KEEP | Shell/error boundary. |
| `index.tsx` | KEEP | Role redirect. |
| `login.tsx` | REWORK | Demo-login affordance added (task 10). |
| `chat.tsx` | REWORK | The student app. Gains the 7-mode model, review reconnection, memory panel hooks, seam fixes. Loses MaterialComments mounts, `lesson1` fallbacks, mock-era copy. |
| `platform.tsx` | KEEP | 20-line alias of admin for platform admins; `roleHome` targets it. |
| `admin.tsx` | REWORK | 7 tabs → 3: **Seeding**, **Live**, **Cost & runtime**. Readiness, School data, Integrations (Google/Canvas/CSV/CampusLive), Operations are CUT. |
| `teacher.tsx` / `teacher.class.$classId.tsx` / `teacher.class.$classId.student.$studentId.tsx` | KEEP | Thin mounts of TeacherConsole. |
| `teacher.curriculum.tsx` | REWORK | Studio-lite: keeps outline tree, StructureDetail, LessonDetail, LessonMetaForm, StepCard (8-mode picker + resource/artifact binding), AI outline/steps panels + AiReferenceInput, ArtifactGeneratePanel, LessonPreview. CUTS TemplatePicker + save-as-template, course-version surface, vestigial `publishing` state. |
| `routes/README.md`, `routeTree.gen.ts`, `router.tsx`, `main.tsx`, `styles.css` | KEEP | Regen route tree after route changes. |

## 2. Student features (`features/student/`)

| File | Decision | Notes |
|---|---|---|
| `shell/AppSidebar.tsx` | REWORK | Keeps Tutor chat / Classes / Overview + lessons list; gains mode-aware chrome. (Voice needs no restoration — always-on by design with best server voices.) |
| `shell/studentViews.ts` | KEEP | |
| `panels/PulsePanel.tsx` | REWORK | Activity feed becomes notifications-only (DM feed removed); stale `ProfilePanel`/`MessagesPanel` comments cleaned; gains "What your mentor remembers" (memory v1) and review-due surface. |
| `panels/ClassesGrid.tsx` | KEEP | |
| `panels/ClassCanvas.tsx` | REWORK | Discussion section (EntityComments) removed; rest kept. |
| `panels/AgendaCalendar.tsx` | KEEP | |
| `chat/ChatStepper.tsx` | KEEP | Promoted as the visible lesson spine in the coherence pass. |
| `GradesPanel.tsx` | KEEP | |
| `MentorControls.tsx` | REWORK | Gains the mode surface it always lacked (MentorMode wiring folds into the 7-mode model or is dropped — see §8); voice settings return. |
| `QuizPanel.tsx` | KEEP | The formal-assessment surface ("assessment" mode entry). |
| `lessonGroups.ts` | KEEP | |

## 3. Comms (`features/comms/`) — CUT

`DmThread.tsx`, `EntityComments.tsx`, `MaterialComments.tsx`: **CUT** (frontend removed;
`dm_*`, `entity_comments`, `material_comments` tables and their flags stay BACKEND-ONLY,
inert). Mounts removed from PulsePanel, ClassCanvas, chat.tsx ResourceCard, and the
teacher Messages tab.

## 4. Teacher features (`features/teacher/`)

| File | Decision | Notes |
|---|---|---|
| `shell/TeacherShell.tsx`, `shell/TeacherSidebar.tsx`, `shell/teacherNav.ts` | KEEP | Already minimal and good. |
| `TeacherConsole.tsx` | REWORK | The big strip. **Keeps:** Home hero + class cards + HotlistFeed; class Overview (live-now strip + work tiles); Students (roster cards, GradebookTable, AssignmentGrading, AssessmentGrading); Structure (ClassStructurePanel, LinkedCoursesPanel, slim ResourceManager, AssignmentManager, AssessmentManager); StudentDetail with Overview + Transcript & notes tabs, watch-live / pause-resume / live tips, report-free. **Cuts:** fleet metric row, pilot-readiness block, ClassAnalyticsPanel + `riskSignalsForClass` + mastery heatmap (hotlist is the one attention system), LessonProgress grid (gradebook is the progress view), Records tab, Messages tab, progress-report generation + past-reports JSON + CSV snapshot export, ALL `intervention_alerts` UI (no writer exists anywhere — provably dead). |
| `ClassOverview.tsx` | KEEP | |
| `HotlistFeed.tsx` | REWORK | Drop the dead `alert_open` kind; keep the six with real sources. |
| `AssignmentGrading.tsx`, `AssessmentGrading.tsx` | KEEP | |
| `ClassStructurePanel.tsx`, `LinkedCoursesPanel.tsx` | KEEP | Needed for the multi-course demo catalog. |
| `StudentReviewSessions.tsx` | KEEP | Becomes meaningful once practice mode reconnects reviews. |
| `TeacherStudentMessages.tsx` | CUT | Comms UI removal. |
| `classShared.tsx`, `lessonStatus.ts` | KEEP | `unifiedLessonStatus` shares math with the runtime completion gate. |

ResourceManager (inside TeacherConsole) — REWORK to "slim": keep create/edit resource
(upload or external URL, type, visibility, display mode, instructions), keep artifact
rows/promote. **Cut the media-extraction pipeline**: PDF text extraction, page assets,
OCR, transcription, chunk QA (approve/reject/edit/delete). `resource-processing` edge fn
becomes BACKEND-ONLY.

## 5. Shared components (`components/`)

| File | Decision | Notes |
|---|---|---|
| `ArtifactFrame.tsx`, `DeckRenderer.tsx` | KEEP | Core student wow; sandbox invariants pinned by tests. |
| `Composer.tsx` | REWORK | Mode-aware chatbar; mock-era placeholder copy replaced. |
| `ChatStepper` deps: `LessonMilestones.tsx`, `ProgressRing.tsx` | KEEP | |
| `NotificationsMenu.tsx`, `PageShell.tsx`, `RouteLoader.tsx`, `EmptyState.tsx`, `ModalCard.tsx`, `Popover.tsx`, `OverflowMenu.tsx`, `Collapsible.tsx`, `ConfirmButton.tsx`, `Breadcrumb.tsx`, `FocusLock.tsx`, `CodeArea.tsx`, `WorkspaceTabs.tsx`, `ThemeToggle.tsx`, `StateNote.tsx`, `GradientCard.tsx`, `ReadAloudAction.tsx` | KEEP | In active use by kept surfaces. |
| `SettingsMenu.tsx` | CUT if orphaned | Verify importers; the student account popover superseded it. |
| `AmbientCanvas.tsx` | REWORK | Kept but toned down + reduced-motion respect (coherence pass). |
| `ui/*` (shadcn, 46 files) | KEEP | Library code; unused members are inert. |

## 6. Hooks (`hooks/`)

`use-mobile`, `useCoarsePointer`, `useIsTouch`, `usePopoverDismiss`, `useCampusLiveLink`,
`useUndoable` — **KEEP** (all used). `useStudentNavData.ts` — **REWORK**: drop dead
`nextDue` export and stale comments.

## 7. Lib (`lib/`)

| File | Decision | Notes |
|---|---|---|
| `api.ts` | REWORK | Prune after UI strips: Canvas block (~260 ln), Google Classroom (~150 ln), comms (~295 ln), cut admin-ops wrappers (CSV import, exports, retention, consent, readiness), report generation. Keep everything the kept surfaces call, incl. review APIs (`invokeReview`, `completeReviewSession`, `computeReviewDue`, `fetchReviewDue`) which get their UI back. |
| `types.ts` | REWORK | Prune types matching removed API domains. |
| `bot.ts` | CUT | Dead mock mentor, zero importers. |
| `jargon-store.ts` | REWORK | Drop hardcoded `LESSONS`/`lesson1`; keep settings store; voice settings re-exposed. |
| `modes.ts` | REWORK | Gains the student-facing chat-mode vocabulary alongside the 8 step modes. |
| `review.ts` | KEEP | SM-2-lite due queue — reconnected by practice mode. |
| `pdf-extract.ts` | KEEP | Used by AiReferenceInput (studio-lite keeps it). Pipeline-only callers go with ResourceManager slim-down. |
| `artifact-lint.ts`, `artifact-schema.ts`, `code-runner.ts`, `jargon-syntax.ts`, `supabase.ts`, `theme.ts`, `motion.ts`, `format.ts`, `feedback.ts`, `error-page.ts`, `utils.ts`, `subjectIcon.ts` | KEEP | |
| `lovable-error-reporting.ts` | KEEP | Harmless error hook wired in `__root`/main. |

## 8. The seven student chat modes (the new model)

Student-facing, switchable in the chat surface. Mapping to machinery:

| Mode | Backing |
|---|---|
| **lesson** | The existing guided lesson runner. Default. Unchanged gates. |
| **open** | New: free mentor chat, no gates, still lesson-aware context + logged turns. New `chat_mode` field on the typed envelope → a dedicated directive posture in the chat fn. |
| **practice** | The orphaned review loop, reconnected: SM-2-lite due queue (`computeReviewDue`) + guided review (`invokeReview` → `handleReviewRequest` → `review_sessions`). |
| **discuss** | New directive posture: Socratic discussion of the current lesson/topic, no advancement. |
| **quiz** | New directive posture: mentor quizzes on demand over the lesson/skill keys (understanding grader loop; in-lesson checkpoint quizzes unchanged). |
| **assessment** | Entry to pending formal assessments (existing QuizPanel/WorkDock machinery). |
| **resources** | The paperclip launcher elevated to a mode surface (debatable per owner — shipped smallest-first). |

The old `MentorMode` stance (explain/guide/quiz/check/write/challenge — engineered, never
had UI) is superseded by this vocabulary; its remnants are folded in or removed.

## 9. Backend (`supabase/`)

**Migrations (47): ALL KEEP.** Applied to the live DB; additive-only rule stands. New
migrations are added for memory v1 (`session_summaries`, `student_memory`) and demo
content.

**Edge functions:**

| Fn | Decision | Notes |
|---|---|---|
| `chat` | REWORK | `chat_mode` directive postures (open/discuss/quiz), memory v1 read/write, relaxation of the past-session guardrail to memory-backed claims. Fingerprint tests updated in step. |
| `run` | KEEP | |
| `curriculum-admin` | KEEP | Studio-lite still uses structure CRUD + AI generate + artifact generate. Template actions become dormant server-side (kept, harmless). |
| `assessment-admin` | KEEP | Formal assessments are in. |
| `voice-session` | KEEP | Best-voice defaults via env (task 9). |
| `artifact-live` | KEEP | Live mentor-built activities stay. |
| `admin-seed` | KEEP | Demo logins + roster seeding are the entry story. |
| `admin-ops` | KEEP (subset used) | Live sessions + cost dashboard + class CRUD/roster used; CSV/exports/retention/consent actions dormant. |
| `resource-processing` | BACKEND-ONLY | Frontend pipeline UI cut; fn stays deployed, dormant. |
| `canvas`, `google-classroom` | BACKEND-ONLY | Integration UIs cut; fns + scheduled sync stay (sync no-ops without connections). |
| `submission-maintenance` | KEEP | System sweeper, invisible. |

## 10. Root and repo-level artifacts

| Artifact | Decision | Notes |
|---|---|---|
| `engine/` | KEEP | The Jargon runtime. |
| `tests/`, `tools/`, `examples/`, `legacy/examples/` | KEEP | Test suite + corpora. Fingerprint tests updated alongside chat-fn changes. |
| `mentor/` | KEEP | Prompt lineage docs. |
| `docs/` | KEEP | This doc added; HANDOFF/DECISIONS updated per protocol. |
| Root static app: `index.html`, `app.js`, `auth.js`, `config.js`, `editor/`, `runner/`, `assets/` | CUT | The pre-frontend platform; not served by render.yaml (which publishes `frontend/dist`). Archived on main. |
| Root `package.json` | REWORK | Points at frontend build only; kept for Render's build command. |
| `jargon_interpreter.py`, `jargon_examples.py` | KEEP | Import shims used by tests/tools. |
| `IT Frontiers - Book (f).pdf` | KEEP | Source material for the seeded catalog. |
| `render.yaml` | KEEP | |
| `.github/workflows/` | KEEP | `deploy-backend.yml` still targets the old branch — deliberately, so this branch never auto-deploys mid-refactor. Repoint at go-live. |
| `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `README.md` | KEEP | README updated at the end of the pass. |

## 11. Execution order

1. This doc + HANDOFF entry (done in the same commit).
2. Frontend strips: admin → teacher console → studio-lite → student/comms.
3. api.ts/types.ts prune + root legacy removal; tsc/build gate.
4. Chat modes (client + chat fn) with review reconnection.
5. Memory v1 (migration + chat fn + panel).
6. Voice restoration.
7. Demo content + login polish.
8. UI coherence pass.
9. Final verification (tsc, eslint, build, python tests), docs sync, push.
