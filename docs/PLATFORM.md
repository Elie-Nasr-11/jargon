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

Seven item kinds. Phase 2 derives them client-side from data already fetched; Phase 5 makes them
rows in a `notifications` table with **exactly these `kind` values**, so the feed upgrade was
intended as a data-source swap.

> **As-built note (2026-07-05):** P5 shipped the `notifications` table + a persistent teacher bell
> (unread badge + dropdown) as an ADDITIVE surface alongside the derived hotlist — NOT the swap.
> Exploration found only 2 of the 7 kinds have clean server-side writers (`mentor_recommendation` in
> chat — later removed because chat runs under the student JWT with no service-role key; and
> `assessment_to_review` in assessment-admin, the one live writer). `submission_to_grade` is
> client-side; `intervention_alerts` has NO insert site anywhere (that kind is already dead);
> `session_risk` / `live_now` / `due_soon` are DERIVED state, not events. So `HotlistFeed` still
> derives all seven client-side, and the bell carries `assessment_to_review` only. The full
> data-source MERGE (not swap) remains deferred until the missing writers exist — see
> `docs/OPEN_QUESTIONS.md`.

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

`class_courses` link table (class ↔ course, unique pair; students read own-class rows,
teachers/org admins manage). The catalog rule — **strict class-first since R43**
(owner decision, docs/DECISIONS.md 2026-08-18):

> If the student has ≥ 1 active class membership → published lessons filtered to the
> UNION of their classes' `class_courses` links (an unlinked class contributes nothing —
> the class curriculum IS the catalog). No memberships (self-serve accounts) or any read
> error → the full global published list. The student's currently-open lesson is always
> retained even if scoped out.

The pre-R43 inversion ("an unlinked class imposes no scoping") is retired; classes that
existed unlinked were backfilled with links to every published course in their org at the
flip, so no live student's list changed. Scoping is UX, not a security boundary (the
`lessons` read policy stays open in v4.0; tightening is deferred so the live student can
never be cut off by a policy change).

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

Visual redesign · `lessons` RLS tightening · merging the Assignment/Assessment builders ·
dropping `activity_type` or the legacy work tables · student-editable mentor system prompt
(safety review of its own) · true OS/web-push (service worker + VAPID; in-app realtime shipped).

DONE since (moved out of "deferred"):
- **Student↔teacher mini-chat + per-material comments + real-time push** — SHIPPED as four additive,
  adversarially-reviewed, per-class-flag-gated slices (a live minor is on the platform, so everything
  ships behind a feature flag defaulting OFF and rides the held main FF). (1) In-app realtime bell:
  `notifications` added to the realtime publication; the bell lights instantly instead of polling.
  (2) Hardened messaging/comment foundation: `dm_channels`/`dm_messages` (1:1 validated by a distinct
  active student+teacher `is_dm_pair`, avoiding the `can_view_student` self-trap) + `material_comments`
  (2-level, mandatory `class_id` anchor gated by `is_class_member`, no cross-class leak). Post-
  moderation, RLS-ENFORCED hide + author soft-delete + service-only retention purge, with BEFORE-UPDATE
  guard triggers freezing body/identity and preventing an author from un-hiding a moderated message.
  (3) Mini-chat UI: student header popover (live unread dot) + teacher Messages tab (self-serve enable
  toggle + moderation) + `list_my_teachers()` discovery helper + a best-effort `direct_message` notify
  trigger. (4) Per-material comments UI under the ResourceCard. Deferred within this arc: true OS/web-
  push (in-app realtime covers tab-open delivery), and a teacher comment-moderation UI surface (the RLS
  already permits it). See DECISIONS 2026-07-06.
- **Platform-generated ad-hoc revision sessions** — SHIPPED post-v4.0 P4b/P5, but NOT via the
  `learning_sessions.lesson_id` relaxation feared here: a greenfield `review_sessions` table + an
  isolated `review:true` chat-fn handler (the live turn loop never reads it). See DECISIONS 2026-07-06.
