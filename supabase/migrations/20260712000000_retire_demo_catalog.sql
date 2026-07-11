-- Retire the original demo catalog now that IT Frontiers Book F is the live subject:
-- archive (not delete) the seeded logic-coding-foundations chain so students see only
-- Book F. History-safe: rows remain for any records that reference them; the student
-- catalog (publication_status='published' filter), RLS read policies, and the chat
-- runtime's published-only lesson load all hide archived content.
--
-- Re-applied on every backend deploy by design (idempotent UPDATEs). The original seed
-- files (0002/0005/0006) are NOT in the deploy workflow's migration list and never
-- re-run, so nothing re-publishes these rows. itf-* rows are untouched.

update public.lessons
set publication_status = 'archived'
where id in (
  'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5',
  'coding1', 'coding2', 'coding3', 'coding4', 'coding5'
);

update public.subjects
set status = 'archived', updated_at = now()
where id = 'logic-coding-foundations';

update public.courses
set status = 'archived', updated_at = now()
where id = 'jargon-foundations';

update public.course_versions
set status = 'archived', updated_at = now()
where id = 'jargon-foundations-v1';

update public.quiz_items
set status = 'archived', updated_at = now()
where lesson_id in (
  'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5',
  'coding1', 'coding2', 'coding3', 'coding4', 'coding5'
);
