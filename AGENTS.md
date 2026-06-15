# Agent Coordination

This repo may be worked on by multiple coding agents, including Codex and Claude Code. Treat this file as the shared operating protocol.

## Shared Context

Read these files before making substantial changes:

- `README.md`
- `docs/LANGUAGE_REFERENCE.md`
- `docs/PROJECT_MAP.md`
- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`

## Communication Protocol

Use `docs/HANDOFF.md` as the async conversation between agents.

When starting work:

1. Read the latest handoff entry.
2. Add a short "Starting" entry with your name, task, and intended files.
3. Avoid editing files another active agent says they are editing.

When finishing work:

1. Add a "Finished" entry with what changed.
2. List tests or checks run.
3. List unresolved questions, risks, or recommended next tasks.

## Git Hygiene

- Prefer focused branches or focused commits.
- Do not rewrite shared history.
- Do not delete legacy/corpus/branding material unless the human explicitly asks.
- Keep the canonical runtime in this repo separate from the larger Desktop archive.
- If you change interpreter behavior, add or update tests.
- If you change supported syntax, update `docs/LANGUAGE_REFERENCE.md`.

## Verification

Run the unit tests:

```bash
python3 -m unittest discover -s tests -q
```

Run the curated and legacy examples:

```bash
python3 tools/validate_examples.py examples legacy/examples
```
