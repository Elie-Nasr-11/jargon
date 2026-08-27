"""R61 — both IT Frontiers books, built book-faithfully into the platform.

Owner (2026-08-25): "Can you build A1 and A2 fully please?" — approved as a
mechanical book-faithful build (no AI generation; the book's printed red answers
are the quiz key) with page-image fallbacks for the diagrams.

Two kinds of pins: string pins on the pipeline (extractor v2, composer, importer
materials branch, page renderer), and DATA pins over the four committed chapter
envelopes — the strongest guarantee, since those files ARE what production runs on.
"""
import json
import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXTRACT = (ROOT / "tools" / "book-import" / "extract.mjs").read_text(encoding="utf-8")
COMPOSE = (ROOT / "tools" / "book-import" / "compose.mjs").read_text(encoding="utf-8")
RENDER = (ROOT / "tools" / "book-import" / "render-pages.mjs").read_text(encoding="utf-8")
SELECT = (ROOT / "tools" / "book-import" / "select-pages.mjs").read_text(encoding="utf-8")
VALIDATE = (ROOT / "tools" / "book-import" / "validate.mjs").read_text(encoding="utf-8")
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)

CHAPTER_FILES = [
    ROOT / "books" / "itf-a1" / "ch1.json",
    ROOT / "books" / "itf-a1" / "ch2.json",
    ROOT / "books" / "itf-a2" / "ch1.json",
    ROOT / "books" / "itf-a2" / "ch2.json",
]
ENVELOPES = [json.loads(f.read_text(encoding="utf-8")) for f in CHAPTER_FILES]
LESSONS = [lesson for envelope in ENVELOPES for lesson in envelope["lessons"]]
EXEMPLAR = json.loads(
    (ROOT / "books" / "itf-a1" / "lesson-1-authored.json").read_text(encoding="utf-8")
)


class ExtractorTests(unittest.TestCase):
    def test_all_three_answer_reds(self):
        # The AI chapter is set almost entirely in the second red — one hex left
        # 8 of 17 lessons answerless.
        for hexcode in ("#ff5739", "#ff4227", "#ff7657"):
            with self.subTest(hexcode=hexcode):
                self.assertIn(hexcode, EXTRACT)

    def test_red_is_marked_at_item_level(self):
        # Leak-strip by construction: a red item never enters block or activity
        # text; it becomes the answer attached to the question it follows.
        self.assertIn("never re-sort", EXTRACT)
        self.assertIn("red: false", EXTRACT)
        self.assertIn("answers_unmatched", EXTRACT)

    def test_the_red_option_stays_in_the_list(self):
        # An MCQ's red run IS the correct option's text — the letter is recorded
        # and the option is kept (restored when trailing prose polluted it).
        self.assertIn("the red run IS", EXTRACT)
        self.assertIn("hit.text = red.text", EXTRACT)

    def test_glossary_splits_off_the_final_lesson(self):
        self.assertIn("Term Definition Page", EXTRACT)
        self.assertIn("glossary", EXTRACT)

    def test_continued_activities_merge(self):
        self.assertIn("(continued)", EXTRACT)

    def test_page_anchors_survive(self):
        self.assertIn("[p${b.page}]", EXTRACT)

    def test_garbled_font_lines_are_filtered(self):
        self.assertIn("isGarbledHead", EXTRACT)
        self.assertIn("stripGarbledPrefix", EXTRACT)

    def test_tf_letters_come_from_the_op_runs(self):
        # Item joins can merge two letters and shift the whole grid by one.
        self.assertIn("runLetters", EXTRACT)


