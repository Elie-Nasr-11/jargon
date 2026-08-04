-- Systems Lab: a second demo class that exercises EVERYTHING the platform does.
--
-- One new global subject (Systems Thinking) with two lessons built to touch every
-- surface: a discussion lesson (explanation -> inquiry -> applied practice ->
-- open-ended assessment with rubric criteria) and a coding lesson (explanation ->
-- prediction -> runnable Jargon program -> MCQ with a bound quiz item). The lessons
-- ship with a PUBLISHED knowledge graph (ideas + step idea_keys, vocab, cross-subject
-- links into all three MVP subjects, and a teacher practice bank) so every brain hook
-- - recall openers, mastery compression, practice targeting, TEACHER BANK priority,
-- frontier mode offers, vocab taps, link toasts, strength halos - has signal from the
-- first turn. A DRAFT knowledge set (idea/vocab/link/practice) is also seeded so the
-- studio-lite Knowledge card opens with a real review queue. Lesson resources (a
-- YouTube embed + an external link) light up the media stage and welcome cards.
--
-- If the demo org exists (admin-seed "Demo Org"), a "Systems Lab" class is created
-- with the demo student + teacher enrolled, the course linked via class_courses, an
-- upcoming assignment (Work due) and a returned, scored assessment (Grades/AVG pill)
-- posted as checkpoints. Without the demo org the class block skips cleanly.
--
-- Deploy-order contract: 20260713000000_book_f_only_catalog.sql re-runs each deploy
-- and archives every published non-Book-F catalog row, so THIS FILE MUST BE
-- REGISTERED AFTER IT in the deploy workflow's migration list (same idiom as the
-- 20260801 MVP catalog). Idempotent: fixed text ids + on conflict do update for
-- catalog rows; not-exists guards for uuid-keyed rows. The starter program below was
-- run through the hardened interpreter; expected_output is its actual output.

-- ---------------------------------------------------------------------------
-- Subject / course / version / unit
-- ---------------------------------------------------------------------------

insert into public.subjects (id, title, description, status)
values
  ('mvp-systems', 'Systems Thinking', 'How things that change over time actually work: inputs, outputs, and the feedback loops that steer everything from thermostats to habits.', 'published')
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into public.courses (id, subject_id, title, description, status)
values
  ('mvp-systems-how-systems-work', 'mvp-systems', 'How Systems Work', 'Seeing the world as systems: what goes in, what comes out, and how feedback loops keep things steady - ending with a working thermostat model in Jargon.', 'published')
on conflict (id) do update set
  subject_id = excluded.subject_id,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into public.course_versions (id, course_id, version_label, status, is_current, content_schema_version)
values
  ('mvp-systems-how-systems-work-v1', 'mvp-systems-how-systems-work', 'v1', 'published', true, 1)
on conflict (id) do update set
  course_id = excluded.course_id,
  version_label = excluded.version_label,
  status = excluded.status,
  is_current = excluded.is_current,
  content_schema_version = excluded.content_schema_version,
  updated_at = now();

insert into public.units (id, course_version_id, position, title, description)
values
  ('mvp-systems-seeing-systems', 'mvp-systems-how-systems-work-v1', 1, 'Seeing Systems', 'Spotting the loop inside everyday things, then building one in code.')
on conflict (id) do update set
  course_version_id = excluded.course_version_id,
  position = excluded.position,
  title = excluded.title,
  description = excluded.description,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Lessons (global spine 231+; MVP catalog uses 201-221, Book F 101-117)
-- ---------------------------------------------------------------------------