- **LLM inquiry tagging** — SHIPPED (§9 pick). The mentor now classifies the student's turn as
  confusion/curiosity in its own JSON output (a free piggyback on the turn call — no extra model
  round-trip), preferred over the loose `isQuestionShaped` regex, which survives only as the
  no-mentor-tag fallback. Confusion stays broad (mentor OR the deterministic detectors). Still
  logging-only (`learning_evidence` mode='inquiry'); feeds the teacher's confusion-vs-curiosity split.

---

## 10. v5.0 addendum — the turn-level mode axis

Status: canonical for v5.0. §2's eight modes are UNCHANGED by this section.

v4.0 had one thing called "mode": `lesson_activities.mode`, a property of a **step**, answering
*what finishes this step?* It feeds `stepRequirements()` and therefore the deterministic gates.

v5.0 adds a second, independent axis: a **student-declared turn mode**, a property of a **message**,
answering *what am I doing right now?* The student picks it from the chatbox — `lesson` (default),
`practice`, `discuss`, `quiz`, `assignment`, `open`. (`checkpoints` appears in the selector but is a
view-only surface that opens the work dock and never sends a turn.)

These do not compete. A step authored as `assessment` stays an assessment while the student asks a
question about it in `discuss` and then answers it in `quiz`.

### How it preserves the progression invariant

§1 requires that deterministic gates own progression and the LLM never grades its own completion.
Student-chosen modes threaten that only if a mode can talk past a gate. It cannot, because:

- The declared mode sets a **ceiling** on what a turn may discharge; the Flow v3 router still
  classifies *within* that ceiling. The ceiling restricts, it never relabels — otherwise declaring
  `practice` would turn a mid-practice question into a graded failure.
- `discuss` and `open` are capped to a conversation kind, which `applyTurn` already refuses to
  grade. No new gate logic and no second guard: `applyTurn` remains the only writer of the four gate
  timestamps in the turn path (`loadStepState`'s one-time v2 backfill is the only other writer, and
  is not on the turn path).
- Explicit control turns (Continue, navigate) bypass the ceiling deliberately. A button press is
  intent, not conversation.
- Absent or unrecognized mode → v4.0 behavior exactly, the same defensive posture as
  `routedKind === null`.

### What v5.0 P2 deliberately does NOT do

Rebuild the authored eight. The two axes serve different purposes, and remapping live curricula
(Book F alone is 106 activities) buys nothing the turn-level axis doesn't already deliver. Whether
the eight still fit is an open question to revisit after the selector has been used — see
OPEN_QUESTIONS.

---

## 11. v6 addendum — the Claude engine, the north star, and the conversation contract

Status: canonical as of 2026-08-12 (live in production). §2's eight modes and §10's turn-mode
axis are UNCHANGED by this section. Everything here is engine, prompt posture, and surface
contract — the deterministic spine of §1 is untouched and remains the reason any of it is safe.

### 11.1 The engine is Claude, and it is swappable

`TUTOR_PROVIDER` defaults to `anthropic`. Two routes, unchanged in shape from v2.0:

- **Conversation** (`claude-opus-5`) — writes every word a student reads.
- **Understanding** (`claude-haiku-4-5`) — the router, the understanding grader, the code-objective
  judge, the running summarizer, the session-memory writer. Pinned cheap on purpose: flipping the
  conversation model must never silently make the high-volume graders expensive.

Operational properties, all env-tunable (see BACKEND_DEPLOYMENT):

- **Missing-key fallback.** If the resolved provider has no API key but the other does, the gateway
  falls back and logs once. A deploy is never one unset secret away from a dead tutor.
- **Provider-aware model resolution.** A model pinned for one provider's family can never ride the
  other's API; it falls back to that provider's route default instead of 404-ing every turn.
