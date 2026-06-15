# Codex Instructions

Codex is helping rebuild Jargon alongside Claude Code.

## Start Here

Read:

1. `AGENTS.md`
2. `README.md`
3. `docs/HANDOFF.md`
4. `docs/ROADMAP.md`
5. `docs/DECISIONS.md`
6. `docs/OPEN_QUESTIONS.md`

## Before Editing

Add a short entry to `docs/HANDOFF.md`:

```md
## Codex -> Claude / Human - YYYY-MM-DD HH:MM

Status: Starting
Task:
Files I expect to touch:
Notes:
```

## Working Style

- Keep the runtime safe by default.
- Prefer `run_sandboxed()` for untrusted code paths.
- Preserve backward-compatible result fields.
- Use the old example corpus as a smoke test when it is locally available.
- Keep the mentor/web layer separate from the interpreter core.

## Before Handing Off

Add a finished entry to `docs/HANDOFF.md` with:

- Summary
- Files changed
- Tests run
- Remaining concerns
- Suggested next task
