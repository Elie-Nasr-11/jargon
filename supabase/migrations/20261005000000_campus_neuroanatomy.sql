-- Campus class 4: NEUROANATOMY — THE CRANIAL NERVES.
--
-- Built from the owner-supplied lecture deck "Cranial Nerves 1 & 2" (35 slides). The deck
-- covers all twelve pairs in one shape per nerve — origin and course, function, clinical
-- testing, applied anatomy — so the lessons follow that shape rather than inventing one,
-- and every clinical sign used here (anosmia, ptosis, the two strabismus directions,
-- trigeminal neuralgia, Bell's palsy, tongue deviation) comes from the deck itself.
--
-- Five lessons, four steps each, ending in a graded checkpoint. Figures were cropped from
-- the deck's own slides; the compressed deck itself is the lesson reading. Ships with a
-- published knowledge graph (ideas bound to steps, vocab, cross-subject links, a teacher
-- practice bank) plus deliberate drafts so the studio review queue has real work.
--
-- Deploy-order: AFTER the Book-F sweep (it publishes non-Book-F rows) and after the other
-- campus migrations, whose ideas this one links to. Additive + idempotent.

insert into public.subjects (id, title, description, status)
values ('mvp-anatomy', 'Human Anatomy',
  'How the body is built and what goes wrong when a part of it fails — starting with the twelve nerves that leave the brain directly.', 'published')
on conflict (id) do update set title = excluded.title, description = excluded.description,
  status = excluded.status, updated_at = now();

insert into public.courses (id, subject_id, title, description, status)
values ('mvp-anatomy-cranial-nerves', 'mvp-anatomy', 'Neuroanatomy: The Cranial Nerves',
  'Twelve pairs, what each one carries, how a clinician tests it, and what a lesion looks like on a real face.', 'published')
on conflict (id) do update set subject_id = excluded.subject_id, title = excluded.title,
  description = excluded.description, status = excluded.status, updated_at = now();

insert into public.course_versions (id, course_id, version_label, status, is_current, content_schema_version)
values ('mvp-anatomy-cranial-nerves-v1', 'mvp-anatomy-cranial-nerves', 'v1', 'published', true, 1)
on conflict (id) do update set course_id = excluded.course_id, status = excluded.status,
  is_current = excluded.is_current, updated_at = now();

insert into public.units (id, course_version_id, position, title, description)
values ('mvp-anatomy-twelve-pairs', 'mvp-anatomy-cranial-nerves-v1', 1, 'The Twelve Pairs',
  'From the map of all twelve down to the individual nerve and its clinical test.')
on conflict (id) do update set course_version_id = excluded.course_version_id,
  position = excluded.position, title = excluded.title, description = excluded.description,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Lessons (global spine 401+; campus classes hold 301-323)
-- ---------------------------------------------------------------------------

insert into public.lessons (id, position, title, tutor_prompt, sample_code, expected_output, module, level, unit_id, unit_position, publication_status, help_ceiling, require_attempt_first, final_answer_policy, tutor_tone, tutor_pace, grade_band, allow_live_artifacts, curriculum_metadata)
values
(
  'camp-cn-l1', 401, 'Twelve pairs: reading the map',
  'Help the learner see the cranial nerves as an ORDERED SET before any individual nerve: numbered I-XII by where they arise front-to-back, the first two pairs attaching to the forebrain and the rest to the brain stem, each one sensory, motor or both, and each leaving the skull through its own foramen. Use the deck''s own mnemonics ("On Old Olympus'' Towering Top..." for the names, "Some Say Marry Money But My Brother Says Big Brains Matter More" for sensory/motor/both) as memory tools, never as a substitute for understanding. The vagus is the standing exception worth naming: the only pair that leaves the head and neck entirely.',
  '', null, 'Human Anatomy', 'Advanced', 'mvp-anatomy-twelve-pairs', 1, 'published',
  'guided', true, 'after_attempt', 'encouraging', 'guided', 'upper', false,
  '{"course_id": "mvp-anatomy-cranial-nerves", "course_version_id": "mvp-anatomy-cranial-nerves-v1", "lesson_type": "discussion", "objective": "Order the twelve cranial nerves, classify each as sensory, motor or both, and state where they attach."}'::jsonb
),
(
  'camp-cn-l2', 402, 'The special senses: olfactory (I) and optic (II)',
  'Trace two purely sensory pathways end to end. For I: olfactory neurons in the nasal epithelium, filaments through the cribriform plate of the ethmoid, synapse in the olfactory bulb, tract back to the primary olfactory cortex — and why a fractured ethmoid causes anosmia. For II: retina to optic nerve, through the optic canal, PARTIAL crossing at the optic chiasm, optic tract, thalamus, optic radiation, occipital cortex. The chiasm is the lesson: make the learner reason about WHY a lesion before it blinds one eye while a lesion after it takes half the field of both. Never let them memorise the pathway without predicting a lesion.',
  '', null, 'Human Anatomy', 'Advanced', 'mvp-anatomy-twelve-pairs', 2, 'published',
  'guided', true, 'after_attempt', 'encouraging', 'guided', 'upper', false,
  '{"course_id": "mvp-anatomy-cranial-nerves", "course_version_id": "mvp-anatomy-cranial-nerves-v1", "lesson_type": "discussion", "objective": "Trace the olfactory and optic pathways and predict the deficit produced by a lesion at a named point."}'::jsonb
),
(
  'camp-cn-l3', 403, 'Moving the eye: oculomotor (III), trochlear (IV), abducens (VI)',
  'Three nerves share one job, so teach them together through the rule the deck gives: LR6 SO4, all the rest 3 — lateral rectus by VI, superior oblique by IV, everything else by III. Build III''s three jobs concretely (move the eyeball, lift the upper eyelid via levator palpebrae superioris, constrict the pupil and focus the lens via parasympathetic fibres) so the learner can DERIVE the palsy picture rather than recall it: ptosis, the eye resting down-and-out, a blown pupil, double vision. Contrast the two strabismus directions — external in III palsy, internal in VI palsy — and make them explain why each follows from the unopposed muscle.',
  '', null, 'Human Anatomy', 'Advanced', 'mvp-anatomy-twelve-pairs', 3, 'published',
  'guided', true, 'after_attempt', 'encouraging', 'guided', 'upper', false,
  '{"course_id": "mvp-anatomy-cranial-nerves", "course_version_id": "mvp-anatomy-cranial-nerves-v1", "lesson_type": "discussion", "objective": "Assign each extrinsic eye muscle to its nerve and derive the deficit produced by a III, IV or VI palsy."}'::jsonb
),
(
  'camp-cn-l4', 404, 'One face, three divisions: the trigeminal (V)',
  'The largest cranial nerve, and the cleanest example of a nerve organised by TERRITORY. Build V1 ophthalmic (superior orbital fissure; forehead, upper eyelid, cornea), V2 maxillary (foramen rotundum; cheek, upper lip, upper teeth, palate), V3 mandibular (foramen ovale; chin, lower teeth, anterior tongue for general sensation — NOT taste — plus the motor supply to the muscles of mastication). The corneal reflex is the clinical anchor for V1; clenching the jaw for V3. Trigeminal neuralgia is the applied anatomy: stabbing seconds-long pain triggered by ordinary touch, usually a vessel compressing the nerve near the brain stem. Make the learner predict WHICH division from a described numbness before naming it.',
  '', null, 'Human Anatomy', 'Advanced', 'mvp-anatomy-twelve-pairs', 4, 'published',
  'guided', true, 'after_attempt', 'encouraging', 'guided', 'upper', false,
  '{"course_id": "mvp-anatomy-cranial-nerves", "course_version_id": "mvp-anatomy-cranial-nerves-v1", "lesson_type": "discussion", "objective": "Map a described facial deficit to the correct trigeminal division and its skull foramen."}'::jsonb
),
(
  'camp-cn-l5', 405, 'From the pons down: VII to XII',
  'Finish the set, grouping by what a clinician actually does. VII facial: muscles of facial expression, taste from the anterior two-thirds of the tongue, tears and saliva — and Bell''s palsy, where the WHOLE half of the face droops (contrast a stroke, which spares the forehead). VIII vestibulocochlear: hearing plus balance, tested with a tuning fork. IX glossopharyngeal: swallow, taste posterior third, parotid saliva, and the carotid body and sinus monitoring blood gases and pressure. X vagus: the only pair leaving head and neck; hoarseness when its laryngeal branches fail. XI accessory: rootlets from the SPINAL CORD, not the brain stem — sternocleidomastoid and trapezius, tested by shrugging. XII hypoglossal: tongue, which deviates TOWARD the damaged side. Make them reason out each deviation direction rather than memorise it.',
  '', null, 'Human Anatomy', 'Advanced', 'mvp-anatomy-twelve-pairs', 5, 'published',
  'guided', true, 'after_attempt', 'encouraging', 'guided', 'upper', false,
  '{"course_id": "mvp-anatomy-cranial-nerves", "course_version_id": "mvp-anatomy-cranial-nerves-v1", "lesson_type": "discussion", "objective": "State what each of VII-XII carries, how it is tested, and the sign produced when it fails."}'::jsonb
)
on conflict (id) do update set
  position = excluded.position, title = excluded.title, tutor_prompt = excluded.tutor_prompt,
  module = excluded.module, level = excluded.level, unit_id = excluded.unit_id,
  unit_position = excluded.unit_position, publication_status = excluded.publication_status,
  help_ceiling = excluded.help_ceiling, require_attempt_first = excluded.require_attempt_first,
  final_answer_policy = excluded.final_answer_policy, tutor_tone = excluded.tutor_tone,
  tutor_pace = excluded.tutor_pace, grade_band = excluded.grade_band,
  curriculum_metadata = excluded.curriculum_metadata;

-- ---------------------------------------------------------------------------
-- Milestones — objective + expected_evidence.student_can feed "What you'll learn"
-- ---------------------------------------------------------------------------

insert into public.milestones (id, lesson_id, position, title, objective, level, skill_keys, expected_evidence, completion_rules, allowed_response_modes)
values
('camp-cn-l1-m', 'camp-cn-l1', 1, 'Read the map of twelve',
 'Order the twelve cranial nerves I-XII, classify each as sensory, motor or both, and say where each attaches to the brain.',
 'Advanced', ARRAY['anatomy.cn_order','anatomy.cn_modality']::text[],
 '{"student_can": ["name the twelve in order", "say whether a given nerve is sensory, motor or both", "state which two attach to the forebrain", "name the one pair that leaves head and neck"]}'::jsonb,
 '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
 ARRAY['text','multiple_choice']::text[]),
('camp-cn-l2-m', 'camp-cn-l2', 1, 'Trace a sensory pathway',
 'Trace the olfactory and optic pathways from receptor to cortex and predict the deficit from a lesion at a named point.',
 'Advanced', ARRAY['anatomy.olfactory_pathway','anatomy.optic_pathway']::text[],
 '{"student_can": ["trace smell from epithelium to cortex", "name the bone the olfactory filaments pierce", "explain what the optic chiasm does", "predict the field loss from a lesion before or after the chiasm"]}'::jsonb,
 '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
 ARRAY['text','multiple_choice']::text[]),
('camp-cn-l3-m', 'camp-cn-l3', 1, 'Derive an eye-movement palsy',
 'Assign each extrinsic eye muscle to its cranial nerve and derive the resting eye position and lid signs of a III, IV or VI palsy.',
 'Advanced', ARRAY['anatomy.eye_movement','anatomy.palsy_reasoning']::text[],
 '{"student_can": ["apply LR6 SO4 to name the nerve for a muscle", "list the three jobs of CN III", "explain why a III palsy gives ptosis and a down-and-out eye", "tell external from internal strabismus"]}'::jsonb,
 '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
 ARRAY['text','multiple_choice']::text[]),
('camp-cn-l4-m', 'camp-cn-l4', 1, 'Localise by territory',
 'Map a described facial sensory or motor deficit to the correct trigeminal division and name the foramen that division uses.',
 'Advanced', ARRAY['anatomy.trigeminal_divisions','anatomy.foramina']::text[],
 '{"student_can": ["state the territory of V1, V2 and V3", "name the foramen for each division", "explain which division carries the motor supply", "describe trigeminal neuralgia and its usual cause"]}'::jsonb,
 '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
 ARRAY['text','multiple_choice']::text[]),
('camp-cn-l5-m', 'camp-cn-l5', 1, 'Finish the set',
 'State what each of VII-XII carries, how a clinician tests it, and the sign that appears when it fails.',
 'Advanced', ARRAY['anatomy.lower_nerves','anatomy.clinical_testing']::text[],
 '{"student_can": ["say what CN VII carries besides facial movement", "explain why Bell''s palsy spares nothing but a stroke spares the forehead", "name what CN XI is unusual for", "say which way the tongue deviates in a XII lesion"]}'::jsonb,
 '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb,
 ARRAY['text','multiple_choice']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, title = excluded.title, objective = excluded.objective,
  skill_keys = excluded.skill_keys, expected_evidence = excluded.expected_evidence,
  completion_rules = excluded.completion_rules,
  allowed_response_modes = excluded.allowed_response_modes, updated_at = now();

update public.lessons set milestone_id = 'camp-cn-l1-m' where id = 'camp-cn-l1';
update public.lessons set milestone_id = 'camp-cn-l2-m' where id = 'camp-cn-l2';
update public.lessons set milestone_id = 'camp-cn-l3-m' where id = 'camp-cn-l3';
update public.lessons set milestone_id = 'camp-cn-l4-m' where id = 'camp-cn-l4';
update public.lessons set milestone_id = 'camp-cn-l5-m' where id = 'camp-cn-l5';

-- ---------------------------------------------------------------------------
-- Steps. idea_keys bind each step to the knowledge graph below.
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type, idea_keys)
values
-- L1
('camp-cn-l1-s1','camp-cn-l1','camp-cn-l1-m',1,'An ordered set, not a list','discussion','intro',
 'Twelve pairs of nerves leave the brain directly, and their numbers are not arbitrary: they are numbered I to XII by the order in which they arise, front to back. The first two pairs — olfactory and optic — attach to the forebrain; every other pair attaches to the brain stem. Each leaves the skull through its own opening, a foramen, which is why a fracture in one place takes out one nerve and spares its neighbour. Each nerve is sensory, motor, or both.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.cn_order']::text[],1,'explanation',null,ARRAY['cranial-nerve-set','nerve-modality']::text[]),