- **Prompt caching.** The static system prompt and the step-stable half of the turn payload carry
  cache breakpoints. The mentor payload therefore ships as TWO text blocks — stable context first
  (lesson/activity/milestone/arc/resources/figures/quiz/chunks/knowledge), live turn state second
  (student/history/turn/directive) — same key paths, partitioned serialization. Measured live: after
  a step's first turn, ~93% of input reads from cache, ~9x cheaper per turn.
- **No sampling parameters.** Current Claude models reject them, so conversational variety comes
  from DATA the model can check — `student.recent_openers` and a widened `student.recent_questions`
  window — not from temperature. Rules the model cannot verify are aspirations; rules with data
  attached are constraints.
- **Bounded retries** on 429/5xx/529, **refusal and truncation** surfaced as ordinary faults (the
  student sees the calm line, operators get the real cause), and a **malformed-JSON salvage**: if the
  envelope fails to parse but prose already streamed, that prose IS the turn rather than an error.

The invariant this preserves: **Jargon's value lives in the governance layer, not in a model.** Any
provider swap must leave gates, evidence, and mastery untouched — as this one did.

### 11.2 The north star replaces guardrail-first prompting

`SYSTEM_PROMPT` opens with a destination, not a fence: carry THIS student to the lesson's learning
objectives, genuinely reached and said in their own words, by whatever honest teaching serves —
examples from the student's own world, bridges to other subjects, analogies from outside the lesson.
The material is the path, never a cage.

The integrity rails are restated INSIDE that preamble as *what the destination requires*: work the
student must produce is never handed over, what they didn't show is never credited, the teacher's
help policy always holds. Reframing direction must never read as loosening grading.

Deliberately additive: the rule text below the preamble is unchanged in this pass. Prohibition
clusters convert to positive direction one at a time, each A/B-ed against real transcripts, so a
teaching regression can never hide inside a large rewrite.

### 11.3 The conversation contract (student surface)

Smoothness is a contract, not a polish pass. The turn loop guarantees:

- **The send lock holds until the reply SETTLES**, not until the network returns. A reply paces out
  over seconds; releasing early let a second send scramble transcript order, revive retired quiz
  choices, and fork a duplicate session on a lesson's first turn. The session pointer, by contrast,
  lands the instant the envelope arrives.
- **Nothing raw reaches a student.** Inline markers (`[[material:…]]`, `[[figure:…]]`,
  `[[action:…]]`) are stripped from streamed text, including a partially-formed marker at the
  stream's edge; they resolve to cards at settle.
- **Text already read never re-animates.** A settled reply that replaced streamed text skips the
  entrance animation.
- **A failed stream keeps what was written.** Partial prose stays in the bubble with Retry, and
  Retry re-sends in the register the turn was originally sent in.
- **The composer stays typeable during a turn** — only Send/Run are gated. A teacher hold is the
  one hard lock.
- **Scrolling never fights the stream**: instant during streaming repaints, animated only for new
  messages, with a "Jump to latest" affordance whenever the student has scrolled up.

Pacing constants live in `useConversation` (sentence release ~150ms/word, holds clamped 0.35–2.5s)
and exist to make a reply readable, never to simulate typing.

### 11.4 Artifacts are keepable

Every generated artifact is a file the student can take away. Decks export as one self-contained,
print-ready HTML handout (print → PDF), speaker notes included. Interactive sims download as their
own document behind the SAME safety lint that gates running them — a document the sandbox refuses to
run is a document the platform refuses to hand out, since a downloaded file opens with no sandbox.
Both record the existing `downloaded` resource-interaction event.

### 11.5 My Jargon

The student's collected vocabulary, on Home: every term the MENTOR has introduced (a word counts as
met when it is taught, never when the student happens to type it), its child-readable definition, its
home subject, and a bridge marker once the word has traveled into a second subject. Fed by
`student_vocab`; refreshed whenever a turn teaches a new word.

