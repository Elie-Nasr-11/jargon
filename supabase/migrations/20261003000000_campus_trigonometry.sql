-- CAMPUS DEMO, part 1 of 3: MATHEMATICS — Sequences, Series and Trigonometry.
--
-- Built from the uploaded Grade 10 "Assessment For Learning" (Abu Dhabi International
-- School, Algebra II modules 13-15) whose assessed outcomes are, verbatim:
--   1. explicit formulas of arithmetic sequences and sums of series
--   2. explicit formulas of geometric sequences and sums of series
--   3. the relationship between the unit circle and radian measure
--   4. the unit circle to define the trigonometric functions for all real numbers
--   5. one trig function to calculate the others via the Pythagorean identity
--   6. key features of the graphs to sketch transformed sine, cosine and tangent
--   7. sum and difference properties
--   8. double angle and half angle properties
-- Four lessons cover 1-2, 3-4, 5+7+8, and 6 in that order, each ending on the exact style
-- of question the paper asks.
--
-- This is also the FIRST content to use R29's math rendering: step prompts carry LaTeX in
-- $...$ / $$...$$, ```graph blocks plot functions, and ```geometry blocks draw the unit
-- circle and reference triangles. Every formula in here is real notation, not ASCII.
--
-- Deploy-order contract: registered AFTER 20260713000000_book_f_only_catalog.sql (which
-- archives non-Book-F published rows each deploy) so the re-publish sticks. Idempotent.

insert into public.subjects (id, title, description, status)
values
  ('camp-math', 'Mathematics', 'Grade 10 Algebra II: patterns that continue forever, and the circle that defines the trigonometric functions.', 'published')
on conflict (id) do update set
  title = excluded.title, description = excluded.description, status = excluded.status, updated_at = now();

insert into public.courses (id, subject_id, title, description, status)
values
  ('camp-math-trig', 'camp-math', 'Sequences, Series and Trigonometry', 'From arithmetic and geometric sequences to the unit circle, the Pythagorean identity, the sum, difference and double-angle properties, and sketching transformed trigonometric graphs.', 'published')
on conflict (id) do update set
  subject_id = excluded.subject_id, title = excluded.title, description = excluded.description,
  status = excluded.status, updated_at = now();

insert into public.course_versions (id, course_id, version_label, status, is_current, content_schema_version)
values ('camp-math-trig-v1', 'camp-math-trig', 'v1', 'published', true, 1)
on conflict (id) do update set
  course_id = excluded.course_id, version_label = excluded.version_label, status = excluded.status,
  is_current = excluded.is_current, content_schema_version = excluded.content_schema_version, updated_at = now();

insert into public.units (id, course_version_id, position, title, description)
values
  ('camp-math-u1', 'camp-math-trig-v1', 1, 'Sequences and Series', 'Patterns with a rule: what the nth term is, and what the whole run adds up to.'),
  ('camp-math-u2', 'camp-math-trig-v1', 2, 'Trigonometric Functions', 'The unit circle, radian measure, the identities, and the graphs.')
on conflict (id) do update set
  course_version_id = excluded.course_version_id, position = excluded.position,
  title = excluded.title, description = excluded.description, updated_at = now();

-- ---------------------------------------------------------------------------
-- Lessons (global spine 301+)
-- ---------------------------------------------------------------------------

