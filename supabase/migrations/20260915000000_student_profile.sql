-- Student profile v2 (round 11): two additive columns on profiles.
--
--   preferred_name      What the student wants to be called — the mentor addresses them by
--                       this (falls back to the first word of name). Student-editable via
--                       the existing "Users can update own profile" policy.
--   mentor_instructions The student's standing note to their mentor ("explain with soccer
--                       examples", "don't spoil answers") — a Claude-style custom
--                       instruction. STYLE ONLY by contract: the chat fn caps it and wraps
--                       it in a guardrail so it can never override teaching policy, safety,
--                       or the teacher's help ceiling.
--
-- No new policies needed: owner select/update and teacher read (can_view_student) already
-- cover both columns.

alter table public.profiles add column if not exists preferred_name text;
alter table public.profiles add column if not exists mentor_instructions text;