('camp-cn-l1-s2','camp-cn-l1','camp-cn-l1-m',2,'What a mnemonic is actually for','discussion','teach',
 'Two mnemonics run through this deck: "On Old Olympus'' Towering Top, A Finn Van German Viewed A Hop" for the names in order, and "Some Say Marry Money, But My Brother Says Big Brains Matter More" for whether each is Sensory, Motor or Both. Use them — then push past them. Pick any three nerves and say what each one actually does. A mnemonic that survives an exam but not a patient has not taught you anything.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.cn_order','anatomy.cn_modality']::text[],1,'inquiry',null,ARRAY['cranial-nerve-set','nerve-modality']::text[]),
('camp-cn-l1-s3','camp-cn-l1','camp-cn-l1-m',3,'The exception worth knowing','discussion','practice',
 'Almost every cranial nerve serves only head and neck structures. One does not: the vagus (X) descends through the neck into the thorax and abdomen. Why would evolution run a HEAD nerve all the way to the gut — what does that tell you about what the vagus is for? Then answer this: if all twelve served only the head, which clinical problems in this course would simply not exist?',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.cn_order']::text[],1,'practice','applied',ARRAY['cranial-nerve-set']::text[]),
('camp-cn-l1-s4','camp-cn-l1','camp-cn-l1-m',4,'Check: where do they attach?','multiple_choice','assessment',
 'Which statement about where the cranial nerves attach is correct?','multiple_choice','',null,
 '[{"id":"a","text":"The first two pairs attach to the forebrain; the rest are associated with the brain stem."},{"id":"b","text":"All twelve pairs attach to the brain stem."},{"id":"c","text":"All twelve pairs attach to the forebrain."},{"id":"d","text":"They attach to the spinal cord and travel up into the skull."}]'::jsonb,
 '{}'::jsonb,ARRAY['anatomy.cn_order']::text[],1,'assessment','mcq',ARRAY['cranial-nerve-set']::text[]),
-- L2
('camp-cn-l2-s1','camp-cn-l2','camp-cn-l2-m',1,'Smell: through the floor of the skull','discussion','intro',
 'Olfactory neurons sit in the epithelium high in the nasal cavity. Their filaments pass up through the cribriform plate — a sieve-like part of the ethmoid bone — to synapse in the olfactory bulb. From there the olfactory tract runs back beneath the frontal lobe to the primary olfactory cortex. Purely sensory. The clinical consequence follows straight from the anatomy: a fractured ethmoid shears those filaments where they pass through the bone, and smell is lost — anosmia.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.olfactory_pathway']::text[],1,'explanation',null,ARRAY['olfactory-pathway']::text[]),
