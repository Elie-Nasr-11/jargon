from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0013_media_processing.sql"
TRANSCRIPTION_MIGRATION = ROOT / "supabase" / "migrations" / "0015_media_transcription.sql"
OCR_MIGRATION = ROOT / "supabase" / "migrations" / "0016_pdf_page_assets_ocr.sql"
FUNCTION = ROOT / "supabase" / "functions" / "resource-processing" / "index.ts"
CHAT_FUNCTION = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
SUPABASE = ROOT / "frontend" / "src" / "lib" / "supabase.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
TEACHER_ROUTE = ROOT / "frontend" / "src" / "routes" / "teacher.tsx"
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
        cls.api = API.read_text(encoding="utf-8")
        cls.supabase = SUPABASE.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.teacher = TEACHER_ROUTE.read_text(encoding="utf-8")
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

    def test_frontend_uses_pdfjs_and_resource_processing_edge_function(self):
        for fragment in (
            '"resource-processing"',
            'functionUrl("resource-processing")',
            "ResourceTextChunk",
            "fetchResourceTextChunks",
            "saveExtractedPdfChunks",
            "transcribeMediaResource",
            "uploadPdfPageAssets",
            "ocrPdfPages",
            "approveResourceChunks",
            "rejectResourceChunks",
            "deleteResourceChunks",
            "pdfjs-dist",
        ):
            with self.subTest(fragment=fragment):
                self.assertTrue(
                    fragment in self.supabase
                    or fragment in self.api
                    or fragment in self.types
                    or fragment in self.package
                )

        self.assertIn("getDocument", self.pdf_extract)
        self.assertIn("pdf.worker.min.mjs?url", self.pdf_extract)
        self.assertIn("extractPdfTextChunksFromUrl", self.pdf_extract)
        self.assertIn("renderPdfPageAssetsFromUrl", self.pdf_extract)

    def test_teacher_resource_manager_supports_extract_review_approve(self):
        for fragment in (
            "Extract PDF text",
            "Generate page previews",
            "OCR scanned pages",
            "Transcribe audio",
            "Transcribe video",
            "Review text",
            "Extracted text / transcript review",
            "Approve drafts",
            "Draft and rejected chunks are teacher-only",
            "Mentor can use approved",
            "ResourceChunkStatusChip",
            "extractPdfTextChunksFromUrl",
            "renderPdfPageAssetsFromUrl",
            "chunkLocationLabel",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.teacher)

    def test_chat_loads_only_approved_chunks_for_mentor_context(self):
        for fragment in (
            "resource_text_chunks?resource_id=",
            "status=eq.approved",
            "approved_resource_chunks",
            "resource_title",
            "page_number",
            "source_kind",
            "start_seconds",
            "end_seconds",
            "you may use them as teacher-approved context",
            "audio/video chunks by resource title/time range",
            "Do not claim a resource was viewed unless resource_interactions proves it",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)


if __name__ == "__main__":
    unittest.main()
