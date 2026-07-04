# Jargon Platform Spec (v4.0 — modes, surfaces, mediation)

Status: canonical. Every v4.0 phase implements against this document. Change this doc first,
code second. (Supersedes the reverted v3.0 PEDAGOGY.md experiment; where that document broke
learning into ten fine-grained pedagogical blocks, this one fixes a smaller, closed vocabulary
of eight conversational MODES and redesigns the surfaces around them.)

Written 2026-07-04 on the v2.1 tutor base.

---

## 1. What the platform is

One sentence: **teachers build lessons from a small set of modes, students live them in a
conversation, and the platform mediates — tracking, adapting, and keeping both sides honest.**

Three systems, one contract:

- **Building** (teacher-centric): compose lessons from mode elements — manually, from org-shared
  templates, or with the AI drafter. Edit at scale: units → lessons → stages.
- **Delivering** (student-centric): everything happens in the chat window; navigation, progress,
  grades, and work orbit it.
- **Adapting** (the platform): every mode outcome is recorded with its mode dimension, feeding
  proficiency, strengths/weaknesses, revision scheduling, and teacher attention (the hotlist).

Design invariants carried over from v2.x (non-negotiable):

- Deterministic gates own progression; the LLM leads conversation *within* a step, never grades
  its own completion. Any LLM verdict unverified by execution caps below the "secure" mastery
  tier (0.8 < 0.85).
- A step with `mode = null` behaves **byte-identically** to today — the legacy derivation
  (`response_mode` + quiz-row presence) remains the fallback forever within v4.0.
- Additive-only schema; idempotent migrations appended to the deploy workflow's hardcoded list.
- A real student is live: every phase ships independently and is behavior-safe by default.

---

## 2. The eight modes

The closed vocabulary. A lesson is an ordered flow of steps; each step is exactly one mode.
`lesson_activities.mode` (DB-checked to these eight values) + `lesson_activities.mode_type`
(validated in `curriculum-admin`, not the DB, so types can grow without migrations).

| Mode | The student… | Gate (what completes the step) | Mentor directive intent | Evidence written | Types (`mode_type`) |
|---|---|---|---|---|---|
| **explanation** | receives information | acknowledge: next contentful student turn (or explicit continue) sets `acknowledged_at` | DELIVER the content plainly — this mode alone lifts the "never state conclusions" rule | `mode='explanation'`, ungraded presence row | — |
| **media** | studies source material | acknowledge, after the placed resource card is presented; writes a `resource_interactions` row | pin + frame the attached resource; point at the card, never paraphrase it away | `mode='media'`, ungraded | — |
| **reflection** | discusses the idea in their own words | `checkUnderstanding` grader `demonstrated=true`, or stuck-cap (attempts ≥ 4) | Socratic; student produces the conclusion (unchanged v2.1 behavior) | graded, `mode='reflection'` | — |
| **practice** | uses the information | `code`: engine run gate (+ capped semantic judge). `applied`: understanding gate with apply-don't-restate framing | lightest help that unblocks; never the answer | graded, `mode='practice'` | `code`, `applied` |
| **assignment** | commits to out-of-chat tasks | acknowledge in-chat; real completion enforced by the existing fail-closed checkpoint gate at lesson completion | frame the task, point at the dock | `mode='assignment'`, ungraded (checkpoint records own the grade) | — |
| **inquiry** | asks questions | acknowledge after ≥ 1 answered question (`question_count` in step_state) | invite questions on the topic; answer directly | EVENT rows (see §3) + step presence | step: — · events: `confusion`, `curiosity` |
| **assessment** | proves grasp | `mcq`: deterministic choice match. `open_ended`: understanding grader in strict mode — no hint ladder, records a miss and advances after stuck-cap (mirrors quiz-miss) | evaluate, don't teach; brief targeted feedback | graded, `mode='assessment'` | `mcq`, `open_ended` |
| **revision** | recalls prior material | understanding gate over the lesson's `skill_keys`, weakest first (Phase 4) | quiz recall of prior skills; constrained to skill keys + tier labels, never invented history | graded, `mode='revision'` | `recall` |