class ComposerTests(unittest.TestCase):
    def test_the_quiz_trap_is_respected(self):
        # Only lesson.quiz[] creates graded quiz_items; the composer never emits
        # an assessment step, and only red-backed questions enter the quiz.
        self.assertIn("never emits", COMPOSE)
        self.assertIn('question_type: "multiple_choice"', COMPOSE)
        self.assertNotIn('mode: "assessment"', COMPOSE)

    def test_applied_practice_is_explicit(self):
        # A bare practice step silently becomes a CODE step in the importer.
        self.assertIn('mode_type: "applied"', COMPOSE)

    def test_casing_happens_after_letter_derivation(self):
        self.assertIn("AFTER the correct letter was derived", COMPOSE)
        self.assertIn("sentenceCase", COMPOSE)

    def test_merged_buckets_are_recovered_or_skipped_never_guessed(self):
        self.assertIn("never guessed", COMPOSE)
        self.assertIn("restart", COMPOSE)

    def test_marked_answers_are_marking_guides(self):
        self.assertIn("never read them out", COMPOSE)
        self.assertIn("marking guide, never as text to read out", COMPOSE)


class ImporterMaterialsTests(unittest.TestCase):
    IMPORTER = ADMIN.split("async function importCurriculum(", 1)[1].split("\nasync function ", 1)[0]

    def test_materials_land_as_external_rows_image_or_pdf(self):
        # R62: type is entry-driven ("pdf" for the book PDFs, image otherwise) and
        # step is optional — a step-less entry is a lesson-level row.
        self.assertIn('cleanText(material.type) === "pdf" ? "pdf" : "image"', self.IMPORTER)
        self.assertIn("resource_type: kind", self.IMPORTER)
        self.assertIn('source_type: "external_url"', self.IMPORTER)
        self.assertIn("activity_id: hasStep ? `${lessonId}-s${stepPos}` : null", self.IMPORTER)
        self.assertIn('mime_type: kind === "pdf" ? "application/pdf" : null', self.IMPORTER)

    def test_documents_ride_the_materials_loop(self):
        # One loop, one idempotency scheme — documents[] is just more materials.
        self.assertIn("lesson.documents", self.IMPORTER)

    def test_idempotency_rides_metadata_not_a_migration(self):
        # lesson_resources.id is a generated uuid — ownership keys on
        # metadata.material_id + metadata.import_key.
        self.assertIn("metadata->>material_id=eq.", self.IMPORTER)
        self.assertIn("is not owned by this import — left alone.", self.IMPORTER)

    def test_materials_are_drafts_until_publish(self):
        materials_block = self.IMPORTER.split("materials (R61)", 1)[1]
        self.assertIn('status: "draft"', materials_block)

    def test_range_guard_uses_the_authored_steps(self):
        self.assertIn("is outside 1..", self.IMPORTER)
        self.assertIn("report.materials", self.IMPORTER)


class ImporterFiguresTests(unittest.TestCase):
    """lesson_figures.id is a database-generated uuid. The first live import proved
    it: sending the composed text id threw `invalid input syntax for type uuid`.
    The envelope's figure id is an import-time handle only — row identity is
    (lesson_id, import_key, position)."""

    FIGURES = (
        ADMIN.split("async function importCurriculum(", 1)[1]
        .split("\nasync function ", 1)[0]
        .split("--- figures", 1)[1]
        .split("--- materials", 1)[0]
    )

    def test_the_importer_never_sends_a_figure_id(self):
        self.assertNotIn("id: figureId", self.FIGURES)
        self.assertNotIn('upsertByConflict(config, "lesson_figures"', self.FIGURES)

    def test_row_identity_is_lesson_import_position(self):
        self.assertIn("import_key=eq.", self.FIGURES)
        self.assertIn("position=eq.", self.FIGURES)
        self.assertIn("import-time handle", self.FIGURES)

    def test_other_owners_rows_stay_invisible_to_the_filter(self):
        # Teacher-extracted drafts and legacy static figures carry a different
        # (or no) import_key — the scoped filter can never select, and so never
        # patch, someone else's row.
        self.assertIn("never touched", self.FIGURES)


class RendererTests(unittest.TestCase):
    def test_pages_render_to_the_public_books_dir(self):
        self.assertIn('quality: 70', RENDER)
        self.assertIn("books", RENDER)
        self.assertIn("frontend/node_modules/pdfjs-dist", RENDER)


