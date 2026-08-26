# Chat Flow — Scope (Round 13)

Status: scoping document, 2026-08-02. Code-verified inventory of the student chat flow
as it exists on `claude/project-scope-mvp-o7ox0y`, the gaps in it, and a phased proposal.
Implementation starts after the owner picks from §5.

> **Superseded in part (2026-08-26, R64 — see DECISIONS "context-first conversation").**
> The §1 inventory below is historical: the 30-branch directive ladder has since been
> dissolved to mechanical rungs + an empty "brief" default (standing SYSTEM-prompt rules
> keyed off a per-turn `flow` world brief carry conversational turns), the LLM router's
> classify task is deleted (the mentor's own `student_action` drives the persisted fold;
> assessTurn is grade-only), and the mentor maintains the running summary itself
> (`flow_summary`).

## 1. What exists today (verified, with receipts)

The flow is far more complete than folklore suggests. The load-bearing pieces:

- **One server brain.** `supabase/functions/chat/index.ts` (~6,100 lines) handles every
  turn. One static SYSTEM_PROMPT; per-turn behavior comes from `turnDirective()` — a
  30-branch priority ladder whose key is also the audit label (`teaching_move`). Payload
  is ordered stable→volatile for prompt caching. (DECISIONS 2026-07-02.)
- **Three mode axes, working as designed** (DECISIONS 2026-07-27): authored step mode
  (8 values) decides deterministic gates; student-declared turn mode (6 values) sets a
  grading ceiling (`discuss`/`open` can never discharge a gate); an LLM router classifies
  each turn (answer/question/continue/navigate/tangent/meta) in parallel with graders.
- **Grading is orchestrator-only.** `checkUnderstanding` / `checkCodeObjective` (cheap
  model, temp 0.2) are the sole gate-closers; the mentor's opinion is telemetry.
- **Transcript is fully persisted** (`learning_turns`, mentor rows store the whole
  envelope) and rehydrated on open; **mid-lesson resume works** (`step_state`,
  `steps_done`, `nav` frame); **retry works** with idempotent replay (`client_msg_id`).
- **Memory rides every turn**: rolling profile + up to 3 relevance-picked session
  summaries + mastery/misconceptions + mentor_instructions (capped 500).
- **Media/artifacts**: resource cards attach on presentation/ask turns; artifact builds
  are consent-first via a separate function returning through an `artifact_ready`
  control turn. No model-side tool calling anywhere in chat (by design).
- **Voice**: dictation into the composer (with modality metadata), realtime WebRTC panel
  submitting through the same turn loop, read-aloud per bubble.

## 2. Gap inventory (code-verified)

Grouped by theme; numbers referenced by the phases in §4.

### A. The flow lies to the student or dead-ends
1. **Backtracking is unreachable.** `sendNavigate` exists client-side but nothing calls
   it; there is no clickable spine — yet the server's own copy tells students "the
   completed steps in the progress bar at the top are clickable" (index.ts:2575, 4142).
2. **No visible lesson spine.** `lesson_arc` is computed on both sides every turn but
   renders only as a section eyebrow; objectives are never shown.
3. **Continue is lost on reload.** Rehydration drops `continue_offer`, but the
   acknowledge gate still requires a continue signal and the prompt forbids "type next"
   — a reload mid-content-step is a soft-lock (chatMessages.ts:158, index.ts:2361).
4. **Reloaded quizzes re-render live choices** (no `chosen` on rehydrate); tapping sends
   a stale answer that produces a reply to a phantom action.
5. **Checkpoints are misdescribed.** Prompt + completion nudge say work is "docked above
   the message box"; no dock exists, and `CheckpointsPanel` has no in-app entry point
   (URL-only).
6. **Mode switches are invisible to the mentor.** The declared mode caps grading but is
   absent from the prompt payload — Lesson→Discuss→Practice changes the rules without
   telling the model.
7. `turnMode` is ephemeral and never resets on lesson switch.
8. Suggested prompts appear only at zero messages; an abandoned session gets no
   re-entry affordance.

### B. Feel: latency and rendering
9. **No streaming.** Both provider adapters are blocking JSON calls; the UI shows a
   static "Thinking…" while router+grader then mentor run (2 sequential round-trips
   minimum).
10. **30 s client timeout** against a 3-model-call turn; on abort the server still
    persists the reply — the student sees an error over work that landed.
