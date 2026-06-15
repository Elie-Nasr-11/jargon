-- Jargon platform schema: public lessons + per-user profiles, chat, and code.

-- Lessons: the curriculum. Readable by everyone (including anon).
create table public.lessons (
  id text primary key,
  position integer not null,
  title text not null,
  tutor_prompt text not null,
  sample_code text not null default ''
);
alter table public.lessons enable row level security;
create policy "Lessons are readable by everyone"
  on public.lessons for select
  using (true);

-- Profiles: one row per auth user (name + grade).
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  grade text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Chat messages: saved Mentor conversation, per user + lesson.
create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text not null references public.lessons on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
create policy "Users manage own chat messages"
  on public.chat_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index chat_messages_user_lesson_idx
  on public.chat_messages (user_id, lesson_id, created_at);

-- Code submissions: saved editor runs, per user + lesson.
create table public.code_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  lesson_id text not null references public.lessons on delete cascade,
  code text not null,
  output text,
  created_at timestamptz not null default now()
);
alter table public.code_submissions enable row level security;
create policy "Users manage own code submissions"
  on public.code_submissions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index code_submissions_user_lesson_idx
  on public.code_submissions (user_id, lesson_id, created_at desc);

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, grade)
  values (
    new.id,
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'grade'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seed the five lessons (dollar-quoted to avoid escaping).
insert into public.lessons (id, position, title, tutor_prompt, sample_code) values
('lesson1', 1, 'Purpose', $lp$Technology is any tool or machine that is made to serve a purpose. Each is used to perform a particular task.

Examples:
- Hammer: hammers in nails.
- Screwdriver: drives in screws.
- Car: transports few people.
- Bus: transports many people.
- Space shuttle: flies people to space.
- Airplane: flies people to different locations on Earth.

The computer is a form of technology. Personal computers (PCs) are general-purpose technology. There are four types:
- Desktop
- Laptop
- Tablet
- Smartphone

Uses of personal computers:
- Reading e-books
- Playing games
- Watching videos
- Studying, online classes, homework
- Work: doctors, teachers, artists
- Communication: video chatting, online classes

Specific-purpose computers:
- Embedded computers: control the machines they're inside (e.g., elevator, car engine, brakes).
- Servers: handle many small requests from clients (e.g., YouTube, Amazon).
- Supercomputers: handle one big problem (e.g., weather prediction).

Summary:
- General-purpose tech = many uses (e.g., PCs)
- Specific-purpose tech = one main task (e.g., embedded computers)
- Four computer types: embedded, personal, servers, supercomputers
$lp$, $lc$// Lesson 1 - Purpose
// Write your Jargon code here, then press Run Code.
// (Placeholder starter - replace with a real Jargon exercise.)
$lc$),
('lesson2', 2, 'Systems & Signals', $lp$A system is something made of parts working together to serve a purpose or cause change.

Examples:
- Bicycle: foot pressure -> spinning wheel
- Human: hearing a question -> responding with speech
- Computer: key press -> letters on screen

A signal is a message in physical form (e.g., sound, light, pressure).

Input: capturing a signal
Output: emitting a signal

Personal computers have:
Input devices:
- Keyboard, mouse, touchpad (pressure)
- Microphone (sound)
- Camera (light)

Output devices:
- Screen (light)
- Speaker (sound)
- Vibration motor (pressure)

Humans:
Input: ears, eyes, skin
Output: mouth (speech), arms and legs (movement)

Embedded computers:
- Use sensors (e.g., infrared, heat)
- Use input panels
- Use actuators (motors for movement/output)

Example: Elevator
- Inputs: button panel, door sensors
- Outputs: screen, speaker, motor that moves doors or cabin
$lp$, $lc$// Lesson 2 - Systems & Signals
// Write your Jargon code here, then press Run Code.
// (Placeholder starter - replace with a real Jargon exercise.)
$lc$),
('lesson3', 3, 'Signal Processing', $lp$Processing = changing input signals to output signals using the processor.

Processors only understand electronic signals. Input devices convert physical signals (sound, light, pressure) into electronic signals. Output devices do the reverse.

The interface is the boundary where this translation happens.
- Auditory interface = sound signals
- Visual interface = light signals

Examples:
- Microphone hears "Hey Siri" (sound -> electronic)
- Processor processes
- Speaker says "How can I help you?" (electronic -> sound)

Actuators (in embedded systems) produce physical movement, not signals.
- Elevator motor moves doors or cabin

Humans process signals too:
- Eyes, ears, skin -> brain -> limbs, mouth
- But use action potential signals (not electronic)
$lp$, $lc$// Lesson 3 - Signal Processing
// Write your Jargon code here, then press Run Code.
// (Placeholder starter - replace with a real Jargon exercise.)
$lc$),
('lesson4', 4, 'Memory', $lp$Memory holds signals inside the computer.

Main Memory:
- Holds input signals before processing
- Holds output signals after processing
- Volatile (erased when power is off)

Storage:
- Non-volatile (data saved even when power is off)
- Larger than main memory
- Stores files and processed data

Example:
Leena takes a photo:
- Camera -> main memory -> processor -> screen (display)
- Then: saved -> storage
- Later: loaded back to memory from storage

Drives:
- HDD (Hard Disk Drive): magnetic disks, larger and heavier
- SSD (Solid State Drive): microchips, smaller and lighter

Main memory is limited; storage helps keep unused signals safe.
$lp$, $lc$// Lesson 4 - Memory
// Write your Jargon code here, then press Run Code.
// (Placeholder starter - replace with a real Jargon exercise.)
$lc$),
('lesson5', 5, 'Exchanging Signals', $lp$Systems can exchange signals across an interface.

For signal exchange:
1. Signals must be able to travel.
2. Each system must understand the signals.

Human-computer:
- Via user interface (sound, light, pressure)

Computer-computer:
- Use radio wave signals or cables

Wireless Technologies:
- Bluetooth: short distance (up to 10m)
- WiFi: medium (up to 100m)
- Cellular: long (up to 1000m)

Wired Interfaces:
- Use network cables, electronic signals
- Use network ports

Access points:
- Gateway device (WiFi)
- Cell tower (Cellular)

The Internet:
- A system that carries signals across long distances
- Computers send signals through antennas (wireless) or ports (wired)
- Example: Sarah watching YouTube (smartphone <-> cell tower <-> Internet <-> server)
$lp$, $lc$// Lesson 5 - Exchanging Signals
// Write your Jargon code here, then press Run Code.
// (Placeholder starter - replace with a real Jargon exercise.)
$lc$);
