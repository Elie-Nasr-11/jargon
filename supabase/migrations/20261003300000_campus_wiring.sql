-- CAMPUS DEMO wiring: the readings, the classes, the roster, and the graded work.
--
-- 1. THE READINGS. The five uploaded PDFs are committed to frontend/public/readings/ and
--    served by the static site, so they open in the media stage as real documents. Their
--    lesson_resources rows use RELATIVE urls ("/readings/x.pdf"): the iframe resolves them
--    against whatever origin the app is on, so the same row works in local dev and in prod
--    with no domain hardcoded. Each carries an APPROVED resource_text_chunks row holding a
--    passage transcribed from the document, which is what extract_knowledge reads when a
--    teacher drafts knowledge from the lesson (the scanned maths and biology papers have no
--    text layer at all, so without this the extractor would see nothing).
--
-- 2. THE CLASSES. Three classes in the demo org — Mathematics, Biology, History — each
--    linked to its course via class_courses, with demo-teacher teaching and every student
--    account enrolled. Students carl / elissar / elie are created by the deploy step that
--    runs alongside this migration (docs/HANDOFF.md); this file enrolls whoever exists, so
--    it is safe before and after they are created.
--
-- 3. THE WORK. Each class gets one upcoming assignment (Work due) and one returned, scored
--    assessment (Grades + the Home AVG pill), plus a quiz checkpoint bound to a real quiz
--    item. Due dates self-refresh on redeploy so the demo never looks stale.
--
-- Idempotent; guarded on the demo org existing.

-- ---------------------------------------------------------------------------
-- The readings as lesson resources (relative urls; served from public/readings)
-- ---------------------------------------------------------------------------

insert into public.lesson_resources (lesson_id, title, description, resource_type, source_type, external_url, student_instructions, status, visibility)
select v.lesson_id, v.title, v.description, 'pdf', 'external_url', v.url, v.instructions, 'published', 'public'
from (values
  ('camp-math-l4', 'Paper: Sequences, Series and Trigonometry (AFL)',
   'The Grade 10 assessment this course is built around — sequences, the unit circle, identities, and graphing.',
   '/readings/trigonometry-afl.pdf',
   'Try questions 3 and 4 after this lesson; bring whichever step you get stuck on.'),
  ('camp-bio-l3', 'Paper: Photosynthesis (Term 2)',
   'The Grade 10 PIB photosynthesis paper: photosystems, light-dependent reactions, the Calvin cycle, and rate graphs.',
   '/readings/photosynthesis-paper.pdf',
   'Look at questions 9 and 10 — the radioactive-carbon experiment and the limiting-factor graph.'),
  ('camp-hist-l1', 'Reading: The Broken Heart of America — Prologue',
   'Walter Johnson, "Mapping the Loss": the warehouse of salvaged architecture, thirty thousand vacant houses, and the case for Black removal.',
   '/readings/broken-heart-of-america-i.pdf',
   'Read the prologue. Mark every place Johnson gives a NUMBER — those are his evidence.'),
  ('camp-hist-l2', 'Reading: The Broken Heart of America — Not Poor, Just Broke',
   'Chapter 8: the Great Migration into St. Louis and the 1916 segregation ordinance passed by popular referendum.',
   '/readings/broken-heart-of-america-ii.pdf',
   'Find the Universal Welfare Association''s defence of the ordinance and copy the sentence out.'),
  ('camp-hist-l3', 'Reading: The Middle Classes',
   'Christof Dejung on the interwar middle classes — Tucholsky, Ossietzky, and the case for looking beyond Europe.',
   '/readings/the-middle-classes.pdf',
   'Read the opening pages. Note what Dejung says the First World War did to expectations of progress.')
) as v(lesson_id, title, description, url, instructions)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (select 1 from public.lesson_resources r where r.lesson_id = v.lesson_id and r.title = v.title);