Relabel vs new (implementation honesty):

- **Pure relabels** (zero runtime change): reflection, practice/`code`, assessment/`mcq`.
- **New-lite** (existing machinery, new directive/gate wiring): media, assignment, inquiry step,
  practice/`applied`.
- **New runtime**: explanation (acknowledge gate + content-delivery directive), assessment/
  `open_ended` (strict grading path), revision (Phase 4).

### Step-state additions (jsonb; no migration)

`learning_sessions.step_state` gains `acknowledged_at` (monotonic, like every pass timestamp)
and `question_count`. The acknowledge gate must be monotonic — the soft-lock/fast-skip failure
mode is the riskiest part of Phase 1.

### Backfill rule (requirement-equivalence; provably zero behavior change)

- `response_mode='code'` → `practice`/`code`
- `response_mode='multiple_choice'` OR bound published quiz → `assessment`/`mcq`
- `response_mode in ('text','file')` → `reflection` — including teach-stage text steps.
  Relabeling a step to `explanation` CHANGES its gate, so it is always a deliberate teacher
  edit, never automatic.

`activity_type` is kept (additive-only), derived from mode on write in `upsert_step`, and
documented as deprecated. Never dropped in v4.0.

---

## 3. The evidence contract (adaptation's raw material)

`learning_evidence` gains `mode` + `mode_type`, stamped at write time by the runtime. Historic
rows are backfilled via a `teaching_move` → mode lookup (run-gate keys → practice, quiz keys →
assessment, understanding keys → reflection); ambiguous rows stay null and read as "legacy".

**Inquiry events** are the one mode recorded outside step gates: whenever intent/help detection
fires on a student turn, an evidence row `mode='inquiry'` is written with
`mode_type='confusion'` (detected) or `'curiosity'` (v1 heuristic: question-shaped turn, not
confusion-matched, not a gate answer — logging-only, never gating, explicitly low-confidence).
This is what makes "asks when confused vs asks out of curiosity" a trackable strength later.

Proficiency reads stay as today (per-skill mastery tiers) until Phase 4, which adds per-mode
strengths/weaknesses views for student (profile popup) and teacher (StudentDetail breakdown).

---

## 4. Templates (org-shared)

`lesson_templates`: an organization-scoped snapshot of a lesson's flow.

- `steps` jsonb — versioned snapshot array (`v` key): `{position, title, mode, mode_type,
  prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys,
  pass_score}`.
- `meta` jsonb — lesson policy snapshot (`tutor_tone`, `tutor_pace`, `help_ceiling`,
  `require_attempt_first`, `final_answer_policy`, `grade_band`).
- Snapshot by value, deliberately: templates never drift with their source lesson;
  instantiation is a lesson stub + step fan-out through the existing `upsert_step` internals.
- RLS: org members read; teachers/org admins write.
- AI interplay: the step drafter accepts an optional `template_id` — the template is the
  scaffold (modes, order, gates), the AI fills prompts for the new topic.

---

## 5. The hotlist vocabulary (teacher attention)

Seven item kinds. Phase 2 derives them client-side from data already fetched; Phase 5 makes
them rows in a `notifications` table with **exactly these `kind` values**, so the feed upgrade
is a data-source swap:

| kind | source |
|---|---|
| `submission_to_grade` | ungraded assignment submissions |
| `assessment_to_review` | submitted assessment attempts awaiting review |
| `alert_open` | open `intervention_alerts` |
| `session_risk` | sessions in `needs_retry` / `needs_rescue` |
| `live_now` | active session with a turn in the last ~5 minutes |
| `due_soon` | checkpoints due within 7 days |
| `mentor_recommendation` | `mentor_recommendations` (write-only today; finally read) |

