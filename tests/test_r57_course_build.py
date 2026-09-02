"""R57 — a whole course built from the teacher's material.

Owner (meeting, 2026-08-21): the platform should build curriculum from what the
teacher uploads, not make them type it all in. R56 made ONE lesson generatable;
R57 wraps the curriculum around it — outline the book, then loop the R56 engine
over every lesson it names.

The load-bearing ideas pinned here:
- An outline can be drafted from MATERIAL ALONE (a chapter upload IS the brief).
- Each outline lesson carries a `source_hint`: a short verbatim phrase copied out
  of the material, so the per-lesson build can find ITS passage again.
- The build is sequential, cancellable, resumable, and per-lesson retryable —
  a 20-lesson run is 20 model calls and must never be all-or-nothing.
- Everything still lands as DRAFTS through the ordinary authoring writes.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
STUDIO = authoring_source()
MATERIAL = (ROOT / "frontend" / "src" / "lib" / "materialText.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")


class OutlineFromMaterialTests(unittest.TestCase):
    def test_material_alone_is_a_brief(self):
        # Backend: either a brief or material is enough (was: brief required).
        self.assertIn(
            'if (!isRefine && !prompt && !outlineReference) {',
            ADMIN,
        )
        # Client: the Generate button unlocks on either one.
        self.assertIn(
            "if (!prompt.trim() && !referenceText.trim()) return;",
            STUDIO,
        )
        self.assertIn(
            "disabled={loading || busy || (!prompt.trim() && !referenceText.trim())}",
            STUDIO,
        )

    def test_outline_reads_a_book_sized_window(self):
        # The outline must see the WHOLE upload, or it proposes a course for the part
        # it happened to read. R59 raised this to 180k after measuring a real chapter
        # at ~140k characters (111 pages); the pin follows the CONTRACT — a window
        # bigger than any single lesson's — rather than a magic number.
        window = int(
            ADMIN.split("const outlineReference = clampText(cleanText(body.reference_text), ", 1)[1]
            .split(")", 1)[0]
        )
        self.assertGreaterEqual(window, 100_000, "an outline window must fit a whole chapter")

    def test_outline_lessons_carry_a_verbatim_source_hint(self):
        self.assertIn('"lessons":[{"title":string,"source_hint":string}]', ADMIN)
        self.assertIn("SHORT VERBATIM PHRASE", ADMIN)
        self.assertIn("source_hint: clampText(cleanText(item.source_hint), 160)", ADMIN)
        self.assertIn("source_hint?: string", TYPES)

    def test_outline_covers_the_material_end_to_end(self):
        # A book must become a course, not a summary of a course.
        self.assertIn("cover it end to end — one lesson per teachable chunk", ADMIN)


class MaterialSlicingTests(unittest.TestCase):
    def test_each_lesson_reads_only_its_slice(self):
        self.assertIn("export function sliceMaterialForLesson(", MATERIAL)
        # A verbatim hint hit outranks any amount of word overlap.
        self.assertIn(
            'let score = hint && hint.length > 8 && haystack.includes(hint) ? 100 : 0;',
            MATERIAL,
        )
        # Short material is passed through whole; no window games.
        self.assertIn("if (text.length <= maxChars) return text;", MATERIAL)
        # The runner uses it — a whole book must never go to every lesson.
        self.assertIn("sliceMaterialForLesson(options.material, lesson)", STUDIO)


class BuildRunnerTests(unittest.TestCase):
    def test_run_is_sequential_and_cancellable(self):
        body = STUDIO.split("const runCourseBuild = useCallback(", 1)[1]
        head = body[:2600]
        self.assertIn("for (let i = 0; i < plan.items.length; i += 1) {", head)
        self.assertIn("if (buildCancel.current) {", head)

    def test_finished_work_is_never_rebuilt(self):
        # The skip is what makes retry and resume safe.
        self.assertIn('if (item.status !== "queued") continue;', STUDIO)

    def test_failures_are_captured_per_lesson_not_fatal(self):
        self.assertIn('patchItem(i, {\n            status: "failed",', STUDIO)
        # Inside a run, per-lesson errors do not stomp the studio banner.
        self.assertIn("if (args.quiet) throw error;", STUDIO)

    def test_retry_requeues_only_its_lesson(self):
        self.assertIn(
            'i === index ? { ...item, status: "queued", error: "" } : item,',
            STUDIO,
        )

    def test_resume_requeues_everything_unfinished(self):
        self.assertIn(
            'item.status === "done" ? item : { ...item, status: "queued", error: "" },',
            STUDIO,
        )

    def test_cancelled_run_leaves_no_empty_shells(self):
        # Units are created up front; each package write creates its own lesson, so a
        # stopped run leaves real lessons and no stubs.
        self.assertIn("lessons are not stubbed —", STUDIO)


class ReviewFirstTests(unittest.TestCase):
    def test_generated_rows_go_through_the_ordinary_writes(self):
        # One write path, shared with the single-lesson panel and manual authoring.
        self.assertIn("async function writeLessonPackage(input: {", STUDIO)
        self.assertIn("await writeLessonPackage({", STUDIO)
        self.assertIn("createCurriculumLessonStub({", STUDIO)
        self.assertIn("upsertCurriculumStep({", STUDIO)

    def test_the_teacher_can_still_take_the_outline_alone(self):
        self.assertIn("Outline only", STUDIO)
        # The button names the size of the job. R98 routed the count through the one
        # pluraliser (countOf) so "all 1 lessons" stopped shipping, which moved the
        # interpolation without changing what the button promises.
        self.assertRegex(STUDIO, r"Build \{(lessonCount|countOf\(lessonCount)")

    def test_drafts_until_published_is_stated_in_the_ui(self):
        self.assertIn("Every lesson is a draft until you publish it.", STUDIO)


if __name__ == "__main__":
    unittest.main()
