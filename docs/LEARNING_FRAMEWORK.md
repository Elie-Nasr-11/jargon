# The Learning Framework — Ideas, Vocab, Links (Sketch)

Status: BUILT, 2026-08-02 (round 18, F1-F4 in one pass). §6 decisions honored
throughout; this doc is now the reference for how the shipped system works.
Companion to CHAT_FLOW_SCOPE.md (flow, fully shipped) and the memory decisions
(2026-08-01). This doc turns the owner's direction into a buildable shape.

**The owner's direction, verbatim in spirit:** learning is linking ideas together across
subjects, lessons, and classes. Progress — the brain's and the AI's tracking — is mapped
against learning objectives, which ARE ideas. Vocab words build on the brain and link
ideas across subjects. In chat, vocab words appear highlighted; a dropdown notification
delivers the definition; the word maps onto the brain by subject. When a new link is made
(a vocab word used in a different subject, or logic carried from geometry to biology), a
pop animation shows the link forming — and it's visible in the brain view.

## 1. The three nouns

### Idea (= learning objective)
The atomic unit of the knowledge graph and the unit ALL progress is tracked against.

**Two origins, one graph (owner decision 2026-08-02):**
- **Authored ideas** — each lesson carries a PRIMARY idea (teacher/AI-draft-approved).
  These are the progress spine: mastery is tracked against them, and they are the
  guaranteed skeleton every student's brain shares.
- **Emergent ideas** — the brain GROWS from conversation. When a student pushes on,
  reasons about, or names a concept beyond the authored set, the mentor proposes a new
  idea node (a `new_idea` field on the JSON contract, validated/deduped server-side
  against existing ideas exactly like `link` and `misconception`). Emergent ideas are
  STUDENT-SCOPED — they are that student's brain growing, not the curriculum changing —
  and they enrich the graph and can be linked, but do not gate lesson progress. A
  student who thinks more literally grows a bigger brain.

- Today's nearest ancestors: `milestones.objective` (authored per step, prompt-only) and
  `skill_key` strings (`student_mastery`, flat, ungoverned). Neither is first-class.
- Proposed: an `ideas` table — `key` (stable slug, e.g. `ratio-scaling`), `title`,
  `one_liner` (student-readable), `subject`, `grade_band`, `status` (draft/published).
- Bindings: `lesson_activities` ↔ ideas (n:m via `activity_ideas`), replacing loose
  skill_keys as the authored source of truth. **Migration-friendly bridge**: `idea.key`
  adopts the existing `skill_key` vocabulary, so `student_mastery` rows become idea
  mastery with zero rewrites — mastery-by-idea IS the new progress spine.
- Authoring: studio-lite gets an Ideas pass — AI drafts ideas per lesson from the
  existing steps/objectives (same pattern as the AI outline/steps panels), teacher
  approves. Demo catalog gets a seeded idea set.

### Vocab word
A term that names an idea (or a facet of one) and carries a student-facing definition.

- Proposed: `vocab_terms` — `term`, `variants` (plural/inflections for matching),
  `definition` (grade-banded), `subject` (home subject), `idea_keys` (the ideas it
  names), `status`.
- Authored per lesson + a shared cross-subject pool ("model", "ratio", "system",
  "signal" — the words that travel). AI-drafted, teacher-approved, like ideas.
- Student state: `student_vocab` — first_seen_at, first_defined_at (the dropdown was
  shown), used_at (the student used it themselves), subjects_seen (array). "Used in a
  NEW subject" falls out of `subjects_seen`.

### Link
An edge in the graph. Two species, kept distinct:

- **Curriculum links** (authored/derived, student-independent): idea↔idea edges with a
  kind — `prerequisite`, `same_pattern` (the geometry→biology "same logic" edge),
  `contrast`, `vocab_bridge` (two ideas sharing a term). These define what CAN be
  linked. AI-drafted from the idea set, teacher-curated.
