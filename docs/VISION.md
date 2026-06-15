# Jargon — Product Vision & Target Architecture

Status: **North star** (decided with the human, 2026-06-15). This is the destination;
the current split-view (Mentor chat ∥ Interpreter editor) is a stepping stone, now legacy.

## Goal

Teach school students to think logically, by climbing a ladder from plain reasoning to
real coding literacy.

## The ladder (also the per-student adaptivity axis)

- **Level 0 — Natural logic:** explain the process in plain language.
- **Level 1 — Baby Jargon:** structured language using normal-speech terms (IF / REPEAT / etc.).
- **Level 2 — Jargon:** runnable pseudocode that bridges toward code.
- **Level 3 — Python bridge:** compare the Jargon idea to Python (room for other languages later).

## Primary interface: a conversational lesson-runner

Not a free-form chatbot — a **stateful, guided conversation that *is* the class**:

- A clear **begin → dense guided turns → end**, with grades and retry / recuse / continue.
- **Multiple student answer modes per turn:** plain text, **code** (runs on the engine),
  **file upload**, or **pick from options** the AI poses.
- The AI keeps sessions dense and engaging, and **steers back to the lesson on drift** —
  even inside explanations.

## Architecture

```
Front-end: conversational lesson-runner UI
  (renders text / inline code editor / MCQ / file upload by the turn's expected_mode;
   shows session progress, grade, retry)
        │ supabase-js
        ▼
Supabase
  Auth · Postgres (lessons, lesson_steps, lesson_sessions, mastery, turns, submissions)
       · Storage (file-upload answers)
  Edge Functions:
    chat = STATEFUL FLOW ENGINE  (not a passthrough)
        load lesson+step+session+student-mastery → build cached prompt →
        structured-output + tool-use turn → grade → persist → advance
    run  → Jargon engine (Render, Codex) — extended to Python and beyond
        │
        ▼
  LLM (decided by spike): Claude tiers + prompt caching  vs  OpenAI gpt-4o
```

## The five necessities → concrete mechanisms

| Necessity | Mechanism |
|---|---|
| Iron-clad guardrails | Every Mentor turn is a **strict structured output** `{say, expected_mode, options?, on_topic, advance, step_id, grade?, mastery_signal}`; the orchestrator enforces flow + redirect from those fields (not prose). Tool use gates real actions (`run_jargon`, `grade`, `advance_step`). |
| Deep topic understanding | Strong base model + per-lesson curriculum/rubric loaded as cached context every turn. |
| Flawless execution (Jargon + others) | Code-as-answer-mode calls the existing sandboxed engine; engine grows a sandboxed **Python** runner (then more). |
| Mass scale, affordable | **Tiered models** (cheap bulk + capable grading) + **prompt caching** on the stable per-lesson prefix (reads ~0.1×) + **Batch API** (50% off) for async grading + structured outputs to bound output tokens. |
| Per-student adaptation | A `mastery` table (student × concept) updated each turn from `mastery_signal`, fed back into the cached prompt so level/difficulty adapt. |

## Data model (additions to the current schema)

- `lessons` (exists) + `module`, `level` (migration 0002).
- `lesson_steps`: `id, lesson_id, position, objective, level, rubric, expected_mode, ...`
- `lesson_sessions`: `id, user_id, lesson_id, status, current_step, grade, started_at, ended_at`
- `turns`: `session_id, role, mode, content, grade, mastery_signal, created_at`
- `mastery`: `user_id, concept, level, score, updated_at`
- `chat_messages`, `code_submissions` (exist) — fold into the session/turn model.

## Cost-at-scale reference (current Claude pricing, for the spike)

| Tier | Model | $ in / out per 1M | Role |
|---|---|---|---|
| Bulk conversation | `claude-haiku-4-5` | 1 / 5 | routine turns |
| Reasoning / grading | `claude-sonnet-4-6` | 3 / 15 | assessment, harder reasoning |
| Escape hatch | `claude-opus-4-8` | 5 / 25 | rare, hardest cases |

Prompt caching: cache **reads ≈ 0.1×** input, **writes ≈ 1.25×** (5-min). The per-lesson
system prefix (persona + rubric + curriculum + student snapshot) is reused every turn and
across students → most of each turn bills at ~0.1×.

## Decisions locked (2026-06-15)

1. **Pivot now** to the conversational lesson-runner; split-view becomes a legacy stepping stone.
2. **Flow = hybrid:** authored objectives/checkpoints per lesson + AI conversation, orchestrator-enforced.
3. **Mentor LLM = decide by spike:** Claude tiers + caching vs gpt-4o, measured on real lessons.
4. **Audience = school students;** the Level 0–3 ladder is the adaptivity axis.

## First steps

- **Spike (gates the model decision):** a `chat` variant that runs one real lesson as a
  structured-output turn against (a) Claude Haiku+Sonnet with prompt caching and (b) gpt-4o;
  measure cost/turn, guardrail adherence, and grading quality. Needs an `ANTHROPIC_API_KEY`
  secret alongside the existing `OPENAI_API_KEY`.
- **Backend (Codex):** data model (`lesson_steps`/`lesson_sessions`/`mastery`), the flow-engine
  `chat` function, structured-output grading, and the Python engine runner.
- **Frontend (Claude):** the conversational lesson-runner UI — answer-mode rendering, session
  state, grades, and retry/continue.