insert into public.lessons (id, position, title, tutor_prompt, sample_code, expected_output, module, level, unit_id, unit_position, publication_status, help_ceiling, require_attempt_first, final_answer_policy, tutor_tone, tutor_pace, grade_band, allow_live_artifacts, curriculum_metadata)
values
(
  'mvp-sys-l1',
  231,
  'Feedback loops: how systems steer',
  'Help the learner discover that a feedback loop has three parts - a sensor that notices, a comparison against a goal, and a correction that pushes back - using everyday systems like thermostats, bike balance, and hunger. Draw the parts out of the learner''s own examples before naming them. Watch for the misconception that a loop is just "repetition": a feedback loop reacts to what it senses, it does not blindly repeat.',
  '',
  null,
  'Systems Thinking',
  'Beginner',
  'mvp-systems-seeing-systems',
  1,
  'published',
  'guided',
  true,
  'after_attempt',
  'friendly',
  'guided',
  '5-8',
  false,
  '{"course_id": "mvp-systems-how-systems-work", "course_version_id": "mvp-systems-how-systems-work-v1", "lesson_type": "discussion", "objective": "Identify the sensor, goal comparison, and correction in an everyday feedback loop."}'::jsonb
),
(
  'mvp-sys-l2',
  232,
  'Model a thermostat in Jargon',
  'Guide the learner to read, predict, and run a small Jargon program that models a thermostat: a REPEAT loop that senses the temperature, compares it with a goal using IF, and corrects by heating. Have them predict the output before running, then connect each printed line back to the loop part that produced it - the PRINT is the sensor reading, the IF is the comparison, the SET is the correction. Encourage one safe change afterwards, like the starting temperature or the goal.',
  '// A tiny thermostat: sense, compare, correct
SET temp (16)
SET goal (20)
REPEAT 4 times
    PRINT temp
    IF temp is less than goal THEN
        PRINT "Too cold - heater ON"
        SET temp (temp + 2)
    ELSE
        PRINT "Warm enough - heater OFF"
    END
END
PRINT "The feedback loop held the room near the goal."',
  '16
Too cold - heater ON
18
Too cold - heater ON
20
Warm enough - heater OFF
20
Warm enough - heater OFF
The feedback loop held the room near the goal.',
  'Systems Thinking',
  'Beginner',
  'mvp-systems-seeing-systems',
  2,
  'published',
  'guided',
  true,
  'after_attempt',
  'friendly',
  'guided',
  '5-8',
  true,
  '{"course_id": "mvp-systems-how-systems-work", "course_version_id": "mvp-systems-how-systems-work-v1", "lesson_type": "coding", "objective": "Predict and run a Jargon program that models a thermostat feedback loop with REPEAT, IF, and SET."}'::jsonb
)
on conflict (id) do update set
  position = excluded.position,
  title = excluded.title,
  tutor_prompt = excluded.tutor_prompt,
  sample_code = excluded.sample_code,
  expected_output = excluded.expected_output,
  module = excluded.module,
  level = excluded.level,
  unit_id = excluded.unit_id,
  unit_position = excluded.unit_position,
  publication_status = excluded.publication_status,
  help_ceiling = excluded.help_ceiling,
  require_attempt_first = excluded.require_attempt_first,
  final_answer_policy = excluded.final_answer_policy,
  tutor_tone = excluded.tutor_tone,
  tutor_pace = excluded.tutor_pace,
  grade_band = excluded.grade_band,
  allow_live_artifacts = excluded.allow_live_artifacts,
  curriculum_metadata = excluded.curriculum_metadata;

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------