('camp-cn-l2-s2','camp-cn-l2','camp-cn-l2-m',2,'The chiasm is the whole point','discussion','teach',
 'The optic pathway runs retina, optic nerve, optic canal, optic chiasm, optic tract, thalamus, optic radiation, occipital cortex. At the chiasm the fibres cross PARTIALLY — not completely. Work out with the mentor what that partial crossing buys us, and then the consequence: what does a lesion of one optic NERVE (before the chiasm) do to vision, and how is that different from a lesion of one optic TRACT (after it)? Reason it from the crossing rather than recalling a diagram.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.optic_pathway']::text[],1,'inquiry',null,ARRAY['optic-pathway','lesion-localisation']::text[]),
('camp-cn-l2-s3','camp-cn-l2','camp-cn-l2-m',3,'Test them like a clinician','discussion','practice',
 'A patient cannot smell the coffee in front of them, and has no other complaint. Another has lost the outer half of the visual field in BOTH eyes. For each: which nerve or pathway point is damaged, what single bedside test would you do, and what would you expect to find? The deck''s tests are simple on purpose — aromatic substances for I, visual fields for II. Say what you would actually do and what result would confirm your answer.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.olfactory_pathway','anatomy.optic_pathway']::text[],1,'practice','applied',ARRAY['olfactory-pathway','optic-pathway','lesion-localisation']::text[]),
