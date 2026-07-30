"""Trimmed 2026-07-30: the teacher-facing media-extraction pipeline UI (extract /
OCR / transcribe / chunk QA in the ResourceManager, plus its api.ts wrappers) was
removed in the MVP strip (see docs/MVP_SCOPE.md §4). The resource-processing edge
function and its migrations stay deployed BACKEND-ONLY, so all backend security
pins remain; the client-side pdf.js extraction stays for the studio's AI reference
input."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0013_media_processing.sql"
TRANSCRIPTION_MIGRATION = ROOT / "supabase" / "migrations" / "0015_media_transcription.sql"
OCR_MIGRATION = ROOT / "supabase" / "migrations" / "0016_pdf_page_assets_ocr.sql"
FUNCTION = ROOT / "supabase" / "functions" / "resource-processing" / "index.ts"
CHAT_FUNCTION = ROOT / "supabase" / "functions" / "chat" / "index.ts"
# Studio-lite keeps the client-side pdf.js extraction for the AI reference input.
STUDIO_ROUTE = ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx"
PDF_EXTRACT = ROOT / "frontend" / "src" / "lib" / "pdf-extract.ts"
PACKAGE = ROOT / "frontend" / "package.json"


class MediaProcessingStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.transcription_migration = TRANSCRIPTION_MIGRATION.read_text(encoding="utf-8")
        cls.ocr_migration = OCR_MIGRATION.read_text(encoding="utf-8")
        cls.function = FUNCTION.read_text(encoding="utf-8")
        cls.chat = CHAT_FUNCTION.read_text(encoding="utf-8")
        cls.studio = STUDIO_ROUTE.read_text(encoding="utf-8")
        cls.pdf_extract = PDF_EXTRACT.read_text(encoding="utf-8")
        cls.package = PACKAGE.read_text(encoding="utf-8")

    def test_media_processing_tables_are_private_and_rls_protected(self):
        for fragment in (
            "create table if not exists public.resource_processing_jobs",
            "create table if not exists public.resource_processing_errors",
            "create table if not exists public.resource_text_chunks",
            "alter table public.resource_processing_jobs enable row level security",
            "alter table public.resource_processing_errors enable row level security",
            "alter table public.resource_text_chunks enable row level security",
            "revoke all privileges on table public.resource_text_chunks from anon",
            "public.can_manage_lesson_resource(resource_id)",
            "status = 'approved'",
            "public.can_view_lesson_resource(resource_id)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_resource_processing_function_is_jwt_scoped(self):
        for fragment in (
            '"extract_pdf_chunks"',
            '"save_pdf_page_assets"',
            '"ocr_pdf_pages"',
            '"transcribe_media_resource"',
            '"save_chunk_edits"',
            '"approve_chunks"',
            '"reject_chunks"',
            '"delete_chunks"',
            '"list_resource_chunks"',
            "fetchCurrentUser",
            "rpc/can_manage_lesson_resource",
            "Only uploaded PDF resources can be extracted in v1.",
            "Only uploaded PDF resources can be OCR processed.",
            "Only uploaded audio and video resources can be transcribed.",
            "Resource management access is required.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

        frontend_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "frontend" / "src").rglob("*")
            if path.suffix in {".ts", ".tsx"}
        )
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", frontend_source)
        self.assertNotIn("OPENAI_API_KEY", frontend_source)

    def test_media_transcription_migration_extends_chunks_safely(self):
        for fragment in (
            "audio_transcription",
            "video_transcription",
            "source_kind text not null default 'document'",
            "start_seconds numeric",
            "end_seconds numeric",
            "confidence numeric",
            "resource_text_chunks_source_kind_check",
            "resource_text_chunks_time_range_check",
            "resource_text_chunks_confidence_check",
            "revoke all privileges on table public.resource_text_chunks from anon",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.transcription_migration)

    def test_media_transcription_uses_server_side_openai_limits(self):
        for fragment in (
            "OPENAI_API_KEY",
            "MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024",
            '"mp3"',
            '"mp4"',
            '"mpeg"',
            '"mpga"',
            '"m4a"',
            '"wav"',
            '"webm"',
            "https://api.openai.com/v1/audio/transcriptions",
            'form.append("model", "whisper-1")',
            'form.append("response_format", "verbose_json")',
            'form.append("timestamp_granularities[]", "segment")',
            "status: \"draft\"",
            "source_kind",
            "start_seconds",
            "end_seconds",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

    def test_pdf_page_asset_migration_is_private_and_scoped(self):
        for fragment in (
            "pdf_page_render",
            "pdf_ocr",
            "create table if not exists public.resource_page_assets",
            "asset_type text not null check (asset_type in ('thumbnail', 'ocr_image'))",
            "alter table public.resource_page_assets enable row level security",
            "revoke all privileges on table public.resource_page_assets from anon",
            "public.can_manage_lesson_resource(resource_id)",
            "public.can_view_lesson_resource(resource_id)",
            "Authorized users can read resource page asset files",
            "Teachers can update resource page asset files",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.ocr_migration)

    def test_pdf_ocr_uses_server_side_openai_and_draft_chunks(self):
        for fragment in (
            "OPENAI_OCR_MODEL",
            '"gpt-5.4-mini"',
            "MAX_OCR_PAGES = 30",
            "MAX_OCR_IMAGE_BYTES = 1.5 * 1024 * 1024",
            "https://api.openai.com/v1/chat/completions",
            "OpenAI OCR failed",
            "generated_from: \"openai_vision_ocr\"",
            "status: \"draft\"",
            "Generate PDF page previews before running OCR.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

    def test_studio_keeps_client_side_pdf_extraction_for_ai_reference(self):
        # The pipeline UI is gone, but the studio's AiReferenceInput still extracts
        # PDF text fully client-side with pdf.js (no server round-trip, no secrets).
        self.assertIn('"pdfjs-dist"', self.package)
        self.assertIn("getDocument", self.pdf_extract)
        self.assertIn("pdf.worker.min.mjs?url", self.pdf_extract)
        self.assertIn("export async function extractPdfTextChunksFromUrl", self.pdf_extract)
        self.assertIn("extractPdfTextChunksFromUrl", self.studio)

    def test_chat_loads_only_approved_chunks_for_mentor_context(self):
        for fragment in (
            "resource_text_chunks?resource_id=",
            "status=eq.approved",
            # Tutor v2.0 Phase C renamed the mentor payload key approved_resource_chunks -> resource_chunks
            # and slimmed the resource guidance wording; the "only approved chunks" contract is unchanged.
            "resource_chunks:",
            "Teacher-approved source material",
            "resource_title",
            "page_number",
            "source_kind",
            "start_seconds",
            "end_seconds",
            "audio/video chunks by title/time range",
            "Never claim a resource was viewed unless resource_interactions",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)


if __name__ == "__main__":
    unittest.main()
