-- Learning session runtime v1.
-- Live note: apply after 0001_init and 0002_lesson_spine; do not re-run earlier migrations.

create table if not exists public.lesson_activities (
  id text primary key,
  lesson_id text not null references public.lessons on delete cascade,
  position integer not null,
  title text not null,
  activity_type text not null check (activity_type in ('discussion', 'code', 'multiple_choice', 'reflection', 'file')),
  stage text not null check (stage in ('intro', 'teach', 'practice', 'assessment', 'review', 'complete')),
  prompt text not null,
  response_mode text not null check (response_mode in ('text', 'code', 'multiple_choice', 'file')),
  starter_code text not null default '',
  expected_output text,
  choices jsonb not null default '[]'::jsonb,
  rubric jsonb not null default '{}'::jsonb,
  skill_keys text[] not null default '{}',
  pass_score numeric not null default 1,
  created_at timestamptz not null default now()
);

alter table public.lesson_activities enable row level security;

create policy "Lesson activities are readable by everyone"
  on public.lesson_activities for select
  using (true);

grant select on public.lesson_activities to anon, authenticated;
grant select, insert, update, delete on public.lesson_activities to service_role;

create index if not exists lesson_activities_lesson_position_idx
  on public.lesson_activities (lesson_id, position);

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text not null references public.lessons on delete cascade,
  current_activity_id text references public.lesson_activities on delete set null,
  stage text not null default 'intro' check (stage in ('intro', 'teach', 'practice', 'assessment', 'review', 'complete')),
  status text not null default 'active' check (status in ('active', 'needs_retry', 'needs_rescue', 'complete', 'abandoned')),
  score numeric not null default 0,
  retry_count integer not null default 0,
  rescue_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.learning_sessions enable row level security;

create policy "Users manage own learning sessions"
  on public.learning_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.learning_sessions to authenticated;
grant select, insert, update, delete on public.learning_sessions to service_role;

create index if not exists learning_sessions_user_lesson_idx
  on public.learning_sessions (user_id, lesson_id, updated_at desc);

create table if not exists public.learning_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text not null references public.lessons on delete cascade,
  role text not null check (role in ('student', 'mentor', 'system')),
  stage text not null check (stage in ('intro', 'teach', 'practice', 'assessment', 'review', 'complete')),
  response_mode text check (response_mode in ('text', 'code', 'multiple_choice', 'file')),
  content text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.learning_turns enable row level security;

create policy "Users manage own learning turns"
  on public.learning_turns for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.learning_turns to authenticated;
grant select, insert, update, delete on public.learning_turns to service_role;

create index if not exists learning_turns_session_created_idx
  on public.learning_turns (session_id, created_at);

create table if not exists public.lesson_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions on delete cascade,
  activity_id text references public.lesson_activities on delete set null,
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text not null references public.lessons on delete cascade,
  answer_mode text not null check (answer_mode in ('text', 'code', 'multiple_choice', 'file')),
  answer_text text,
  answer_code text,
  choice_id text,
  run_result jsonb,
  score numeric,
  passed boolean,
  feedback text,
  created_at timestamptz not null default now()
);

alter table public.lesson_attempts enable row level security;

create policy "Users manage own lesson attempts"
  on public.lesson_attempts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.lesson_attempts to authenticated;
grant select, insert, update, delete on public.lesson_attempts to service_role;

create index if not exists lesson_attempts_user_lesson_idx
  on public.lesson_attempts (user_id, lesson_id, created_at desc);

create table if not exists public.student_mastery (
  user_id uuid not null references auth.users on delete cascade,
  skill_key text not null,
  level text not null default 'emerging',
  evidence_count integer not null default 0,
  score numeric not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, skill_key)
);

alter table public.student_mastery enable row level security;

create policy "Users manage own mastery evidence"
  on public.student_mastery for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.student_mastery to authenticated;
grant select, insert, update, delete on public.student_mastery to service_role;