('camp-cn-l2-s4','camp-cn-l2','camp-cn-l2-m',4,'Check: the cribriform plate','multiple_choice','assessment',
 'Olfactory nerve filaments reach the olfactory bulb by passing through which structure?','multiple_choice','',null,
 '[{"id":"a","text":"The cribriform plate of the ethmoid bone."},{"id":"b","text":"The optic canal."},{"id":"c","text":"The superior orbital fissure."},{"id":"d","text":"The jugular foramen."}]'::jsonb,
 '{}'::jsonb,ARRAY['anatomy.olfactory_pathway']::text[],1,'assessment','mcq',ARRAY['olfactory-pathway']::text[]),
-- L3
('camp-cn-l3-s1','camp-cn-l3','camp-cn-l3-m',1,'LR6 SO4, all the rest 3','discussion','intro',
 'Six muscles move each eye, and three nerves share them by one rule: the LATERAL RECTUS is supplied by VI (abducens), the SUPERIOR OBLIQUE by IV (trochlear), and everything else by III (oculomotor). CN III has three jobs, not one: move the eyeball, lift the upper eyelid through levator palpebrae superioris, and — through parasympathetic fibres — constrict the pupil and change the lens shape to focus. Hold on to those three; the palsy picture falls out of them.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.eye_movement']::text[],1,'explanation',null,ARRAY['eye-movement-rule','third-nerve-jobs']::text[]),
('camp-cn-l3-s2','camp-cn-l3','camp-cn-l3-m',2,'Derive the palsy, do not recall it','discussion','teach',
 'Do not look up what a third nerve palsy looks like — build it. If III stops working, its three jobs stop. Take them one at a time: what happens to the eyelid? What happens to the pupil? And with the lateral rectus (VI) and superior oblique (IV) still working and nothing opposing them, where does the eye come to rest? Say what you predict before checking, then compare it with the deck: ptosis, external strabismus, trouble focusing, double vision.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.palsy_reasoning']::text[],1,'inquiry',null,ARRAY['third-nerve-jobs','palsy-reasoning']::text[]),
('camp-cn-l3-s3','camp-cn-l3','camp-cn-l3-m',3,'Two strabismus directions','discussion','practice',
 'In a III palsy the eye rests turned OUTWARD (external strabismus); in a VI palsy it rests turned INWARD (internal strabismus). Both follow from the same principle — the muscle left unopposed pulls. Explain each direction in terms of which muscle is still working, then say how you would tell a IV palsy apart from both at the bedside, given the superior oblique''s job.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.palsy_reasoning']::text[],1,'practice','applied',ARRAY['palsy-reasoning','eye-movement-rule']::text[]),
('camp-cn-l3-s4','camp-cn-l3','camp-cn-l3-m',4,'Check: which nerve for lateral rectus?','multiple_choice','assessment',
 'A patient cannot move the right eye laterally, and at rest that eye turns inward. Which nerve is affected?','multiple_choice','',null,
 '[{"id":"a","text":"The abducens nerve (VI), which supplies the lateral rectus."},{"id":"b","text":"The oculomotor nerve (III), which supplies the lateral rectus."},{"id":"c","text":"The trochlear nerve (IV), which supplies the lateral rectus."},{"id":"d","text":"The optic nerve (II), which moves the eye laterally."}]'::jsonb,
 '{}'::jsonb,ARRAY['anatomy.eye_movement']::text[],1,'assessment','mcq',ARRAY['eye-movement-rule']::text[]),
-- L4
('camp-cn-l4-s1','camp-cn-l4','camp-cn-l4-m',1,'One nerve, three territories','discussion','intro',
 'The trigeminal is the largest cranial nerve and the main general sensory nerve of the face — touch, temperature and pain. Its name says the shape: three divisions. V1 ophthalmic covers the forehead, upper eyelid, cornea and nose, entering via the superior orbital fissure. V2 maxillary covers the cheek, upper lip, upper teeth and palate, via the foramen rotundum. V3 mandibular covers the chin, lower teeth and the anterior tongue for ordinary sensation, via the foramen ovale — and it alone carries motor fibres, to the muscles of chewing.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.trigeminal_divisions']::text[],1,'explanation',null,ARRAY['trigeminal-territory','skull-foramina']::text[]),
('camp-cn-l4-s2','camp-cn-l4','camp-cn-l4-m',2,'Sensation is not taste','discussion','teach',
 'V3 carries general sensation from the anterior two-thirds of the tongue — touch, temperature, pain — but NOT taste from it. Taste there travels with the facial nerve (VII). Two nerves, one piece of tongue, different jobs. Why does that separation matter clinically: what could a patient lose, and keep, if only one of the two were damaged? Work it out before moving on.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.trigeminal_divisions']::text[],1,'inquiry',null,ARRAY['trigeminal-territory']::text[]),
