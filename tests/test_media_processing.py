from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0013_media_processing.sql"
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
            '"save_chunk_edits"',
            '"approve_chunks"',
            '"reject_chunks"',
            '"delete_chunks"',
            '"list_resource_chunks"',
            "fetchCurrentUser",
            "rpc/can_manage_lesson_resource",
            "Only uploaded PDF resources can be extracted in v1.",
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

    def test_frontend_uses_pdfjs_and_resource_processing_edge_function(self):
        for fragment in (
            '"resource-processing"',
            'functionUrl("resource-processing")',
            "ResourceTextChunk",
            "fetchResourceTextChunks",
            "saveExtractedPdfChunks",
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

    def test_teacher_resource_manager_supports_extract_review_approve(self):
        for fragment in (
            "Extract PDF text",
            "Review text",
            "Extracted text review",
            "Approve drafts",
            "Draft and rejected chunks are teacher-only",
            "Mentor can use approved",
            "ResourceChunkStatusChip",
            "extractPdfTextChunksFromUrl",
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
            "you may use them as teacher-approved context",
            "Do not claim a resource was viewed unless resource_interactions proves it",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)


if __name__ == "__main__":
    unittest.main()
