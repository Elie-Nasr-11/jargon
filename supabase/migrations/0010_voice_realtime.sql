-- Voice v2: OpenAI Realtime sessions and private cached Mentor audio.

alter table public.voice_interaction_events
  drop constraint if exists voice_interaction_events_event_type_check;

alter table public.voice_interaction_events
  add constraint voice_interaction_events_event_type_check
  check (
    event_type in (
      'dictation_started',
      'dictation_transcribed',
      'dictation_submitted',
      'read_aloud_started',
      'read_aloud_finished',
      'read_aloud_requested',
      'read_aloud_cached',
      'read_aloud_failed',
      'voice_session_started',
      'voice_session_ready',
      'voice_session_ended',
      'voice_session_failed',
      'voice_turn_submitted',
      'voice_tool_result'
    )
  );

create table if not exists public.voice_realtime_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid references public.learning_sessions on delete set null,
  lesson_id text references public.lessons on delete set null,
  provider text not null default 'openai',
  model text not null default 'gpt-realtime-2',
  voice text not null default 'marin',
  status text not null default 'starting'
    check (status in ('starting', 'live', 'ended', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.voice_audio_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid references public.learning_sessions on delete set null,
  lesson_id text references public.lessons on delete set null,
  turn_id uuid references public.learning_turns on delete set null,
  provider text not null default 'openai',
  model text not null default 'gpt-4o-mini-tts',
  voice text not null default 'marin',
  rate numeric not null default 1,
  text_hash text not null,
  storage_bucket text not null default 'mentor-audio-cache',
  storage_path text not null,
  content_type text not null default 'audio/mpeg',
  character_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.voice_realtime_sessions enable row level security;
alter table public.voice_audio_cache enable row level security;

create index if not exists voice_realtime_sessions_user_idx
  on public.voice_realtime_sessions (user_id, started_at desc);

create index if not exists voice_audio_cache_lookup_idx
  on public.voice_audio_cache (user_id, text_hash, voice, rate, created_at desc);

create unique index if not exists voice_audio_cache_unique_idx
  on public.voice_audio_cache (user_id, text_hash, voice, rate);

grant select, insert, update, delete on public.voice_realtime_sessions to authenticated;
grant select, insert, update, delete on public.voice_audio_cache to authenticated;
grant select, insert, update, delete on public.voice_realtime_sessions to service_role;
grant select, insert, update, delete on public.voice_audio_cache to service_role;
revoke all privileges on table public.voice_realtime_sessions from anon;
revoke all privileges on table public.voice_audio_cache from anon;

drop policy if exists "Students can view own voice realtime sessions" on public.voice_realtime_sessions;
create policy "Students can view own voice realtime sessions"
  on public.voice_realtime_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "Students can insert own voice realtime sessions" on public.voice_realtime_sessions;
create policy "Students can insert own voice realtime sessions"
  on public.voice_realtime_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Students can update own voice realtime sessions" on public.voice_realtime_sessions;
create policy "Students can update own voice realtime sessions"
  on public.voice_realtime_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Teachers can view class voice realtime sessions" on public.voice_realtime_sessions;
create policy "Teachers can view class voice realtime sessions"
  on public.voice_realtime_sessions for select
  using (
    exists (
      select 1
      from public.class_memberships teacher_membership
      join public.class_memberships student_membership
        on student_membership.class_id = teacher_membership.class_id
      where teacher_membership.user_id = auth.uid()
        and teacher_membership.role = 'teacher'
        and student_membership.user_id = voice_realtime_sessions.user_id
    )
  );

drop policy if exists "Students can view own voice audio cache" on public.voice_audio_cache;
create policy "Students can view own voice audio cache"
  on public.voice_audio_cache for select
  using (auth.uid() = user_id);

drop policy if exists "Students can insert own voice audio cache" on public.voice_audio_cache;
create policy "Students can insert own voice audio cache"
  on public.voice_audio_cache for insert
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mentor-audio-cache', 'mentor-audio-cache', false, 10485760, array['audio/mpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