-- Approved text chunks: what extract_knowledge actually reads. Transcribed from the
-- documents themselves (the maths and biology papers are scans with no text layer).
insert into public.resource_text_chunks (resource_id, lesson_id, page_number, chunk_index, chunk_text, status)
select r.id, r.lesson_id, v.page_number, v.chunk_index, v.chunk_text, 'approved'
from (values
  ('Paper: Sequences, Series and Trigonometry (AFL)', 1, 0,
   'Outcomes assessed: find missing terms by writing explicit formulas of arithmetic sequences and find sums of series; the same for geometric sequences; express the relationship between the unit circle and radian measure; use the unit circle to define the trigonometric functions for all real numbers; use a given trigonometric function to calculate the values of other trigonometric functions by means of the Pythagorean identity; use the key features of the graphs to sketch transformed Sine, Cosine and Tangent functions; use Sum and Difference trigonometric properties to calculate trigonometric values and simplify expressions; use Double angle and Half angle trigonometric properties.'),
  ('Paper: Sequences, Series and Trigonometry (AFL)', 2, 0,
   'Question 1: a_n is a geometric sequence where a_2 = 0.2 and a_5 = 43.2. Find a_1; write an explicit formula of a_n; find the sum from n = 1 to n = 15. Question 2: given the coordinates of a point (3, -4), plot the point on the coordinate system and construct the angle of rotation theta associated with the given point; evaluate Sin theta, Cos theta and Tan theta. Question 3: given Cos theta = -1/2 where pi/2 <= theta <= pi, calculate Sin theta; calculate Cos(2 theta) and Tan(2 theta). Question 4: given Cos(2 theta) = sqrt(3)/2 where 0 <= theta <= pi/2, calculate Sin(2 theta).'),
  ('Paper: Sequences, Series and Trigonometry (AFL)', 3, 0,
   'Question 5: without using a calculator, calculate the value of Sin(-135) and Tan(2pi/3). Question 6: simplify the trigonometric expression Cos(pi - theta) - Sin(pi/2 - theta). Question 7: show that 1/cos^2 x - tan^2 x = 1. Question 8: use the five-step method to sketch the function f(x) = Tan(x + pi) - 1. Total 30 marks.'),
  ('Paper: Photosynthesis (Term 2)', 1, 0,
   'Identify the main function of photosystems: to absorb and transfer light energy in order to excite electrons. Identify the correct description of a photosystem: arrays of pigments within protein complexes. During the light-dependent reactions the electrons needed to replace those lost from photosystem II come from water molecules. If six molecules of water were split, determine the number of O2, H+ and e- that would be formed: 3 O2, 12 H+, 12 e-. Within the intermembrane space of the thylakoids while light is being absorbed you would expect low pH conditions due to the high concentration of H+.'),
  ('Paper: Photosynthesis (Term 2)', 3, 0,
   'A diagram shows reactions taking place during the light dependent reactions of photosynthesis, with Photosystem 2 and Photosystem 1 labelled. Excited electrons in PSII transfer through the electron transport chain, allowing protons to get pumped into the lumen creating a proton gradient. Name the enzyme that forms ATP and what causes it to function. Describe what happens in photosystem I. A further diagram depicts the light-independent reactions: compound M is a 1C compound, compound N is a 5C compound, compound O is a 3C compound formed as 2 molecules, and compound P is a 6C compound.'),
  ('Paper: Photosynthesis (Term 2)', 4, 0,
   'An experiment using radioactive carbon investigated the Calvin cycle. The alga Chlorella was exposed to radioactive carbon for different amounts of time and analysed for radioactive compounds; when the light was switched off, labelled GP rose while labelled RuBP fell. A further graph shows the effect of light intensity, carbon dioxide and temperature on the rate of photosynthesis, with curves A (0.04% carbon dioxide at 15 C), B (0.04% at 25 C), C (0.04% at 35 C) and D (0.1% at 25 C). A commercial farmer growing peppers keeps her greenhouses at 25 C with 0.04% carbon dioxide and ambient light intensity of 3000 lux.'),
  ('Reading: The Broken Heart of America — Prologue', 1, 0,
   'The architectural history of a once-great city lies packed into crates in a warehouse near Cahokia, Illinois. The city of St. Louis torn down, pieced out into elements, cataloged, and packed into crates. Across the Mississippi River the pieces of the past lie scattered around the foundations of the city''s thirty thousand vacant houses; some can be bought for as little as a single dollar. The population of the city today is just over 300,000 - roughly the same number as in 1870, and around one-third of the total in 1950. It is a truism that the struggles of American cities in the second half of the twentieth century were due to white flight, and there is no doubt that St. Louis whites moved out of the city in droves in the years following the Second World War. But the story of the human geography of St. Louis is as much a story of Black removal - the serial destruction of Black neighborhoods and the transfer of their population according to the reigning model of profit and policing at any given moment - as of white flight. Of the city''s abandoned houses it is perhaps fair to say that they are worth more dead than alive: the deep burgundy bricks sell for fifty cents apiece in cities like New Orleans and Houston.'),
  ('Reading: The Broken Heart of America — Not Poor, Just Broke', 1, 0,
   'Tens of thousands of Blacks migrated to the city, joining the refugees from East St. Louis, in the years between the world wars. They came in search of sanctuary from the white supremacist violence of the Deep South, of honest wages instead of sharecropping contracts and company stores, of the chance to vote, and of the hope of something closer to freedom. In the years between the world wars the proportion of African Americans in the city''s population almost doubled, to over 13 percent, about 100,000 people. On February 29, 1916, the city of St. Louis became the first in the nation to pass a residential segregation ordinance by popular referendum, part of a wider panic about Black refugees from the South. The ordinance was sponsored by a long list of real estate commercial interests and white neighborhood associations that came together as the Universal Welfare Association. It stipulated that no Blacks should move into neighborhoods where either 100 percent of the houses were owned by whites or 75 percent of the residents were white, and banned whites from moving to neighborhoods in which the opposite prevailed. Our ordinance protects both the Negro and white man where he lives now, said the Universal Welfare Association, in an early instance of the employment of false equivalence in the service of white supremacy.'),
  ('Reading: The Middle Classes', 1, 0,
   'In 1920 Kurt Tucholsky mused in the magazine Die Weltbuehne: It is odd, this bourgeoisie. Odd in its rigid adherence to forms that are void, to things that actually do not exist anymore. The era of the bourgeoisie is over. Nobody knows what will come next. On February 21, 1933, just a week before being illegally arrested by the Nazis, Carl von Ossietzky confirmed in the same magazine: The bourgeois is broke, his ideals are scattered to the four winds. These quotations may be considered evidence for the crisis of middle-class culture that contemporaries noticed in various European countries in the face of economic troubles, the intensification of class conflict, the enduring critique of parliamentary democracy, and the rise of mass culture in the interwar years. The First World War had fundamentally shattered the expectation of social progress. This contribution aims to also explore the history of the middle classes in other parts of the world, beyond Europe: the interwar years brought about social changes in Asia, the Middle East, Africa and the Americas that affected the middle classes in these areas. The First World War was indeed a global moment.')
) as v(title, page_number, chunk_index, chunk_text)
join public.lesson_resources r on r.title = v.title
where not exists (
  select 1 from public.resource_text_chunks c
  where c.resource_id = r.id and c.page_number = v.page_number and c.chunk_index = v.chunk_index
);

