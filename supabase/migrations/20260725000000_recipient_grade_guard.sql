-- Recipient grade guard (S2 hardening) — idempotent, additive.
--
-- assignment_recipients + checkpoint_recipients both let a student self-UPDATE their OWN row
-- (assignments are self-attested: the student marks status submitted/complete from the dock). That
-- grant is whole-row, so via a raw PostgREST PATCH a student could also set their own `score` /
-- `final_score` / `feedback` — and the teacher gradebook reads checkpoint_recipients.* (incl. score)
-- while the student's own grades view reads it too, so a fabricated grade could surface.
--
-- RLS cannot column-scope an UPDATE (both students and teachers are the `authenticated` role, and
-- WITH CHECK cannot reference the OLD row), so we pin the graded columns with a BEFORE UPDATE trigger:
-- when the writer is the row's OWN student (auth.uid() = user_id) the graded columns are forced back
-- to their prior values. Teacher grading (auth.uid() = the teacher, never the graded student) and
-- service-role writes (auth.uid() is null) are unaffected, so normal grading + the assignment
-- dual-write flow through untouched. Status + lifecycle timestamps stay student-settable
-- (self-attestation is intended).

-- assignment_recipients: score + feedback are the graded/teacher-authored columns.
create or replace function public.guard_assignment_recipient_grade()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = new.user_id then
    new.score := old.score;
    new.feedback := old.feedback;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_assignment_recipient_grade on public.assignment_recipients;
create trigger trg_guard_assignment_recipient_grade
  before update on public.assignment_recipients
  for each row execute function public.guard_assignment_recipient_grade();

-- checkpoint_recipients: score, final_score, feedback are graded/teacher-authored.
create or replace function public.guard_checkpoint_recipient_grade()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = new.user_id then
    new.score := old.score;
    new.final_score := old.final_score;
    new.feedback := old.feedback;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_checkpoint_recipient_grade on public.checkpoint_recipients;
create trigger trg_guard_checkpoint_recipient_grade
  before update on public.checkpoint_recipients
  for each row execute function public.guard_checkpoint_recipient_grade();
