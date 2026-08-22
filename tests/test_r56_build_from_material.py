"""R56 — "build from material": a teacher's upload becomes a whole draft lesson.

Owner directive (post-meeting, 2026-08-21): make the teacher end "more of a one-stop
job for education… we need to be able to create the curriculum, entire lessons, slide
decks, quizzes, and assignments from the material that the teacher uploads. Rather
than it being completely a manual upload and input of everything, our platform builds
it out for them."

Slice 1 (owner's pick): ONE grounded generation drafts a complete lesson — meta,
steps, wrap-up quiz, assignment brief — plus a deck brief the studio feeds to the
existing artifact generator. The curriculum-outline builder loops this engine next.

The invariant that must never bend: REVIEW-FIRST. Generation writes nothing; the
teacher applies the package through the same authoring actions manual work uses, and
the lesson lands as a DRAFT (publishing stays an explicit human act).
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
PROCESSING = (
    ROOT / "supabase" / "functions" / "resource-processing" / "index.ts"
).read_text(encoding="utf-8")
STUDIO = (ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text(
    encoding="utf-8"
)
MATERIAL = (ROOT / "frontend" / "src" / "lib" / "materialText.ts").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")


class PackageGenerationTests(unittest.TestCase):
    def test_lesson_package_mode_is_routed_first(self):
        self.assertIn(
            'if (mode === "lesson_package") return await generateLessonPackage(config, actorId, body);',
            ADMIN,
        )

    def test_generation_authorizes_before_calling_the_model(self):
        body = ADMIN.split("async function generateLessonPackage(", 1)[1].split(
            "\nasync function generateDraft(", 1
        )[0]
        guard = body.index("await assertCanAuthor(")
        model = body.index("await callModelJson(")
        self.assertLess(guard, model)

    def test_generation_writes_nothing(self):
        # The whole point of review-first: no insert/upsert/patch in this path.
        body = ADMIN.split("async function generateLessonPackage(", 1)[1].split(
            "\nasync function generateDraft(", 1
        )[0]
        for writer in ("insertRow(", "upsertByConflict(", "patchRows(", "bulkInsert("):
            self.assertNotIn(writer, body)

    def test_material_is_the_source_of_truth_in_the_prompt(self):
        self.assertIn("GROUNDED IN THE TEACHER'S MATERIAL", ADMIN)
        self.assertIn("TEACHER'S MATERIAL — the source of truth", ADMIN)
        self.assertIn(
            "EVERY fact, example, and question must come from the teacher's material",
            ADMIN,
        )

    def test_material_window_is_bigger_than_the_step_generator(self):
        # A chapter upload is the normal input here (steps mode clamps at 8000).
        self.assertIn('clampText(cleanText(body.reference_text), 24000)', ADMIN)

    def test_ungrounded_packages_are_flagged_not_hidden(self):
        self.assertIn("grounded: Boolean(referenceText)", ADMIN)
        self.assertIn("Built from your brief alone", STUDIO)

    def test_broken_mcq_degrades_to_open_ended(self):
        # A quiz item whose choices/answer didn't validate must not become a broken
        # auto-scored question.
        self.assertIn(
            "const usable = choices.length >= 2 && choices.some((choice) => choice.id === correct);",
            ADMIN,
        )
        self.assertIn('openEnded || !usable ? "open_ended" : "multiple_choice"', ADMIN)


class ApplyTests(unittest.TestCase):
    def test_apply_goes_through_the_normal_authoring_actions(self):
        body = STUDIO.split("const applyPackage = (", 1)[1].split("\n  // P7:", 1)[0]
        self.assertIn("createCurriculumLessonStub(", body)
        self.assertIn("upsertCurriculumStep(", body)
        # No privileged bulk path — same guards, gates, and audit trail as manual work.
        self.assertIn("no privileged bulk path", STUDIO)

    def test_quiz_and_assignment_land_as_steps(self):
        # Steps need no roster (the studio has none) and R48's step-work strip turns
        # them into graded classwork in one click.
        body = STUDIO.split("const applyPackage = (", 1)[1].split("\n  // P7:", 1)[0]
        self.assertIn('mode: "assessment"', body)
        self.assertIn('mode: "assignment"', body)
        self.assertIn("R48's step-work strip", STUDIO)

    def test_applied_lesson_is_a_draft(self):
        self.assertIn("Lands as a draft — publish it when you're happy.", STUDIO)


class IngestionTests(unittest.TestCase):
    def test_office_formats_are_read_in_the_browser(self):
        self.assertIn("export async function extractDocxText", MATERIAL)
        self.assertIn("export async function extractPptxText", MATERIAL)
        # No new dependency: the platform's own DecompressionStream inflates entries.
        self.assertIn('new DecompressionStream("deflate-raw")', MATERIAL)

    def test_studio_accepts_the_owner_requested_inputs(self):
        self.assertIn("Upload files (PDF, Word, PowerPoint, images, notes)", STUDIO)
        self.assertIn(
            'accept=".txt,.md,.markdown,.csv,.html,.htm,.pdf,.docx,.pptx,image/*,text/plain,application/pdf"',
            STUDIO,
        )
        self.assertIn("Add a link", STUDIO)

    def test_url_reader_refuses_private_networks(self):
        # SSRF guard: a pasted link must never make the function reach inside.
        body = PROCESSING.split("function assertPublicHttpUrl(", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('url.protocol !== "http:" && url.protocol !== "https:"', body)
        self.assertIn("url.username || url.password", body)
        self.assertIn("That link points inside a private network.", body)
        self.assertIn("a === 10 ||", body)
        self.assertIn("host === \"::1\"", body)

    def test_material_readers_require_an_authenticated_actor(self):
        for fn in ("readUrlMaterial", "readImageMaterial"):
            body = PROCESSING.split(f"async function {fn}(", 1)[1][:400]
            self.assertIn('if (!cleanId(user.id)) throw new Error("Authentication is required.");', body)

    def test_material_readers_store_nothing(self):
        for fn in ("readUrlMaterial", "readImageMaterial"):
            body = PROCESSING.split(f"async function {fn}(", 1)[1].split("\n}\n", 1)[0]
            self.assertNotIn("resource_text_chunks", body)


class WiringTests(unittest.TestCase):
    def test_package_type_is_a_draft_contract(self):
        self.assertIn("export type CurriculumLessonPackage = {", TYPES)
        self.assertIn("package?: CurriculumLessonPackage;", TYPES)

    def test_generate_wrapper_carries_the_new_mode_and_budget(self):
        self.assertIn('| "lesson_package";', API)
        self.assertIn(
            'input.mode === "artifact" || input.mode === "lesson_package" ? 150000 : undefined,',
            API,
        )

    def test_panel_is_reachable_from_a_unit(self):
        self.assertIn("function BuildFromMaterialPanel(", STUDIO)
        self.assertIn("buildFromMaterial={", STUDIO)
        self.assertIn("Build a lesson from material", STUDIO)


if __name__ == "__main__":
    unittest.main()