### 11.6 Knowledge drafts itself at publish

Publishing a lesson with no knowledge rows schedules `extract_knowledge` in the background: learning
objectives, vocabulary, curriculum links, and practice items drafted from the lesson's own material.
Unchanged hard rules — **drafts only**, teacher review in the studio Knowledge tab gates everything a
student sees, re-publishing never duplicates, and a failed extraction never fails the publish.

### 11.7 Project assist

When a student wants to PREPARE something from the lesson — a presentation, essay, speech, poster —
the mentor co-builds it: the student says what each part should claim, the mentor structures,
sharpens, and keeps it lesson-accurate, and the settled outline lands in one keepable message. An
outline they assembled beats a draft they copied.

A presentation/slides ask additionally flips the consent-first build offer (§P8) from an interactive
sim to a **deck** ("Build these slides"), which the student downloads via 11.4. Offer eligibility,
caps, and the `allow_live_artifacts` teacher flag are unchanged — the co-build conversation works
everywhere; the one-tap build waits on the flag.

### What v6 deliberately does NOT do

- **Move grading to the model.** Deterministic gates still own progression; an LLM verdict
  unverified by execution still caps below the secure mastery tier.
- **Move voice to Anthropic.** Realtime speech and media transcription stay on OpenAI — there is no
  Anthropic realtime speech API. `voice-session` and `resource-processing` are untouched.
- **Rewrite the authored eight** (§2) or the turn-mode axis (§10).
- **Auto-enable live artifact builds.** `allow_live_artifacts` remains teacher-owned and defaults
  off; whether project decks deserve their own defaulted-on flag is an OPEN_QUESTION.
- **Remove the OpenAI path.** `TUTOR_PROVIDER=openai` still runs it unchanged.

## 12. Flow rebuild addendum — the flow event log (Pillar 1)

Status: canonical as of 2026-08-15. First slice of the five-pillar flow rebuild (see
DECISIONS 2026-08-15). §10's turn-mode axis and §2's modes are unchanged; this section is
about how flow is RECORDED and RENDERED.

### 12.1 The server writes the flow log

Flow is now a first-class object. Every mentor turn's envelope (and persisted payload)
carries `flow: FlowEvent[]` — one entry per flow fact the turn established, written by the
chat fn at the moment each fact is decided, in the order the student experienced it:

- `mode_changed {from, to, cause}` — the register shifted. Emitted ONLY when a persisted
  student turn declared the new register; `cause` names the student action (`"pill"` for a
  mode_offer control, `"picker"` for the composer).
- `revisit_opened {target_activity_id, target_title}` / `revisit_resumed
  {frontier_activity_id}` — the navigate/resume controls.
- `checkpoint_opened` — a lesson-register quiz FIRST attached (same moment
  `quiz_presented_at` stamps). Practice/discuss drills never emit it (R33c held server-side).
- `step_advanced {to_activity_id, to_title, step, total}` — the session cursor moved.

Absent `flow` = the turn established no fact, or predates the log. `makeEnvelope` passes
stored logs through on dedup replays (unknown kinds dropped, never invented).

### 12.2 The client renders the record

`groupIntoSections` draws section boundaries from the log on flow-bearing turns: checkpoints
come from `checkpoint_opened`, revisit boundaries from the revisit events (the divider now
says "Revisit · Step N/M · title" instead of silently pointing the eyebrow backwards), and a
bare arc diff can never open a section — which is what stopped the section churn. Turns from
before the log keep today's inference unchanged, so old transcripts render exactly as before.

### 12.3 The register-shift invariant

