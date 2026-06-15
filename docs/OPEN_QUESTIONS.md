# Open Questions

Add new questions at the top. Close resolved questions by moving them to `docs/DECISIONS.md` if they become durable choices.

## Should curated examples be copied into Supabase lessons?

Context:

- `examples/` now contains a small curated set.
- `legacy/examples/` contains the full 131-file corpus.
- Supabase currently has five seeded lessons with placeholder starter code.

Options:

- Keep examples in the repo only.
- Add a migration that maps curated examples into lesson `sample_code`.
- Add a separate `examples` table later.

## How should interactive ASK work in the web UI?

Current decision so far:

- Start with stateless rerun using `answers`.

Options:

- Continue stateless `answers`.
- Use `preset_answers` keyed by variable.
- Add a resumable execution/session model later.
