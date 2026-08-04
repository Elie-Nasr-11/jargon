-- CAMPUS DEMO, part 2 of 3: BIOLOGY — Photosynthesis.
--
-- Built from the uploaded "Grade 10-PIB_Biology_Term 2_Photosynthesis" paper, which tests:
-- the function and structure of photosystems; the light-dependent reactions (electron
-- replacement from photolysis, the electron transport chain, the proton gradient in the
-- thylakoid lumen, ATP synthase); chloroplast structure and adaptation; the Calvin cycle
-- with its 3C/5C/6C compounds; reading rate-of-photosynthesis graphs; and the limiting
-- factor experiments (light intensity, CO2 concentration, temperature, chlorophyll mutants).
--
-- Rate graphs are drawn with R29 ```graph blocks so students read a curve rather than a
-- description of a curve — the paper's own questions are graph-reading questions.
--
-- Deploy-order: registered AFTER the Book-F sweep. Idempotent.

insert into public.subjects (id, title, description, status)
values
  ('camp-bio', 'Biology', 'How living things capture energy and build themselves — starting with the reaction that feeds almost everything.', 'published')
on conflict (id) do update set
  title = excluded.title, description = excluded.description, status = excluded.status, updated_at = now();

insert into public.courses (id, subject_id, title, description, status)
values
  ('camp-bio-photo', 'camp-bio', 'Photosynthesis', 'From the structure of a chloroplast to the light-dependent reactions, the Calvin cycle, and what limits the rate in a real greenhouse.', 'published')
on conflict (id) do update set
  subject_id = excluded.subject_id, title = excluded.title, description = excluded.description,
  status = excluded.status, updated_at = now();

insert into public.course_versions (id, course_id, version_label, status, is_current, content_schema_version)
values ('camp-bio-photo-v1', 'camp-bio-photo', 'v1', 'published', true, 1)
on conflict (id) do update set
  course_id = excluded.course_id, version_label = excluded.version_label, status = excluded.status,
  is_current = excluded.is_current, content_schema_version = excluded.content_schema_version, updated_at = now();

insert into public.units (id, course_version_id, position, title, description)
values
  ('camp-bio-u1', 'camp-bio-photo-v1', 1, 'Capturing Light', 'The chloroplast, the photosystems, and the reactions that need light.'),
  ('camp-bio-u2', 'camp-bio-photo-v1', 2, 'Building Sugar', 'The Calvin cycle, and what limits the rate of the whole process.')
on conflict (id) do update set
  course_version_id = excluded.course_version_id, position = excluded.position,
  title = excluded.title, description = excluded.description, updated_at = now();

insert into public.lessons (id, position, title, tutor_prompt, sample_code, expected_output, module, level, unit_id, unit_position, publication_status, help_ceiling, require_attempt_first, final_answer_policy, tutor_tone, tutor_pace, grade_band, allow_live_artifacts, curriculum_metadata)
values
(
  'camp-bio-l1', 311, 'Inside a chloroplast', 'Help the learner connect chloroplast STRUCTURE to FUNCTION rather than memorising a labelled diagram: thylakoids stacked into grana give an enormous membrane area for photosystems to sit in, the stroma is the fluid where the Calvin cycle runs, and the thylakoid space is a sealed compartment — which is the whole reason a proton gradient can exist. Push them to explain WHY each adaptation helps, because "large surface area" is only an answer when they can say what it is a large surface area FOR. Correct the common idea that a photosystem is a single molecule: it is an array of pigments held in a protein complex, funnelling energy to one reaction centre.',
  '', null, 'Biology', 'Grade 10', 'camp-bio-u1', 1, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-bio-photo", "course_version_id": "camp-bio-photo-v1", "lesson_type": "discussion", "objective": "Relate the structures of a chloroplast to their roles in photosynthesis and describe what a photosystem is and does."}'::jsonb
),
(
  'camp-bio-l2', 312, 'The light-dependent reactions', 'Guide the learner through the light-dependent reactions as a STORY OF ELECTRONS: light excites electrons in photosystem II, those electrons are replaced by splitting water (photolysis, which also releases oxygen), the electrons fall down the transport chain releasing energy that pumps protons into the thylakoid lumen, the lumen becomes acidic, and protons flowing back through ATP synthase make ATP. Photosystem I re-excites the electrons to reduce NADP. Insist on stoichiometry when they claim numbers — splitting six water molecules gives 3 O2, 12 H+ and 12 e-. Make them explain WHY the lumen has a low pH rather than just stating it.',
  '', null, 'Biology', 'Grade 10', 'camp-bio-u1', 2, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-bio-photo", "course_version_id": "camp-bio-photo-v1", "lesson_type": "discussion", "objective": "Trace electrons from photolysis through the transport chain to NADP, and explain chemiosmotic ATP synthesis."}'::jsonb
),
(
  'camp-bio-l3', 313, 'The Calvin cycle and what limits the rate', 'Lead the learner through the light-independent reactions in terms of CARBON COUNTING: CO2 (1C) joins RuBP (5C) via rubisco to make an unstable 6C compound that splits into two 3C molecules (glycerate-3-phosphate), which are reduced using ATP and NADPH to triose phosphate, most of which regenerates RuBP. Then move to limiting factors: the rate curve plateaus when something OTHER than light becomes limiting, which is exactly how the greenhouse question is answered. When they read a graph, make them state which factor is limiting at the point they are reading, and support any comparison with numbers off the axes.',
  '', null, 'Biology', 'Grade 10', 'camp-bio-u2', 1, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-bio-photo", "course_version_id": "camp-bio-photo-v1", "lesson_type": "discussion", "objective": "Describe the Calvin cycle by carbon count and use rate graphs to identify limiting factors."}'::jsonb
)
on conflict (id) do update set
  position = excluded.position, title = excluded.title, tutor_prompt = excluded.tutor_prompt,
  sample_code = excluded.sample_code, expected_output = excluded.expected_output, module = excluded.module,
  level = excluded.level, unit_id = excluded.unit_id, unit_position = excluded.unit_position,
  publication_status = excluded.publication_status, help_ceiling = excluded.help_ceiling,
  require_attempt_first = excluded.require_attempt_first, final_answer_policy = excluded.final_answer_policy,
  tutor_tone = excluded.tutor_tone, tutor_pace = excluded.tutor_pace, grade_band = excluded.grade_band,
  allow_live_artifacts = excluded.allow_live_artifacts, curriculum_metadata = excluded.curriculum_metadata;

insert into public.milestones (id, lesson_id, position, title, objective, level, skill_keys, expected_evidence, completion_rules, allowed_response_modes)
values
('camp-bio-l1-m', 'camp-bio-l1', 1, 'Chloroplast structure and function', 'Identify the structures of a chloroplast and explain how each adaptation serves the reactions it houses.', 'Grade 10', ARRAY['bio.chloroplast', 'bio.photosystem']::text[], '{"student_can": ["label grana, stroma and thylakoid space", "explain why stacked thylakoids help", "describe a photosystem as pigments in a protein complex"]}'::jsonb, '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb, ARRAY['text', 'multiple_choice']::text[]),
('camp-bio-l2-m', 'camp-bio-l2', 1, 'Light-dependent reactions', 'Trace the path of electrons from water through both photosystems and explain how the proton gradient drives ATP synthesis.', 'Grade 10', ARRAY['bio.photolysis', 'bio.electron_transport', 'bio.chemiosmosis']::text[], '{"student_can": ["name photolysis as the source of replacement electrons", "explain the low pH of the lumen", "state what ATP synthase does and why it turns"]}'::jsonb, '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb, ARRAY['text', 'multiple_choice']::text[]),
('camp-bio-l3-m', 'camp-bio-l3', 1, 'Calvin cycle and limiting factors', 'Describe the Calvin cycle by carbon count and use a rate graph to identify which factor is limiting.', 'Grade 10', ARRAY['bio.calvin_cycle', 'bio.limiting_factors']::text[], '{"student_can": ["track carbon from CO2 to triose phosphate", "explain why a rate curve plateaus", "read values off a rate graph to support a comparison"]}'::jsonb, '{"requires": ["student_explanation"], "min_score": 1}'::jsonb, ARRAY['text']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, position = excluded.position, title = excluded.title,
  objective = excluded.objective, level = excluded.level, skill_keys = excluded.skill_keys,
  expected_evidence = excluded.expected_evidence, completion_rules = excluded.completion_rules,
  allowed_response_modes = excluded.allowed_response_modes, updated_at = now();

update public.lessons set milestone_id = 'camp-bio-l1-m' where id = 'camp-bio-l1';
update public.lessons set milestone_id = 'camp-bio-l2-m' where id = 'camp-bio-l2';
update public.lessons set milestone_id = 'camp-bio-l3-m' where id = 'camp-bio-l3';

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type, idea_keys)
values
('camp-bio-l1-s1', 'camp-bio-l1', 'camp-bio-l1-m', 1, 'A factory with compartments', 'discussion', 'intro',
 'A chloroplast is not a bag of green liquid — it is a building with rooms, and the rooms are the point. **Thylakoids** are flattened membrane sacs stacked into **grana**; the photosystems sit in those membranes, so stacking them multiplies the area available to catch light. The fluid around the stacks is the **stroma**, where the Calvin cycle runs. And the space sealed INSIDE each thylakoid — the lumen — matters enormously for a reason that will not be obvious yet: because it is sealed, protons can be pumped into it and build up. Structure here is not decoration; every one of those features exists because a reaction needs it.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.chloroplast']::text[], 1, 'explanation', null, ARRAY['chloroplast-structure', 'photosystem']::text[]),
('camp-bio-l1-s2', 'camp-bio-l1', 'camp-bio-l1-m', 2, 'What exactly is a photosystem?', 'discussion', 'teach',
 'A common exam trap: a photosystem is NOT a single pigment molecule and NOT just a pile of electrons. It is an **array of pigments held inside a protein complex** — many chlorophyll and accessory pigment molecules acting as an antenna, all funnelling absorbed energy inward to one reaction centre where a special chlorophyll finally loses an excited electron. Investigate with me: why would a plant bother having many pigment molecules feeding one reaction centre instead of just having more reaction centres? And why do accessory pigments help when they absorb different wavelengths from chlorophyll a?',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.photosystem']::text[], 1, 'inquiry', null, ARRAY['photosystem']::text[]),
('camp-bio-l1-s3', 'camp-bio-l1', 'camp-bio-l1-m', 3, 'Adaptation, not vocabulary', 'discussion', 'practice',
 'Pick two structures from a chloroplast — say the grana and the stroma — and for each one write the adaptation AND the reason it matters, in the form "this feature ... which allows ...". Then answer the version examiners actually ask: describe the adaptations of the thylakoid membrane and of the thylakoid space specifically for the light-dependent reactions. Naming a part earns nothing; connecting it to a reaction earns everything.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.chloroplast']::text[], 1, 'practice', 'applied', ARRAY['chloroplast-structure']::text[]),
('camp-bio-l1-s4', 'camp-bio-l1', 'camp-bio-l1-m', 4, 'Check: what a photosystem is', 'multiple_choice', 'assessment',
 'Which is the correct description of a photosystem?', 'multiple_choice', '', null,
 '[{"id": "a", "text": "Arrays of pigments within protein complexes"}, {"id": "b", "text": "Arrays of electrons within membranes"}, {"id": "c", "text": "Arrays of proteins within membranes"}, {"id": "d", "text": "Arrays of electrons within protein complexes"}]'::jsonb,
 '{}'::jsonb, ARRAY['bio.photosystem']::text[], 1, 'assessment', 'mcq', ARRAY['photosystem']::text[]),
('camp-bio-l2-s1', 'camp-bio-l2', 'camp-bio-l2-m', 1, 'Follow the electron', 'discussion', 'intro',
 'The light-dependent reactions are best understood as one continuous journey of electrons. Light hits **photosystem II** and excites electrons, which leave. They must be replaced — and they are replaced by **photolysis**, the splitting of water, which is where the oxygen you are breathing comes from. The excited electrons travel down an **electron transport chain**, and the energy they release is used to pump protons from the stroma INTO the thylakoid lumen. At **photosystem I** light re-excites them one more time, and they end up reducing NADP to NADPH. Two products leave for the next stage: ATP and NADPH.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.photolysis', 'bio.electron_transport']::text[], 1, 'explanation', null, ARRAY['photolysis', 'electron-transport']::text[]),
('camp-bio-l2-s2', 'camp-bio-l2', 'camp-bio-l2-m', 2, 'Why the lumen turns acidic', 'discussion', 'teach',
 'Here is the question that separates memorising from understanding. While light is being absorbed, what conditions would you expect INSIDE the thylakoid space, and why? Reason it out with me: protons are being pumped in, the compartment is sealed, and pH measures proton concentration. Then take the next step — protons pile up until they are desperate to escape, and the only way out is through **ATP synthase**, which turns as they rush through and phosphorylates ADP. What does that make ATP synthase: a pump, or a turbine?',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.chemiosmosis']::text[], 1, 'inquiry', null, ARRAY['chemiosmosis', 'electron-transport']::text[]),
('camp-bio-l2-s3', 'camp-bio-l2', 'camp-bio-l2-m', 3, 'Count the products of photolysis', 'discussion', 'practice',
 'If six molecules of water are split, determine how many molecules of oxygen, how many hydrogen ions, and how many electrons are formed. Write the balanced photolysis equation first and then reason from it — the numbers should fall out of the equation rather than be recalled. Then say precisely where each product goes: which one leaves the plant, which one contributes to the gradient, and which one replaces what was lost at photosystem II.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.photolysis']::text[], 1, 'practice', 'applied', ARRAY['photolysis']::text[]),
('camp-bio-l2-s4', 'camp-bio-l2', 'camp-bio-l2-m', 4, 'Check: replacing lost electrons', 'multiple_choice', 'assessment',
 'During the light-dependent reactions, which component provides the electrons needed to replace those lost from photosystem II?', 'multiple_choice', '', null,
 '[{"id": "a", "text": "Electrons from water molecules"}, {"id": "b", "text": "Oxygen molecules"}, {"id": "c", "text": "Hydrogen ions"}, {"id": "d", "text": "Electrons from photosystem I"}]'::jsonb,
 '{}'::jsonb, ARRAY['bio.photolysis']::text[], 1, 'assessment', 'mcq', ARRAY['photolysis']::text[]),
('camp-bio-l3-s1', 'camp-bio-l3', 'camp-bio-l3-m', 1, 'Carbon counting in the stroma', 'discussion', 'intro',
 'The Calvin cycle is bookkeeping with carbon atoms. Carbon dioxide (**1C**) is fixed onto **RuBP** (5C) by the enzyme **rubisco**, making a 6C compound so unstable it immediately splits into two molecules of glycerate-3-phosphate (**3C** each). Those are reduced — using the ATP and NADPH the light reactions delivered — into triose phosphate (3C). Most of the triose phosphate is spent regenerating RuBP so the cycle can turn again; only a fraction leaves to build glucose. That is why the cycle needs so many turns for one sugar, and why it stops in the dark even though it is called "light-independent".',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.calvin_cycle']::text[], 1, 'explanation', null, ARRAY['calvin-cycle']::text[]),
('camp-bio-l3-s2', 'camp-bio-l3', 'camp-bio-l3-m', 2, 'Read the rate curve', 'discussion', 'practice',
 'Here are the classic limiting-factor curves — rate of photosynthesis against light intensity, for four different combinations of carbon dioxide concentration and temperature.

```graph
{"functions": [{"expression": "38*(1 - exp(-x/1.2))", "label": "A: 0.04% CO2, 15°C"}, {"expression": "55*(1 - exp(-x/1.2))", "label": "B: 0.04% CO2, 25°C"}, {"expression": "60*(1 - exp(-x/1.2))", "label": "C: 0.04% CO2, 35°C"}, {"expression": "95*(1 - exp(-x/1.4))", "label": "D: 0.1% CO2, 25°C"}], "xRange": [0, 6], "yRange": [0, 110], "xLabel": "light intensity / 000 lux", "yLabel": "rate", "title": "What limits the rate?"}
```

A farmer grows peppers at 25 °C with air at 0.04% CO2 and light at 3 000 lux. Using the curves, would she gain more by raising CO2 to 0.1% or by raising the temperature to 35 °C? Answer with the curve letters and the values you read off, then explain WHY in terms of which factor is limiting at that point.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.limiting_factors']::text[], 1, 'practice', 'applied', ARRAY['limiting-factors']::text[]),
('camp-bio-l3-s3', 'camp-bio-l3', 'camp-bio-l3-m', 3, 'Why oxygen makes a good measuring stick', 'reflection', 'review',
 'In the chlorophyll-mutant experiment, scientists isolated chloroplasts and measured the OXYGEN they produced over twenty minutes to compare rates of photosynthesis. Why is oxygen a sensible proxy for the rate of the whole process — and what assumption are you making when you use it? Then name two other quantities you could have measured instead, and one situation where oxygen would mislead you.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['bio.limiting_factors']::text[], 1, 'reflection', null, ARRAY['limiting-factors']::text[]),
('camp-bio-l3-s4', 'camp-bio-l3', 'camp-bio-l3-m', 4, 'Explain the radioactive-carbon result', 'discussion', 'assessment',
 'Scientists exposed the alga *Chlorella* to radioactively labelled CO2 and followed which compounds became radioactive over time. When the light was switched OFF, the amount of labelled glycerate-3-phosphate rose sharply while labelled RuBP fell.

Explain that result using the Calvin cycle: say what each compound is, which step stops without light and why, and why the level of one rises while the other falls. Finish by predicting what happens to both if the light stays off for a long time.',
 'text', '', null, '[]'::jsonb,
 '{"criteria": ["identifies GP and RuBP correctly", "states that reduction of GP needs ATP and NADPH from the light reactions", "explains GP accumulating because it is still being made but not used", "explains RuBP falling because it is not regenerated", "gives a sensible long-run prediction"]}'::jsonb,
 ARRAY['bio.calvin_cycle']::text[], 1, 'assessment', 'open_ended', ARRAY['calvin-cycle', 'limiting-factors']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, position = excluded.position,
  title = excluded.title, activity_type = excluded.activity_type, stage = excluded.stage,
  prompt = excluded.prompt, response_mode = excluded.response_mode, starter_code = excluded.starter_code,
  expected_output = excluded.expected_output, choices = excluded.choices, rubric = excluded.rubric,
  skill_keys = excluded.skill_keys, pass_score = excluded.pass_score, mode = excluded.mode,
  mode_type = excluded.mode_type, idea_keys = excluded.idea_keys;

insert into public.quiz_items (id, lesson_id, milestone_id, activity_id, position, prompt, question_type, choices, correct_choice_ids, rubric, skill_keys, status)
values
('camp-bio-l1-s4-q', 'camp-bio-l1', 'camp-bio-l1-m', 'camp-bio-l1-s4', 4, 'Which is the correct description of a photosystem?', 'multiple_choice',
 '[{"id": "a", "text": "Arrays of pigments within protein complexes"}, {"id": "b", "text": "Arrays of electrons within membranes"}, {"id": "c", "text": "Arrays of proteins within membranes"}, {"id": "d", "text": "Arrays of electrons within protein complexes"}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['bio.photosystem']::text[], 'published'),
('camp-bio-l2-s4-q', 'camp-bio-l2', 'camp-bio-l2-m', 'camp-bio-l2-s4', 4, 'During the light-dependent reactions, which component provides the electrons needed to replace those lost from photosystem II?', 'multiple_choice',
 '[{"id": "a", "text": "Electrons from water molecules"}, {"id": "b", "text": "Oxygen molecules"}, {"id": "c", "text": "Hydrogen ions"}, {"id": "d", "text": "Electrons from photosystem I"}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['bio.photolysis']::text[], 'published')
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, activity_id = excluded.activity_id,
  position = excluded.position, prompt = excluded.prompt, question_type = excluded.question_type,
  choices = excluded.choices, correct_choice_ids = excluded.correct_choice_ids, rubric = excluded.rubric,
  skill_keys = excluded.skill_keys, status = excluded.status, updated_at = now();

insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select v.key, v.title, v.one_liner, v.subject, v.lesson_id, 'published'
from (values
  ('chloroplast-structure', 'Structure serves the reaction', 'Stacked thylakoids, a sealed lumen and the stroma each exist because a specific reaction needs them.', 'Photosynthesis', 'camp-bio-l1'),
  ('photosystem', 'Photosystems are antennas', 'Many pigments in a protein complex funnel light energy to one reaction centre.', 'Photosynthesis', 'camp-bio-l1'),
  ('photolysis', 'Splitting water replaces electrons', 'Photolysis refills photosystem II and releases the oxygen we breathe.', 'Photosynthesis', 'camp-bio-l2'),
  ('electron-transport', 'Falling electrons do work', 'Energy released as electrons fall down the chain pumps protons against their gradient.', 'Photosynthesis', 'camp-bio-l2'),
  ('chemiosmosis', 'A gradient is stored energy', 'Protons crowded into the lumen escape through ATP synthase, and the flow makes ATP.', 'Photosynthesis', 'camp-bio-l2'),
  ('calvin-cycle', 'The Calvin cycle counts carbon', 'CO2 joins a 5C sugar, splits into two 3C molecules, and most of it goes back to rebuild the acceptor.', 'Photosynthesis', 'camp-bio-l3'),
  ('limiting-factors', 'Something is always the bottleneck', 'A rate curve plateaus when a different factor takes over as the limit.', 'Photosynthesis', 'camp-bio-l3')
) as v(key, title, one_liner, subject, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select v.term, v.variants, v.definition, v.subject, v.idea_keys, v.lesson_id, 'published'
from (values
  ('chloroplast', array['chloroplasts'], 'The organelle where photosynthesis happens, divided into compartments that each host different reactions.', 'Photosynthesis', array['chloroplast-structure'], 'camp-bio-l1'),
  ('thylakoid', array['thylakoids'], 'A flattened membrane sac holding the photosystems; stacks of them are called grana.', 'Photosynthesis', array['chloroplast-structure'], 'camp-bio-l1'),
  ('stroma', array['stromal'], 'The fluid around the thylakoid stacks, where the Calvin cycle runs.', 'Photosynthesis', array['chloroplast-structure', 'calvin-cycle'], 'camp-bio-l1'),
  ('pigment', array['pigments'], 'A molecule that absorbs particular wavelengths of light — chlorophyll is the famous one.', 'Photosynthesis', array['photosystem'], 'camp-bio-l1'),
  ('photolysis', array['photolytic'], 'Splitting water using light energy, releasing electrons, protons and oxygen.', 'Photosynthesis', array['photolysis'], 'camp-bio-l2'),
  ('gradient', array['gradients'], 'A difference in concentration across a barrier — a store of energy waiting to be released.', 'Photosynthesis', array['chemiosmosis'], 'camp-bio-l2'),
  ('enzyme', array['enzymes'], 'A protein that speeds up one specific reaction, like rubisco fixing carbon dioxide.', 'Photosynthesis', array['calvin-cycle'], 'camp-bio-l3'),
  ('limiting factor', array['limiting factors'], 'Whichever requirement is in shortest supply and therefore sets the rate of the whole process.', 'Photosynthesis', array['limiting-factors'], 'camp-bio-l3')
) as v(term, variants, definition, subject, idea_keys, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

-- Links reach into the maths and systems courses: rate curves ARE asymptotic graphs, and a
-- proton gradient IS a feedback-driven store. Cross-subject frontier offers come from these.
insert into public.curriculum_links (from_key, to_key, kind, note, status)
select v.from_key, v.to_key, v.kind, v.note, 'published'
from (values
  ('photolysis', 'electron-transport', 'prerequisite', 'The chain has nothing to carry until photolysis supplies replacement electrons.'),
  ('electron-transport', 'chemiosmosis', 'prerequisite', 'The pumping has to happen before the gradient can be spent.'),
  ('calvin-cycle', 'limiting-factors', 'same_pattern', 'The cycle stalls for the same reason any rate plateaus: one required input runs short.'),
  ('limiting-factors', 'trig-graphs', 'same_pattern', 'Reading where a curve flattens is the same skill in biology and in mathematics — the shape carries the meaning.'),
  ('chemiosmosis', 'feedback-loop', 'same_pattern', 'A gradient that builds until it drives its own release is a system steering itself.')
) as v(from_key, to_key, kind, note)
where exists (select 1 from public.ideas i where i.key = v.to_key)
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'published'
from (values
  ('chloroplast-structure', 'camp-bio-l1', 'Why are thylakoids stacked into grana rather than spread out flat?', 'Connects stacking to a much larger membrane area holding more photosystems, so more light is absorbed.', 'intro'),
  ('photosystem', 'camp-bio-l1', 'Explain what happens to the energy absorbed by an accessory pigment at the edge of a photosystem.', 'Describes energy being funnelled inward through the antenna to the reaction centre chlorophyll.', 'core'),
  ('photolysis', 'camp-bio-l2', 'If four water molecules are split, how many oxygen molecules, protons and electrons are produced?', 'Gives 2 O2, 8 H+ and 8 e-, reasoning from the balanced equation.', 'core'),
  ('chemiosmosis', 'camp-bio-l2', 'A drug makes the thylakoid membrane leaky to protons. Predict the effect on ATP production and explain why.', 'Predicts ATP falling because the gradient dissipates without passing through ATP synthase.', 'stretch'),
  ('calvin-cycle', 'camp-bio-l3', 'Name the compounds in the Calvin cycle with 5, 3 and 6 carbons, and say which one is unstable.', 'RuBP (5C), glycerate-3-phosphate (3C), and the 6C intermediate which splits immediately.', 'intro'),
  ('calvin-cycle', 'camp-bio-l3', 'Why does the Calvin cycle stop in the dark if it is called light-INDEPENDENT?', 'Explains dependence on ATP and NADPH supplied by the light-dependent reactions.', 'core'),
  ('limiting-factors', 'camp-bio-l3', 'A rate-of-photosynthesis curve rises then flattens as light increases. What is limiting the rate on the flat part?', 'Says light is no longer limiting and names another factor (CO2 concentration or temperature) as the new limit.', 'core')
) as v(idea_key, lesson_id, prompt, expected, difficulty)
where not exists (
  select 1 from public.practice_items p where p.idea_key = v.idea_key and p.prompt = v.prompt
);

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select 'rubisco', array['ribulose bisphosphate carboxylase'],
  'The enzyme that fixes carbon dioxide onto RuBP — often called the most abundant protein on Earth.',
  'Photosynthesis', array['calvin-cycle'], 'camp-bio-l3', 'draft'
where exists (select 1 from public.lessons l where l.id = 'camp-bio-l3')
on conflict do nothing;

insert into public.lesson_resources (lesson_id, title, description, resource_type, source_type, external_url, student_instructions, status, visibility)
select v.lesson_id, v.title, v.description, v.resource_type, 'external_url', v.external_url, v.student_instructions, 'published', 'public'
from (values
  ('camp-bio-l2', 'Watch: the light-dependent reactions', 'An animated walk along the electron transport chain and through ATP synthase.', 'youtube', 'https://www.youtube.com/embed/GR2GA7chA_c', 'Watch once for the story, then again pausing at each step to name what the electron is doing.'),
  ('camp-bio-l3', 'Read: the Calvin cycle', 'A reference article on the light-independent reactions.', 'link', 'https://en.wikipedia.org/wiki/Calvin_cycle', 'Skim for the carbon counts — 1C, 5C, 6C, 3C — and check them against the lesson.')
) as v(lesson_id, title, description, resource_type, external_url, student_instructions)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (select 1 from public.lesson_resources r where r.lesson_id = v.lesson_id and r.title = v.title);
