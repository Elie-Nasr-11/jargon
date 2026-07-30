-- MVP multi-subject demo catalog (docs/MVP_SCOPE.md, owner decision 5).
--
-- Three small global subjects (organization_id NULL, everything published) so the demo
-- shows breadth beyond Book F: Coding Foundations (two lessons, one runnable Jargon
-- program), Clear Thinking (one discussion lesson), Math Reasoning (one lesson with a
-- bound checkpoint quiz). Additive only: no Book F (itf-*) rows and no retired demo
-- (lesson*/coding*) rows are touched.
--
-- Idempotent: fixed text ids + on conflict (id) do update (the Book F seed idiom), safe
-- to re-run. Deploy-order contract: 20260713000000_book_f_only_catalog.sql re-runs on
-- every deploy and archives every published subject/course/version/lesson/quiz outside
-- Book F, so THIS FILE MUST BE REGISTERED AFTER IT in the deploy workflow's migration
-- list — each re-run then re-publishes this catalog after the sweep, which is exactly
-- how the "do update ... status = excluded.status" idiom keeps it visible.
--
-- lessons.allow_live_artifacts is created by 20260901000000_live_artifact_scoping.sql,
-- which sorts AFTER this file; the identical guarded alter below keeps plain
-- filename-order application (fresh database) working. Definitions match exactly, so
-- whichever runs first wins and the other is a no-op.

alter table public.lessons
  add column if not exists allow_live_artifacts boolean not null default false;

-- ---------------------------------------------------------------------------
-- Subjects
-- ---------------------------------------------------------------------------

insert into public.subjects (id, title, description, status)
values
  ('mvp-coding', 'Coding Foundations', 'What programs are and how to think in ordered instructions, ending in your first runnable Jargon program.', 'published'),
  ('mvp-thinking', 'Clear Thinking', 'Everyday reasoning skills: telling claims from reasons and judging whether a reason actually supports a claim.', 'published'),
  ('mvp-math', 'Math Reasoning', 'Number sense built on meaning, not memorization — starting with why a fraction is a division in disguise.', 'published')
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------

insert into public.courses (id, subject_id, title, description, status)
values
  ('mvp-coding-thinking-in-jargon', 'mvp-coding', 'Thinking in Jargon', 'From "what is a program?" to writing and running your first Jargon program with SET, PRINT, and REPEAT.', 'published'),
  ('mvp-thinking-reasoning-well', 'mvp-thinking', 'Reasoning Well', 'How to spot a claim, find the reasons offered for it, and test whether those reasons are any good.', 'published'),
  ('mvp-math-number-sense', 'mvp-math', 'Number Sense', 'Why the rules of arithmetic work, beginning with fractions as fair sharing.', 'published')
on conflict (id) do update set
  subject_id = excluded.subject_id,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Course versions
-- ---------------------------------------------------------------------------

insert into public.course_versions (id, course_id, version_label, status, is_current, content_schema_version)
values
  ('mvp-coding-thinking-in-jargon-v1', 'mvp-coding-thinking-in-jargon', 'v1', 'published', true, 1),
  ('mvp-thinking-reasoning-well-v1', 'mvp-thinking-reasoning-well', 'v1', 'published', true, 1),
  ('mvp-math-number-sense-v1', 'mvp-math-number-sense', 'v1', 'published', true, 1)
on conflict (id) do update set
  course_id = excluded.course_id,
  version_label = excluded.version_label,
  status = excluded.status,
  is_current = excluded.is_current,
  content_schema_version = excluded.content_schema_version,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------

insert into public.units (id, course_version_id, position, title, description)
values
  ('mvp-coding-first-steps', 'mvp-coding-thinking-in-jargon-v1', 1, 'First Steps', 'What a program is, and your first runnable Jargon program.'),
  ('mvp-thinking-claims-and-reasons', 'mvp-thinking-reasoning-well-v1', 1, 'Claims and Reasons', 'Separating what someone believes from why they believe it, and testing the why.'),
  ('mvp-math-fractions-refresher', 'mvp-math-number-sense-v1', 1, 'Fractions Refresher', 'Fractions as fair sharing: why the bar in a fraction means divide.')
on conflict (id) do update set
  course_version_id = excluded.course_version_id,
  position = excluded.position,
  title = excluded.title,
  description = excluded.description,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Lessons (global spine positions 201+ stay clear of Book F at 101-117)
-- ---------------------------------------------------------------------------