('camp-cn-l4-s3','camp-cn-l4','camp-cn-l4-m',3,'Localise from the complaint','discussion','practice',
 'Three patients. One has numbness of the cheek and upper teeth. One cannot feel a wisp of cotton touched to the cornea. One has numbness of the chin AND a weak bite on that side. For each: which division, which foramen, and what single test confirms it? Then read this description — sudden stabbing pain lasting seconds, triggered by brushing the teeth or a breeze on the face, dozens of times a day — and say what it is and what usually causes it.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.trigeminal_divisions','anatomy.foramina']::text[],1,'practice','applied',ARRAY['trigeminal-territory','skull-foramina','clinical-signs']::text[]),
('camp-cn-l4-s4','camp-cn-l4','camp-cn-l4-m',4,'Check: which division chews?','multiple_choice','assessment',
 'Which trigeminal division carries motor fibres to the muscles of mastication?','multiple_choice','',null,
 '[{"id":"a","text":"The mandibular division (V3), through the foramen ovale."},{"id":"b","text":"The ophthalmic division (V1), through the superior orbital fissure."},{"id":"c","text":"The maxillary division (V2), through the foramen rotundum."},{"id":"d","text":"All three divisions carry motor fibres equally."}]'::jsonb,
 '{}'::jsonb,ARRAY['anatomy.trigeminal_divisions']::text[],1,'assessment','mcq',ARRAY['trigeminal-territory']::text[]),
-- L5
('camp-cn-l5-s1','camp-cn-l5','camp-cn-l5-m',1,'Six nerves, grouped by what they do','discussion','intro',
 'VII facial moves the face, carries taste from the anterior two-thirds of the tongue, and drives tears and saliva. VIII vestibulocochlear carries hearing from the cochlea and balance from the semicircular canals. IX glossopharyngeal handles swallowing, taste from the posterior third, parotid saliva, and monitoring of blood pressure and blood gases at the carotid. X vagus runs past the head entirely into thorax and abdomen. XI accessory is unusual — its rootlets come from the spinal cord, not the brain stem — and it moves the head and shoulders. XII hypoglossal moves the tongue.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.lower_nerves']::text[],1,'explanation',null,ARRAY['lower-nerve-set','clinical-signs']::text[]),
