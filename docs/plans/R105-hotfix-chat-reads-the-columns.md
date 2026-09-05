# R105 — hotfix: chat asks for every column it steers on

## Context

`learnerSteer` (`supabase/functions/chat/index.ts:3000-3130`) reads ten profile fields:
`turns_scored`, `scaffold_earlier/recent`, the eight dims (via `steerDim`), `retention`,
`transfer`, **`share_unaided`** (:3048) and **`load_flag`** (:3055). The profile it is handed is
loaded at `:5187` with an explicit `select=` that ends `…turns_scored,retention,transfer,probes_answered`
— **`share_unaided` and `load_flag` are not in it.**

Consequences, both since 2026-09-03:
- R103's cognitive-load move (`if (loaded) moves.push(STEER_MOVES.load)`) can never fire on a
  live turn: `profile.load_flag` is always `undefined`.
- R101b's §14 guard (`seenWorkingAlone = shareUnaided === null || …`) always passes: the share
  is always `null`.

The scorer side (the room's groups, the Thinking tab) is correct — it reads its own tables with
its own column lists. Only the mentor never received the columns. Found by the 2026-09-04
audit, not by a test, which is the point of the pin below.

## Files

- `supabase/functions/chat/index.ts:5187` — the select list.
- `tests/test_r105_chat_reads_what_it_steers_on.py` — new.
- `docs/COGNITION.md` — "The wrong diagnoses" gains the entry; operational table bumps chat's version.
- `docs/HANDOFF.md`, `docs/DECISIONS.md` (a short entry: the rule).

## Change

Append `,share_unaided,load_flag` to the select at `:5187`. Nothing else.

## The pin — the rule, not the two names

```python
# Every profile column learnerSteer reads must be requested by the profile select.
steer = CHAT_CODE[CHAT_CODE.index("export function learnerSteer(") : CHAT_CODE.index("export function heuristicKind(")]
read = set(re.findall(r'steerDim\(profile, "(\w+)"\)', steer)) | set(re.findall(r"profile\.(\w+)", steer))
read -= {"turns_scored"} if False else set()   # turns_scored IS read; keep it in the set
select_line = next(l for l in CHAT.splitlines() if "cognition_profiles?user_id=eq." in l and "select=" in l)
asked = set(re.search(r"select=([\w,]+)", select_line).group(1).split(","))
missing = read - asked
assert not missing, f"learnerSteer reads columns chat never asks for: {sorted(missing)}"
```

Plus the inverse sanity check: every asked column exists on `cognition_profiles` (grep the
migrations for `add column if not exists <name>` or the create table) — so a typo in the select
fails loudly rather than 400ing every turn.

## Verification

1. Gate items 3–4 (python + `deno check chat` still 7).
2. Deploy; read back the deployed `chat` source (`get_edge_function`, grep the select string).
3. No students are active to exercise it live; the derivation is covered by
   `tests/flow_core.test.ts` R103/R101b properties, which already pass because they hand the
   profile in directly — that is exactly why they did not catch this.

## Docs

COGNITION.md "The wrong diagnoses": *"Two §19 guards shipped inert on the mentor side.* The scorer
wrote `load_flag` and `share_unaided`; chat never selected them; the property tests passed
because they construct the profile themselves and never touch the select. **A test that builds
its own input cannot see a missing column** — the pin now reads the select against the reads."

## Est. 0.25h