insert into public.lessons (id, position, title, tutor_prompt, sample_code, expected_output, module, level, unit_id, unit_position, publication_status, help_ceiling, require_attempt_first, final_answer_policy, tutor_tone, tutor_pace, grade_band, allow_live_artifacts, curriculum_metadata)
values
(
  'camp-math-l1', 301, 'Arithmetic sequences and their sums',
  'Lead the learner to see an arithmetic sequence as "start somewhere, add the same thing every time", and to derive the explicit formula rather than memorise it. Insist on the distinction between the RECURSIVE rule (what you add) and the EXPLICIT formula (jump straight to any term). When summing, guide them to Gauss''s pairing argument before showing the formula — the pairing is the reason the formula is true. Write mathematics in real notation: $a_n = a_1 + (n-1)d$, never ASCII. Watch for the classic off-by-one: the first term already exists before any $d$ is added, so the nth term has $(n-1)$ steps, not $n$.',
  '', null, 'Mathematics', 'Grade 10', 'camp-math-u1', 1, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-math-trig", "course_version_id": "camp-math-trig-v1", "lesson_type": "discussion", "objective": "Write the explicit formula of an arithmetic sequence and find the sum of a finite arithmetic series."}'::jsonb
),
(
  'camp-math-l2', 302, 'Geometric sequences and their sums',
  'Guide the learner from "add the same thing" to "MULTIPLY by the same thing", and to find the common ratio from any two terms — the exam''s favourite move is giving $a_2$ and $a_5$ and asking for $a_1$, which needs $r^3 = a_5/a_2$. Make them state why three steps separate the 2nd and 5th terms before they compute. For sums, anchor $S_n = a_1\\frac{1-r^n}{1-r}$ in the telescoping trick (multiply by $r$, subtract) rather than presenting it as a fact to memorise. Use real notation throughout.',
  '', null, 'Mathematics', 'Grade 10', 'camp-math-u1', 2, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-math-trig", "course_version_id": "camp-math-trig-v1", "lesson_type": "discussion", "objective": "Find the explicit formula of a geometric sequence from two terms and evaluate a finite geometric series."}'::jsonb
),
(
  'camp-math-l3', 303, 'The unit circle, radians, and the six functions',
  'Help the learner see that the unit circle turns sine and cosine from triangle ratios (only for acute angles) into functions defined for EVERY real number: the angle is a rotation, and the point it lands on has coordinates $(\\cos\\theta, \\sin\\theta)$. Derive radian measure from arc length — one radian is the angle whose arc equals the radius, so a full turn is $2\\pi$ — never as a conversion rule to memorise. Use the ```geometry block with "unitCircle": true to draw rotations and reference triangles. Watch for the two big misconceptions: that radians are "just another unit like degrees" (they are a pure ratio), and that sine is a length rather than a coordinate, which is why sine goes negative below the axis.',
  '', null, 'Mathematics', 'Grade 10', 'camp-math-u2', 1, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-math-trig", "course_version_id": "camp-math-trig-v1", "lesson_type": "discussion", "objective": "Relate radian measure to the unit circle and use the circle to evaluate trigonometric functions of any real number."}'::jsonb
),
(
  'camp-math-l4', 304, 'Identities: Pythagorean, sum, difference, double angle',
  'Guide the learner to treat identities as CONSEQUENCES of the unit circle, not a list to memorise: $\\sin^2\\theta + \\cos^2\\theta = 1$ is the circle''s own equation $x^2 + y^2 = 1$ rewritten. Dividing that identity by $\\cos^2\\theta$ produces $\\tan^2\\theta + 1 = \\sec^2\\theta$ — have them do the dividing themselves. When a value is given with a quadrant restriction, the QUADRANT decides the sign and they must say so before computing. Then the double angle formulas follow from the sum formulas with $\\alpha = \\beta$. Always demand the sign reasoning, not just the number.',
  '', null, 'Mathematics', 'Grade 10', 'camp-math-u2', 2, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-math-trig", "course_version_id": "camp-math-trig-v1", "lesson_type": "discussion", "objective": "Use the Pythagorean, sum, difference and double-angle identities to evaluate and simplify trigonometric expressions."}'::jsonb
),
(
  'camp-math-l5', 305, 'Sketching transformed trigonometric graphs',
  'Teach the five-step method for sketching $f(x) = a\\,\\mathrm{trig}(b(x-h)) + k$: identify the parent function, find the period ($\\frac{2\\pi}{b}$ for sine and cosine, $\\frac{\\pi}{b}$ for tangent), apply the horizontal shift, apply the vertical stretch and shift, then mark the key points or asymptotes. Use ```graph blocks to show the parent and the transformed curve, but ALWAYS ask the learner to predict the change before you draw it. The tangent case matters most: its asymptotes move with the shift, and students routinely forget the period is $\\pi$ rather than $2\\pi$.',
  '', null, 'Mathematics', 'Grade 10', 'camp-math-u2', 3, 'published', 'guided', true, 'after_attempt', 'friendly', 'guided', '9-12', false,
  '{"course_id": "camp-math-trig", "course_version_id": "camp-math-trig-v1", "lesson_type": "discussion", "objective": "Use key features (period, shift, amplitude, asymptotes) to sketch transformed sine, cosine and tangent functions."}'::jsonb
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
('camp-math-l1-m', 'camp-math-l1', 1, 'Arithmetic sequences and series', 'Write the explicit formula of an arithmetic sequence from given terms and evaluate the sum of a finite arithmetic series.', 'Grade 10', ARRAY['math.arithmetic_sequence', 'math.series_sum']::text[], '{"student_can": ["find d from two terms", "write a_n explicitly", "sum a finite series"]}'::jsonb, '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb, ARRAY['text', 'multiple_choice']::text[]),
('camp-math-l2-m', 'camp-math-l2', 1, 'Geometric sequences and series', 'Find the common ratio and first term of a geometric sequence from two given terms, write the explicit formula, and evaluate a finite geometric series.', 'Grade 10', ARRAY['math.geometric_sequence', 'math.series_sum']::text[], '{"student_can": ["find r from two non-adjacent terms", "write a_n explicitly", "evaluate a finite geometric sum"]}'::jsonb, '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb, ARRAY['text', 'multiple_choice']::text[]),
('camp-math-l3-m', 'camp-math-l3', 1, 'Unit circle and radian measure', 'Explain radian measure from arc length and use the unit circle to evaluate trigonometric functions of any angle, including negative and obtuse ones.', 'Grade 10', ARRAY['math.unit_circle', 'math.radians']::text[], '{"student_can": ["define a radian from arc length", "place an angle of rotation on the circle", "read sine and cosine as coordinates"]}'::jsonb, '{"requires": ["student_explanation", "quiz_passed"], "min_score": 1}'::jsonb, ARRAY['text', 'multiple_choice']::text[]),
('camp-math-l4-m', 'camp-math-l4', 1, 'Trigonometric identities', 'Use the Pythagorean identity with quadrant reasoning to find one function from another, and apply sum, difference and double-angle properties to evaluate and simplify.', 'Grade 10', ARRAY['math.pythagorean_identity', 'math.angle_identities']::text[], '{"student_can": ["justify the sign from the quadrant", "derive tan^2+1=sec^2", "apply a double angle formula"]}'::jsonb, '{"requires": ["student_explanation"], "min_score": 1}'::jsonb, ARRAY['text']::text[]),
('camp-math-l5-m', 'camp-math-l5', 1, 'Graphing transformations', 'Sketch a transformed sine, cosine or tangent function using period, shift and amplitude, and mark its key points and asymptotes.', 'Grade 10', ARRAY['math.trig_graphs']::text[], '{"student_can": ["compute the period from b", "apply horizontal and vertical shifts", "locate asymptotes of a shifted tangent"]}'::jsonb, '{"requires": ["student_explanation"], "min_score": 1}'::jsonb, ARRAY['text']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, position = excluded.position, title = excluded.title,
  objective = excluded.objective, level = excluded.level, skill_keys = excluded.skill_keys,
  expected_evidence = excluded.expected_evidence, completion_rules = excluded.completion_rules,
  allowed_response_modes = excluded.allowed_response_modes, updated_at = now();

update public.lessons set milestone_id = 'camp-math-l1-m' where id = 'camp-math-l1';
update public.lessons set milestone_id = 'camp-math-l2-m' where id = 'camp-math-l2';
update public.lessons set milestone_id = 'camp-math-l3-m' where id = 'camp-math-l3';
update public.lessons set milestone_id = 'camp-math-l4-m' where id = 'camp-math-l4';
update public.lessons set milestone_id = 'camp-math-l5-m' where id = 'camp-math-l5';

-- ---------------------------------------------------------------------------
-- Steps. Math notation is LaTeX in $...$; figures ride ```graph / ```geometry.
-- ---------------------------------------------------------------------------

insert into public.lesson_activities (id, lesson_id, milestone_id, position, title, activity_type, stage, prompt, response_mode, starter_code, expected_output, choices, rubric, skill_keys, pass_score, mode, mode_type, idea_keys)
values
-- L1 arithmetic
('camp-math-l1-s1', 'camp-math-l1', 'camp-math-l1-m', 1, 'A rule you can jump with', 'discussion', 'intro',
 'An **arithmetic sequence** starts at a first term $a_1$ and adds the same **common difference** $d$ every step: $3, 7, 11, 15, \ldots$ has $d = 4$. The recursive rule $a_n = a_{n-1} + d$ is honest but slow — to reach the 50th term you would have to walk all 49 steps. The explicit formula lets you jump straight there:
$$a_n = a_1 + (n-1)d$$
Notice the $(n-1)$: the first term is already sitting there before you add anything, so reaching the nth term takes one fewer step than you might expect.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.arithmetic_sequence']::text[], 1, 'explanation', null, ARRAY['arithmetic-sequence']::text[]),
('camp-math-l1-s2', 'camp-math-l1', 'camp-math-l1-m', 2, 'Why the pairing trick works', 'discussion', 'teach',
 'Here is the story every textbook tells: a schoolboy named Gauss was told to add $1 + 2 + 3 + \cdots + 100$ and finished almost instantly. He paired the first with the last, the second with the second-last, and so on — and every pair added to the same total. Work out with me: what does each pair sum to, how many pairs are there, and what does that make the total? Then tell me how that argument turns into the general formula
$$S_n = \frac{n}{2}(a_1 + a_n)$$',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.series_sum']::text[], 1, 'inquiry', null, ARRAY['series-sum', 'arithmetic-sequence']::text[]),
('camp-math-l1-s3', 'camp-math-l1', 'camp-math-l1-m', 3, 'Build one from two terms', 'discussion', 'practice',
 'An arithmetic sequence has $a_3 = 11$ and $a_7 = 27$. Find $d$ first — say out loud how many steps separate the 3rd and 7th terms before you divide — then find $a_1$, write the explicit formula for $a_n$, and use it to evaluate
$$\sum_{n=1}^{20} a_n$$
Show the reasoning for the step count; that is the part that goes wrong most often.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.arithmetic_sequence', 'math.series_sum']::text[], 1, 'practice', 'applied', ARRAY['arithmetic-sequence', 'series-sum']::text[]),
('camp-math-l1-s4', 'camp-math-l1', 'camp-math-l1-m', 4, 'Check: the step count', 'multiple_choice', 'assessment',
 'In an arithmetic sequence with first term $a_1$ and common difference $d$, which expression gives the 12th term?',
 'multiple_choice', '', null,
 '[{"id": "a", "text": "a_1 + 11d — the first term plus eleven steps"}, {"id": "b", "text": "a_1 + 12d — the first term plus twelve steps"}, {"id": "c", "text": "12a_1 + d — twelve first terms plus one step"}, {"id": "d", "text": "a_1 x d^11 — the first term times the difference eleven times"}]'::jsonb,
 '{}'::jsonb, ARRAY['math.arithmetic_sequence']::text[], 1, 'assessment', 'mcq', ARRAY['arithmetic-sequence']::text[]),
-- L2 geometric
('camp-math-l2-s1', 'camp-math-l2', 'camp-math-l2-m', 1, 'Multiply instead of add', 'discussion', 'intro',
 'A **geometric sequence** keeps the same **common ratio** $r$: each term is the one before it multiplied by $r$. So $2, 6, 18, 54, \ldots$ has $r = 3$, and the explicit formula mirrors the arithmetic one with multiplication doing the work:
$$a_n = a_1 \cdot r^{\,n-1}$$
The same $(n-1)$ appears for the same reason — the first term is there before any multiplying happens. Growth like this is why a rumour, a bank balance, and a folding sheet of paper all get out of hand faster than people expect.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.geometric_sequence']::text[], 1, 'explanation', null, ARRAY['geometric-sequence']::text[]),
('camp-math-l2-s2', 'camp-math-l2', 'camp-math-l2-m', 2, 'Two terms, three steps apart', 'discussion', 'practice',
 'This is the exam''s favourite shape of question. A geometric sequence has $a_2 = 0.2$ and $a_5 = 43.2$. Before computing anything, tell me how many multiplications by $r$ separate $a_2$ from $a_5$ — then use that to find $r$, then $a_1$, then write the explicit formula for $a_n$. Finally evaluate
$$\sum_{n=1}^{15} a_n$$
using $S_n = a_1\frac{1 - r^n}{1 - r}$.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.geometric_sequence', 'math.series_sum']::text[], 1, 'practice', 'applied', ARRAY['geometric-sequence', 'series-sum']::text[]),
('camp-math-l2-s3', 'camp-math-l2', 'camp-math-l2-m', 3, 'Where have you seen this shape?', 'reflection', 'review',
 'Arithmetic sequences grow in a straight line; geometric ones bend upward (or collapse toward zero when $|r| < 1$). Think of one situation in your own life that grows arithmetically and one that grows geometrically, and say what makes the difference between them. If you have met exponential growth in science — populations, half-lives, compound interest — say how a geometric sequence is the same idea sampled at whole-number steps.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.geometric_sequence']::text[], 1, 'reflection', null, ARRAY['geometric-sequence']::text[]),
('camp-math-l2-s4', 'camp-math-l2', 'camp-math-l2-m', 4, 'Check: finding the ratio', 'multiple_choice', 'assessment',
 'A geometric sequence has $a_2 = 5$ and $a_6 = 405$. What is the common ratio $r$?',
 'multiple_choice', '', null,
 '[{"id": "a", "text": "r = 3, because r^4 = 405/5 = 81"}, {"id": "b", "text": "r = 81, because 405/5 = 81"}, {"id": "c", "text": "r = 4, because there are four terms between them"}, {"id": "d", "text": "r = 100, because 405 - 5 = 400"}]'::jsonb,
 '{}'::jsonb, ARRAY['math.geometric_sequence']::text[], 1, 'assessment', 'mcq', ARRAY['geometric-sequence']::text[]),
-- L3 unit circle
('camp-math-l3-s1', 'camp-math-l3', 'camp-math-l3-m', 1, 'The circle that redefines sine', 'discussion', 'intro',
 'In a right triangle, $\sin\theta$ is a ratio of two sides — which only makes sense for angles between $0$ and $90^{\circ}$. The **unit circle** (radius $1$, centred at the origin) frees the functions from the triangle: rotate by $\theta$ from the positive $x$-axis and land on a point whose coordinates ARE the functions,
$$(\cos\theta,\ \sin\theta)$$
Now every real number has a sine, including negative and obtuse angles, because you can always keep rotating.

```geometry
{"unitCircle": true, "points": {"O": [0, 0], "P": [0.6, 0.8], "F": [0.6, 0]}, "segments": [["O", "P"], [ "P", "F"], ["O", "F"]], "angles": [{"at": "F", "from": "P", "to": "O", "right": true}, {"at": "O", "from": "F", "to": "P", "label": "θ"}], "labels": [{"at": "O", "to": "F", "text": "cos θ"}, {"at": "P", "to": "F", "text": "sin θ"}], "title": "Sine and cosine are coordinates"}
```',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.unit_circle']::text[], 1, 'explanation', null, ARRAY['unit-circle']::text[]),
('camp-math-l3-s2', 'camp-math-l3', 'camp-math-l3-m', 2, 'Investigate: what is a radian, really?', 'discussion', 'teach',
 'A degree is arbitrary — the Babylonians chose 360 because it divides nicely. A **radian** is not arbitrary: it is the angle you get when the arc you have walked around the circle is exactly as long as the radius. Investigate with me: if the whole circumference is $2\pi r$, how many radius-lengths fit around the full circle? What does that make a full turn in radians, and a half turn? And here is the part worth chewing on — why is a radian a pure number with no units at all, when a degree is a unit?',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.radians']::text[], 1, 'inquiry', null, ARRAY['radians', 'unit-circle']::text[]),
('camp-math-l3-s3', 'camp-math-l3', 'camp-math-l3-m', 3, 'Plot a point, build the angle', 'discussion', 'practice',
 'Take the point $(3, -4)$. Plot it, then construct the angle of rotation $\theta$ associated with it (measured from the positive $x$-axis). Work out $\sin\theta$, $\cos\theta$ and $\tan\theta$ exactly — remember this point is NOT on the unit circle, so first find the distance $r$ from the origin and scale. Say which quadrant you are in and which of the three functions come out negative there, and why that follows from the coordinates rather than from a rule you memorised.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.unit_circle']::text[], 1, 'practice', 'applied', ARRAY['unit-circle', 'radians']::text[]),
('camp-math-l3-s4', 'camp-math-l3', 'camp-math-l3-m', 4, 'Check: reading the circle', 'multiple_choice', 'assessment',
 'A rotation of $\theta$ radians lands on the unit circle at the point $\left(-\frac{1}{2}, \frac{\sqrt{3}}{2}\right)$. What is $\cos\theta$?',
 'multiple_choice', '', null,
 '[{"id": "a", "text": "-1/2 — cosine is the x-coordinate"}, {"id": "b", "text": "√3/2 — cosine is the y-coordinate"}, {"id": "c", "text": "-√3 — cosine is y divided by x"}, {"id": "d", "text": "1 — the radius of the unit circle"}]'::jsonb,
 '{}'::jsonb, ARRAY['math.unit_circle']::text[], 1, 'assessment', 'mcq', ARRAY['unit-circle']::text[]),
-- L4 identities
('camp-math-l4-s1', 'camp-math-l4', 'camp-math-l4-m', 1, 'The circle''s own equation', 'discussion', 'intro',
 'Every point on the unit circle satisfies $x^2 + y^2 = 1$. Since $x = \cos\theta$ and $y = \sin\theta$, that equation IS the Pythagorean identity:
$$\sin^2\theta + \cos^2\theta = 1$$
It is not a fact to memorise; it is the circle written in trigonometric clothing. And it has children: divide both sides by $\cos^2\theta$ and you get $\tan^2\theta + 1 = \sec^2\theta$ — which is exactly what you need to show that $\frac{1}{\cos^2 x} - \tan^2 x = 1$.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.pythagorean_identity']::text[], 1, 'explanation', null, ARRAY['pythagorean-identity']::text[]),
('camp-math-l4-s2', 'camp-math-l4', 'camp-math-l4-m', 2, 'Let the quadrant decide the sign', 'discussion', 'practice',
 'Given $\cos\theta = -\frac{1}{2}$ where $\frac{\pi}{2} \le \theta \le \pi$:
- calculate $\sin\theta$,
- then calculate $\cos(2\theta)$ and $\tan(2\theta)$.

Before you take any square root, tell me which quadrant $\theta$ is in and what that forces the sign of $\sin\theta$ to be. The identity gives you the magnitude; only the quadrant gives you the sign, and dropping it is the single most common way to lose marks here.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.pythagorean_identity', 'math.angle_identities']::text[], 1, 'practice', 'applied', ARRAY['pythagorean-identity', 'angle-identities']::text[]),
('camp-math-l4-s3', 'camp-math-l4', 'camp-math-l4-m', 3, 'Simplify without a calculator', 'discussion', 'practice',
 'Use the sum, difference and co-function properties to simplify
$$\cos(\pi - \theta) - \sin\left(\frac{\pi}{2} - \theta\right)$$
and, separately, evaluate $\sin(-135^{\circ})$ and $\tan\left(\frac{2\pi}{3}\right)$ exactly. For each one, name the property you used and sketch (or describe) where the angle lands on the circle — an exact value should come from the geometry, never from a decimal.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.angle_identities']::text[], 1, 'practice', 'applied', ARRAY['angle-identities', 'unit-circle']::text[]),
('camp-math-l4-s4', 'camp-math-l4', 'camp-math-l4-m', 4, 'Prove it, and say why each line is allowed', 'discussion', 'assessment',
 'Show that
$$\frac{1}{\cos^2 x} - \tan^2 x = 1$$
Write the proof line by line, and after each line say which identity or algebraic move justifies it. Then answer the harder question: given $\cos(2\theta) = \frac{\sqrt{3}}{2}$ where $0 \le \theta \le \frac{\pi}{2}$, calculate $\sin(2\theta)$ — and explain why the restriction on $\theta$ settles the sign.',
 'text', '', null, '[]'::jsonb,
 '{"criteria": ["rewrites 1/cos^2 x as sec^2 x", "cites the Pythagorean identity correctly", "reaches 1 with justified steps", "uses the range restriction to fix the sign of sin(2θ)"]}'::jsonb,
 ARRAY['math.pythagorean_identity', 'math.angle_identities']::text[], 1, 'assessment', 'open_ended', ARRAY['pythagorean-identity', 'angle-identities']::text[]),
-- L5 graphs
('camp-math-l5-s1', 'camp-math-l5', 'camp-math-l5-m', 1, 'Five steps to any sketch', 'discussion', 'intro',
 'To sketch $f(x) = a\,\mathrm{trig}\big(b(x - h)\big) + k$, work in this order: (1) name the parent function, (2) find the period — $\frac{2\pi}{b}$ for sine and cosine, but $\frac{\pi}{b}$ for tangent, (3) shift horizontally by $h$, (4) stretch by $a$ and shift vertically by $k$, (5) mark the key points, or for tangent the asymptotes. Here is the sine parent with one period marked:

```graph
{"functions": [{"expression": "sin(x)", "label": "y = sin x"}], "xRange": [-6.283, 6.283], "yRange": [-1.6, 1.6], "xStep": 1.5708, "points": [{"x": 1.5708, "y": 1, "label": "max"}, {"x": 4.712, "y": -1, "label": "min"}], "title": "The parent: one period is 2π"}
```',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.trig_graphs']::text[], 1, 'explanation', null, ARRAY['trig-graphs']::text[]),
('camp-math-l5-s2', 'camp-math-l5', 'camp-math-l5-m', 2, 'Predict before you look', 'reflection', 'practice',
 'Do not sketch yet — predict. For $f(x) = \tan(x + \pi) - 1$: what is the parent function, what is its period, which way and how far does the graph shift horizontally, and which way vertically? Then the interesting one: where do the asymptotes end up? Write your prediction down first. Predicting and then checking is what makes the five-step method stick; jumping to the picture teaches you nothing about the rule.',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.trig_graphs']::text[], 1, 'reflection', null, ARRAY['trig-graphs']::text[]),
('camp-math-l5-s3', 'camp-math-l5', 'camp-math-l5-m', 3, 'Sketch it and defend the key points', 'discussion', 'practice',
 'Now sketch $f(x) = \tan(x + \pi) - 1$ over $-\pi \le x \le \pi$ using the five-step method, and describe your sketch to me: the period, the asymptote positions, and the coordinates of the point where the curve crosses its own midline. Then explain the surprise: $\tan(x + \pi)$ looks identical to $\tan x$ — why does shifting a tangent graph by exactly $\pi$ change nothing at all?',
 'text', '', null, '[]'::jsonb, '{}'::jsonb, ARRAY['math.trig_graphs']::text[], 1, 'practice', 'applied', ARRAY['trig-graphs']::text[]),
('camp-math-l5-s4', 'camp-math-l5', 'camp-math-l5-m', 4, 'Check: reading a transformation', 'multiple_choice', 'assessment',
 'What is the period of $y = 3\cos(4x) - 2$?',
 'multiple_choice', '', null,
 '[{"id": "a", "text": "π/2, because the period of cosine is 2π divided by b = 4"}, {"id": "b", "text": "2π, because cosine always has period 2π"}, {"id": "c", "text": "8π, because the period is 2π times b = 4"}, {"id": "d", "text": "3, because the amplitude sets the period"}]'::jsonb,
 '{}'::jsonb, ARRAY['math.trig_graphs']::text[], 1, 'assessment', 'mcq', ARRAY['trig-graphs']::text[])
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, position = excluded.position,
  title = excluded.title, activity_type = excluded.activity_type, stage = excluded.stage,
  prompt = excluded.prompt, response_mode = excluded.response_mode, starter_code = excluded.starter_code,
  expected_output = excluded.expected_output, choices = excluded.choices, rubric = excluded.rubric,
  skill_keys = excluded.skill_keys, pass_score = excluded.pass_score, mode = excluded.mode,
  mode_type = excluded.mode_type, idea_keys = excluded.idea_keys;

insert into public.quiz_items (id, lesson_id, milestone_id, activity_id, position, prompt, question_type, choices, correct_choice_ids, rubric, skill_keys, status)
values
('camp-math-l1-s4-q', 'camp-math-l1', 'camp-math-l1-m', 'camp-math-l1-s4', 4, 'In an arithmetic sequence with first term $a_1$ and common difference $d$, which expression gives the 12th term?', 'multiple_choice',
 '[{"id": "a", "text": "a_1 + 11d — the first term plus eleven steps"}, {"id": "b", "text": "a_1 + 12d — the first term plus twelve steps"}, {"id": "c", "text": "12a_1 + d — twelve first terms plus one step"}, {"id": "d", "text": "a_1 x d^11 — the first term times the difference eleven times"}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['math.arithmetic_sequence']::text[], 'published'),
('camp-math-l2-s4-q', 'camp-math-l2', 'camp-math-l2-m', 'camp-math-l2-s4', 4, 'A geometric sequence has $a_2 = 5$ and $a_6 = 405$. What is the common ratio $r$?', 'multiple_choice',
 '[{"id": "a", "text": "r = 3, because r^4 = 405/5 = 81"}, {"id": "b", "text": "r = 81, because 405/5 = 81"}, {"id": "c", "text": "r = 4, because there are four terms between them"}, {"id": "d", "text": "r = 100, because 405 - 5 = 400"}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['math.geometric_sequence']::text[], 'published'),
('camp-math-l3-s4-q', 'camp-math-l3', 'camp-math-l3-m', 'camp-math-l3-s4', 4, 'A rotation of $\theta$ radians lands on the unit circle at $\left(-\frac{1}{2}, \frac{\sqrt{3}}{2}\right)$. What is $\cos\theta$?', 'multiple_choice',
 '[{"id": "a", "text": "-1/2 — cosine is the x-coordinate"}, {"id": "b", "text": "√3/2 — cosine is the y-coordinate"}, {"id": "c", "text": "-√3 — cosine is y divided by x"}, {"id": "d", "text": "1 — the radius of the unit circle"}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['math.unit_circle']::text[], 'published'),
('camp-math-l5-s4-q', 'camp-math-l5', 'camp-math-l5-m', 'camp-math-l5-s4', 4, 'What is the period of $y = 3\cos(4x) - 2$?', 'multiple_choice',
 '[{"id": "a", "text": "π/2, because the period of cosine is 2π divided by b = 4"}, {"id": "b", "text": "2π, because cosine always has period 2π"}, {"id": "c", "text": "8π, because the period is 2π times b = 4"}, {"id": "d", "text": "3, because the amplitude sets the period"}]'::jsonb,
 ARRAY['a']::text[], '{}'::jsonb, ARRAY['math.trig_graphs']::text[], 'published')
on conflict (id) do update set
  lesson_id = excluded.lesson_id, milestone_id = excluded.milestone_id, activity_id = excluded.activity_id,
  position = excluded.position, prompt = excluded.prompt, question_type = excluded.question_type,
  choices = excluded.choices, correct_choice_ids = excluded.correct_choice_ids, rubric = excluded.rubric,
  skill_keys = excluded.skill_keys, status = excluded.status, updated_at = now();

-- ---------------------------------------------------------------------------
-- Knowledge graph: ideas, vocab, links, teacher practice bank
-- ---------------------------------------------------------------------------

insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select v.key, v.title, v.one_liner, v.subject, v.lesson_id, 'published'
from (values
  ('arithmetic-sequence', 'Arithmetic sequences add', 'Start somewhere and add the same amount each step; the explicit formula jumps to any term.', 'Sequences, Series and Trigonometry', 'camp-math-l1'),
  ('series-sum', 'A series is the running total', 'Pairing the ends turns a long addition into one multiplication.', 'Sequences, Series and Trigonometry', 'camp-math-l1'),
  ('geometric-sequence', 'Geometric sequences multiply', 'Each term is the last one times a fixed ratio, which is why growth curves bend.', 'Sequences, Series and Trigonometry', 'camp-math-l2'),
  ('unit-circle', 'The unit circle defines sine and cosine', 'Rotate and land on a point: its coordinates ARE cosine and sine, for every real number.', 'Sequences, Series and Trigonometry', 'camp-math-l3'),
  ('radians', 'A radian is arc length over radius', 'Measuring an angle by the arc it sweeps makes it a pure number, not an arbitrary unit.', 'Sequences, Series and Trigonometry', 'camp-math-l3'),
  ('pythagorean-identity', 'The Pythagorean identity is the circle', 'sin²θ + cos²θ = 1 is just x² + y² = 1 written in trigonometric clothing.', 'Sequences, Series and Trigonometry', 'camp-math-l4'),
  ('angle-identities', 'Identities relate combined angles', 'Sum, difference and double-angle formulas let one known angle unlock many others.', 'Sequences, Series and Trigonometry', 'camp-math-l4'),
  ('trig-graphs', 'Transformations move key features', 'Period, shift and amplitude are enough to sketch any transformed trig graph.', 'Sequences, Series and Trigonometry', 'camp-math-l5')
) as v(key, title, one_liner, subject, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.vocab_terms (term, variants, definition, subject, idea_keys, lesson_id, status)
select v.term, v.variants, v.definition, v.subject, v.idea_keys, v.lesson_id, 'published'
from (values
  ('sequence', array['sequences'], 'An ordered list of numbers that follows a rule.', 'Sequences, Series and Trigonometry', array['arithmetic-sequence'], 'camp-math-l1'),
  ('common difference', array['common differences'], 'The fixed amount added at each step of an arithmetic sequence, written d.', 'Sequences, Series and Trigonometry', array['arithmetic-sequence'], 'camp-math-l1'),
  ('series', array['summation'], 'The sum of the terms of a sequence, rather than the list itself.', 'Sequences, Series and Trigonometry', array['series-sum'], 'camp-math-l1'),
  ('common ratio', array['common ratios'], 'The fixed number each term is multiplied by in a geometric sequence, written r.', 'Sequences, Series and Trigonometry', array['geometric-sequence'], 'camp-math-l2'),
  ('radian', array['radians'], 'The angle whose arc is exactly as long as the radius — a full turn is 2π of them.', 'Sequences, Series and Trigonometry', array['radians'], 'camp-math-l3'),
  ('unit circle', array['unit circles'], 'The circle of radius 1 centred at the origin, on which cosine and sine are the coordinates.', 'Sequences, Series and Trigonometry', array['unit-circle'], 'camp-math-l3'),
  ('quadrant', array['quadrants'], 'One of the four regions of the plane — which one you are in decides the signs.', 'Sequences, Series and Trigonometry', array['unit-circle'], 'camp-math-l3'),
  ('identity', array['identities'], 'An equation true for EVERY value of the variable, not just for a solution or two.', 'Sequences, Series and Trigonometry', array['pythagorean-identity'], 'camp-math-l4'),
  ('amplitude', array['amplitudes'], 'Half the distance from the highest to the lowest point of a wave.', 'Sequences, Series and Trigonometry', array['trig-graphs'], 'camp-math-l5'),
  ('period', array['periods', 'periodic'], 'The horizontal length after which a repeating graph starts over.', 'Sequences, Series and Trigonometry', array['trig-graphs'], 'camp-math-l5'),
  ('asymptote', array['asymptotes'], 'A line the graph races toward but never touches.', 'Sequences, Series and Trigonometry', array['trig-graphs'], 'camp-math-l5')
) as v(term, variants, definition, subject, idea_keys, lesson_id)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
on conflict do nothing;

insert into public.curriculum_links (from_key, to_key, kind, note, status)
select v.from_key, v.to_key, v.kind, v.note, 'published'
from (values
  ('arithmetic-sequence', 'geometric-sequence', 'contrast', 'One adds the same amount, the other multiplies by the same amount — that single swap is the difference between a line and a curve.'),
  ('unit-circle', 'radians', 'prerequisite', 'Radian measure only makes sense once the angle is a rotation around a circle of radius 1.'),
  ('unit-circle', 'pythagorean-identity', 'prerequisite', 'The identity IS the circle equation, so the circle has to come first.'),
  ('pythagorean-identity', 'angle-identities', 'same_pattern', 'Both turn one known value into another without measuring anything new.'),
  ('unit-circle', 'trig-graphs', 'same_pattern', 'Walking around the circle once IS one period of the graph — the circle unrolled.')
) as v(from_key, to_key, kind, note)
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'published'
from (values
  ('arithmetic-sequence', 'camp-math-l1', 'A sequence starts $5, 9, 13, \ldots$. Write the explicit formula for $a_n$ and use it to find $a_{30}$.', 'Gets a_n = 5 + (n-1)4 = 4n + 1 and a_30 = 121, with the (n-1) step count justified.', 'intro'),
  ('arithmetic-sequence', 'camp-math-l1', 'An arithmetic sequence has $a_4 = 14$ and $a_9 = 39$. Find $d$, then $a_1$.', 'Recognises five steps between the 4th and 9th terms, so d = 5 and a_1 = -1.', 'core'),
  ('series-sum', 'camp-math-l1', 'Find $\sum_{n=1}^{40}(3n - 2)$ and explain which sum formula you used and why.', 'Identifies an arithmetic series with a_1 = 1, a_40 = 118, giving S = 20(119) = 2380.', 'core'),
  ('geometric-sequence', 'camp-math-l2', 'A geometric sequence has $a_1 = 3$ and $r = 2$. Find $a_7$.', 'Applies a_n = a_1 r^(n-1) to get 3 x 64 = 192.', 'intro'),
  ('geometric-sequence', 'camp-math-l2', 'A geometric sequence has $a_3 = 12$ and $a_6 = 96$. Find $r$ and $a_1$.', 'Uses r^3 = 96/12 = 8 so r = 2 and a_1 = 3, with the three-step gap explained.', 'core'),
  ('unit-circle', 'camp-math-l3', 'Without a calculator, evaluate $\sin\left(\frac{5\pi}{6}\right)$ and say which quadrant the angle is in.', 'Places the angle in quadrant II with reference angle π/6, giving sin = 1/2 (positive there).', 'core'),
  ('radians', 'camp-math-l3', 'Convert $135^{\circ}$ to radians exactly, and explain the conversion in terms of arc length rather than as a rule.', 'Gets 3π/4 and grounds it in a half turn being π radians.', 'intro'),
  ('pythagorean-identity', 'camp-math-l4', 'Given $\sin\theta = \frac{3}{5}$ with $\theta$ in quadrant II, find $\cos\theta$ and $\tan\theta$.', 'Uses the identity for magnitude 4/5 and the quadrant to make cosine negative: cos = -4/5, tan = -3/4.', 'core'),
  ('angle-identities', 'camp-math-l4', 'Use a double-angle formula to evaluate $\sin(2\theta)$ when $\sin\theta = \frac{1}{2}$ and $\theta$ is acute.', 'Finds cos θ = √3/2 and applies sin 2θ = 2 sin θ cos θ = √3/2.', 'stretch'),
  ('trig-graphs', 'camp-math-l5', 'State the period, amplitude and vertical shift of $y = -2\sin(3x) + 1$, and say what the minus sign does.', 'Period 2π/3, amplitude 2, shift up 1, with the minus recognised as a reflection in the midline.', 'core'),
  ('trig-graphs', 'camp-math-l5', 'Where are the asymptotes of $y = \tan\left(x - \frac{\pi}{4}\right)$?', 'Shifts the parent asymptotes right by π/4: x = 3π/4 + nπ.', 'stretch')
) as v(idea_key, lesson_id, prompt, expected, difficulty)
where not exists (
  select 1 from public.practice_items p where p.idea_key = v.idea_key and p.prompt = v.prompt
);

-- A draft queue for the studio Knowledge card on the identities lesson.
insert into public.ideas (key, title, one_liner, subject, lesson_id, status)
select 'half-angle', 'Half-angle formulas', 'Halving an angle costs a square root — and the quadrant picks its sign.', 'Sequences, Series and Trigonometry', 'camp-math-l4', 'draft'
where exists (select 1 from public.lessons l where l.id = 'camp-math-l4')
on conflict do nothing;

insert into public.practice_items (idea_key, lesson_id, prompt, expected, difficulty, status)
select v.idea_key, v.lesson_id, v.prompt, v.expected, v.difficulty, 'draft'
from (values
  ('angle-identities', 'camp-math-l4', 'Evaluate $\cos(75^{\circ})$ exactly using a difference formula.', 'Writes 75 = 45 + 30 and applies the sum formula to get (√6 - √2)/4.', 'stretch')
) as v(idea_key, lesson_id, prompt, expected, difficulty)
where not exists (
  select 1 from public.practice_items p where p.idea_key = v.idea_key and p.prompt = v.prompt
);

insert into public.lesson_resources (lesson_id, title, description, resource_type, source_type, external_url, student_instructions, status, visibility)
select v.lesson_id, v.title, v.description, v.resource_type, 'external_url', v.external_url, v.student_instructions, 'published', 'public'
from (values
  ('camp-math-l3', 'Watch: the unit circle, visually', 'A short walk around the unit circle showing how sine and cosine are read off as coordinates.', 'youtube', 'https://www.youtube.com/embed/1m9p9iubmLU', 'Watch until you can say why sine goes negative below the axis.'),
  ('camp-math-l5', 'Watch: transforming trig graphs', 'How amplitude, period and phase shift each move the curve.', 'youtube', 'https://www.youtube.com/embed/uJ_KMx0Zjbg', 'Pause before each transformation and predict what it will do.')
) as v(lesson_id, title, description, resource_type, external_url, student_instructions)
where exists (select 1 from public.lessons l where l.id = v.lesson_id)
  and not exists (select 1 from public.lesson_resources r where r.lesson_id = v.lesson_id and r.title = v.title);
