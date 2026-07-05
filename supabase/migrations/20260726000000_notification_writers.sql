-- Phase 1a: notification writers (idempotent, additive).
--
-- The teacher notification bell (v4.0 P5) only ever carried `assessment_to_review`, because that is
-- the one hotlist event kind produced inside a service-role edge fn (assessment-admin). The other
-- event kinds are produced where NO service-role insert path exists: assignment submission is a
-- direct CLIENT DB write (student JWT), and mentor recommendations are written by the chat runtime
-- (also student JWT, no service-role key). Neither can insert a `notifications` row.
--
-- The fix is SECURITY DEFINER triggers: the trigger runs as the (privileged) function owner, so it
-- can insert notifications on behalf of the student's write, fanning out to the class's active
-- teachers. Each trigger is best-effort (its own EXCEPTION block) so a notification failure can never
-- roll back the submission / turn it accompanies.
--
-- Kinds handled here: `submission_to_grade` (new) + `mentor_recommendation` (new). `assessment_to_review`
-- keeps its edge-fn writer. The remaining hotlist kinds stay client-derived: `session_risk`,
-- `live_now`, `due_soon` are ephemeral/projected state (not events), and `alert_open`
-- (intervention_alerts) is intentionally NOT revived — it would duplicate the derived `session_risk`
-- signal (both mean "student is stuck"), and the discrete rescue EVENT is already captured by
-- `mentor_recommendation`.
--
-- Dedup: a partial unique index over (user_id, kind, related_student_id, ref->>'subject_id') for the
-- kinds written HERE by triggers (which insert with `ON CONFLICT DO NOTHING`, a per-row skip). The
-- index is deliberately scoped to those kinds: `assessment_to_review` is written by the edge fn as a
-- bulk PostgREST insert with no on_conflict, so if it were covered a single already-present unread row
-- would 409 the whole teacher batch and starve the rest — it keeps its pre-existing no-dedup behavior
-- and relies on the auto-clear (below) instead. A future edge-fn writer must be added to this predicate
-- ONLY if it also inserts with conflict-tolerance.

create unique index if not exists notifications_dedup_unread_idx
  on public.notifications (user_id, kind, related_student_id, (ref->>'subject_id'))
  where read_at is null and kind in ('submission_to_grade', 'mentor_recommendation');

-- submission_to_grade: a student submits an assignment (client-side direct insert). The assignment
-- carries class_id/organization_id/title, so fan out to that class's active teachers.
create or replace function public.notify_submission_to_grade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  student_name text;
begin
  if coalesce(new.status, '') <> 'submitted' then
    return new;
  end if;
  select asg.class_id, asg.organization_id, asg.title
    into a
    from public.assignments asg
    where asg.id = new.assignment_id;
  if a.class_id is null then
    return new;
  end if;
  select p.name into student_name from public.profiles p where p.id = new.user_id;
  insert into public.notifications
    (user_id, organization_id, class_id, related_student_id, kind, title, ref)
  select
    cm.user_id,
    a.organization_id,
    a.class_id,
    new.user_id,
    'submission_to_grade',
    coalesce(nullif(student_name, ''), 'A student') || ' submitted ' ||
      coalesce(nullif(a.title, ''), 'an assignment'),
    jsonb_build_object(
      'subject_id', new.assignment_id::text,
      'assignment_id', new.assignment_id,
      'submission_id', new.id
    )
  from public.class_memberships cm
  where cm.class_id = a.class_id and cm.role = 'teacher' and cm.status = 'active'
    and cm.user_id <> new.user_id -- never notify a teacher about their own (self-enrolled) submission
  on conflict do nothing;
  return new;
exception when others then
  return new; -- best-effort: never break the submission
end;
$$;

drop trigger if exists trg_notify_submission_to_grade on public.assignment_submissions;
create trigger trg_notify_submission_to_grade
  after insert on public.assignment_submissions
  for each row execute function public.notify_submission_to_grade();

-- mentor_recommendation: the chat runtime flags a stuck student (once per step at the rescue
-- threshold). mentor_recommendations has no class column, so fan out to the teachers of the student's
-- active classes (distinct per teacher), dedup subject = the lesson (one unread per student per lesson).
create or replace function public.notify_mentor_recommendation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_name text;
  subj text;
begin
  select p.name into student_name from public.profiles p where p.id = new.user_id;
  subj := coalesce(nullif(new.lesson_id, ''), new.session_id::text, new.id::text);
  insert into public.notifications
    (user_id, organization_id, class_id, related_student_id, kind, title, ref)
  select distinct on (t.user_id)
    t.user_id,
    c.organization_id,
    t.class_id,
    new.user_id,
    'mentor_recommendation',
    coalesce(nullif(student_name, ''), 'A student') || ' — ' ||
      coalesce(nullif(new.title, ''), 'mentor flagged for support'),
    jsonb_build_object(
      'subject_id', subj,
      'recommendation_id', new.id,
      'lesson_id', new.lesson_id,
      'session_id', new.session_id
    )
  from public.class_memberships s
  join public.class_memberships t
    on t.class_id = s.class_id and t.role = 'teacher' and t.status = 'active'
    and t.user_id <> new.user_id -- never notify a teacher about themselves (self-enrolled)
  join public.classes c on c.id = t.class_id
  where s.user_id = new.user_id and s.role = 'student' and s.status = 'active'
  on conflict do nothing;
  return new;
exception when others then
  return new; -- best-effort: never break the chat turn's recommendation write
end;
$$;

drop trigger if exists trg_notify_mentor_recommendation on public.mentor_recommendations;
create trigger trg_notify_mentor_recommendation
  after insert on public.mentor_recommendations
  for each row execute function public.notify_mentor_recommendation();