-- ---------------------------------------------------------------------------
-- Classes, roster, and graded work
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid;
  v_teacher uuid;
  v_class uuid;
  v_cp uuid;
  spec record;
  student record;
begin
  select id into v_org from public.organizations where slug = 'demo-org' limit 1;
  select id into v_teacher from auth.users where email = 'demo-teacher@example.com' limit 1;
  if v_org is null then
    raise notice 'Campus demo: demo org not seeded; skipping class wiring.';
    return;
  end if;

  for spec in
    select * from (values
      ('Mathematics 10', 'camp-math-trig', 'camp-math-l1',
       'Problem set: sequences and series',
       'Complete questions 1a-1c from the AFL paper: given a geometric sequence with a2 = 0.2 and a5 = 43.2, find a1, write the explicit formula, and evaluate the sum of the first 15 terms. Show the reasoning for the step count between the given terms - not just the answer.',
       'Quiz: the unit circle and radian measure', 'camp-math-l3', 'camp-math-l3-s4-q', 0.8),
      ('Biology 10', 'camp-bio-photo', 'camp-bio-l2',
       'Written answer: follow the electron',
       'In no more than 300 words, trace an electron from a water molecule to NADPH. Name photolysis, the electron transport chain, the proton gradient in the thylakoid lumen, and ATP synthase, and explain WHY the lumen becomes acidic while light is being absorbed.',
       'Quiz: photosystems and photolysis', 'camp-bio-l1', 'camp-bio-l1-s4-q', 0.75),
      ('History 10', 'camp-hist-city', 'camp-hist-l2',
       'Paragraph: fairness as an instrument',
       'Write one tight paragraph answering: how did the 1916 St. Louis ordinance use the language of fairness to entrench inequality? Quote the Universal Welfare Association''s own defence, explain what the ordinance did, and name one source you would want in order to test your explanation.',
       'Quiz: reading a city as evidence', 'camp-hist-l1', 'camp-hist-l1-s4-q', 0.9)
    ) as t(class_name, course_id, assign_lesson, assign_title, assign_body, quiz_title, quiz_lesson, quiz_item, quiz_score)
  loop
    select id into v_class from public.classes
      where organization_id = v_org and name = spec.class_name limit 1;
    if v_class is null then
      insert into public.classes (organization_id, name, status, created_by)
      values (v_org, spec.class_name, 'active', v_teacher)
      returning id into v_class;
    end if;

    if v_teacher is not null then
      insert into public.class_memberships (class_id, user_id, role, status)
      values (v_class, v_teacher, 'teacher', 'active')
      on conflict (class_id, user_id) do update set status = 'active', updated_at = now();
    end if;

    -- Every demo student account gets every class: the roster is the point of the demo.
    for student in
      select id, email from auth.users
      where email in ('demo-student@example.com', 'carl@example.com',
                      'elissar@example.com', 'elie@example.com')
    loop
      insert into public.class_memberships (class_id, user_id, role, status)
      values (v_class, student.id, 'student', 'active')
      on conflict (class_id, user_id) do update set status = 'active', updated_at = now();

      insert into public.organization_memberships (organization_id, user_id, role, status)
      values (v_org, student.id, 'student', 'active')
      on conflict (organization_id, user_id) do nothing;
    end loop;

    insert into public.class_courses (class_id, course_id, created_by)
    values (v_class, spec.course_id, v_teacher)
    on conflict (class_id, course_id) do nothing;

    -- Upcoming assignment -> the Work due row.
    select id into v_cp from public.checkpoints
      where class_id = v_class and title = spec.assign_title limit 1;
    if v_cp is null then
      insert into public.checkpoints (kind, organization_id, class_id, course_id, lesson_id, title, instructions, created_by, status, due_at)
      values ('assignment', v_org, v_class, spec.course_id, spec.assign_lesson, spec.assign_title, spec.assign_body, v_teacher, 'published', now() + interval '6 days')
      returning id into v_cp;
    else
      update public.checkpoints set due_at = now() + interval '6 days', updated_at = now()
        where id = v_cp and (due_at is null or due_at < now());
    end if;
    insert into public.checkpoint_recipients (checkpoint_id, user_id, status)
    select v_cp, m.user_id, 'assigned'
    from public.class_memberships m
    where m.class_id = v_class and m.role = 'student' and m.status = 'active'
      and not exists (
        select 1 from public.checkpoint_recipients r
        where r.checkpoint_id = v_cp and r.user_id = m.user_id
      );

    -- Returned, scored quiz -> Grades + the Home AVG pill. Scores differ per class so the
    -- average is a real average rather than one number repeated.
    select id into v_cp from public.checkpoints
      where class_id = v_class and title = spec.quiz_title limit 1;
    if v_cp is null then
      insert into public.checkpoints (kind, organization_id, class_id, course_id, lesson_id, title, instructions, created_by, status, due_at)
      values ('assessment', v_org, v_class, spec.course_id, spec.quiz_lesson, spec.quiz_title,
              'A short check on the core idea of this unit.', v_teacher, 'published', now() - interval '2 days')
      returning id into v_cp;
      insert into public.checkpoint_items (checkpoint_id, quiz_item_id, position, points)
      values (v_cp, spec.quiz_item, 1, 1)
      on conflict do nothing;
    end if;
    insert into public.checkpoint_recipients (checkpoint_id, user_id, status, score, final_score, submitted_at, returned_at)
    select v_cp, m.user_id, 'returned', spec.quiz_score, spec.quiz_score,
           now() - interval '3 days', now() - interval '1 day'
    from public.class_memberships m
    where m.class_id = v_class and m.role = 'student' and m.status = 'active'
      and not exists (
        select 1 from public.checkpoint_recipients r
        where r.checkpoint_id = v_cp and r.user_id = m.user_id
      );
  end loop;
end $$;
