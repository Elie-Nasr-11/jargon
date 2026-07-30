"""Static invariants for automatic resource extraction on upload.

The load-bearing rules this file pins:
- Uploading a resource scans it. Forgetting the manual "Extract PDF text" step is silent —
  the resource looks fine and the mentor simply never sees its contents — which is the
  failure this feature exists to prevent.
- The scanned-PDF fallback (text → page previews → OCR) is driven by a RETURN VALUE, never
  by matching an error message. Keying it off a string would mean a reworded message
  silently disables automatic OCR.
- Scanning never blocks or fails the upload. The file saved; extraction is best-effort.
- Approval still gates what the mentor sees. chat reads only status='approved', and this
  feature feeds that contract rather than changing it.
"""

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONSOLE = (REPO / "frontend" / "src" / "features" / "teacher" / "TeacherConsole.tsx").read_text()
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()


class AutoExtractOnUpload(unittest.TestCase):
    def _auto_extract(self) -> str:
        start = CONSOLE.index("const autoExtract = async (")
        return CONSOLE[start : CONSOLE.index("\n  };", start)]

    def test_upload_triggers_a_scan(self):
        # The submit path captures the created resource and scans it.
        self.assertIn("const created = await onSaveResource({", CONSOLE)
        self.assertIn("if (created) void autoExtract(created);", CONSOLE)

    def test_scan_is_not_awaited_by_the_upload(self):
        # `void` (not `await`): a slow browser PDF pass must not hold the form open, and a
        # scanning failure must not surface as a failed upload.
        self.assertIn("void autoExtract(created)", CONSOLE)
        self.assertNotIn("await autoExtract(", CONSOLE)

    def test_dispatch_is_by_resource_type(self):
        fn = self._auto_extract()
        self.assertIn('resource.source_type !== "upload"', fn)  # links have nothing to scan
        self.assertIn('resource.resource_type === "pdf"', fn)
        self.assertIn('resource.resource_type === "audio"', fn)
        self.assertIn('resource.resource_type === "video"', fn)

    def test_ocr_fallback_is_driven_by_a_return_value(self):
        fn = self._auto_extract()
        # Branches on the result. The message string may appear as status COPY, but must never
        # be what the control flow tests — that is the brittleness being designed out.
        self.assertIn('result !== "no_text"', fn)
        self.assertNotIn(".includes(", fn)
        self.assertNotIn(".message ===", fn)
        self.assertNotIn(".match(", fn)
        # extractChunks reports the scanned case by returning, not throwing.
        extract = CONSOLE[CONSOLE.index("const extractChunks = async (") :]
        extract = extract[: extract.index("\n  };")]
        self.assertIn('return "no_text"', extract)
        self.assertIn('return "extracted"', extract)
        self.assertIn('return "failed"', extract)
        self.assertNotIn('throw new Error("No selectable text', extract)

    def test_ocr_receives_the_freshly_rendered_assets(self):
        # Reading assetsByResource in the same tick the previews were saved yields an empty
        # page list (React has not re-rendered). That happens to work because the server treats
        # an empty list as "every asset" — passing them explicitly makes it intentional.
        fn = self._auto_extract()
        self.assertIn("await ocrPdfResource(resource, assets)", fn)
        self.assertIn(
            "const ocrPdfResource = async (resource: LessonResource, freshAssets?: ResourcePageAsset[])",
            CONSOLE,
        )

    def test_scan_failure_does_not_report_a_failed_upload(self):
        fn = self._auto_extract()
        self.assertIn("setResourceMessage(", fn)
        # Points the teacher at the manual override rather than dead-ending.
        self.assertIn("by hand", fn)

    def test_approval_still_gates_what_the_mentor_sees(self):
        # The contract this feature feeds. If chat stops filtering on approved, auto-extraction
        # would start publishing unreviewed text to students.
        self.assertIn("status=eq.approved", CHAT)


if __name__ == "__main__":
    unittest.main()