insert into public.milestones (id, lesson_id, position, title, objective, level, skill_keys, expected_evidence, completion_rules, allowed_response_modes)
values
(
  'mvp-sys-l1-milestone',
  'mvp-sys-l1',
  1,
  'Take a feedback loop apart',
  'Name the three parts of a feedback loop - sensor, goal comparison, correction - and identify all three inside an everyday system the learner chose themselves.',
  'Beginner',
  ARRAY['systems.feedback_loop', 'systems.inputs_outputs']::text[],
  '{"student_can": ["name the three parts of a feedback loop", "find the parts inside an everyday system", "explain what breaks when the sensor fails"]}'::jsonb,
  '{"requires": ["student_explanation"], "min_score": 1}'::jsonb,
  ARRAY['text']::text[]
),
(
  'mvp-sys-l2-milestone',
  'mvp-sys-l2',
  1,
  'Run a thermostat model',
  'Predict the output of the thermostat program, run it successfully, and map each printed line to the loop part (sensor, comparison, correction) that produced it.',
  'Beginner',
  ARRAY['systems.modeling', 'systems.feedback_loop', 'jargon.if', 'jargon.repeat']::text[],
  '{"student_can": ["predict the program output before running", "run the model successfully", "map PRINT, IF, and SET to sensor, comparison, and correction"]}'::jsonb,
  '{"requires": ["successful_code_run", "quiz_passed"], "min_score": 1}'::jsonb,
  ARRAY['text', 'code', 'multiple_choice']::text[]
)
on conflict (id) do update set
  lesson_id = excluded.lesson_id,
  position = excluded.position,
  title = excluded.title,
  objective = excluded.objective,
  level = excluded.level,
  skill_keys = excluded.skill_keys,
  expected_evidence = excluded.expected_evidence,
  completion_rules = excluded.completion_rules,
  allowed_response_modes = excluded.allowed_response_modes,
  updated_at = now();

update public.lessons set milestone_id = 'mvp-sys-l1-milestone' where id = 'mvp-sys-l1';
update public.lessons set milestone_id = 'mvp-sys-l2-milestone' where id = 'mvp-sys-l2';