Item shape: `{kind, title, ts, href, classId}` (+ `read_at` once persisted).

---

## 6. Class scoping (student catalog rule)

New `class_courses` link table (class ↔ course, unique pair; students read own-class rows,
teachers/org admins manage). The catalog rule, with the no-break fallback:

> If the student has ≥ 1 active class membership AND those classes have ≥ 1 `class_courses`
> row → published lessons filtered to those courses. **Otherwise: exactly today's global
> published list.**

Scoping is UX, not a security boundary (the `lessons` read policy stays open in v4.0;
tightening is deferred so the live student can never be cut off by a policy change).

---

## 7. Surface IA (kept design system; layouts/IA only)

### Student — the chat window is the center
- **Profile popup** (header): settings, mentor characteristics (relocated Mentor panel; the
  teacher-set policy knobs surface read-only — free-text system prompts are deferred), and
  stats: lesson progress, grades (checkpoint results), proficiency tiers, `student_visible`
  teacher notes (exist today, shown nowhere — fixed in Phase 3).
- **Progress bar**: current-lesson pill (exists) + hover dropdown gains previous/upcoming
  lessons.
- **LMS nav**: the current Subject▸Unit▸Lesson dropdown stays; it gains an "Open class view"
  button → class menu (a card per membership) → class dashboard (unit cards, recent/upcoming
  work WITHOUT the current-lesson-only dock filter, grades summary) → unit view (per-lesson
  real progress, assessment reviews with teacher comments/grades).
- **Calendar** (Phase 5): all past/upcoming assignments + assessments over `checkpoints` dates.

### Teacher — attention first, then scale
- **Landing**: hotlist feed on top (replaces the 3-count "Needs attention" card), class cards
  below (exist), profile menu only (persistent unread badge arrives with Phase 5).
- **Class view**: work overview (submitted/recent/upcoming from unified checkpoints), "Live
  now" strip (promoted entry to the existing watch-live flow), risk signals, and the editor.
- **Editor at scale**: the curriculum studio pattern (outline → detail pane → step cards) with
  the step editor as a MODE picker; AI assistant, mentor settings, publish/preview ambient at
  the lesson level. Assignment/Assessment builders stay separate in v4.0 (unified read only).
- **Settings** (Phase 5): profile + report generation / export (reusing admin-ops report and
  snapshot actions, re-scoped for teachers).

### Admin
Existing six tabs stay; Phase 5 adds a "Live" fleet view of active sessions and richer usage
monitoring. Import/export and class CRUD already exist.

---

## 8. Phase map

- **P0** — this document (+ DECISIONS entry). Docs only.
- **P1** — mode foundation: columns + backfills, runtime mode branch with null fallback,
  acknowledge gate, mode directives, open-ended assessment, inquiry event logging, studio mode
  picker, evidence stamping.
- **P2** — teacher build system: hotlist v0 (derived), `lesson_templates` + save/instantiate +
  AI-from-template, Live-now strip, unified work overview.
- **P3** — student class scoping + LMS shell: `class_courses` + fallback catalog, profile
  popup with real stats, classes → dashboard → unit view, localStorage → `student_settings`.
- **P4** — adaptation I: revision mode live, per-mode strengths/weaknesses surfaces,
  review-due chip.
- **P5** — platform layer: `notifications` table (hotlist kinds), student calendar, admin live
  monitoring, teacher reports/export.

## 9. Deferred (explicitly not v4.0)

Visual redesign · student↔teacher mini chat (comms/moderation surface of its own) ·
per-material comment sections · real-time push · `lessons` RLS tightening · merging the
Assignment/Assessment builders · platform-generated ad-hoc revision sessions
(`learning_sessions.lesson_id` is NOT NULL) · LLM inquiry tagging (heuristic first) · dropping
`activity_type` or the legacy work tables · student-editable mentor system prompt (safety
review of its own).
