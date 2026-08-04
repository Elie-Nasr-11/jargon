-- CAMPUS DEMO, part 3 of 3: HISTORY — Cities, Class and Power.
--
-- Built from three uploaded readings:
--   * Walter Johnson, THE BROKEN HEART OF AMERICA, Prologue "Mapping the Loss" — St. Louis
--     as the nucleus of racial capitalism and American empire; thirty thousand vacant houses;
--     the argument that "Black removal" explains the city's human geography as much as
--     "white flight"; houses worth more dead than alive, sold for bricks.
--   * The same book, chapter 8 "Not Poor, Just Broke" — the Great Migration into St. Louis;
--     the February 1916 residential segregation ordinance, the first in the nation passed by
--     popular referendum, sponsored by real-estate interests as the Universal Welfare
--     Association and defended with the false equivalence that it "protects both the Negro
--     and white man"; the city's deep radical and anti-imperialist tradition.
--   * Christof Dejung, "The Middle Classes" (interwar global history) — Tucholsky's 1920
--     "the era of the bourgeoisie is over", Ossietzky's 1933 "the bourgeois is broke", the
--     crisis of middle-class culture, and the insistence on looking beyond Europe to Asia,
--     the Middle East, Africa and the Americas after the Great War.
--
-- The lessons teach SOURCE WORK, not a story to recall: every step puts the student in
-- front of a claim from the readings and asks what evidence would test it. The readings
-- themselves ride as lesson resources (see 20261003300000_campus_wiring.sql).
--
-- Deploy-order: registered AFTER the Book-F sweep. Idempotent.

insert into public.subjects (id, title, description, status)
values
  ('camp-hist', 'History', 'Reading the past as an argument: whose city, whose class, whose account — and what evidence would settle it.', 'published')
on conflict (id) do update set
  title = excluded.title, description = excluded.description, status = excluded.status, updated_at = now();

insert into public.courses (id, subject_id, title, description, status)
values
  ('camp-hist-city', 'camp-hist', 'Cities, Class and Power', 'Walter Johnson''s St. Louis and the interwar middle classes: how removal, segregation and class identity were built — and how historians argue about them.', 'published')
on conflict (id) do update set
  subject_id = excluded.subject_id, title = excluded.title, description = excluded.description,
  status = excluded.status, updated_at = now();

insert into public.course_versions (id, course_id, version_label, status, is_current, content_schema_version)
values ('camp-hist-city-v1', 'camp-hist-city', 'v1', 'published', true, 1)
on conflict (id) do update set
  course_id = excluded.course_id, version_label = excluded.version_label, status = excluded.status,
  is_current = excluded.is_current, content_schema_version = excluded.content_schema_version, updated_at = now();

insert into public.units (id, course_version_id, position, title, description)
values
  ('camp-hist-u1', 'camp-hist-city-v1', 1, 'The Broken Heart of America', 'St. Louis as a case study in extraction, removal and resistance.'),
  ('camp-hist-u2', 'camp-hist-city-v1', 2, 'Class in a Global Interwar', 'What happened to the middle classes after the Great War, in Europe and beyond.')
on conflict (id) do update set
  course_version_id = excluded.course_version_id, position = excluded.position,
  title = excluded.title, description = excluded.description, updated_at = now();