The mentor turn's `turn_mode` stamp may differ from the previous student register ONLY when
a persisted student turn declared the new one. A declared mode whose turn persisted no
student row (empty body) stamps the register the transcript is actually in — so a replayed
transcript can never open a section that no visible student action started (the
phantom-Discuss bug, root-caused from a live session's DB).

### 12.4 The register has one owner (client) — Pillar 2

The conversation register (`TurnMode`) lives in `useConversation` behind a single
`setRegister(mode, cause)` seam. The causes are the enumerated student-visible actions —
`picker` (the composer), `offer` (a hand-off pill; the flip happens inside
`sendModeOffer`, so the picker move and the control send cannot come apart),
`suggestion` (welcome/re-entry rows), `lesson_open` (reset to the spine, folded into
`openLesson` so no caller can forget it). Nothing else may move it: not an envelope
arriving, not a retry (one-shot override of the send, register untouched), not a
component holding its own copy.

Sends read the register at the owner (`sendText`/`sendCode`/`sendChoice`/`sendVoiceTurn`
take no mode parameter), so the R33c class — a call site threading the wrong mode — is
unwritable. A synchronously-updated ref backs the state so a gesture that sets the
register and sends in the same tick goes out in the register it just chose.

### What Pillar 1 deliberately does NOT do

- **Emit `session_resumed`.** In the approved plan, but it has no renderer yet — shipping it
  would be a dead contract (what Pillar 5 exists to remove). It joins the log when the
  time-gap divider that consumes it does.
- **Change the live-turn register ownership.** The client still stamps the live bot message
  with the mode it sent; unifying the five register writers behind one reducer is Pillar 2.
- **Touch gates.** `applyTurn`/`applyModeCeiling` semantics are byte-identical; the log
  records decisions, it does not make them.

### 12.5 The flow core is executable under test — Pillar 4

`applyTurn`, `deriveTurn`, `applyModeCeiling`, `stepDone`, `requirementsFor`, and
`turnDirective` are exported, and `Deno.serve` is guarded behind
`!Deno.env.get("JARGON_FLOW_TEST")` — so the test harness imports the chat fn itself
and RUNS the spine instead of only pinning its source. `tests/flow_core.test.ts`
(driven from the Python harness by `tests/test_flow_pillar4_properties.py`, skipped
when deno is absent) asserts the invariants the spine promises:

- gates are monotonic and attempts never decrease over random turn sequences;
- only `continue_signal` (or the legacy-null readiness text) discharges the
  acknowledge gate; conversation kinds never stamp presentation or close understanding;
- `deriveTurn` completes iff presented and every required gate is closed; `choose`
  only while the quiz gate is genuinely open;
- the ceiling's mapping, enumerated over every (register, kind) pair;
- every rung of the directive ladder is REACHABLE via a witness vector and keyed as
  documented, fuzzed vectors never leave the known key set, navigation precedence
  holds, and `turnDirective` is pure;
- the readiness recognizers stay a closed class.

Fuzz vectors derive requirements through the real `requirementsFor` coupling — states
the runtime cannot reach are not tested. Pillar 4 was deliberately landed BEFORE
Pillar 3: the ladder-to-table conversion (if still warranted) now happens under a
harness that executes every branch, and the reachability witnesses double as the
"completeness test" that pillar wanted.

### 12.6 Dead contracts are retired — Pillar 5

`continue_offer` is gone end-to-end. R31b removed the Continue button and made typed
readiness the advance verb; the offer field spent two rounds as a wire + transcript-model
contract nothing rendered. Pillar 5 removed the emission, the envelope field, the replay
passthrough, the client model field and restore, and the caller-less `sendContinue`. Old
stored payloads keep the key at rest; it maps to nothing. The `continue` CONTROL is still
parsed server-side — a tab open since before R31b can still send one.

Control turns (resume / navigate / control-retry) now ride the LIVE register instead of a
hardcoded `"lesson"`: the conversation register does not change because a control was
pressed, so the server's REGISTER SHIFT voice nod can no longer fire on a stepper click,
and the live message stamp agrees with what a replay reconstructs under §12.3's rule.
(`sendModeOffer` still declares `offer.mode` — it IS the register change.)