- **Student links** (earned, the product's heartbeat): `student_links` — student,
  link (or ad-hoc idea pair), `evidence_kind`
  (`vocab_in_new_subject` | `mentor_flagged` | `student_articulated`), the session/turn
  it happened in, created_at. **A student link is MADE once and never unmade** — this
  is the event that pops the animation and permanently lights the arc in the brain.

## 2. Detection — how a link event actually fires

All server-side in the existing chat turn pipeline (no new round trips; these ride the
turn that's already running):

1. **Vocab sighting** (deterministic, free): after the mentor reply resolves, match the
   lesson's + student's vocab set against the reply + student message (word-boundary,
   variants included). New term → `student_vocab` row + envelope `vocab_events` (term,
   definition, first_time). Term seen where `subject ≠ term.subject` and that subject is
   new for the student → candidate **link event**.
2. **Mentor-flagged link** (one more field on the existing JSON contract, like
   `misconception`): the mentor sets `link: {from_idea, to_idea, note}` when the
   conversation genuinely carries logic across ideas/subjects. The orchestrator
   validates both ideas exist before writing — the LLM proposes, the server disposes
   (same trust posture as grading).
3. **Emergent idea minting** (owner decision): the mentor's contract gains
   `new_idea: {title, one_liner, related_idea_keys}` — proposed only when the student
   genuinely pushed into territory beyond the authored set. The server dedupes
   (normalized title match against authored + this student's emergent ideas), caps
   minting (≤1 per turn, bounded per session), and writes the student-scoped idea +
   its links. The envelope carries it as an `idea_events` entry → the brain visibly
   grows a NEW star.
4. **Student articulation** (the strongest signal, later phase): the understanding
   grader gets one extra output bit — "did the student themselves draw a cross-idea
   connection?" — gated the same way as everything else the grader emits.

Link events land in the envelope (`link_events: [{from, to, kind, note}]`) → the client
pops the notification and the brain animates. Frequency guardrails from day one: max one
vocab dropdown + one link pop per turn; a term's dropdown fires only on first
encounter (per subject, at most); everything else accumulates silently into the brain.

## 3. Chat UX

- **Highlighting**: MessageBody wraps matched vocab terms (final text only — not while
  streaming; the envelope's `vocab_events`/known-term list drives the matcher, so client
  and server agree on what's a term). Highlight = the underline-dot treatment in the
  term's SUBJECT hue — subtle in running prose, obviously tappable.
- **Definition dropdown**: first encounter → a notification banner slides from the top
  (design system: pill-radius card, term + one-line definition + subject tag, auto
  dismiss ~6s, tap to pin). Later encounters: tap the highlight → same card inline.
- **Link pop**: on a `link_event` — a small toast anchored top-right: "New link:
  ratios ↔ population growth" with a spark animation, and a "See it in your brain"
  action that jumps to Home's brain map with the new arc pulsing. Reduced-motion: the
  toast is static, the arc just appears.

## 4. Brain map v4 (the graph becomes real)

The galaxy keeps its skeleton (you → courses → units → lessons, memory satellites) and
gains the knowledge layer:

- **Idea stars**: authored ideas attach to the lessons that teach them — rendered on
  demand (a zoom threshold or a layer toggle: Lessons / Ideas / Vocab) so the default
  view stays calm. **Emergent ideas render distinctly** (aurora-tinted, orbiting the
  subject they were born in): the part of the brain that exists because THIS student
  thought — the more they push, the more stars only they have.
- **Earned arcs**: `student_links` render as PERMANENT bright arcs between idea stars
  (cross-subject arcs are the long, spectacular ones — geometry to biology crosses the
  whole disc). The current lexical topic links (round 12e) retire in favor of real
  curriculum links rendered faint (possible) vs. bright (earned) — the map literally
  shows unrealized potential vs. made connections.
- **Vocab dust**: encountered vocab as tiny motes clustered near their subject's
  course hub; a term seen in multiple subjects renders once per subject with a thin
  thread between — the visible trace of a traveling word.
- **The link-made moment**: when a link event arrives while the map is visible (or the
  toast is tapped), the new arc draws itself tip-to-tip with the existing bmap-flow
  dash animation, then settles to permanent. One-time, then calm.
- **Progress remap**: the map's fractions (and the tree's, and the mentor's own
  tracking) move from steps to **ideas mastered / ideas total** — steps discharge
  requirements (unchanged, per the v5.0 ledger), and discharged steps mark their bound
  ideas mastered. The AI's prompt context gains the student's idea/link graph summary
  (bounded, relevance-picked like memory).

## 5. Build phases (each shippable alone)

- **F1 — Foundations**: `ideas`, `vocab_terms`, `activity_ideas`, curriculum `links`
  tables + RLS; AI-draft/approve authoring in studio-lite; demo catalog seeded with
  ideas + vocab + a handful of authored cross-subject links (the demo classes already
  mirror each other — Foundations ↔ IT Frontiers is a ready-made link farm).
- **F2 — Vocab live in chat**: server-side sighting detection, `student_vocab`,
  envelope `vocab_events`, highlighting + definition dropdown, vocab dust on the map.
- **F3 — Links live**: mentor `link` contract field + validation, `student_links`,
  envelope `link_events`, the toast + arc-draw animation, earned vs. possible arcs on
  the map (lexical topic links retire here).
- **F4 — Progress remap**: mastery-by-idea becomes the tracked spine (tree, map,
  teacher analytics, mentor prompt context); grader gains the articulation bit;
  class/teacher views of the class's collective link graph.

## 6. Decisions (owner, 2026-08-02)

1. **Subject = course.** No separate taxonomy; every course is its own subject, so
   "cross-subject" means "cross-course". Revisit only if two same-discipline courses
   ever make the links feel false.
2. **Idea granularity: lesson-primary + EMERGENT.** One authored primary idea per
   lesson as the progress spine; beyond that, the brain grows from conversation — the
   mentor mints student-scoped emergent ideas when the student pushes and thinks (see
   §1 and §2.3). The brain's size reflects the student's thinking, not just coverage.
3. **Highlight density: first occurrence per message** (full card on tap anywhere).
4. **Who sees links first**: student-first at F3; teacher views follow in F4
   (defaulted — not explicitly picked).
5. **Notification timing: after the reply finishes streaming** — highlights, the
   definition dropdown, and link/idea toasts all wait for the text to settle.

## 7. Explicitly not in this sketch

Embedding-based similarity (stays out, consistent with memory's no-embeddings
decision — links are authored or evidenced, never guessed from cosine distance);
spaced repetition of vocab (future — `student_vocab` rows are already the substrate);
gamification beyond the link-made moment (streaks/badges are a different conversation).
