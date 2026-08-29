"""R70 — the review gate over AI-built courses.

A course built from a book lands as twenty-odd draft lessons. Before this, the
only way to know what the machine had written was to open each lesson and read
it, then publish them one at a time — so in practice nobody checked, and the
first reader of an AI-written lesson was a student. That is the wrong first
reader, and under the curriculum-delivery framing (DECISIONS, 2026-08-27) a
badly built course does not disappoint a feature, it breaks the core promise.

The gate, pinned here:
- it REPORTS, it does not score: counts of what is there (steps, teaching,
  checks, figures) plus flags, and the teacher judges the rest;
- BLOCKING flags are reserved for broken-as-data — no steps at all, or a
  multiple-choice step with nothing to choose. Thin, unillustrated or
  placeholder-prompt lessons are notes the teacher may publish straight past;
- reviewing never writes; publishing stays the teacher's explicit act;
- single and bulk publish share ONE write path (applyLessonPublish), so a
  lesson published from the gate lands in exactly the same state as one
  published from the editor — including the background knowledge draft.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
ROUTE = authoring_source()


class OneWritePathTests(unittest.TestCase):
    def test_publish_has_a_single_shared_implementation(self):
        self.assertIn("async function applyLessonPublish(", ADMIN)
        # Both entry points delegate; neither re-implements the patch sequence.
        self.assertEqual(ADMIN.count("await applyLessonPublish(config, scope, lessonId);"), 2)
        # The row writes live in the shared helper only.
        self.assertEqual(ADMIN.count('publication_status: "published",'), 1)

    def test_bulk_publish_drafts_knowledge_like_a_single_publish(self):
        # autoExtractKnowledgeAfterPublish is scoped to the dispatcher, so the bulk
        # action schedules it there — same background contract as publish_lesson.
        dispatch = ADMIN.split('if (action === "publish_lessons") {', 1)[1][:1200]
        self.assertIn("autoExtractKnowledgeAfterPublish(config, actorId, {", dispatch)
        self.assertIn("response\n          .clone()", dispatch)


class ReviewLawTests(unittest.TestCase):
    def test_only_broken_data_blocks_a_publish(self):
        block = ADMIN.split("function reviewLesson(", 1)[1].split("\n}", 1)[0]
        blocking = [line for line in block.splitlines() if 'level: "blocking"' in line]
        self.assertEqual(len(blocking), 2, blocking)
        self.assertIn('code: "no_steps", level: "blocking"', block)
        self.assertIn('code: "mcq_without_choices"', block)
        # Thin / unillustrated / placeholder lessons are notes, never blocks.
        for code in ("thin", "no_figures", "placeholder_prompt", "nothing_checked"):
            marker = f'code: "{code}"'
            self.assertIn(marker, block)
            self.assertIn('level: "note"', block.split(marker, 1)[1][:120])

    def test_ready_is_derived_from_blocking_flags_only(self):
        self.assertIn('ready: !flags.some((flag) => flag.level === "blocking")', ADMIN)

    def test_reviewing_never_writes(self):
        body = ADMIN.split("async function reviewUnit(", 1)[1].split("\nasync function", 1)[0]
        for writer in ("patchRows(", "insertRow(", "upsertByConflict(", "applyLessonPublish("):
            self.assertNotIn(writer, body)

    def test_review_authorizes_through_the_same_scope_as_publish(self):
        body = ADMIN.split("async function reviewUnit(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn("courseScopeForLesson(config,", body)
        self.assertIn("await assertCanAuthor(config, actorId, organizationId, classId);", body)

    def test_one_bad_lesson_never_blocks_the_rest(self):
        body = ADMIN.split("async function publishLessons(", 1)[1].split("\nasync function", 1)[0]
        self.assertIn('results.push({ lesson_id: lessonId, status: "failed"', body)
        self.assertIn("Publish at most 60 lessons at a time.", body)
        # Author checks are cached per organization+class, not paid per lesson.
        self.assertIn("if (!authorized.has(authKey))", body)

    def test_both_actions_are_dispatched(self):
        self.assertIn('if (action === "review_unit") return await reviewUnit(config, actorId, record);', ADMIN)
        self.assertIn('if (action === "publish_lessons") {', ADMIN)


class ClientTests(unittest.TestCase):
    def test_api_exposes_the_gate(self):
        self.assertIn("export async function reviewUnit(input: {", API)
        self.assertIn("export async function publishLessons(input: {", API)
        self.assertIn('action: "review_unit"', API)
        self.assertIn('action: "publish_lessons"', API)

    def test_the_panel_pretickets_only_publishable_drafts(self):
        block = ROUTE.split("const openReview = useCallback(", 1)[1][:1800]
        self.assertIn('.filter((row) => row.ready && row.publication_status !== "published")', block)

    def test_blocked_lessons_cannot_be_ticked(self):
        self.assertIn("disabled={!item.ready || publishing}", ROUTE)

    def test_the_build_panel_offers_the_gate_when_something_was_built(self):
        self.assertIn("Review &amp; publish", ROUTE)
        self.assertIn("{onReview && done ? (", ROUTE)


if __name__ == "__main__":
    unittest.main()
