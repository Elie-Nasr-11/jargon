-- Restrict the live catalog to IT Frontiers Book F ONLY.
--
-- After archiving the seeded demo chain, two studio-authored pilot lessons remained visible
-- to students ("Instructions and Systems", "Claims, Reasons, Evidence") — created at runtime
-- through /teacher/curriculum, so no migration touched them. This sweep archives every
-- published subject/course/version/lesson (and its quiz items) that is NOT Book F, catching
-- those two and any other stray studio-authored content in one pass.
--
-- Book F ids: subject itf-beginner, course itf-f, version itf-f-v1, lessons itf-f-ch* (all 17
-- Book F lesson ids start with "itf-f-ch"). History-safe: archive, not delete — existing
-- sessions/attempts keep their rows. Idempotent and re-applied on every backend deploy, so
-- newly authored strays can't resurface. To bring other content back: remove this file from
-- the deploy workflow's migration list and re-publish the desired rows.

update public.lessons
set publication_status = 'archived'
where publication_status = 'published'
  and id not like 'itf-f-ch%';

update public.subjects
set status = 'archived', updated_at = now()
where status = 'published'
  and id <> 'itf-beginner';

update public.courses
set status = 'archived', updated_at = now()
where status = 'published'
  and id <> 'itf-f';

update public.course_versions
set status = 'archived', updated_at = now()
where status = 'published'
  and id <> 'itf-f-v1';

update public.quiz_items
set status = 'archived', updated_at = now()
where status = 'published'
  and lesson_id not like 'itf-f-ch%';