insert into public.lesson_activities (
  id,
  lesson_id,
  position,
  title,
  activity_type,
  stage,
  prompt,
  response_mode,
  starter_code,
  expected_output,
  choices,
  rubric,
  skill_keys,
  pass_score
) values
(
  'lesson1-practice',
  'lesson1',
  1,
  'Connect a Tool to Its Purpose',
  'code',
  'practice',
  'Run the starter, then change the tool and purpose to another pair you can explain.',
  'code',
  $lesson1_activity_code$// Purpose starter
SET tool ("hammer")
SET purpose ("hammers nails")
PRINT (tool + " -> " + purpose)$lesson1_activity_code$,
  $lesson1_activity_output$hammer -> hammers nails$lesson1_activity_output$,
  '[]'::jsonb,
  '{"checks":["Program runs without errors","Output clearly connects one tool to one purpose"],"pass_threshold":1}'::jsonb,
  ARRAY['process.purpose','jargon.set','jargon.print'],
  1
),
(
  'lesson2-practice',
  'lesson2',
  1,
  'Trace Input, Process, Output',
  'code',
  'practice',
  'Run the starter and explain which line is the input, which is the process, and which is the output.',
  'code',
  $lesson2_activity_code$// Systems and signals starter
SET input_signal ("button press")
SET process ("elevator decides where to go")
SET output_signal ("door opens")
PRINT ("Input: " + input_signal)
PRINT ("Process: " + process)
PRINT ("Output: " + output_signal)$lesson2_activity_code$,
  $lesson2_activity_output$Input: button press
Process: elevator decides where to go
Output: door opens$lesson2_activity_output$,
  '[]'::jsonb,
  '{"checks":["Names input, process, and output","Uses clear ordered steps"],"pass_threshold":1}'::jsonb,
  ARRAY['systems.input','systems.process','systems.output','jargon.print'],
  1
),
(
  'lesson3-practice',
  'lesson3',
  1,
  'Convert a Signal',
  'code',
  'practice',
  'Run the starter and describe why the microphone changes the signal before the processor can use it.',
  'code',
  $lesson3_activity_code$// Signal processing starter
SET signal ("sound")
SET converted ("electronic")
IF signal is equal to "sound" THEN
    PRINT ("Microphone changes sound into " + converted + " signals")
ELSE
    PRINT "Signal needs a different interface"
END$lesson3_activity_code$,
  $lesson3_activity_output$Microphone changes sound into electronic signals$lesson3_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses a condition","Explains physical signal to computer signal conversion"],"pass_threshold":1}'::jsonb,
  ARRAY['signals.conversion','jargon.if','jargon.print'],
  1
),
(
  'lesson4-practice',
  'lesson4',
  1,
  'Store and Replay Memory',
  'code',
  'practice',
  'Run the starter and explain how the list acts like memory for stored signals.',
  'code',
  $lesson4_activity_code$// Memory starter
SET memory ([])
ADD "camera input" to memory
ADD "processed photo" to memory
SET i (0)
REPEAT_UNTIL i reaches end of memory
    PRINT memory[i]
    SET i (i + 1)
END$lesson4_activity_code$,
  $lesson4_activity_output$camera input
processed photo$lesson4_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses a list as memory","Loops through stored values"],"pass_threshold":1}'::jsonb,
  ARRAY['memory.storage','jargon.list','jargon.loop'],
  1
),
(
  'lesson5-practice',
  'lesson5',
  1,
  'Follow a Signal Route',
  'code',
  'practice',
  'Run the starter and explain how each stop is a system that receives the signal.',
  'code',
  $lesson5_activity_code$// Exchanging signals starter
SET route (["phone", "cell tower", "internet", "server"])
REPEAT_FOR_EACH stop in route
    PRINT ("Signal reaches " + stop)
END$lesson5_activity_code$,
  $lesson5_activity_output$Signal reaches phone
Signal reaches cell tower
Signal reaches internet
Signal reaches server$lesson5_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses a route list","Explains signal exchange across systems"],"pass_threshold":1}'::jsonb,
  ARRAY['signals.exchange','jargon.foreach','jargon.list'],
  1
),
(
  'coding1-practice',
  'coding1',
  1,
  'Sequence a Process',
  'code',
  'practice',
  'Run the starter, then change it into another everyday process with three ordered steps.',
  'code',
  $coding1_activity_code$// Sequence starter
SET step1 ("Gather ingredients")
SET step2 ("Mix")
SET step3 ("Serve")
PRINT step1
PRINT step2
PRINT step3$coding1_activity_code$,
  $coding1_activity_output$Gather ingredients
Mix
Serve$coding1_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses ordered instructions","Each printed line is one clear step"],"pass_threshold":1}'::jsonb,
  ARRAY['logic.sequence','jargon.set','jargon.print'],
  1
),
(
  'coding2-practice',
  'coding2',
  1,
  'Choose With a Condition',
  'code',
  'practice',
  'Run the starter and explain what condition decides the output.',
  'code',
  $coding2_activity_code$// Condition starter
SET temperature (15)
IF temperature is less than 20 THEN
    PRINT "Wear a jacket"
ELSE
    PRINT "No jacket needed"
END$coding2_activity_code$,
  $coding2_activity_output$Wear a jacket$coding2_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses IF/ELSE","Explains the comparison that controls the path"],"pass_threshold":1}'::jsonb,
  ARRAY['logic.condition','jargon.if_else','jargon.comparison'],
  1
),
(
  'coding3-practice',
  'coding3',
  1,
  'Select Items From a List',
  'code',
  'assessment',
  'Run the starter and explain why each selected number belongs in the final list.',
  'code',
  $coding3_activity_code$// Lists and looping starter
SET nums ([1, 6, 9, 12, 14, 18])
SET selected ([])

REPEAT_FOR_EACH x in nums
    IF x is even AND (x % 3) is equal to 0 THEN
        ADD x to selected
    END
END

PRINT selected$coding3_activity_code$,
  $coding3_activity_output$[6, 12, 18]$coding3_activity_output$,
  '[]'::jsonb,
  '{"checks":["Loops through a list","Uses compound logic","Output matches selected even multiples of 3"],"pass_threshold":1}'::jsonb,
  ARRAY['jargon.list','jargon.foreach','logic.compound_condition'],
  1
),
(
  'coding4-practice',
  'coding4',
  1,
  'Use Input to Decide Output',
  'code',
  'assessment',
  'Run the starter, answer the prompt with Fatima, and explain how the input changes the result.',
  'code',
  $coding4_activity_code$// Input and output starter
ASK "Enter a name" as name
SET people (["Ali", "Fatima", "Rami"])
REPEAT_FOR_EACH person in people
    IF name is equal to person THEN
        PRINT "Found!"
    END
END$coding4_activity_code$,
  $coding4_activity_output$Found!$coding4_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses ASK input","Compares input to list items","Explains input-driven output"],"pass_threshold":1}'::jsonb,
  ARRAY['jargon.ask','jargon.foreach','logic.search'],
  1
),
(
  'coding5-practice',
  'coding5',
  1,
  'Final Logic Lab Trace',
  'code',
  'assessment',
  'Run the starter and trace how result changes before BREAK stops the loop.',
  'code',
  $coding5_activity_code$// Final logic lab starter
SET num (5)
SET result (1)
SET i (1)

REPEAT 100 times
    IF i is greater than num THEN
        PRINT result
        BREAK
    END
    SET result (result * i)
    SET i (i + 1)
END$coding5_activity_code$,
  $coding5_activity_output$120$coding5_activity_output$,
  '[]'::jsonb,
  '{"checks":["Uses loop, condition, and BREAK","Traces factorial state changes","Output matches expected result"],"pass_threshold":1}'::jsonb,
  ARRAY['jargon.repeat','jargon.break','logic.trace','logic.factorial'],
  1
)
on conflict (id) do update set
  lesson_id = excluded.lesson_id,
  position = excluded.position,
  title = excluded.title,
  activity_type = excluded.activity_type,
  stage = excluded.stage,
  prompt = excluded.prompt,
  response_mode = excluded.response_mode,
  starter_code = excluded.starter_code,
  expected_output = excluded.expected_output,
  choices = excluded.choices,
  rubric = excluded.rubric,
  skill_keys = excluded.skill_keys,
  pass_score = excluded.pass_score;