insert into public.lessons (id, position, title, tutor_prompt, sample_code, expected_output, module, level, unit_id, unit_position, publication_status, help_ceiling, require_attempt_first, final_answer_policy, tutor_tone, tutor_pace, grade_band, allow_live_artifacts, curriculum_metadata)
values
(
  'mvp-coding-l1',
  201,
  'What is a program?',
  'Help the learner discover that a program is just an ordered list of exact instructions, and that computers follow instructions literally without guessing. Draw out everyday examples of instruction-following (recipes, directions, game rules) before naming the idea. No code is written in this lesson; the goal is the concept of exact, ordered steps.',
  '',
  null,
  'Coding Foundations',
  'Beginner',
  'mvp-coding-first-steps',
  1,
  'published',
  'guided',
  true,
  'after_attempt',
  'friendly',
  'guided',
  '5-8',
  true,
  '{"course_id": "mvp-coding-thinking-in-jargon", "course_version_id": "mvp-coding-thinking-in-jargon-v1", "lesson_type": "discussion", "objective": "Explain that a program is an ordered list of exact instructions a computer follows literally."}'::jsonb
),
(
  'mvp-coding-l2',
  202,
  'Your first Jargon program',
  'Guide the learner to read, predict, and then run their first Jargon program using SET, PRINT, and REPEAT. Have them predict the output line by line before running, then connect each output line back to the instruction that produced it. Celebrate the first successful run and encourage one small safe change, such as the name or the repeat count.',
  '// Your first Jargon program
SET name ("Jargon")
PRINT ("Hello, " + name + "!")
REPEAT 3 times
    PRINT "Programs follow instructions in order."
END',
  'Hello, Jargon!
Programs follow instructions in order.
Programs follow instructions in order.
Programs follow instructions in order.',
  'Coding Foundations',
  'Beginner',
  'mvp-coding-first-steps',
  2,
  'published',
  'guided',
  true,
  'after_attempt',
  'friendly',
  'guided',
  '5-8',
  true,
  '{"course_id": "mvp-coding-thinking-in-jargon", "course_version_id": "mvp-coding-thinking-in-jargon-v1", "lesson_type": "coding", "objective": "Read, predict, and run a first Jargon program using SET, PRINT, and REPEAT."}'::jsonb
),
(
  'mvp-thinking-l1',
  211,
  'Spotting a good reason',
  'Lead a Socratic discussion that separates claims (what someone believes) from reasons (why they believe it), then builds a two-part test for a good reason: it must be relevant to the claim and checkable by someone else. Push the learner to generate their own examples and counterexamples rather than supplying them. This is a discussion lesson with no code.',
  '',
  null,
  'Clear Thinking',
  'Beginner',
  'mvp-thinking-claims-and-reasons',
  1,
  'published',
  'guided',
  true,
  'after_attempt',
  'friendly',
  'guided',
  '5-8',
  false,
  '{"course_id": "mvp-thinking-reasoning-well", "course_version_id": "mvp-thinking-reasoning-well-v1", "lesson_type": "discussion", "objective": "Distinguish claims from reasons and judge reasons with the relevant-and-checkable test."}'::jsonb
),
(
  'mvp-math-l1',
  221,
  'Why fractions are division',
  'Help the learner see that the fraction bar means divide: three fourths is literally 3 divided by 4, the amount each person gets when 3 things are shared fairly among 4 people. Anchor everything in fair-sharing stories before using symbols, and have the learner narrate the sharing out loud. Watch for the common misconception that the bottom number is "how many pieces exist" rather than "how many ways we split".',
  '',
  null,
  'Math Reasoning',
  'Beginner',
  'mvp-math-fractions-refresher',
  1,
  'published',
  'guided',
  true,
  'after_attempt',
  'friendly',
  'guided',
  '5-8',
  false,
  '{"course_id": "mvp-math-number-sense", "course_version_id": "mvp-math-number-sense-v1", "lesson_type": "discussion", "objective": "Explain a fraction as a division: a divided by b is the fair share when a things are split among b people."}'::jsonb
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
-- Milestones (one per lesson; the chat runtime loads the milestone via the
-- activity's milestone_id and the lesson's primary pointer, mirroring Book F)
-- ---------------------------------------------------------------------------

insert into public.milestones (id, lesson_id, position, title, objective, level, skill_keys, expected_evidence, completion_rules, allowed_response_modes)
values
(
  'mvp-coding-l1-milestone',
  'mvp-coding-l1',
  1,
  'Explain what a program is',
  'Explain that a program is an ordered list of exact instructions that a computer follows literally, and produce a correct ordered instruction list for an everyday task.',
  'Beginner',
  ARRAY['coding.program_concept', 'coding.instruction_order']::text[],
  '{"student_can": ["define a program in their own words", "explain why order and exactness matter", "write an ordered instruction list for an everyday task"]}'::jsonb,
  '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
  ARRAY['text', 'multiple_choice']::text[]
),
(
  'mvp-coding-l2-milestone',
  'mvp-coding-l2',
  1,
  'Run a first Jargon program',
  'Predict the output of a short Jargon program using SET, PRINT, and REPEAT, then run it successfully and connect each output line to the instruction that produced it.',
  'Beginner',
  ARRAY['jargon.set', 'jargon.print', 'jargon.repeat']::text[],
  '{"student_can": ["predict output before running", "run the starter program successfully", "explain what SET, PRINT, and REPEAT each do"]}'::jsonb,
  '{"requires": ["successful_code_run", "quiz_passed"], "min_score": 1}'::jsonb,
  ARRAY['text', 'code', 'multiple_choice']::text[]
),
(
  'mvp-thinking-l1-milestone',
  'mvp-thinking-l1',
  1,
  'Test a reason for a claim',
  'Distinguish a claim from the reasons offered for it and evaluate a reason using the two-part test: relevant to the claim, and checkable by someone else.',
  'Beginner',
  ARRAY['reasoning.claims_vs_reasons', 'reasoning.evidence_quality']::text[],
  '{"student_can": ["separate a claim from its reasons", "apply the relevant-and-checkable test", "justify which of two reasons is stronger"]}'::jsonb,
  '{"requires": ["student_explanation"], "min_score": 1}'::jsonb,
  ARRAY['text']::text[]
),
(
  'mvp-math-l1-milestone',
  'mvp-math-l1',
  1,
  'Read a fraction as a division',
  'Explain a fraction a/b as a divided by b — the fair share when a things are split among b people — and match fraction notation to the sharing story it describes.',
  'Beginner',
  ARRAY['math.fraction_as_division', 'math.fair_sharing']::text[],
  '{"student_can": ["tell a sharing story for a given fraction", "explain what the top and bottom numbers mean", "convert a sharing situation into fraction notation"]}'::jsonb,
  '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
  ARRAY['text', 'multiple_choice']::text[]
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

update public.lessons set milestone_id = 'mvp-coding-l1-milestone' where id = 'mvp-coding-l1';
update public.lessons set milestone_id = 'mvp-coding-l2-milestone' where id = 'mvp-coding-l2';
update public.lessons set milestone_id = 'mvp-thinking-l1-milestone' where id = 'mvp-thinking-l1';
update public.lessons set milestone_id = 'mvp-math-l1-milestone' where id = 'mvp-math-l1';

-- ---------------------------------------------------------------------------
-- Lesson steps: Coding Foundations / What is a program?
-- explanation -> reflection -> practice(applied) -> assessment(mcq)
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type)
values
(
  'mvp-coding-l1-s1',
  'mvp-coding-l1',
  'mvp-coding-l1-milestone',
  1,
  'A program is a plan the computer follows',
  'discussion',
  'intro',
  'A program is an ordered list of instructions that a computer follows exactly, one after another. It is like a recipe: "crack two eggs, then stir, then heat the pan" only works because the steps are precise and in the right order. Computers are powerful but literal — they never guess what you meant, they only do what the instructions say. That is why programmers spend their time making steps exact and putting them in the right order.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['coding.program_concept']::text[],
  1,
  'explanation',
  null
),
(
  'mvp-coding-l1-s2',
  'mvp-coding-l1',
  'mvp-coding-l1-milestone',
  2,
  'Instructions you already follow',
  'reflection',
  'practice',
  'Think about one set of instructions you followed recently — a recipe, directions to a friend''s house, the rules of a game, or the steps to log in to something. Describe the steps in the order you did them, and say what would have gone wrong if you had done them out of order or skipped one. This is exactly the kind of thinking programs are made of.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['coding.program_concept', 'coding.instruction_order']::text[],
  1,
  'reflection',
  null
),
(
  'mvp-coding-l1-s3',
  'mvp-coding-l1',
  'mvp-coding-l1-milestone',
  3,
  'Program a very literal robot',
  'discussion',
  'practice',
  'Imagine a robot helper that does exactly what you say and nothing more. Write a program of five to seven numbered instructions that gets the robot to make a jam sandwich, starting from a closed jam jar, a bag of bread, and a knife on the table. Make every step exact: the robot will not open the jar or the bag unless an instruction tells it to. When you are done, trace your list like a literal robot and fix anything that would fail.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['coding.instruction_order']::text[],
  1,
  'practice',
  'applied'
),
(
  'mvp-coding-l1-s4',
  'mvp-coding-l1',
  'mvp-coding-l1-milestone',
  4,
  'Check: what is a program?',
  'multiple_choice',
  'assessment',
  'Which statement best describes what a program is?',
  'multiple_choice',
  '',
  null,
  '[{"id": "a", "text": "An ordered list of exact instructions that a computer follows literally, one after another."}, {"id": "b", "text": "A part inside the computer that stores photos, music, and files."}, {"id": "c", "text": "Any machine that runs on electricity and has a screen."}, {"id": "d", "text": "A message the computer shows when something goes wrong."}]'::jsonb,
  '{}'::jsonb,
  ARRAY['coding.program_concept']::text[],
  1,
  'assessment',
  'mcq'
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
  mode_type = excluded.mode_type;

-- ---------------------------------------------------------------------------
-- Lesson steps: Coding Foundations / Your first Jargon program
-- explanation -> reflection (media-free) -> practice(code) -> assessment(mcq)
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type)
values
(
  'mvp-coding-l2-s1',
  'mvp-coding-l2',
  'mvp-coding-l2-milestone',
  1,
  'Three instructions: SET, PRINT, REPEAT',
  'discussion',
  'intro',
  'Jargon programs are built from readable instructions. SET stores a value in a named box called a variable, so SET name ("Jargon") puts the word Jargon into a box called name. PRINT shows a value on the screen, and it can join pieces together with +, so PRINT ("Hello, " + name + "!") prints Hello, Jargon!. REPEAT 3 times runs every line between REPEAT and END three times — a way to say "do this again" without copying the line.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['jargon.set', 'jargon.print', 'jargon.repeat']::text[],
  1,
  'explanation',
  null
),
(
  'mvp-coding-l2-s2',
  'mvp-coding-l2',
  'mvp-coding-l2-milestone',
  2,
  'Predict before you run',
  'reflection',
  'practice',
  'Before running anything, read the starter program in the next step line by line and write down exactly what you think it will print, in order. How many lines of output will there be, and where does each one come from? Predicting first is what programmers do: the run then either confirms your model of the program or shows you precisely where it differs.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['jargon.print', 'jargon.repeat']::text[],
  1,
  'reflection',
  null
),
(
  'mvp-coding-l2-s3',
  'mvp-coding-l2',
  'mvp-coding-l2-milestone',
  3,
  'Run your first program',
  'code',
  'practice',
  'Run the starter program and compare the output with your prediction, line by line. Then make it yours: change the name in SET, or change how many times the REPEAT runs, and run it again. Every output line should be traceable to one instruction — if anything surprises you, find the instruction responsible before moving on.',
  'code',
  '// Your first Jargon program
SET name ("Jargon")
PRINT ("Hello, " + name + "!")
REPEAT 3 times
    PRINT "Programs follow instructions in order."
END',
  'Hello, Jargon!
Programs follow instructions in order.
Programs follow instructions in order.
Programs follow instructions in order.',
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['jargon.set', 'jargon.print', 'jargon.repeat']::text[],
  1,
  'practice',
  'code'
),
(
  'mvp-coding-l2-s4',
  'mvp-coding-l2',
  'mvp-coding-l2-milestone',
  4,
  'Check: what does REPEAT do?',
  'multiple_choice',
  'assessment',
  'In the program you just ran, what does REPEAT 3 times ... END do?',
  'multiple_choice',
  '',
  null,
  '[{"id": "a", "text": "It runs every line between REPEAT and END three times, then the program continues after END."}, {"id": "b", "text": "It prints the number 3 on the screen three times."}, {"id": "c", "text": "It restarts the whole program from the first line three times."}, {"id": "d", "text": "It pauses the program for three seconds before moving on."}]'::jsonb,
  '{}'::jsonb,
  ARRAY['jargon.repeat']::text[],
  1,
  'assessment',
  'mcq'
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
  mode_type = excluded.mode_type;

-- ---------------------------------------------------------------------------
-- Lesson steps: Clear Thinking / Spotting a good reason
-- explanation -> inquiry -> reflection -> assessment(open_ended)
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type)
values
(
  'mvp-thinking-l1-s1',
  'mvp-thinking-l1',
  'mvp-thinking-l1-milestone',
  1,
  'Claims and the reasons behind them',
  'discussion',
  'intro',
  'A claim is something a person says is true, like "recess should be longer". A reason is what they offer to back it up, like "students focus better after a break". A good reason passes two tests: it is relevant, meaning it actually connects to the claim, and it is checkable, meaning someone else could look into whether it is true. "Recess should be longer because I like it" fails the first test — it tells you about the speaker, not about recess.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['reasoning.claims_vs_reasons']::text[],
  1,
  'explanation',
  null
),
(
  'mvp-thinking-l1-s2',
  'mvp-thinking-l1',
  'mvp-thinking-l1-milestone',
  2,
  'Investigate: because everyone says so',
  'discussion',
  'teach',
  'People often defend a claim with "because everyone says so" or "because everyone does it". Investigate that kind of reason with the mentor: think of a time lots of people believed or did something, and whether that made it true or right. Try to find one example where the crowd was correct and one where it was not, then work out what that tells you about popularity as a reason. Does "everyone says so" pass the relevant-and-checkable test?',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['reasoning.evidence_quality']::text[],
  1,
  'inquiry',
  null
),
(
  'mvp-thinking-l1-s3',
  'mvp-thinking-l1',
  'mvp-thinking-l1-milestone',
  3,
  'A reason that fooled you',
  'reflection',
  'practice',
  'Think of a time you believed something or made a choice because of a reason that later turned out to be weak — maybe it came from an ad, a rumor, or a friend sounding confident. What was the claim, what was the reason, and which part of the two-part test did the reason fail? Knowing how weak reasons got past you before is the best defense against the next one.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['reasoning.claims_vs_reasons', 'reasoning.evidence_quality']::text[],
  1,
  'reflection',
  null
),
(
  'mvp-thinking-l1-s4',
  'mvp-thinking-l1',
  'mvp-thinking-l1-milestone',
  4,
  'Judge two reasons for one claim',
  'discussion',
  'assessment',
  'Here is a claim: "Our school should start one hour later." Reason 1: "Sleep researchers have found that students remember more when school starts later." Reason 2: "Nobody likes waking up early." State which reason is stronger and defend your choice using both parts of the test: explain how each reason does or does not connect to the claim, and whether each one could be checked by someone else. Finish by saying what evidence would make the weaker reason stronger.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{"criteria": ["identifies the stronger reason", "applies the relevance test to both reasons", "applies the checkability test to both reasons", "proposes evidence that would strengthen the weaker reason"]}'::jsonb,
  ARRAY['reasoning.claims_vs_reasons', 'reasoning.evidence_quality']::text[],
  1,
  'assessment',
  'open_ended'
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
  mode_type = excluded.mode_type;

-- ---------------------------------------------------------------------------
-- Lesson steps: Math Reasoning / Why fractions are division
-- explanation -> practice(applied) -> revision(recall) -> assessment(mcq)
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type)
values
(
  'mvp-math-l1-s1',
  'mvp-math-l1',
  'mvp-math-l1-milestone',
  1,
  'The fraction bar means divide',
  'discussion',
  'intro',
  'The fraction 3/4 is not a mysterious new kind of number — it is the division 3 divided by 4, paused and written down. Picture 3 sandwiches shared fairly among 4 friends: each friend gets 3/4 of a sandwich, and that is exactly what 3 divided by 4 equals. The top number counts what is being shared, and the bottom number counts how many ways it is split. Every fraction tells a fair-sharing story like this one.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['math.fraction_as_division']::text[],
  1,
  'explanation',
  null
),
(
  'mvp-math-l1-s2',
  'mvp-math-l1',
  'mvp-math-l1-milestone',
  2,
  'Share five brownies among four friends',
  'discussion',
  'practice',
  'Five brownies are shared fairly among four friends. Work out how much each friend gets, and describe how you would actually cut and hand out the brownies so everyone agrees the shares are fair. Write the answer both as a single fraction and as a whole number plus a fraction, and explain why 5/4 and 5 divided by 4 must come out the same. If your sharing plan and your arithmetic disagree, one of them has a mistake worth finding.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['math.fair_sharing', 'math.fraction_as_division']::text[],
  1,
  'practice',
  'applied'
),
(
  'mvp-math-l1-s3',
  'mvp-math-l1',
  'mvp-math-l1-milestone',
  3,
  'Recall the sharing rule',
  'discussion',
  'review',
  'Without looking back at the earlier steps, state the rule this lesson is built on: what does the fraction bar mean, what does the top number count, and what does the bottom number count? Then make up your own quick sharing story for the fraction 2/5 and say how much each person in your story receives. If any part is fuzzy, that is the part to revisit before the check.',
  'text',
  '',
  null,
  '[]'::jsonb,
  '{}'::jsonb,
  ARRAY['math.fraction_as_division', 'math.fair_sharing']::text[],
  1,
  'revision',
  'recall'
),
(
  'mvp-math-l1-s4',
  'mvp-math-l1',
  'mvp-math-l1-milestone',
  4,
  'Check: match the fraction to its story',
  'multiple_choice',
  'assessment',
  'Which story matches the fraction 3/4?',
  'multiple_choice',
  '',
  null,
  '[{"id": "a", "text": "3 pizzas are shared fairly among 4 friends, so each friend gets 3/4 of a pizza."}, {"id": "b", "text": "4 pizzas are shared fairly among 3 friends, so each friend gets 3/4 of a pizza."}, {"id": "c", "text": "3 pizzas are each cut into 4 slices, so there are 3/4 slices in total."}, {"id": "d", "text": "A pizza is cut into 3 big and 4 small slices, and 3/4 compares big slices to small ones."}]'::jsonb,
  '{}'::jsonb,
  ARRAY['math.fraction_as_division']::text[],
  1,
  'assessment',
  'mcq'
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
  mode_type = excluded.mode_type;

-- ---------------------------------------------------------------------------
-- Bound quiz items for the mcq assessment steps (published; the 20260713 sweep
-- archives non-Book-F published quiz items each deploy, and this re-publish
-- runs after it in the workflow's migration list)
-- ---------------------------------------------------------------------------

insert into public.quiz_items (id, lesson_id, milestone_id, activity_id, position, prompt, question_type, choices, correct_choice_ids, rubric, skill_keys, status)
values
(
  'mvp-coding-l1-s4-quiz',
  'mvp-coding-l1',
  'mvp-coding-l1-milestone',
  'mvp-coding-l1-s4',
  4,
  'Which statement best describes what a program is?',
  'multiple_choice',
  '[{"id": "a", "text": "An ordered list of exact instructions that a computer follows literally, one after another."}, {"id": "b", "text": "A part inside the computer that stores photos, music, and files."}, {"id": "c", "text": "Any machine that runs on electricity and has a screen."}, {"id": "d", "text": "A message the computer shows when something goes wrong."}]'::jsonb,
  ARRAY['a']::text[],
  '{}'::jsonb,
  ARRAY['coding.program_concept']::text[],
  'published'
),
(
  'mvp-coding-l2-s4-quiz',
  'mvp-coding-l2',
  'mvp-coding-l2-milestone',
  'mvp-coding-l2-s4',
  4,
  'In the program you just ran, what does REPEAT 3 times ... END do?',
  'multiple_choice',
  '[{"id": "a", "text": "It runs every line between REPEAT and END three times, then the program continues after END."}, {"id": "b", "text": "It prints the number 3 on the screen three times."}, {"id": "c", "text": "It restarts the whole program from the first line three times."}, {"id": "d", "text": "It pauses the program for three seconds before moving on."}]'::jsonb,
  ARRAY['a']::text[],
  '{}'::jsonb,
  ARRAY['jargon.repeat']::text[],
  'published'
),
(
  'mvp-math-l1-s4-quiz',
  'mvp-math-l1',
  'mvp-math-l1-milestone',
  'mvp-math-l1-s4',
  4,
  'Which story matches the fraction 3/4?',
  'multiple_choice',
  '[{"id": "a", "text": "3 pizzas are shared fairly among 4 friends, so each friend gets 3/4 of a pizza."}, {"id": "b", "text": "4 pizzas are shared fairly among 3 friends, so each friend gets 3/4 of a pizza."}, {"id": "c", "text": "3 pizzas are each cut into 4 slices, so there are 3/4 slices in total."}, {"id": "d", "text": "A pizza is cut into 3 big and 4 small slices, and 3/4 compares big slices to small ones."}]'::jsonb,
  ARRAY['a']::text[],
  '{}'::jsonb,
  ARRAY['math.fraction_as_division']::text[],
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