11. **No autoscroll** in the transcript container.
12. No transcript pagination (full session fetch on open).

### C. Continuity and context
13. **Hard context window: last 8 turns × 400 chars**, no mid-session summarization — a
    long session forgets its own beginning.
14. Attachments never reach the graders — a photo of handwritten work can't satisfy a
    gate (documented server-side, index.ts:5142).

### D. Contract hygiene
15. `envelope.session` (shipped explicitly for sync) is ignored; the client refetches
    the whole progress table after every send.
16. Progress is binary (0 / 0.5 / 1) though step-level truth exists server-side.
17. Nothing consumes `next_action`/`stage`; completion produces no client affordance
    (no next-lesson, no celebration).

### E. Ops / dead weight
18. `estimated_cost_usd` is always null (token counts only).
19. Rate limiter costs a DB round trip before any work.
20. `components/Composer.tsx` (1,095 lines) retained solely for one type.
21. `handleReviewRequest` (~260 lines) writes rows nothing reads; no client caller.

Explicitly NOT gaps: transcript persistence, resume, retry/idempotency, thinking
indicator (static), checkpoint derivation helpers.

## 3. Design anchors (unchanged)

- One directive ladder, orchestrator-only grading (2026-07-02) — nothing here reopens it.
- Two mode axes; student mode = input to existing routing, no requirement-ledger rebuild
  (2026-07-27 amended).
- v5.0's header concept: "N of M requirements met", outstanding ones tappable — decided
  but never built; Phase 1 builds it.
- Design system: transcript bubbles/pills/mode tags per docs/design-system.

## 4. Proposed phases

**Phase 1 — Make the flow honest (fix lies and dead ends).** Gaps 1-8, 11.
The lesson header becomes the real, tappable spine: steps from `lesson_arc` with
done/current state, tapping a done step fires the existing `sendNavigate`; requirement
count per the v5.0 decision. Rehydrate `continue_offer` and quiz `chosen` from the
persisted envelope. Put the declared turn mode into the prompt payload (one key + a
directive nod on change). Fix checkpoint copy to point at a real surface and give
CheckpointsPanel its entry point (or dock the pending checkpoint above the composer —
owner call, §5). Reset `turnMode` on lesson switch. Autoscroll. Re-entry suggestion row
for abandoned sessions. No schema changes; server copy + payload additions + client UI.

**Phase 2 — Feel (streaming + latency).** Gaps 9, 10, 19.
SSE streaming from the edge function for the mentor call (router/graders stay blocking —
they're small and parallel); client renders tokens incrementally into the thinking
bubble; timeout raised and made phase-aware; rate-limit check folded into an existing
query. Biggest perceived-quality win per line of code after Phase 1.

**Phase 3 — Continuity (context + progress truth).** Gaps 13, 15, 16, 17.
Mid-session rolling summary (same cheap-model writer, updated every N turns into the
session row, prepended to history) so long sessions stop forgetting; client consumes
`envelope.session` instead of refetching; percent progress from `steps_done`/arc length
(the brain map and tree get gradations for free); a completion affordance (next-lesson
hand-off).

**Phase 4 — Hygiene.** Gaps 12, 14, 18, 20, 21.
Cost computation from a small price table; extract `ComposerLanguage` and delete the
1,095-line corpse; delete or wire `handleReviewRequest` (owner call); attachment-to-
grader policy (owner call — needs a vision-capable grader to be honest); transcript
pagination if sessions ever get long enough to hurt.

## 5. Owner decisions needed

1. **Phase order** — recommend 1 → 2 → 3 → 4 as above.
2. **Checkpoint surface**: build the promised composer dock, or reroute copy/entry to
   the existing panels? (Dock recommended: it's what the prompt already promises and
   it keeps work visible in the flow.)
3. **Streaming transport**: SSE from the same `chat` function (recommended; smallest
   delta, keeps the envelope contract by sending it as the final SSE event) vs. a
   separate streaming endpoint.
4. **Review path** (`handleReviewRequest`): delete on this branch (recommended; archive
   lives on main) or wire a student surface for it.
5. **Attachments to graders**: keep prose-only gates (recommended for MVP) or add a
   vision grader so photographed work can pass gates.

## 6. Out of scope for this round

Model-side tool calling, teacher live-view changes, voice-session internals, artifact
pipeline internals, requirement-ledger redesign (settled 2026-07-27), any schema change
beyond an additive session column for the rolling summary (Phase 3).
