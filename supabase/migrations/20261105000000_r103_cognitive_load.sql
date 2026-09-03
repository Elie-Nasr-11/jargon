-- R103 / rubric §19, the eighth rule: "If cognitive load appears excessive: break the
-- task into smaller steps."
--
-- Seven of §19's eight rules already steer the mentor. This is the last one, and the
-- only one that could not be read off the eight dimensions: overload is not weakness.
-- A student who finds the work hard produces weak answers; an OVERLOADED student
-- produces almost nothing while the tutor carries the turn. Telling the two apart needs
-- the two facts together — how heavy the help was, and how short the answers came back —
-- and the second of those lives in cognition_turn_scores.signals.words, which R99
-- started writing.
--
-- Both columns are derived by buildProfile in supabase/functions/cognition-scorer and
-- rewritten on every sweep. Nothing here is authoritative on its own: load_flag is the
-- verdict, load_signals is the arithmetic behind it, kept so that a reader can disagree
-- with the thresholds rather than with the machine.
--
-- Defaults matter. `false` and `{}` mean every profile written before this release
-- reads as not-overloaded rather than as unknown-and-therefore-alarming, and the flag
-- only becomes true when a sweep has actually looked.

alter table public.cognition_profiles
  add column if not exists load_flag boolean not null default false,
  -- { window, heavy_scaffold, short_answers, words_missing } over the recent window.
  -- words_missing is the honest part: responses judged before R99 carry no word count,
  -- they are counted as NOT short, and this says how many of them there were.
  add column if not exists load_signals jsonb not null default '{}'::jsonb;

-- The room reads the flag off the freshest profile, through the same service-role path
-- as every other column on this table, so no policy changes. Stated rather than assumed:
-- a student never sees this column, and no grant here widens what `authenticated` can
-- read beyond the existing cognition_profiles_read policy.