-- ---------------------------------------------------------------------------
-- Steps. idea_keys binds each step to the knowledge graph below, so mastery
-- evidence, recall openers, and step-tier grading all engage on this content.
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type, idea_keys)
values
(
  'mvp-sys-l1-s1',
  'mvp-sys-l1',
  'mvp-sys-l1-milestone',
  1,
  'Loops that notice and push back',
  'discussion',
  'intro',
  'A system is anything that takes inputs, does something, and produces outputs - a bathtub, a classroom, your body. The most interesting systems steer themselves with a feedback loop, which always has three parts: a sensor that notices how things are, a comparison against a goal, and a correction that pushes things back toward the goal. A thermostat is the classic one: it senses the room temperature, compares it with the number on the dial, and switches the heater on or off. No part is optional - remove any one and the room drifts.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.feedback_loop', 'systems.inputs_outputs']::text[],
  1,
  'explanation',
  null,
  ARRAY['feedback-loop', 'inputs-and-outputs']::text[]
),
(
  'mvp-sys-l1-s2',
  'mvp-sys-l1',
  'mvp-sys-l1-milestone',
  2,
  'Investigate: how do you not fall off a bike?',
  'discussion',
  'teach',
  'Riding a bike without falling is a feedback loop running many times a second. Investigate it with the mentor: what is the sensor, what is the goal, and what is the correction? Then push further - why can''t you balance a bike that is standing still, and what does that say about how often the loop needs to run? Try to find one more loop your own body runs without you thinking about it.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.feedback_loop']::text[],
  1,
  'inquiry',
  null,
  ARRAY['feedback-loop']::text[]
),
(
  'mvp-sys-l1-s3',
  'mvp-sys-l1',
  'mvp-sys-l1-milestone',
  3,
  'Take apart a system you own',
  'discussion',
  'practice',
  'Choose one everyday system - a fridge, a phone battery saver, feeling hungry and eating, a game''s difficulty that adapts to you. Name its inputs and outputs, then find the loop: what senses, what goal is compared against, and what corrects. Finish with the breakage test: say exactly what would happen to your system if the sensor stopped working but everything else kept running.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.feedback_loop', 'systems.inputs_outputs']::text[],
  1,
  'practice',
  'applied',
  ARRAY['feedback-loop', 'inputs-and-outputs']::text[]
),
(
  'mvp-sys-l1-s4',
  'mvp-sys-l1',
  'mvp-sys-l1-milestone',
  4,
  'Explain the loop in a new system',
  'discussion',
  'assessment',
  'Here is a system you have not taken apart yet: a school water fountain that keeps its tank full. Explain how it could steer itself: name the sensor, the goal comparison, and the correction, and say what the inputs and outputs of the whole system are. Then answer the breakage test - what happens to the tank if the sensor jams and always reports "full"?',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{"criteria": ["names a plausible sensor", "states the goal comparison", "describes the correction", "identifies inputs and outputs", "reasons correctly about the jammed sensor"]}'::jsonb,
  ARRAY['systems.feedback_loop', 'systems.inputs_outputs']::text[],
  1,
  'assessment',
  'open_ended',
  ARRAY['feedback-loop', 'inputs-and-outputs']::text[]
),
(
  'mvp-sys-l2-s1',
  'mvp-sys-l2',
  'mvp-sys-l2-milestone',
  1,
  'A program can be a model',
  'discussion',
  'intro',
  'Scientists and engineers rarely test ideas on the real thing first - they build a model, a simplified copy that behaves like the real system in the ways that matter. A program makes a great model because it is exact: the thermostat model in this lesson uses SET to hold the temperature, REPEAT to run the loop again and again, and IF to make the comparison a real decision. When the model runs, you can watch the feedback loop steer the number toward the goal - the same shape as the real room, with none of the waiting.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.modeling']::text[],
  1,
  'explanation',
  null,
  ARRAY['model-the-world']::text[]
),
(
  'mvp-sys-l2-s2',
  'mvp-sys-l2',
  'mvp-sys-l2-milestone',
  2,
  'Predict the thermostat',
  'reflection',
  'practice',
  'Read the starter program in the next step line by line before running anything. The temperature starts at 16 and the goal is 20. Write down exactly what you think it will print, in order - every temperature reading and every heater message. How many times does the heater turn on? What happens in the loop runs after the room reaches the goal?',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.modeling', 'jargon.if']::text[],
  1,
  'reflection',
  null,
  ARRAY['model-the-world', 'feedback-loop']::text[]
),
(
  'mvp-sys-l2-s3',
  'mvp-sys-l2',
  'mvp-sys-l2-milestone',
  3,
  'Run the model',
  'code',
  'practice',
  'Run the thermostat and compare the output with your prediction line by line. Then map the code to the loop: which line is the sensor reading, which line is the comparison, and which line is the correction? Make one safe change - start the room colder, or move the goal - predict again, and run again. If the output ever surprises you, find the loop part responsible before moving on.',
  'code',
  '// A tiny thermostat: sense, compare, correct
SET temp (16)
SET goal (20)
REPEAT 4 times
    PRINT temp
    IF temp is less than goal THEN
        PRINT "Too cold - heater ON"
        SET temp (temp + 2)
    ELSE
        PRINT "Warm enough - heater OFF"
    END
END
PRINT "The feedback loop held the room near the goal."',
  '16
Too cold - heater ON
18
Too cold - heater ON
20
Warm enough - heater OFF
20
Warm enough - heater OFF
The feedback loop held the room near the goal.',
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.modeling', 'jargon.if', 'jargon.repeat']::text[],
  1,
  'practice',
  'code',
  ARRAY['model-the-world', 'feedback-loop']::text[]
),
(
  'mvp-sys-l2-s4',
  'mvp-sys-l2',
  'mvp-sys-l2-milestone',
  4,
  'Check: which line is the sensor?',
  'multiple_choice',
  'assessment',
  'In the thermostat model, which line plays the role of the SENSOR in the feedback loop?',
  'multiple_choice',
  '',
  null,
  '[{"id": "a", "text": "PRINT temp - it reads out the current state of the system each time around."}, {"id": "b", "text": "SET goal (20) - it decides what the room should be."}, {"id": "c", "text": "SET temp (temp + 2) - it changes the temperature."}, {"id": "d", "text": "REPEAT 4 times - it makes the program run again."}]'::jsonb,
  '{}'::jsonb,
  ARRAY['systems.modeling', 'systems.feedback_loop']::text[],
  1,
  'assessment',
  'mcq',
  ARRAY['model-the-world', 'feedback-loop']::text[]
)
on conflict (id) do update set
  lesson_id = excluded.lesson_id,
  milestone_id = excluded.milestone_id,
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
  pass_score = excluded.pass_score,
  mode = excluded.mode,
  mode_type = excluded.mode_type,
  idea_keys = excluded.idea_keys;

