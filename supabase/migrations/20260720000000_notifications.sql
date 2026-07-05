-- v4.0 Phase 5: persistent teacher/admin notifications (docs/PLATFORM.md).
-- Additive + idempotent (re-applied on every deploy). The RECIPIENT is user_id (the teacher/admin
-- who should see it); `kind` uses the hotlist vocabulary so a future HotlistFeed swap is a
-- data-source change. Edge functions write these best-effort as the service role; the owner reads
-- and marks their own read. There is NO authenticated INSERT grant — clients can never forge one.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  class_id uuid references public.classes on delete cascade,
  related_student_id uuid references auth.users on delete set null,
  kind text not null,
  title text not null,
  body text not null default '',
  ref jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table if exists public.notifications enable row level security;
-- Revoke Supabase's default broad grants first, then re-grant the minimum: the recipient reads
-- their rows and may only mark them read (UPDATE is column-scoped to read_at, so they cannot
-- rewrite title/kind/etc. of their own row). INSERT is service-role only — clients can never forge.
revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- Owner-only: a recipient reads their own rows and may mark them read (update read_at). INSERT is
-- service-role only (edge functions) — no authenticated insert policy exists.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.notifications is
  'v4.0 persistent teacher/admin notifications; recipient = user_id; kind matches the hotlist vocabulary (docs/PLATFORM.md).';

-- One-time conservative backfill (marker-guarded, like mode_foundation): recent (<=30d) submitted
-- assessment attempts -> one assessment_to_review notification per active teacher of the
-- assessment's class, so the bell is not empty on launch. Re-applying the migration is a no-op.
do $$
begin
  if not exists (
    select 1 from public.platform_backfill_markers where key = 'notifications_backfill_v1'
  ) then
    insert into public.notifications
      (user_id, organization_id, class_id, related_student_id, kind, title, body, ref, created_at)
    select
      tm.user_id,
      a.organization_id,
      a.class_id,
      att.user_id,
      'assessment_to_review',
      coalesce(p.name, 'A student') || ' submitted ' || coalesce(a.title, 'an assessment'),
      '',
      jsonb_build_object('assessment_id', a.id, 'attempt_id', att.id, 'source', 'backfill'),
      att.submitted_at
    from public.assessment_attempts att
    join public.assessments a on a.id = att.assessment_id
    join public.class_memberships tm
      on tm.class_id = a.class_id and tm.role = 'teacher' and tm.status = 'active'
    left join public.profiles p on p.id = att.user_id
    -- Only 'submitted' (awaiting teacher review) — a 'returned'/auto-graded attempt needs no review.
    where att.status = 'submitted'
      and att.submitted_at is not null
      and att.submitted_at >= now() - interval '30 days'
      and a.class_id is not null;

    insert into public.platform_backfill_markers (key) values ('notifications_backfill_v1');
  end if;
end $$;
