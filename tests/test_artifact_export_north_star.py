from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "frontend" / "src" / "lib" / "artifact-export.ts"
DECK = ROOT / "frontend" / "src" / "components" / "DeckRenderer.tsx"
FRAME = ROOT / "frontend" / "src" / "components" / "ArtifactFrame.tsx"
RESOURCE_CARD = ROOT / "frontend" / "src" / "student" / "ResourceCard.tsx"
MEDIA_STAGE = ROOT / "frontend" / "src" / "student" / "MediaStage.tsx"
RESOURCE_MEDIA = ROOT / "frontend" / "src" / "student" / "resourceMedia.ts"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"


class ArtifactExport(unittest.TestCase):
    """Wael (workspace, 2026-08-09): "Is there a way I can download the outline
    artifact?" — decks export as a self-contained print-ready handout; sims download
    as the .html file they are, behind the SAME safety lint that gates running them."""

    @classmethod
    def setUpClass(cls):
        cls.export = EXPORT.read_text(encoding="utf-8")
        cls.deck = DECK.read_text(encoding="utf-8")
        cls.frame = FRAME.read_text(encoding="utf-8")

    def test_export_lib_shape(self):
        for fragment in (
            "export function deckToStandaloneHtml",
            "export function downloadTextFile",
            "export function exportFilename",
            "export function escapeHtml",
            # Every text field is escaped on the way into the exported document —
            # deck text is plain by construction, but the export does not trust that.
            "escapeHtml(slide.title)",
            "escapeHtml(slide.code)",
            # The handout prints cleanly: one slide per block, no page splits.
            "@media print",
            "page-break-inside: avoid",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.export)

    def test_deck_renderer_offers_download(self):
        self.assertIn("deckToStandaloneHtml(deck, title)", self.deck)
        self.assertIn('aria-label="Download this deck"', self.deck)
        # Telemetry is optional: the export never depends on a session being wired.
        self.assertIn("onDownload?: () => void", self.deck)

    def test_sim_download_is_lint_gated(self):
        # A document the sandbox refuses to run is a document we refuse to hand out —
        # a downloaded file opens with NO sandbox, so the lint gate is load-bearing.
        download = self.frame[self.frame.index("const download = useCallback") :]
        lint_at = download.index("lintArtifactHtml(html)")
        download_at = download.index("downloadTextFile(")
        self.assertLess(lint_at, download_at)
        self.assertIn('setStatus("blocked")', download[: download.index("downloadTextFile(")])
        self.assertIn('aria-label="Download this activity"', self.frame)

    def test_downloaded_telemetry_is_wired(self):
        self.assertIn('"downloaded"', RESOURCE_MEDIA.read_text(encoding="utf-8"))
        self.assertIn('onDownload={() => track("downloaded")}', RESOURCE_CARD.read_text(encoding="utf-8"))
        self.assertIn('onDownload={() => track("downloaded")}', MEDIA_STAGE.read_text(encoding="utf-8"))
        self.assertIn('onTelemetry("downloaded")', self.frame)


class NorthStar(unittest.TestCase):
    """Owner + Wael philosophy shift: the mentor prompt leads with a destination
    (learning objectives, honestly reached) instead of a wall of prohibitions —
    "skiing a marked run, not tiptoeing between trees". The hard rails that protect
    the destination (no handed-over answers, no unearned credit, teacher policy)
    are restated INSIDE the preamble so the reframe can never be read as loosening
    integrity."""

    @classmethod
    def setUpClass(cls):
        cls.chat = CHAT_FN.read_text(encoding="utf-8")

    def test_north_star_leads_the_prompt(self):
        self.assertIn("YOUR NORTH STAR", self.chat)
        # It sits ahead of everything else the mentor reads.
        self.assertLess(
            self.chat.index("YOUR NORTH STAR"),
            self.chat.index("CONVERSATION CRAFT"),
        )

    def test_north_star_keeps_the_integrity_rails(self):
        for fragment in (
            "skiing a marked run",
            "the lesson's material is the path, never a cage",
            "work the student must produce is never handed over",
            "is never credited",
            "the teacher's policy always holds",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)


if __name__ == "__main__":
    unittest.main()