('camp-cn-l5-s2','camp-cn-l5','camp-cn-l5-m',2,'Why a stroke spares the forehead','discussion','teach',
 'In Bell''s palsy the facial nerve itself fails and the WHOLE half of the face droops, forehead included. In a stroke affecting the same side of the face, the forehead is usually spared and the patient can still raise that eyebrow. That single difference sends patients down completely different treatment paths. Reason about what it implies: if the nerve is the final common path to all those muscles, what must be true higher up for the forehead to escape?',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.lower_nerves','anatomy.clinical_testing']::text[],1,'inquiry',null,ARRAY['clinical-signs','lower-nerve-set']::text[]),
('camp-cn-l5-s3','camp-cn-l5','camp-cn-l5-m',3,'Which way does it deviate?','discussion','practice',
 'Two signs point at their own lesion. In an accessory (XI) injury the head turns TOWARD the injured side, because the sternocleidomastoid that normally turns it away is paralysed. In a one-sided hypoglossal (XII) lesion the protruded tongue deviates TOWARD the damaged side. Do not memorise the directions — derive each from which muscle stopped pulling, then state a bedside test for each nerve and what a normal result looks like.',
 'text','',null,'[]'::jsonb,'{}'::jsonb,ARRAY['anatomy.clinical_testing']::text[],1,'practice','applied',ARRAY['clinical-signs','lower-nerve-set']::text[]),
('camp-cn-l5-s4','camp-cn-l5','camp-cn-l5-m',4,'Check: the tongue deviates','multiple_choice','assessment',
 'A patient protrudes their tongue and it deviates to the left. Which is correct?','multiple_choice','',null,
 '[{"id":"a","text":"The left hypoglossal nerve (XII) is damaged — the tongue deviates toward the damaged side."},{"id":"b","text":"The right hypoglossal nerve (XII) is damaged — the tongue deviates away from the damaged side."},{"id":"c","text":"The left glossopharyngeal nerve (IX) is damaged."},{"id":"d","text":"The left accessory nerve (XI) is damaged."}]'::jsonb,
 '{}'::jsonb,ARRAY['anatomy.clinical_testing']::text[],1,'assessment','mcq',ARRAY['clinical-signs']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, position = excluded.position,
  title = excluded.title, activity_type = excluded.activity_type, stage = excluded.stage,
  prompt = excluded.prompt, response_mode = excluded.response_mode, choices = excluded.choices,
  skill_keys = excluded.skill_keys, pass_score = excluded.pass_score, mode = excluded.mode,
  mode_type = excluded.mode_type, idea_keys = excluded.idea_keys;

insert into public.quiz_items (id, lesson_id, milestone_id, activity_id, position, prompt, question_type, choices, correct_choice_ids, rubric, skill_keys, status)
select a.id || '-quiz', a.lesson_id, a.milestone_id, a.id, a.position, a.prompt, 'multiple_choice',
       a.choices, ARRAY['a']::text[], '{}'::jsonb, a.skill_keys, 'published'
from public.lesson_activities a
where a.lesson_id like 'camp-cn-%' and a.mode_type = 'mcq'
on conflict (id) do update set prompt = excluded.prompt, choices = excluded.choices,
  correct_choice_ids = excluded.correct_choice_ids, status = excluded.status, updated_at = now();

-- ---------------------------------------------------------------------------
-- Knowledge graph
-- ---------------------------------------------------------------------------

insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select v.key, v.title, v.one_liner, 'Neuroanatomy: The Cranial Nerves', v.lesson_id, 'published'
from (values
  ('cranial-nerve-set','Twelve pairs, numbered by origin','The cranial nerves are an ordered set: numbered front to back by where they arise, each leaving through its own foramen.','camp-cn-l1'),
  ('nerve-modality','Sensory, motor, or both','Every cranial nerve carries sensation, movement, or a mix — and knowing which narrows a deficit immediately.','camp-cn-l1'),
  ('olfactory-pathway','Smell crosses a sieve of bone','Olfactory filaments pass through the cribriform plate to the bulb, which is why a fractured ethmoid costs you smell.','camp-cn-l2'),
  ('optic-pathway','The chiasm splits the story','Optic fibres cross partially at the chiasm, so a lesion before it blinds an eye and a lesion after it takes half of both fields.','camp-cn-l2'),
  ('lesion-localisation','A deficit names its own lesion','Where a pathway is cut determines exactly what is lost — so the pattern of loss localises the damage.','camp-cn-l2'),
  ('eye-movement-rule','LR6, SO4, all the rest 3','Lateral rectus is VI, superior oblique is IV, every other extrinsic eye muscle is III.','camp-cn-l3'),
  ('third-nerve-jobs','CN III has three jobs','Move the eyeball, lift the eyelid, and constrict the pupil while focusing the lens — lose the nerve and lose all three.','camp-cn-l3'),
  ('palsy-reasoning','The unopposed muscle pulls','A palsied eye rests where the still-working muscles drag it, which is why III gives an outward eye and VI an inward one.','camp-cn-l3'),
  ('trigeminal-territory','One face, three divisions','V1, V2 and V3 divide the face into bands of sensation, and only V3 also drives the muscles of chewing.','camp-cn-l4'),
  ('skull-foramina','Each nerve has its own doorway','Nerves leave the skull through named foramina, so a fracture at one doorway takes one nerve and spares its neighbours.','camp-cn-l4'),
  ('lower-nerve-set','From the pons down','VII to XII handle the face, hearing and balance, swallowing, the viscera, the shoulders and the tongue.','camp-cn-l5'),
  ('clinical-signs','Signs point at their own cause','Drooping, deviation and strabismus all point toward or away from a lesion in a way you can derive, not memorise.','camp-cn-l5')
) as v(key,title,one_liner,lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select v.term, v.variants, v.definition, 'Neuroanatomy: The Cranial Nerves', v.idea_keys, v.lesson_id, 'published'
from (values
  ('foramen', array['foramina'], 'A natural opening in bone that a nerve or vessel passes through.', array['skull-foramina'], 'camp-cn-l1'),
  ('afferent', array['afferents'], 'Carrying signals INTO the central nervous system — sensory traffic.', array['nerve-modality'], 'camp-cn-l1'),
  ('efferent', array['efferents'], 'Carrying signals OUT to muscles or glands — motor traffic.', array['nerve-modality'], 'camp-cn-l1'),
  ('cribriform plate', array['cribriform'], 'The sieve-like part of the ethmoid bone that olfactory nerve filaments pass through.', array['olfactory-pathway'], 'camp-cn-l2'),
  ('anosmia', array['anosmic'], 'Loss of the sense of smell, classically after a fracture shears the olfactory filaments.', array['olfactory-pathway'], 'camp-cn-l2'),
  ('optic chiasm', array['optic chiasma','chiasm'], 'The X where optic nerve fibres partially cross, so each side of the brain sees the opposite half of the world.', array['optic-pathway'], 'camp-cn-l2'),
  ('ptosis', array['ptotic'], 'A drooping upper eyelid — the levator palpebrae superioris has lost its nerve supply (CN III).', array['third-nerve-jobs'], 'camp-cn-l3'),
  ('strabismus', array['squint'], 'Eyes that do not point the same way, because a muscle has lost its nerve and the others pull unopposed.', array['palsy-reasoning'], 'camp-cn-l3'),
  ('proprioception', array['proprioceptor','proprioceptors'], 'The sense of where your own body parts are, reported by receptors inside muscles.', array['nerve-modality'], 'camp-cn-l3'),
  ('trigeminal neuralgia', array['tic douloureux'], 'Stabbing seconds-long facial pain, usually from a vessel compressing the trigeminal nerve near the brain stem.', array['clinical-signs'], 'camp-cn-l4'),
  ('mastication', array['masticatory'], 'Chewing — its muscles are driven by the mandibular division of the trigeminal nerve.', array['trigeminal-territory'], 'camp-cn-l4'),
  ('Bell''s palsy', array['bells palsy'], 'Facial nerve paralysis dropping one whole half of the face, forehead included, often with lost taste.', array['clinical-signs'], 'camp-cn-l5'),
  ('parasympathetic', array['parasympathetics'], 'The rest-and-digest half of the autonomic system — here it drives tears, saliva and pupil constriction.', array['third-nerve-jobs'], 'camp-cn-l5')
) as v(term,variants,definition,idea_keys,lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

-- Cross-subject links: anatomy earns its place next to the other campus classes.
insert into public.curriculum_links (from_key, to_key, kind, note, status)
select v.from_key, v.to_key, v.kind, v.note, 'published'
from (values
  ('lesion-localisation','claims-vs-reasons','same_pattern','Localising a lesion from a deficit IS reasoning from evidence to cause — the sign is the evidence, the lesion is the claim.'),
  ('skull-foramina','chloroplast-structure','same_pattern','Both are structure serving function: a bone''s openings route nerves the way a chloroplast''s membranes route reactions.'),
  ('nerve-modality','inputs-and-outputs','same_pattern','Afferent and efferent are just inputs and outputs named for the nervous system.'),
  ('palsy-reasoning','feedback-loop','contrast','A feedback loop corrects itself back to a goal; a palsied eye has lost the opposing pull and simply stays where it is dragged.')
) as v(from_key,to_key,kind,note)
where exists (select 1 from public.ideas i where i.key = v.to_key)
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'published'
from (values
  ('cranial-nerve-set','camp-cn-l1','Name the cranial nerves in order from I to VI, and say for each whether it is sensory, motor or both.','Lists olfactory, optic, oculomotor, trochlear, trigeminal, abducens with S, S, M, M, B, M.','intro'),
  ('nerve-modality','camp-cn-l1','A patient has a purely sensory deficit in the head. Which cranial nerves can you immediately rule OUT, and why?','Rules out the purely motor nerves (III, IV, VI, XI, XII) because a purely sensory loss cannot come from a motor-only nerve.','core'),
  ('optic-pathway','camp-cn-l2','A lesion destroys the left optic nerve just before the chiasm. What does the patient lose, and what would they still see?','States complete blindness in the left eye only, with the right eye''s full field intact, because the fibres had not yet crossed.','core'),
  ('optic-pathway','camp-cn-l2','Now move that lesion to the left optic TRACT, just after the chiasm. What changes, and why?','Explains loss of the right half of the visual field in BOTH eyes, because the tract carries crossed fibres from the other eye as well.','stretch'),
  ('third-nerve-jobs','camp-cn-l3','List the three jobs of CN III, then predict what a complete III palsy looks like on the face.','Names eye movement, eyelid elevation, pupil constriction and lens focusing; predicts ptosis, a down-and-out eye, a dilated pupil, double vision.','core'),
  ('eye-movement-rule','camp-cn-l3','Using LR6 SO4, say which nerve supplies the medial rectus, the superior oblique and the lateral rectus.','Medial rectus III, superior oblique IV, lateral rectus VI.','intro'),
  ('trigeminal-territory','camp-cn-l4','A patient cannot feel a cotton wisp on the cornea but has normal sensation on the cheek and chin. Which division, and which foramen?','Identifies V1 ophthalmic, entering via the superior orbital fissure, and notes the corneal reflex as the test.','core'),
  ('skull-foramina','camp-cn-l4','Name the foramen used by each trigeminal division, and say why a fracture at one spares the other two.','Superior orbital fissure (V1), foramen rotundum (V2), foramen ovale (V3); separate openings mean separate damage.','core'),
  ('clinical-signs','camp-cn-l5','A patient''s whole left face droops, including the forehead, and they cannot taste on the front left of the tongue. Name the condition and the nerve.','Identifies Bell''s palsy of the left facial nerve (VII), noting the forehead involvement and the taste loss from the anterior two-thirds.','core'),
  ('clinical-signs','camp-cn-l5','Explain, from the muscles, why the tongue deviates TOWARD a damaged hypoglossal nerve.','Explains that the working genioglossus on the intact side pushes its half forward, swinging the tip toward the weak side.','stretch')
) as v(idea_key,lesson_id,prompt,expected,difficulty)
where not exists (
  select 1 from public.practice_items p where p.idea_key = v.idea_key and p.prompt = v.prompt
);

-- Deliberate drafts so the studio review queue has real work on this class too.
insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select 'brainstem-levels','Level by level down the brain stem','Midbrain, pons and medulla each launch their own nerves, so a level of damage predicts a set of deficits.','Neuroanatomy: The Cranial Nerves','camp-cn-l1','draft'
where exists (select 1 from public.lessons l where l.id = 'camp-cn-l1')
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select 'lesion-localisation','camp-cn-l2','A patient loses the outer half of the field in both eyes. Where is the lesion, and what anatomical fact makes that the only possible answer?','Identifies a central chiasm lesion striking the crossing fibres from both nasal retinas.','stretch','draft'
where not exists (select 1 from public.practice_items p where p.idea_key='lesion-localisation' and p.prompt like 'A patient loses the outer half%');

-- ---------------------------------------------------------------------------
-- Figures cropped from the deck's own slides + the deck as the lesson reading
-- ---------------------------------------------------------------------------

insert into public.lesson_figures (lesson_id, idea_key, title, caption, image_url, alt_text, position, status)
select v.lesson_id, v.idea_key, v.title, v.caption, v.image_url, v.alt_text, v.position, v.status
from (values
  ('camp-cn-l1','cranial-nerve-set','The twelve pairs on the underside of the brain',
   'Where each nerve arises, its number, and whether it is sensory (S), motor (M) or both (B).',
   '/figures/cranial-nerves-brain-map.png',
   'Hand-drawn map of the base of the brain with the twelve cranial nerves labelled I to XII, each marked sensory, motor or both, beside the two classic mnemonics.',1,'published'),
  ('camp-cn-l1','nerve-modality','Where the cranial nerves sit in the nervous system',
   'Central versus peripheral, and the afferent/efferent split the cranial nerves belong to.',
   '/figures/nervous-system-overview.png',
   'Diagram dividing the nervous system into central and peripheral, with afferent sensory input to the brain and efferent motor output to muscles and glands.',2,'draft'),
  ('camp-cn-l2','olfactory-pathway','The olfactory pathway through the cribriform plate',
   'Filaments of the olfactory nerve passing from the nasal mucosa through bone to the bulb and tract.',
   '/figures/olfactory-pathway.png',
   'Sagittal section of the nasal cavity and frontal lobe showing olfactory nerve filaments passing through the cribriform plate of the ethmoid bone into the olfactory bulb, with the olfactory tract running back beneath the frontal lobe.',1,'published')
) as v(lesson_id,idea_key,title,caption,image_url,alt_text,position,status)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (select 1 from public.lesson_figures f where f.lesson_id = v.lesson_id and f.image_url = v.image_url);

insert into public.lesson_resources (lesson_id, title, description, resource_type, source_type, external_url, student_instructions, status, visibility)
select v.lesson_id, v.title, v.description, 'pdf', 'external_url', v.url, v.instructions, 'published', 'public'
from (values
  -- The deck is the reading for EVERY lesson (it covers all twelve pairs); each lesson
  -- points at its own section, so the "open the teacher's material first" gate has
  -- something real to ask for wherever the student is.
  ('camp-cn-l1','Lecture deck: Cranial Nerves 1 & 2','The full slide deck this course is built from — all twelve nerves, with origin, function, testing and applied anatomy.','/readings/cranial-nerves.pdf','Skim the first few slides before we start, then keep it open — we work through it nerve by nerve.'),
  ('camp-cn-l2','Lecture deck: Cranial Nerves 1 & 2','The opening sections trace the olfactory and optic pathways from receptor to cortex.','/readings/cranial-nerves.pdf','Follow the olfactory and optic pathway slides and note every structure each one passes through.'),
  ('camp-cn-l3','Lecture deck: Cranial Nerves 1 & 2','The eye-movement sections cover III, IV and VI together, with the palsy pictures.','/readings/cranial-nerves.pdf','Look up which muscle each of III, IV and VI drives before we derive the palsies.'),
  ('camp-cn-l4','Lecture deck: Cranial Nerves 1 & 2','The trigeminal section covers all three divisions and trigeminal neuralgia.','/readings/cranial-nerves.pdf','Find the three trigeminal divisions in the deck and note which foramen each uses.'),
  ('camp-cn-l5','Lecture deck: Cranial Nerves 1 & 2','The closing sections run VII through XII, each with its bedside test and failure sign.','/readings/cranial-nerves.pdf','Read the VII to XII sections and note the test a clinician uses for each one.')
) as v(lesson_id,title,description,url,instructions)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (select 1 from public.lesson_resources r where r.lesson_id = v.lesson_id and r.external_url = v.url);

-- ---------------------------------------------------------------------------
-- Class wiring: "Anatomy 1" in the demo org, the three testers enrolled,
-- one assignment due and one returned quiz. Skips cleanly without the demo org.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid; v_teacher uuid; v_class uuid; v_cp uuid; v_cp2 uuid; v_student uuid;
begin
  select id into v_org from public.organizations where slug = 'demo-org' limit 1;
  select id into v_teacher from auth.users where email = 'demo-teacher@example.com' limit 1;
  if v_org is null then
    raise notice 'Neuroanatomy: demo org absent; skipping class wiring.';
    return;
  end if;

  select id into v_class from public.classes where organization_id = v_org and name = 'Anatomy 1' limit 1;
  if v_class is null then
    insert into public.classes (organization_id, name, status, created_by)
    values (v_org, 'Anatomy 1', 'active', v_teacher) returning id into v_class;
  end if;

  if v_teacher is not null then
    insert into public.class_memberships (class_id, user_id, role, status)
    values (v_class, v_teacher, 'teacher', 'active')
    on conflict (class_id, user_id) do update set status = 'active', updated_at = now();
  end if;

  insert into public.class_courses (class_id, course_id, created_by)
  values (v_class, 'mvp-anatomy-cranial-nerves', v_teacher)
  on conflict (class_id, course_id) do nothing;

  -- Upcoming assignment -> Work due (due date refreshes if it has gone stale).
  select id into v_cp from public.checkpoints where class_id = v_class and title = 'Cranial nerve exam: localise five deficits' limit 1;
  if v_cp is null then
    insert into public.checkpoints (kind, organization_id, class_id, course_id, lesson_id, title, instructions, created_by, status, due_at)
    values ('assignment', v_org, v_class, 'mvp-anatomy-cranial-nerves', 'camp-cn-l5',
      'Cranial nerve exam: localise five deficits',
      'Five short clinical vignettes. For each: name the cranial nerve involved, say whether the fault is sensory, motor or both, name the foramen it leaves the skull through where relevant, and give the bedside test you would use to confirm it. Reason from the anatomy — a correct nerve with no reasoning earns half marks.',
      v_teacher, 'published', now() + interval '8 days') returning id into v_cp;
  else
    update public.checkpoints set due_at = now() + interval '8 days', updated_at = now()
      where id = v_cp and (due_at is null or due_at < now());
  end if;

  select id into v_cp2 from public.checkpoints where class_id = v_class and title = 'Quiz: the twelve pairs' limit 1;
  if v_cp2 is null then
    insert into public.checkpoints (kind, organization_id, class_id, course_id, lesson_id, title, instructions, created_by, status, due_at)
    values ('assessment', v_org, v_class, 'mvp-anatomy-cranial-nerves', 'camp-cn-l1',
      'Quiz: the twelve pairs', 'Order, modality, and attachment of the twelve cranial nerves.',
      v_teacher, 'published', now() - interval '2 days') returning id into v_cp2;
    insert into public.checkpoint_items (checkpoint_id, quiz_item_id, position, points)
    values (v_cp2, 'camp-cn-l1-s4-quiz', 1, 1) on conflict do nothing;
  end if;

  for v_student in
    select id from auth.users where email in ('carl@example.com','elissar@example.com','elie@example.com')
  loop
    insert into public.class_memberships (class_id, user_id, role, status)
    values (v_class, v_student, 'student', 'active')
    on conflict (class_id, user_id) do update set status = 'active', updated_at = now();

    insert into public.checkpoint_recipients (checkpoint_id, user_id, status)
    select v_cp, v_student, 'assigned'
    where not exists (select 1 from public.checkpoint_recipients r where r.checkpoint_id = v_cp and r.user_id = v_student);

    insert into public.checkpoint_recipients (checkpoint_id, user_id, status, score, final_score, submitted_at, returned_at)
    select v_cp2, v_student, 'returned', 0.85, 0.85, now() - interval '3 days', now() - interval '1 day'
    where not exists (select 1 from public.checkpoint_recipients r where r.checkpoint_id = v_cp2 and r.user_id = v_student);
  end loop;
end $$;