insert into public.lessons (id, position, title, tutor_prompt, sample_code, expected_output, module, level, unit_id, unit_position, publication_status, help_ceiling, require_attempt_first, final_answer_policy, tutor_tone, tutor_pace, grade_band, allow_live_artifacts, curriculum_metadata)
values
(
  'camp-hist-l1', 321, 'Mapping the loss: reading a city as evidence',
  'Lead the learner to treat a landscape as a primary source. Johnson opens with the architectural remains of St. Louis packed in crates and thirty thousand vacant houses whose bricks sell for fifty cents apiece — "worth more dead than alive". Draw out what those physical facts EVIDENCE, and then introduce his central move: that the standard explanation, "white flight", is incomplete, and that "Black removal" — the serial destruction of Black neighbourhoods — explains as much of the city''s human geography. Do not let the learner simply agree with Johnson: make them state what evidence would support the claim and what would count against it. Historical argument is the skill here; the city is the case.',
  '', null, 'History', 'Grade 10', 'camp-hist-u1', 1, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-hist-city", "course_version_id": "camp-hist-city-v1", "lesson_type": "discussion", "objective": "Use physical and demographic evidence to evaluate competing explanations for a city''s decline."}'::jsonb
),
(
  'camp-hist-l2', 322, 'Segregation by referendum: law as an instrument',
  'Guide the learner through the February 29, 1916 St. Louis ordinance — the first residential segregation law in the nation passed by POPULAR REFERENDUM, sponsored by real-estate interests organised as the Universal Welfare Association. Focus on its rhetoric: "Our ordinance protects both the Negro and white man where he lives now" — an early, textbook use of FALSE EQUIVALENCE in the service of white supremacy, since a rule written symmetrically operated on wildly asymmetrical starting positions. Have the learner take that rhetorical move apart themselves rather than being told it is bad. Connect to the Great Migration that produced the panic, and to the later legal fight (Shelley v. Kraemer began in this city). Keep them anchored in the text''s own evidence.',
  '', null, 'History', 'Grade 10', 'camp-hist-u1', 2, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-hist-city", "course_version_id": "camp-hist-city-v1", "lesson_type": "discussion", "objective": "Analyse how a law''s neutral-sounding language can produce unequal effects, using the 1916 St. Louis ordinance."}'::jsonb
),
(
  'camp-hist-l3', 323, 'Was the era of the bourgeoisie over?',
  'Open with the two quotations Dejung uses: Tucholsky in 1920 — "It is odd, this bourgeoisie... The era of the bourgeoisie is over. Nobody knows what will come next" — and Ossietzky in 1933, a week before the Nazis arrested him: "The bourgeois is broke, his ideals are scattered to the four winds." Have the learner weigh whether a contemporary''s sense of crisis is EVIDENCE of crisis, and then push the comparison outward: Dejung insists the interwar story is not only European, and that middle classes in Asia, the Middle East, Africa and the Americas were reshaped too — sometimes as agents, sometimes as victims of forces beyond their control. Insist on distinguishing what a source SHOWS from what it CLAIMS.',
  '', null, 'History', 'Grade 10', 'camp-hist-u2', 1, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-hist-city", "course_version_id": "camp-hist-city-v1", "lesson_type": "discussion", "objective": "Weigh contemporary testimony as historical evidence and compare interwar middle-class change across regions."}'::jsonb
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
('camp-hist-l1-m', 'camp-hist-l1', 1, 'Evidence and explanation', 'Weigh "white flight" against "Black removal" as explanations for St. Louis''s human geography, using evidence from the reading.', 'Grade 10', ARRAY['hist.evidence', 'hist.urban_change']::text[], '{"student_can": ["read a landscape as evidence", "state what each explanation predicts", "name evidence that would distinguish them"]}'::jsonb, '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb, ARRAY['text', 'multiple_choice']::text[]),
('camp-hist-l2-m', 'camp-hist-l2', 1, 'Reading a law critically', 'Explain how the 1916 ordinance''s symmetrical language produced asymmetrical effects, and identify the false equivalence in its defence.', 'Grade 10', ARRAY['hist.law_and_power', 'hist.rhetoric']::text[], '{"student_can": ["summarise what the ordinance did", "explain why symmetric wording was not neutral", "name the rhetorical move in its defence"]}'::jsonb, '{"requires": ["student_explanation"], "min_score": 1}'::jsonb, ARRAY['text']::text[]),
('camp-hist-l3-m', 'camp-hist-l3', 1, 'Testimony and comparison', 'Assess contemporary testimony as evidence and compare interwar middle-class experience across at least two regions.', 'Grade 10', ARRAY['hist.evidence', 'hist.class_history']::text[], '{"student_can": ["distinguish what a source shows from what it claims", "explain the interwar crisis of bourgeois culture", "compare across regions rather than generalising from Europe"]}'::jsonb, '{"requires": ["student_explanation"], "min_score": 1}'::jsonb, ARRAY['text']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, position = excluded.position, title = excluded.title,
  objective = excluded.objective, level = excluded.level, skill_keys = excluded.skill_keys,
  expected_evidence = excluded.expected_evidence, completion_rules = excluded.completion_rules,
  allowed_response_modes = excluded.allowed_response_modes, updated_at = now();

update public.lessons set milestone_id = 'camp-hist-l1-m' where id = 'camp-hist-l1';
update public.lessons set milestone_id = 'camp-hist-l2-m' where id = 'camp-hist-l2';
update public.lessons set milestone_id = 'camp-hist-l3-m' where id = 'camp-hist-l3';

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type, idea_keys)
values
('camp-hist-l1-s1', 'camp-hist-l1', 'camp-hist-l1-m', 1, 'A city packed into crates', 'discussion', 'intro',
 'Walter Johnson opens *The Broken Heart of America* in a warehouse near Cahokia, Illinois, where the architectural history of St. Louis lies "packed into crates" — pediments, cast iron, stone friezes, whole wooden staircases salvaged from banks, breweries, churches, schools and steel mills. Across the river stand thirty thousand vacant houses, some sold by the city for a single dollar. Their deep burgundy bricks fetch fifty cents apiece in New Orleans and Houston, which is why Johnson writes that the houses are **worth more dead than alive** — and why "brick rustlers" set old houses on fire so the firemen''s hoses will soften the mortar.

The population is just over 300,000: roughly what it was in 1870, and about a third of what it was in 1950. Those are not decorations on the argument. They ARE the argument''s evidence.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.evidence']::text[], 1, 'explanation', null, ARRAY['landscape-as-evidence', 'urban-removal']::text[]),
('camp-hist-l1-s2', 'camp-hist-l1', 'camp-hist-l1-m', 2, 'Two explanations, one city', 'discussion', 'teach',
 'Johnson takes on a widely accepted explanation. It is a *truism*, he writes, that American cities struggled in the later twentieth century because of **white flight** — and he grants that St. Louis whites did leave in droves after the Second World War. But he argues the human geography of the city is "as much a story of **Black removal** — the serial destruction of Black neighbourhoods and the transfer of their population according to the reigning model of profit and policing at any given moment — as of white flight".

Investigate this with me before you decide. If white flight alone were the whole story, what would you expect to find in the record? What would you expect to find instead if Black removal were doing much of the work? Name at least one piece of evidence that would point clearly to one explanation and not the other.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.evidence', 'hist.urban_change']::text[], 1, 'inquiry', null, ARRAY['landscape-as-evidence', 'urban-removal']::text[]),
('camp-hist-l1-s3', 'camp-hist-l1', 'camp-hist-l1-m', 3, 'Your own place, read as evidence', 'reflection', 'practice',
 'Think about a place you know well — a neighbourhood, a town, a street that has changed. What physical traces would a historian in fifty years be able to read there, and what would those traces suggest about who left, who arrived, and who decided? Then say what those traces could NOT tell them, and what other kind of source would be needed to fill that gap. This is the habit Johnson is modelling: the landscape is evidence, but it is never the only evidence.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.evidence']::text[], 1, 'reflection', null, ARRAY['landscape-as-evidence']::text[]),
('camp-hist-l1-s4', 'camp-hist-l1', 'camp-hist-l1-m', 4, 'Check: what the bricks show', 'multiple_choice', 'assessment',
 'Johnson writes that St. Louis''s abandoned houses are "worth more dead than alive". Which claim does that fact most directly support?', 'multiple_choice', '', null,
 '[{"id": "a", "text": "Demolition became more profitable than habitation, so the market itself rewarded destroying housing."}, {"id": "b", "text": "The houses were structurally unsound and could not have been repaired."}, {"id": "c", "text": "Residents preferred newer suburban housing to old brick rowhouses."}, {"id": "d", "text": "The city had run out of demand for housing of any kind."}]'::jsonb,
 '{}'::jsonb, ARRAY['hist.evidence']::text[], 1, 'assessment', 'mcq', ARRAY['landscape-as-evidence', 'urban-removal']::text[]),
('camp-hist-l2-s1', 'camp-hist-l2', 'camp-hist-l2-m', 1, 'A first in the nation', 'discussion', 'intro',
 'On **February 29, 1916**, St. Louis became the first city in the nation to pass a residential segregation ordinance **by popular referendum**. It was sponsored by a long list of real-estate commercial interests and white neighbourhood associations organised as the *Universal Welfare Association*. The rule: no Black resident could move into a neighbourhood where either 100 percent of houses were owned by whites or 75 percent of residents were white — and, written symmetrically, whites were likewise barred from moving into neighbourhoods where the opposite held.

This came during what Johnson describes as a wider panic about Black refugees arriving from the South. In the years between the world wars the share of African Americans in the city almost doubled, to over 13 percent — about 100,000 people.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.law_and_power']::text[], 1, 'explanation', null, ARRAY['law-as-instrument', 'great-migration']::text[]),
('camp-hist-l2-s2', 'camp-hist-l2', 'camp-hist-l2-m', 2, 'Take the defence apart', 'discussion', 'teach',
 'The ordinance''s defenders insisted its intent was not prejudicial but *mutually beneficial*. The Universal Welfare Association put it this way: **"Our ordinance protects both the Negro and white man where he lives now."**

Work on that sentence with me. It describes a rule that applies to both groups equally — so what is wrong with it? Think about the starting positions the rule freezes in place, about who was arriving in the city and who already owned property, and about who was actually asking for this law. Johnson calls it an early instance of **false equivalence in the service of white supremacy**; before you accept that label, build the argument for it yourself, in your own words.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.rhetoric']::text[], 1, 'inquiry', null, ARRAY['law-as-instrument', 'false-equivalence']::text[]),
('camp-hist-l2-s3', 'camp-hist-l2', 'camp-hist-l2-m', 3, 'Spot the move elsewhere', 'discussion', 'practice',
 'The move you just took apart — a rule stated symmetrically that lands asymmetrically because the starting positions differ — did not stop in 1916. Find one example from another period, another country, or contemporary life where a formally equal rule produces unequal effects. Set it out in three parts: what the rule says, why it sounds fair, and what makes its effects uneven. Then say what evidence you would need to prove the effect is uneven rather than merely assert it.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.rhetoric', 'hist.law_and_power']::text[], 1, 'practice', 'applied', ARRAY['false-equivalence', 'law-as-instrument']::text[]),
('camp-hist-l2-s4', 'camp-hist-l2', 'camp-hist-l2-m', 4, 'Write the paragraph', 'discussion', 'assessment',
 'Write a single tight paragraph answering this: **How did the 1916 St. Louis ordinance use the language of fairness to entrench inequality?**

Your paragraph must quote the Association''s own defence, explain what the ordinance actually did, and explain precisely why symmetrical wording did not produce symmetrical effects. Finish with the historian''s move: name one source you would want to see — a map, a census table, a property record, a newspaper — to test your explanation, and say what it would show if you were right.',
 'text', '', null, '[]'::jsonb,
 '{"criteria": ["states accurately what the ordinance did", "quotes or closely paraphrases the defence", "explains why equal wording produced unequal effects", "names a specific source that would test the claim", "says what that source would show"]}'::jsonb,
 ARRAY['hist.law_and_power', 'hist.rhetoric']::text[], 1, 'assessment', 'open_ended', ARRAY['law-as-instrument', 'false-equivalence']::text[]),
('camp-hist-l3-s1', 'camp-hist-l3', 'camp-hist-l3-m', 1, 'Two obituaries for a class', 'discussion', 'intro',
 'In 1920, in *Die Weltbühne*, the journalist Kurt Tucholsky wrote: *"It is odd, this bourgeoisie... Odd in its rigid adherence to forms that are void, to things that actually do not exist anymore... The era of the bourgeoisie is over. Nobody knows what will come next."*

Thirteen years later, a week before the Nazis illegally arrested him, Carl von Ossietzky wrote in the same magazine: *"The bourgeois is broke, his ideals are scattered to the four winds."*

Historians read these as evidence of a **crisis of middle-class culture** across interwar Europe — economic troubles, sharpening class conflict, sustained attacks on parliamentary democracy, and the rise of mass culture. Tucholsky himself argued the Great War had not created the collapse but accelerated it: August 1914 "only sped up what has been in the process of rolling anyway".',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.class_history']::text[], 1, 'explanation', null, ARRAY['bourgeois-crisis', 'testimony-as-evidence']::text[]),
('camp-hist-l3-s2', 'camp-hist-l3', 'camp-hist-l3-m', 2, 'Does feeling a crisis prove one?', 'discussion', 'teach',
 'Here is the methodological question at the heart of this lesson. Tucholsky and Ossietzky both *felt* the bourgeois world collapsing, and both were sharp, well-placed observers. But a person''s sense that an era is ending is not the same as the era ending.

So: what exactly does a quotation like Tucholsky''s prove? What does it merely suggest? And what kind of evidence — the sort a historian could count or compare — would you want alongside it before writing "the middle classes were in crisis" in your own essay? Take a position and defend it; I will push back either way.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.evidence']::text[], 1, 'inquiry', null, ARRAY['testimony-as-evidence']::text[]),
('camp-hist-l3-s3', 'camp-hist-l3', 'camp-hist-l3-m', 3, 'Beyond Europe', 'discussion', 'practice',
 'Dejung''s argument is that the interwar story cannot be told from Europe alone: the Great War was a *global* moment, dissolving the Ottoman Empire and strengthening independence movements across several European colonies, and middle classes in Asia, the Middle East, Africa and the Americas were reshaped by it too — sometimes influencing events, sometimes victims of transformations beyond their control.

Choose one region outside Europe and set out what you would need to know to judge whether ITS middle class experienced a "crisis" in the same sense as the German one. What would count as the same phenomenon, and what would make it a different phenomenon that merely shares a name?',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['hist.class_history']::text[], 1, 'practice', 'applied', ARRAY['bourgeois-crisis', 'global-comparison']::text[]),
('camp-hist-l3-s4', 'camp-hist-l3', 'camp-hist-l3-m', 4, 'The comparison, defended', 'discussion', 'assessment',
 'Answer in a short structured response: **Was the interwar "crisis of the middle classes" a European story or a global one?**

Use at least one of the two quotations as evidence and say explicitly what it does and does not establish. Then bring in Dejung''s global claim and one region beyond Europe. Your answer must do the thing historians actually get marked on: state a position, support it with specific evidence, and acknowledge what would weaken it.',
 'text', '', null, '[]'::jsonb,
 '{"criteria": ["states a clear position", "uses a quotation as evidence with its limits noted", "brings in at least one non-European region", "distinguishes shared causes from merely shared vocabulary", "names what evidence would weaken the argument"]}'::jsonb,
 ARRAY['hist.class_history', 'hist.evidence']::text[], 1, 'assessment', 'open_ended', ARRAY['bourgeois-crisis', 'global-comparison', 'testimony-as-evidence']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, position = excluded.position,
  title = excluded.title, activity_type = excluded.activity_type, stage = excluded.stage,
  prompt = excluded.prompt, response_mode = excluded.response_mode, starter_code = excluded.starter_code,
  expected_output = excluded.expected_output, choices = excluded.choices, rubric = excluded.rubric,
  skill_keys = excluded.skill_keys, pass_score = excluded.pass_score, mode = excluded.mode,
  mode_type = excluded.mode_type, idea_keys = excluded.idea_keys;

insert into public.quiz_items (id, lesson_id, milestone_id, activity_id, position, prompt, question_type, choices, correct_choice_ids, rubric, skill_keys, status)
values
('camp-hist-l1-s4-q', 'camp-hist-l1', 'camp-hist-l1-m', 'camp-hist-l1-s4', 4, 'Johnson writes that St. Louis''s abandoned houses are "worth more dead than alive". Which claim does that fact most directly support?', 'multiple_choice',
 '[{"id": "a", "text": "Demolition became more profitable than habitation, so the market itself rewarded destroying housing."}, {"id": "b", "text": "The houses were structurally unsound and could not have been repaired."}, {"id": "c", "text": "Residents preferred newer suburban housing to old brick rowhouses."}, {"id": "d", "text": "The city had run out of demand for housing of any kind."}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['hist.evidence']::text[], 'published')
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, activity_id = excluded.activity_id,
  position = excluded.position, prompt = excluded.prompt, question_type = excluded.question_type,
  choices = excluded.choices, correct_choice_ids = excluded.correct_choice_ids, rubric = excluded.rubric,
  skill_keys = excluded.skill_keys, status = excluded.status, updated_at = now();

insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select v.key, v.title, v.one_liner, v.subject, v.lesson_id, 'published'
from (values
  ('landscape-as-evidence', 'A place is a primary source', 'Vacant houses, salvaged bricks and population counts are evidence — read them like a document.', 'Cities, Class and Power', 'camp-hist-l1'),
  ('urban-removal', 'Removal, not only flight', 'Cities emptied partly because neighbourhoods were destroyed, not only because residents chose to leave.', 'Cities, Class and Power', 'camp-hist-l1'),
  ('law-as-instrument', 'Law encodes power', 'A statute is a tool: who wrote it, who benefits, and what it freezes in place are historical questions.', 'Cities, Class and Power', 'camp-hist-l2'),
  ('false-equivalence', 'Equal words, unequal effects', 'A rule written symmetrically lands asymmetrically when the starting positions differ.', 'Cities, Class and Power', 'camp-hist-l2'),
  ('great-migration', 'The Great Migration reshaped cities', 'Hundreds of thousands moving north for wages, votes and safety changed what northern cities did next.', 'Cities, Class and Power', 'camp-hist-l2'),
  ('bourgeois-crisis', 'A class in crisis', 'Contemporaries declared the bourgeois era over after 1918 — the question is whether they were right.', 'Cities, Class and Power', 'camp-hist-l3'),
  ('testimony-as-evidence', 'What a witness can prove', 'A contemporary''s testimony shows what was believed; other evidence is needed for what was true.', 'Cities, Class and Power', 'camp-hist-l3'),
  ('global-comparison', 'Compare, do not generalise', 'A European pattern is a hypothesis about elsewhere, never a conclusion about it.', 'Cities, Class and Power', 'camp-hist-l3')
) as v(key, title, one_liner, subject, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select v.term, v.variants, v.definition, v.subject, v.idea_keys, v.lesson_id, 'published'
from (values
  ('primary source', array['primary sources'], 'Evidence made at the time being studied — a letter, a law, a photograph, or a building.', 'Cities, Class and Power', array['landscape-as-evidence'], 'camp-hist-l1'),
  ('racial capitalism', array['racial capitalist'], 'The argument that racial hierarchy is not a side effect of capitalism but built into how it extracts value.', 'Cities, Class and Power', array['urban-removal'], 'camp-hist-l1'),
  ('white flight', array['suburbanisation'], 'The postwar movement of white residents from cities to suburbs — a real pattern, but not a complete explanation.', 'Cities, Class and Power', array['urban-removal'], 'camp-hist-l1'),
  ('segregation', array['segregated', 'segregationist'], 'Enforced separation of groups by law or by practice, here written into who may live on which street.', 'Cities, Class and Power', array['law-as-instrument'], 'camp-hist-l2'),
  ('ordinance', array['ordinances'], 'A law passed by a city rather than a state or nation.', 'Cities, Class and Power', array['law-as-instrument'], 'camp-hist-l2'),
  ('referendum', array['referenda', 'referendums'], 'A vote in which the public decides a measure directly, rather than through elected representatives.', 'Cities, Class and Power', array['law-as-instrument'], 'camp-hist-l2'),
  ('migration', array['migrations', 'migrant', 'migrants'], 'The movement of people between places, usually driven by both push and pull forces.', 'Cities, Class and Power', array['great-migration'], 'camp-hist-l2'),
  ('bourgeoisie', array['bourgeois'], 'The property-owning middle class, and the culture and self-image that came with it.', 'Cities, Class and Power', array['bourgeois-crisis'], 'camp-hist-l3'),
  ('testimony', array['testimonies'], 'A first-hand account — strong evidence of belief and experience, weaker evidence of wider fact.', 'Cities, Class and Power', array['testimony-as-evidence'], 'camp-hist-l3')
) as v(term, variants, definition, subject, idea_keys, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

-- Cross-subject links: the reasoning skills here are the SAME skills the thinking course
-- teaches, and evidence-weighing is a shared muscle. These drive frontier offers between
-- history and the other classes.
insert into public.curriculum_links (from_key, to_key, kind, note, status)
select v.from_key, v.to_key, v.kind, v.note, 'published'
from (values
  ('landscape-as-evidence', 'testimony-as-evidence', 'contrast', 'A building cannot lie about what it is, but it cannot tell you why either — testimony is the opposite trade.'),
  ('law-as-instrument', 'false-equivalence', 'prerequisite', 'You have to see what the law actually did before its defence can be judged.'),
  ('great-migration', 'urban-removal', 'prerequisite', 'The panic that produced segregation law followed the arrival the migration brought.'),
  ('false-equivalence', 'claims-vs-reasons', 'same_pattern', 'Testing whether a reason really supports a claim is the same move, whether the claim is about recess or about a housing ordinance.'),
  ('testimony-as-evidence', 'claims-vs-reasons', 'same_pattern', 'A witness gives you a claim; the historian''s job is to ask what reasons back it.'),
  ('global-comparison', 'bourgeois-crisis', 'contrast', 'One region''s crisis is a hypothesis about another region, not a description of it.')
) as v(from_key, to_key, kind, note)
where exists (select 1 from public.ideas i where i.key = v.to_key)
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'published'
from (values
  ('landscape-as-evidence', 'camp-hist-l1', 'St. Louis has roughly the same population today as in 1870, and about a third of its 1950 peak. What does that pair of facts establish, and what does it NOT establish?', 'Establishes scale and timing of decline; does not by itself establish the cause or who left.', 'core'),
  ('urban-removal', 'camp-hist-l1', 'Explain in your own words the difference between "white flight" and "Black removal" as explanations, and name one piece of evidence that would favour the second.', 'Distinguishes voluntary departure from destruction of neighbourhoods; cites demolition records, urban-renewal plans or displacement data.', 'core'),
  ('law-as-instrument', 'camp-hist-l2', 'What did the February 1916 St. Louis ordinance actually forbid, and who sponsored it?', 'Names the 100%/75% thresholds barring Black residents from white blocks (and the mirror clause), and real-estate interests organised as the Universal Welfare Association.', 'intro'),
  ('false-equivalence', 'camp-hist-l2', '"Our ordinance protects both the Negro and white man where he lives now." Explain why this defence is a false equivalence.', 'Shows that treating unequal starting positions identically preserves the inequality, and notes who actually sought the law.', 'core'),
  ('great-migration', 'camp-hist-l2', 'Why did tens of thousands of Black Americans move to St. Louis between the world wars? Give three distinct reasons from the reading.', 'Names escaping white supremacist violence, honest wages rather than sharecropping and company stores, and the chance to vote.', 'intro'),
  ('bourgeois-crisis', 'camp-hist-l3', 'Tucholsky wrote in 1920 that the era of the bourgeoisie was over. What four interwar developments do historians point to as the substance behind that feeling?', 'Names economic troubles, intensified class conflict, criticism of parliamentary democracy, and the rise of mass culture.', 'core'),
  ('testimony-as-evidence', 'camp-hist-l3', 'A politician writes in a diary that "the country is collapsing". What can a historian legitimately conclude from that sentence alone?', 'Concludes only that this person believed or wished to record collapse; needs corroborating evidence for the claim itself.', 'stretch'),
  ('global-comparison', 'camp-hist-l3', 'Why does Dejung insist the interwar middle-class story must be told beyond Europe? Give his reason, not just his conclusion.', 'Cites the Great War as a global moment — Ottoman dissolution, strengthened independence movements — reshaping middle classes elsewhere.', 'stretch')
) as v(idea_key, lesson_id, prompt, expected, difficulty)
where not exists (
  select 1 from public.practice_items p where p.idea_key = v.idea_key and p.prompt = v.prompt
);

-- Draft queue for the studio Knowledge card on the segregation lesson.
insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select 'restrictive-covenant', 'Restrictive covenants',
  'When public segregation law was struck down, private contracts between owners carried it on.',
  'Cities, Class and Power', 'camp-hist-l2', 'draft'
where exists (select 1 from public.lessons l where l.id = 'camp-hist-l2')
on conflict do nothing;

insert into public.curriculum_links (from_key, to_key, kind, note, status)
values ('restrictive-covenant', 'law-as-instrument', 'prerequisite',
  'Covenants are the private-contract version of the same instrument — worth drawing only after the ordinance is understood.', 'draft')
on conflict do nothing;

insert into public.lesson_resources (lesson_id, title, description, resource_type, source_type, external_url, student_instructions, status, visibility)
select v.lesson_id, v.title, v.description, v.resource_type, 'external_url', v.external_url, v.student_instructions, 'published', 'public'
from (values
  ('camp-hist-l2', 'Watch: the Great Migration', 'A short overview of the movement that reshaped American cities.', 'youtube', 'https://www.youtube.com/embed/n3qA8DNc2Ss', 'Note every push factor and pull factor you hear; bring two of each to the discussion.'),
  ('camp-hist-l2', 'Read: Shelley v. Kraemer', 'The Supreme Court case that began with a house in St. Louis.', 'link', 'https://en.wikipedia.org/wiki/Shelley_v._Kraemer', 'Find what the Court actually forbade — it is narrower than students usually expect.'),
  ('camp-hist-l1', 'Read: The Broken Heart of America', 'Background on Walter Johnson''s book and its central argument.', 'link', 'https://en.wikipedia.org/wiki/Walter_Johnson_(historian)', 'Compare the summary of his argument with the prologue you were given.')
) as v(lesson_id, title, description, resource_type, external_url, student_instructions)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (select 1 from public.lesson_resources r where r.lesson_id = v.lesson_id and r.title = v.title);
