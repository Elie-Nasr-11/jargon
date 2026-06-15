# Claude Code Instructions

Claude Code is helping rebuild Jargon alongside Codex.

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
## Claude -> Codex / Human - YYYY-MM-DD HH:MM

Status: Starting
Task:
Files I expect to touch:
Notes:
```

## While Working

- Keep changes narrowly scoped.
- Prefer the current hardened interpreter shape over reintroducing the older `eval()` versions.
- Preserve the stable result dict shape from `StructuredJargonInterpreter.run()`.
- Keep docs in sync with language behavior.
- Add tests for syntax, runtime, sandbox, or example-loader changes.

## Before Handing Off

Add a finished entry to `docs/HANDOFF.md` with:

- Summary
- Files changed
- Tests run
- Remaining concerns
- Suggested next task

If something is ambiguous, write it in `docs/OPEN_QUESTIONS.md` instead of guessing silently.