insert into public.quiz_items (id, lesson_id, milestone_id, activity_id, position, prompt, question_type, choices, correct_choice_ids, rubric, skill_keys, status)
values
(
  'mvp-sys-l2-s4-quiz',
  'mvp-sys-l2',
  'mvp-sys-l2-milestone',
  'mvp-sys-l2-s4',
  4,
  'In the thermostat model, which line plays the role of the SENSOR in the feedback loop?',
  'multiple_choice',
  '[{"id": "a", "text": "PRINT temp - it reads out the current state of the system each time around."}, {"id": "b", "text": "SET goal (20) - it decides what the room should be."}, {"id": "c", "text": "SET temp (temp + 2) - it changes the temperature."}, {"id": "d", "text": "REPEAT 4 times - it makes the program run again."}]'::jsonb,
  ARRAY['a']::text[],
  '{}'::jsonb,
  ARRAY['systems.feedback_loop']::text[],
  'published'
)
on conflict (id) do update set
  lesson_id = excluded.lesson_id,
  milestone_id = excluded.milestone_id,
  activity_id = excluded.activity_id,
  position = excluded.position,
  prompt = excluded.prompt,
  question_type = excluded.question_type,
  choices = excluded.choices,
  correct_choice_ids = excluded.correct_choice_ids,
  rubric = excluded.rubric,
  skill_keys = excluded.skill_keys,
  status = excluded.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- PUBLISHED knowledge graph: ideas, vocab, cross-subject links, practice bank.
-- Links reach into all three MVP subjects so frontier offers and vocab bridges
-- have real cross-subject targets from the first session.
-- ---------------------------------------------------------------------------

insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select v.key, v.title, v.one_liner, v.subject, v.lesson_id, 'published'
from (values
  ('feedback-loop', 'Feedback loops steer systems',
   'Sensor, goal comparison, correction: a loop that notices and pushes back is how systems steer themselves.',
   'How Systems Work', 'mvp-sys-l1'),
  ('inputs-and-outputs', 'Inputs and outputs',
   'Every system takes something in, does something, and puts something out - name those and you can take anything apart.',
   'How Systems Work', 'mvp-sys-l1'),
  ('model-the-world', 'Programs can model the world',
   'A program can be a simplified copy of a real system - exact enough to test ideas on, fast enough to watch.',
   'How Systems Work', 'mvp-sys-l2')
) as v(key, title, one_liner, subject, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select v.term, v.variants, v.definition, v.subject, v.idea_keys, v.lesson_id, 'published'
from (values
  ('system', array['systems'],
   'Anything that takes inputs, does something, and produces outputs - a bathtub, a body, a game.',
   'How Systems Work', array['inputs-and-outputs'], 'mvp-sys-l1'),
  ('feedback', array['feedback loop', 'feedback loops'],
   'Information about how things are going, fed back in so the system can correct itself.',
   'How Systems Work', array['feedback-loop'], 'mvp-sys-l1'),
  ('sensor', array['sensors', 'sensing'],
   'The part of a loop that notices the current state - a thermometer, your eyes, PRINT temp.',
   'How Systems Work', array['feedback-loop'], 'mvp-sys-l1'),
  ('input', array['inputs'],
   'What goes INTO a system - the water into the tub, the food into you, the value into a program.',
   'How Systems Work', array['inputs-and-outputs'], 'mvp-sys-l1'),
  ('output', array['outputs'],
   'What comes OUT of a system - the warm room, the printed line, the finished result.',
   'How Systems Work', array['inputs-and-outputs'], 'mvp-sys-l1'),
  ('model', array['models', 'modeling', 'modelling'],
   'A simplified copy of something real that behaves the same way in the parts that matter.',
   'How Systems Work', array['model-the-world'], 'mvp-sys-l2')
) as v(term, variants, definition, subject, idea_keys, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.curriculum_links (from_key, to_key, kind, note, status)
select v.from_key, v.to_key, v.kind, v.note, 'published'
from (values
  ('feedback-loop', 'state-and-repetition', 'vocab_bridge',
   'The word "loop" travels: REPEAT loops in code and feedback loops in systems both come back around - but a feedback loop reacts to what it senses.'),
  ('inputs-and-outputs', 'exact-instructions', 'same_pattern',
   'A system runs inputs through steps to outputs exactly the way a program runs instructions in order.'),
  ('feedback-loop', 'claims-vs-reasons', 'same_pattern',
   'Updating a belief when the evidence pushes back IS a feedback loop for thinking - the check is the sensor.'),
  ('inputs-and-outputs', 'fractions-as-division', 'contrast',
   'A fraction splits one fixed whole into fair shares; a system keeps taking new input - a snapshot versus a flow.'),
  ('model-the-world', 'exact-instructions', 'prerequisite',
   'You can only model a system in code once you can write exact, ordered instructions for it.')
) as v(from_key, to_key, kind, note)
on conflict do nothing;

-- Teacher practice bank (published): the chat fn uses these FIRST for practice on
-- these ideas. No unique constraint on practice_items, so guard by idea_key+prompt.
insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'published'
from (values
  ('feedback-loop', 'mvp-sys-l1',
   'Your body keeps its temperature near 37 degrees. Name the sensor, the goal comparison, and the correction in that loop.',
   'Identifies a plausible sensor (nerves/skin), the 37-degree set point as the goal, and shivering or sweating as the correction.',
   'intro'),
  ('feedback-loop', 'mvp-sys-l1',
   'A gamer complains a game "gets harder exactly when I get good at it". Explain the feedback loop the game is running on the player.',
   'Describes the game sensing player performance, comparing it against a target difficulty or win rate, and correcting by raising or lowering challenge.',
   'core'),
  ('feedback-loop', 'mvp-sys-l1',
   'Design a feedback loop that would help a student keep a homework streak going. Name all three parts and one way the loop could fail.',
   'Invents a sensor (streak tracker), a goal comparison (streak target), a correction (reminder or reward), and a plausible failure such as the sensor not counting a day.',
   'stretch'),
  ('inputs-and-outputs', 'mvp-sys-l1',
   'Pick a toaster. What are its inputs, what are its outputs, and what happens in between?',
   'Names bread and electricity (and a setting) as inputs, toast and heat as outputs, and heating as the process.',
   'intro'),
  ('inputs-and-outputs', 'mvp-sys-l1',
   'Two systems are connected: a kettle and a person making tea. Trace how an output of one becomes an input of the other.',
   'Shows the kettle''s output (hot water) becoming the person''s input, or the person''s action as input to the kettle - any correct chaining of output to input.',
   'core'),
  ('model-the-world', 'mvp-sys-l2',
   'The thermostat model heats by exactly 2 degrees each loop. Name one way that makes the model simpler than a real room, and why it is still useful.',
   'Recognizes the simplification (real rooms heat unevenly/gradually, lose heat) and that the model still shows the loop''s steering behavior.',
   'core'),
  ('model-the-world', 'mvp-sys-l2',
   'Change the thermostat model in words: what would you edit so the room can also COOL when it gets above the goal, and what new output would you expect?',
   'Proposes a second comparison or an ELSE branch that lowers temp when above goal, and predicts cooling messages in the output.',
   'stretch')
) as v(idea_key, lesson_id, prompt, expected, difficulty)
where not exists (
  select 1 from public.practice_items p
  where p.idea_key = v.idea_key and p.prompt = v.prompt
);

-- ---------------------------------------------------------------------------
-- DRAFT knowledge (the studio-lite Knowledge card opens with a review queue:
-- publish or discard these on lesson mvp-sys-l1 to demo the Phase D flow).
-- ---------------------------------------------------------------------------

insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select 'equilibrium', 'Equilibrium: when the loop wins',
  'A system sits at equilibrium when its feedback loop cancels every push away from the goal.',
  'How Systems Work', 'mvp-sys-l1', 'draft'
where exists (select 1 from public.lessons l where l.id = 'mvp-sys-l1')
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select 'equilibrium', array['equilibria', 'balance point'],
  'The steady state a system settles into when its corrections cancel out the pushes.',
  'How Systems Work', array['equilibrium'], 'mvp-sys-l1', 'draft'
where exists (select 1 from public.lessons l where l.id = 'mvp-sys-l1')
on conflict do nothing;

insert into public.curriculum_links (from_key, to_key, kind, note, status)
values
  ('equilibrium', 'feedback-loop', 'prerequisite',
   'You need the loop before the balance: equilibrium is what a working feedback loop produces.', 'draft')
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'draft'
from (values
  ('feedback-loop', 'mvp-sys-l1',
   'A shower takes 10 seconds to respond when you turn the knob. Why does that delay make the temperature swing hot and cold?',
   'Connects the sensing/correction delay to overshooting: corrections keep arriving for a state that has already changed.',
   'stretch'),
  ('inputs-and-outputs', 'mvp-sys-l1',
   'Name a system where one of the outputs is ALSO one of the inputs. What does that make the system do?',
   'Gives a loop example (savings interest, microphone feedback, rumor spreading) and notes the self-feeding growth or steering it causes.',
   'core')
) as v(idea_key, lesson_id, prompt, expected, difficulty)
where not exists (
  select 1 from public.practice_items p
  where p.idea_key = v.idea_key and p.prompt = v.prompt
);

-- ---------------------------------------------------------------------------
-- Lesson resources: a YouTube embed (media stage) + an external link (welcome
-- cards / plus-menu references). Global rows: visibility public, no org.
-- ---------------------------------------------------------------------------

insert into public.lesson_resources (lesson_id, title, description, resource_type, source_type, external_url, student_instructions, status, visibility)
select v.lesson_id, v.title, v.description, v.resource_type, 'external_url', v.external_url, v.student_instructions, 'published', 'public'
from (values
  ('mvp-sys-l1', 'Watch: feedback loops in nature',
   'A short animated tour of the feedback loops that keep ecosystems steady.',
   'youtube', 'https://www.youtube.com/embed/inVZoI1AkC8',
   'Watch for the three parts of the loop: what senses, what compares, what corrects.'),
  ('mvp-sys-l1', 'Read: feedback',
   'A reference article on feedback - skim the intro and the everyday examples.',
   'link', 'https://en.wikipedia.org/wiki/Feedback',
   'Skim the opening section and find one example we did not discuss in the lesson.')
) as v(lesson_id, title, description, resource_type, external_url, student_instructions)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (
    select 1 from public.lesson_resources r
    where r.lesson_id = v.lesson_id and r.title = v.title
  );

-- ---------------------------------------------------------------------------
-- Class wiring: "Systems Lab" in the demo org, demo student + teacher enrolled,
-- course linked, one upcoming assignment (Work due) and one returned assessment
-- with a score (Grades / AVG pill). Skips cleanly when the demo org is absent.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid;
  v_student uuid;
  v_teacher uuid;
  v_class uuid;
  v_cp uuid;
  v_cp2 uuid;
begin
  select id into v_org from public.organizations where slug = 'demo-org' limit 1;
  select id into v_student from auth.users where email = 'demo-student@example.com' limit 1;
  select id into v_teacher from auth.users where email = 'demo-teacher@example.com' limit 1;
  if v_org is null or v_student is null then
    raise notice 'Systems Lab demo: demo org or demo student not seeded; skipping class wiring.';
    return;
  end if;

  select id into v_class from public.classes
    where organization_id = v_org and name = 'Systems Lab' limit 1;
  if v_class is null then
    insert into public.classes (organization_id, name, status, created_by)
    values (v_org, 'Systems Lab', 'active', v_teacher)
    returning id into v_class;
  end if;

  insert into public.class_memberships (class_id, user_id, role, status)
  values (v_class, v_student, 'student', 'active')
  on conflict (class_id, user_id) do update set status = 'active', updated_at = now();
  if v_teacher is not null then
    insert into public.class_memberships (class_id, user_id, role, status)
    values (v_class, v_teacher, 'teacher', 'active')
    on conflict (class_id, user_id) do update set status = 'active', updated_at = now();
  end if;

  insert into public.class_courses (class_id, course_id, created_by)
  values (v_class, 'mvp-systems-how-systems-work', v_teacher)
  on conflict (class_id, course_id) do nothing;

  -- Upcoming assignment -> Work due row. Due date refreshes on redeploy once past,
  -- so the demo never shows a stale overdue post.
  select id into v_cp from public.checkpoints
    where class_id = v_class and title = 'Feedback hunt: find a loop at home' limit 1;
  if v_cp is null then
    insert into public.checkpoints (kind, organization_id, class_id, course_id, lesson_id, title, instructions, created_by, status, due_at)
    values ('assignment', v_org, v_class, 'mvp-systems-how-systems-work', 'mvp-sys-l1',
      'Feedback hunt: find a loop at home',
      'Find one feedback loop somewhere in your home and write it up: the system, its inputs and outputs, and the three loop parts (sensor, goal comparison, correction). Finish with the breakage test - what happens if the sensor fails?',
      v_teacher, 'published', now() + interval '7 days')
    returning id into v_cp;
  else
    update public.checkpoints
      set due_at = now() + interval '7 days', updated_at = now()
      where id = v_cp and (due_at is null or due_at < now());
  end if;
  insert into public.checkpoint_recipients (checkpoint_id, user_id, status)
  select v_cp, v_student, 'assigned'
  where not exists (
    select 1 from public.checkpoint_recipients r
    where r.checkpoint_id = v_cp and r.user_id = v_student
  );

  -- Returned, scored assessment -> Grades row + the Home AVG pill.
  select id into v_cp2 from public.checkpoints
    where class_id = v_class and title = 'Systems check: the sensor question' limit 1;
  if v_cp2 is null then
    insert into public.checkpoints (kind, organization_id, class_id, course_id, lesson_id, title, instructions, created_by, status, due_at)
    values ('assessment', v_org, v_class, 'mvp-systems-how-systems-work', 'mvp-sys-l2',
      'Systems check: the sensor question',
      'One question on the thermostat model: identify the sensor line and defend the choice.',
      v_teacher, 'published', now() - interval '3 days')
    returning id into v_cp2;
    insert into public.checkpoint_items (checkpoint_id, quiz_item_id, position, points)
    values (v_cp2, 'mvp-sys-l2-s4-quiz', 1, 1)
    on conflict do nothing;
  end if;
  insert into public.checkpoint_recipients (checkpoint_id, user_id, status, score, final_score, submitted_at, returned_at)
  select v_cp2, v_student, 'returned', 0.9, 0.9, now() - interval '4 days', now() - interval '2 days'
  where not exists (
    select 1 from public.checkpoint_recipients r
    where r.checkpoint_id = v_cp2 and r.user_id = v_student
  );
end $$;
