"""R58 — the curriculum import pipeline: a whole book lands as drafts.

Owner (2026-08-22): two full textbooks, as two classes, with real figures. R56/R57
generate curriculum inside the app, which is right for a handout and wrong for a
book: a book is long, worth doing carefully, and worth being able to redo. R58 adds
a file contract + an idempotent importer so the authoring (an agent reading chapter
by chapter) is separable from the landing.

The load-bearing rules pinned here:
- Idempotent by the SOURCE's stable ids — re-importing a chapter updates in place.
- Never eats a teacher's work: rows are stamped import_key, and a row owned by
  someone else is skipped, never overwritten. The importer never deletes.
- Same authoring guard as every other write (including R50's shared-book refusal).
- One derivation for a step's stored shape, shared with upsertStep.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20261101000000_curriculum_import.sql"
).read_text(encoding="utf-8")
CLI = (ROOT / "scripts" / "import-curriculum.mjs").read_text(encoding="utf-8")
CONTRACT = (ROOT / "docs" / "CURRICULUM_IMPORT.md").read_text(encoding="utf-8")
TRANSCRIPT = (ROOT / "frontend" / "src" / "student" / "Transcript.tsx").read_text(
    encoding="utf-8"
)
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")


def _importer() -> str:
    rest = ADMIN.split("async function importCurriculum(", 1)[1]
    return rest.split("\nasync function ", 1)[0]


class IdempotencyTests(unittest.TestCase):
    def test_rows_are_stamped_with_the_import_key(self):
        body = _importer()
        self.assertIn("import_key: importKey", body)
        for table in ("units", "lessons", "lesson_figures"):
            self.assertIn(f"add column if not exists import_key", MIGRATION)
        self.assertIn('if (!importKey) throw new Error("import_key is required', body)

    def test_someone_elses_rows_are_never_overwritten(self):
        body = _importer()
        self.assertIn("function ownedByImport(", ADMIN)
        # Unit collision is fatal (the chapter would land in a stranger's unit);
        # lesson and figure collisions are skipped with a warning.
        self.assertIn("was not created by this import", body)
        self.assertIn("is not owned by this import — left alone", body)

    def test_the_importer_never_deletes(self):
        body = _importer()
        self.assertNotIn('method: "DELETE"', body)
        self.assertIn("never deletes", ADMIN)

    def test_reimport_updates_in_place(self):
        body = _importer()
        # Stable ids + upsert, not insert-and-hope.
        self.assertIn('upsertByConflict(config, "units", "id"', body)
        self.assertIn('upsertByConflict(config, "lessons", "id"', body)
        self.assertIn("const activityId = `${lessonId}-s${stepIndex + 1}`;", body)


class GuardTests(unittest.TestCase):
    def test_import_runs_through_the_normal_authoring_guard(self):
        body = _importer()
        self.assertIn("await assertCanAuthor(config, actorId, organizationId", body)

    def test_empty_lessons_are_refused(self):
        body = _importer()
        self.assertIn("has no steps — skipped", body)

    def test_figures_must_live_under_the_import_prefix(self):
        body = _importer()
        self.assertIn('!storagePath.startsWith("figures/")', body)

    def test_everything_lands_as_a_draft(self):
        body = _importer()
        self.assertIn('publication_status: "draft"', body)


class SharedStepShapeTests(unittest.TestCase):
    def test_one_derivation_shared_with_upsert_step(self):
        # A book landing hundreds of steps and a teacher editing one must agree.
        self.assertIn("function stepRowFrom(", ADMIN)
        upsert = ADMIN.split("async function upsertStep(", 1)[1].split(
            "\nasync function ", 1
        )[0]
        self.assertIn("stepRowFrom(step, { lessonId, milestoneId, activityId, position })", upsert)
        self.assertIn("stepRowFrom(step, {", _importer())

    def test_quiz_and_assignment_land_as_steps(self):
        # R56 precedent: no roster needed, and R48's strip promotes them to graded
        # classwork in one click.
        body = _importer()
        self.assertIn('mode: "assessment"', body)
        self.assertIn('mode: "assignment"', body)


class FigureStorageTests(unittest.TestCase):
    def test_imported_figures_use_private_storage(self):
        self.assertIn("add column if not exists storage_path text", MIGRATION)
        self.assertIn("storage_path: storagePath || null", _importer())

    def test_legacy_static_figures_still_render(self):
        # 11 rows in prod use /figures/*.png with no storage_path.
        self.assertIn("export async function signFigureUrl(", API)
        self.assertIn("const src = signed || figure.image_url;", TRANSCRIPT)
        self.assertIn("if (!figure.storage_path)", TRANSCRIPT)

    def test_figures_publish_with_the_import(self):
        # A draft figure is invisible to the runtime and reads as a bug.
        self.assertIn('status: "published"', _importer())


class CliTests(unittest.TestCase):
    def test_cli_uses_the_operators_own_credentials(self):
        # No service-role path: an import can never do more than the person running it.
        self.assertIn("there is\n// deliberately no service-role path here", CLI)
        self.assertIn("grant_type=password", CLI)
        self.assertNotIn("SERVICE_ROLE", CLI)

    def test_one_bad_chapter_does_not_abandon_the_book(self):
        self.assertIn("must not abandon the rest of the book", CLI)
        self.assertIn("failures += 1", CLI)

    def test_figures_upload_before_the_document(self):
        self.assertIn("await uploadFigure(token, localPath, objectPath)", CLI)
        self.assertIn("figure.storage_path = objectPath", CLI)

    def test_dry_run_exists(self):
        self.assertIn('const DRY_RUN = args.includes("--dry-run")', CLI)


class ContractTests(unittest.TestCase):
    def test_the_contract_documents_what_an_author_needs(self):
        for section in ("## Idempotency", "## Shape", "## Figures", "## Running it"):
            self.assertIn(section, CONTRACT)
        self.assertIn("import_key", CONTRACT)
        self.assertIn("storage_path", CONTRACT)


if __name__ == "__main__":
    unittest.main()