class SelectorTests(unittest.TestCase):
    def test_vector_line_art_pages_are_seen(self):
        # A1's diagrams are drawn, not rastered — a raster-only census finds 7
        # of its ~35 visual pages. The vector tier is what covers the books.
        self.assertIn("VECTOR_OPS_MIN", SELECT)
        self.assertIn("OPS.constructPath", SELECT)
        self.assertIn('"vector"', SELECT)

    def test_the_lesson_cap_is_twelve(self):
        # 12 images + 3 PDFs = 15 rows, under chat's 16-per-lesson fetch cap.
        self.assertIn("MAX_PER_LESSON = 12", SELECT)


class ComposedDataTests(unittest.TestCase):
    """The committed chapter envelopes ARE the production content — pin the data."""

    def test_seventeen_lessons_with_the_id_scheme(self):
        self.assertEqual(len(LESSONS), 17)
        for lesson in LESSONS:
            with self.subTest(lesson=lesson["id"]):
                self.assertRegex(lesson["id"], r"^itf-a[12]-ch[12]-l\d$")

    def test_envelopes_carry_the_established_identities(self):
        keys = [(e["import_key"], e["course"]["id"], e["unit"]["id"]) for e in ENVELOPES]
        self.assertEqual(
            keys,
            [
                ("itf-a1", "itf-adv-a1", "itf-a1-ch1"),
                ("itf-a1", "itf-adv-a1", "itf-a1-ch2"),
                ("itf-a2", "itf-adv-a2", "itf-a2-ch1"),
                ("itf-a2", "itf-adv-a2", "itf-a2-ch2"),
            ],
        )
        # A2's unit titles carry the book's own printed numbering.
        self.assertIn("Chapter 3", ENVELOPES[2]["unit"]["title"])
        self.assertIn("Chapter 4", ENVELOPES[3]["unit"]["title"])

    def test_no_assessment_steps_anywhere(self):
        for lesson in LESSONS:
            for step in lesson["steps"]:
                self.assertNotEqual(step.get("mode"), "assessment", lesson["id"])

    def test_every_practice_step_is_applied(self):
        for lesson in LESSONS:
            for step in lesson["steps"]:
                if step.get("mode") == "practice":
                    self.assertEqual(step.get("mode_type"), "applied", lesson["id"])

    def test_quiz_invariants(self):
        for lesson in LESSONS:
            quiz = lesson.get("quiz", [])
            self.assertLessEqual(len(quiz), 8, lesson["id"])
            for item in quiz:
                ids = [choice["id"] for choice in item["choices"]]
                self.assertGreaterEqual(len(ids), 2, lesson["id"])
                self.assertEqual(len(set(ids)), len(ids), lesson["id"])
                self.assertIn(item["correct_choice_id"], ids, lesson["id"])

    def test_the_exemplar_facts_survive(self):
        lesson_one = next(l for l in LESSONS if l["id"] == "itf-a1-ch1-l1")
        self.assertEqual(lesson_one, EXEMPLAR["lessons"][0])
        self.assertEqual(lesson_one["quiz"][0]["correct_choice_id"], "c")
        self.assertEqual(len(lesson_one["steps"]), 11)

    def test_materials_bind_in_range_to_existing_files(self):
        for lesson in LESSONS:
            slug = lesson["id"].replace("itf-", "")
            step_load = {}
            for material in lesson.get("materials", []):
                if "step" in material:
                    self.assertTrue(
                        1 <= material["step"] <= len(lesson["steps"]),
                        f"{material['id']} step out of range",
                    )
                    step_load[material["step"]] = step_load.get(material["step"], 0) + 1
                self.assertRegex(material["external_url"], rf"^/books/{slug}/p\d+\.jpg$")
                self.assertTrue(
                    (ROOT / "frontend" / "public" / material["external_url"].lstrip("/")).exists(),
                    material["external_url"],
                )
            self.assertLessEqual(len(lesson.get("materials", [])), 12, lesson["id"])
            for step, load in step_load.items():
                self.assertLessEqual(load, 3, f"{lesson['id']} step {step}")

    def test_every_rendered_page_is_referenced(self):
        # The R61 gap in reverse: no orphan JPEGs. Every committed page image is
        # a material of its lesson, and every material's file exists (above).
        # R69 added a second kind of image beside the page scans — p<n>-fig.jpg,
        # the cropped figure — which a lesson references as a FIGURE, not as
        # reading material, so each kind is checked against its own referrer.
        referenced = {
            material["external_url"]
            for lesson in LESSONS
            for material in lesson.get("materials", [])
        }
        on_disk = {
            f"/{p.relative_to(ROOT / 'frontend' / 'public')}"
            for p in (ROOT / "frontend" / "public" / "books").glob("*/p*.jpg")
            if not p.name.endswith("-fig.jpg")
        }
        self.assertEqual(on_disk, referenced)

    def test_every_cropped_figure_is_referenced(self):
        figures = {
            figure["image_url"]
            for lesson in LESSONS
            for figure in lesson.get("figures", [])
        }
        crops = {
            f"/{p.relative_to(ROOT / 'frontend' / 'public')}"
            for p in (ROOT / "frontend" / "public" / "books").glob("*/p*-fig.jpg")
        }
        self.assertEqual(crops, {url for url in figures if url.endswith("-fig.jpg")})
        # The page scan a crop came from is never deleted — it stays the
        # fallback, and stays reading material.
        for crop in crops:
            scan = crop.replace("-fig.jpg", ".jpg")
            self.assertTrue((ROOT / "frontend" / "public" / scan.lstrip("/")).exists(), scan)

    def test_every_lesson_carries_the_three_book_pdfs(self):
        for lesson in LESSONS:
            docs = lesson.get("documents", [])
            self.assertEqual(len(docs), 3, lesson["id"])
            suffixes = {doc["id"].replace(lesson["id"], "") for doc in docs}
            self.assertEqual(suffixes, {"-doc-lesson", "-doc-chapter", "-doc-book"}, lesson["id"])
            for doc in docs:
                self.assertEqual(doc["type"], "pdf", doc["id"])
                self.assertNotIn("step", doc, doc["id"])
                self.assertRegex(doc["external_url"], r"^/books/pdf/[a-z0-9-]+\.pdf$")
                self.assertTrue(
                    (ROOT / "frontend" / "public" / doc["external_url"].lstrip("/")).exists(),
                    doc["external_url"],
                )
                self.assertTrue(doc["student_instructions"].strip(), doc["id"])

    def test_row_totals_stay_under_the_chat_fetch_cap(self):
        # chat fetches lesson_resources with limit=16 — a lesson past that hides
        # rows from the mentor entirely.
        for lesson in LESSONS:
            total = len(lesson.get("materials", [])) + len(lesson.get("documents", []))
            self.assertLessEqual(total, 15, lesson["id"])

    def test_figures_stay_under_the_load_cap(self):
        for lesson in LESSONS:
            self.assertLessEqual(len(lesson.get("figures", [])), 12, lesson["id"])

    def test_no_glossary_text_leaked(self):
        for lesson in LESSONS:
            for step in lesson["steps"]:
                self.assertNotIn("Term Definition Page", step["prompt"], lesson["id"])

    def test_exactly_two_project_assignments(self):
        # The corpus has exactly two named projects (Activities 3.6 and 4.4).
        project_titles = [
            lesson["assignment"]["title"]
            for lesson in LESSONS
            if lesson.get("assignment") and not lesson["assignment"]["title"].endswith("your own answer")
        ]
        self.assertEqual(len(project_titles), 3)  # the two projects + the authored exemplar's

    def test_glossaries_are_committed_for_later_vocab_work(self):
        for book in ("itf-a1", "itf-a2"):
            glossary = json.loads((ROOT / "books" / book / "glossary.json").read_text(encoding="utf-8"))
            self.assertGreater(len(glossary["entries"]), 80, book)


if __name__ == "__main__":
    unittest.main()
