"""Static invariants for Artifacts v1 P6: the artifact resource foundation.

The load-bearing invariant in this file is the SANDBOX rule: an html_sim renders in an
iframe with sandbox="allow-scripts" ONLY — never allow-same-origin, never a navigable
URL. The sandbox is the security boundary; everything else (lint, caps) is
defense-in-depth. These tests read the source so a regression shows up in CI without a
Deno/browser toolchain.
"""

import re
import unittest
from pathlib import Path
from tests.teacher_sources import console_source

REPO = Path(__file__).resolve().parent.parent
MIGRATION = (
    REPO / "supabase" / "migrations" / "20260820000000_artifact_resources.sql"
).read_text()
BASELINE = (
    REPO / "supabase" / "migrations" / "0009_full_platform_foundation.sql"
).read_text()
WORKFLOW = (REPO / ".github" / "workflows" / "deploy-backend.yml").read_text()
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()
ROADMAP = (REPO / "docs" / "COMPLETE_ROADMAP.md").read_text()
FRONTEND = REPO / "frontend" / "src"
FRAME = (FRONTEND / "components" / "ArtifactFrame.tsx").read_text()
DECK = (FRONTEND / "components" / "DeckRenderer.tsx").read_text()
LINT = (FRONTEND / "lib" / "artifact-lint.ts").read_text()
SCHEMA = (FRONTEND / "lib" / "artifact-schema.ts").read_text()
TYPES = (FRONTEND / "lib" / "types.ts").read_text()
API = (FRONTEND / "lib" / "api.ts").read_text()
# v6 slice B2 (2026-07-30): student/ResourceCard.tsx is the UNIVERSAL renderer for the
# DESIGN_V6 §5 media table — it mounts ArtifactFrame (html_sim) and DeckRenderer (deck)
# inline in the transcript AND in the Resources panel, alongside the pdf/youtube/video/
# audio/image inline players. The sandbox posture lives in ArtifactFrame and is pinned
# below; the card-level pins assert the artifact document only ever reaches the frame as
# TEXT and never becomes a navigable or embeddable URL in the card itself.
RESOURCE_CARD = (FRONTEND / "student" / "ResourceCard.tsx").read_text()
TEACHER = console_source()
PACKAGE = (REPO / "frontend" / "package.json").read_text()


class ArtifactMigrationInvariants(unittest.TestCase):
    def test_check_swap_is_idempotent(self):
        self.assertIn(
            "drop constraint if exists lesson_resources_resource_type_check",
            MIGRATION,
        )
        self.assertIn(
            "add constraint lesson_resources_resource_type_check",
            MIGRATION,
        )
        self.assertIn(
            "check (resource_type in ('video', 'audio', 'pdf', 'flipbook', 'youtube', 'image', 'link', 'document', 'artifact'))",
            MIGRATION,
        )

    def test_migration_is_whitelisted(self):
        self.assertIn("20260820000000_artifact_resources.sql", WORKFLOW)

    def test_baseline_migration_untouched(self):
        # 0009 keeps the ORIGINAL 8-type check text — its own test pins it, and the
        # deploy loop never replays 0009, so the swap must live in the new file only.
        self.assertIn(
            "check (resource_type in ('video', 'audio', 'pdf', 'flipbook', 'youtube', 'image', 'link', 'document'))",
            BASELINE,
        )


class ArtifactWireInvariants(unittest.TestCase):
    def test_envelope_passthrough_is_validated_and_capped(self):
        self.assertIn("function artifactForEnvelope(", CHAT)
        self.assertIn("ARTIFACT_DECK_MAX_BYTES", CHAT)
        self.assertIn('"html_sim"', CHAT)
        self.assertIn("artifact: artifactForEnvelope(resource)", CHAT)
        # The loadContext select pin other suites rely on stays intact.
        self.assertIn("lesson_resources?lesson_id=eq.", CHAT)

    def test_directive_says_run_for_artifacts(self):
        # Both the media presentation variant and the attached-card footer must use the
        # honest verb — artifacts run on the card; nothing "opens".
        self.assertGreaterEqual(len(re.findall(r"tap Run", CHAT)), 2)

    def test_roadmap_locks_artifact(self):
        self.assertIn('"artifact"', ROADMAP)
        self.assertIn("allow-scripts", ROADMAP)
        self.assertIn("65536", ROADMAP)


class ArtifactSandboxInvariants(unittest.TestCase):
    """THE security boundary: allow-scripts only, opaque origin, no navigable URL."""

    def test_sandbox_is_scripts_only(self):
        # Every sandbox attribute in the file must be EXACTLY the allow-scripts string
        # literal (comments may name allow-same-origin to forbid it; the attribute never
        # carries it), and the expression form sandbox={...} — which could smuggle a
        # computed value past this pin — must not exist at all.
        sandboxes = re.findall(r'sandbox="([^"]*)"', FRAME)
        self.assertTrue(sandboxes)
        for value in sandboxes:
            self.assertEqual(value, "allow-scripts")
        self.assertNotIn("sandbox={", FRAME)
        self.assertIn("srcDoc", FRAME)
        # The iframe must never navigate to a URL (the signed URL would render the raw
        # HTML on the storage origin) — only srcDoc, never src=.
        self.assertIsNone(re.search(r"<iframe[^>]*\bsrc=", FRAME))
        self.assertNotIn("allow=", FRAME)

    def test_frame_never_autoruns_by_default(self):
        self.assertIn("autoRun = false", FRAME)
        self.assertIn(">Run<", FRAME.replace("\n", "").replace("  ", "")[:100000] or FRAME)

    def test_lint_is_wired_as_defense_in_depth(self):
        for token in (
            "fetch",
            "XMLHttpRequest",
            "WebSocket",
            "EventSource",
            "sendBeacon",
            "importScripts",
            "document\\s*\\.\\s*cookie",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "<iframe",
        ):
            self.assertIn(token, LINT)
        self.assertIn("https?:", LINT)
        self.assertIn("lintArtifactHtml", FRAME)

    def test_ready_watchdog_and_token_gate(self):
        self.assertIn("READY_TIMEOUT_MS", FRAME)
        self.assertIn("data.token !== tokenRef.current", FRAME)
        self.assertIn("event.source !== iframeRef.current?.contentWindow", FRAME)


class ArtifactClientWireInvariants(unittest.TestCase):
    def test_types_carry_artifact(self):
        self.assertIn('| "artifact"', TYPES)
        self.assertIn("artifact?: ArtifactConfig", TYPES)

    def test_api_selects_only_the_artifact_subtree(self):
        # Selecting the whole metadata jsonb would ship every resource's internal keys
        # to the student — only the artifact subtree may ride the launcher fetch.
        self.assertIn("artifact:metadata->artifact", API)
        self.assertNotIn("student_instructions,metadata,", API)
        self.assertIn("parseArtifactConfig", API)

    def test_resource_card_mounts_artifacts_only_through_the_sandboxed_renderers(self):
        # Re-anchored 2026-07-30 (slice B2): the card now DOES render artifacts inline —
        # but ONLY through the components that carry the security posture. html_sim goes
        # through ArtifactFrame (poster→Run gate, allow-scripts sandbox pinned above);
        # deck goes through DeckRenderer (native, no HTML at all).
        self.assertIn('from "@/components/ArtifactFrame"', RESOURCE_CARD)
        self.assertIn('from "@/components/DeckRenderer"', RESOURCE_CARD)
        self.assertIn('artifact?.kind === "html_sim"', RESOURCE_CARD)
        self.assertIn('artifact?.kind === "deck" && artifact.deck', RESOURCE_CARD)
        # The parse is the validated schema parser, never raw metadata trust.
        self.assertIn("parseArtifactConfig(resource.artifact)", RESOURCE_CARD)

    def test_resource_card_artifact_html_travels_as_text_never_as_a_url(self):
        # An artifact NEVER gets an Open action or an inline player URL: the isArtifact
        # flag excludes it from both generic paths, so a signed URL for artifact HTML is
        # only ever consumed inside fetchHtml — fetched as TEXT into the frame's srcdoc.
        self.assertIn('const isArtifact = resource.resource_type === "artifact"', RESOURCE_CARD)
        self.assertIn("const rendersInline = !isArtifact &&", RESOURCE_CARD)
        self.assertIn("const canOpen =\n    !isArtifact &&", RESOURCE_CARD)
        self.assertIn("response.text()", RESOURCE_CARD)
        # The card itself composes no document: no srcdoc, no injected HTML. (The only
        # iframes it may mount are the pdf/youtube players, pinned in the media suite.)
        self.assertNotIn("srcDoc", RESOURCE_CARD)
        self.assertNotIn("dangerouslySetInnerHTML", RESOURCE_CARD)

    def test_deck_renderer_is_native(self):
        self.assertIn('from "@/components/ui/carousel"', DECK)
        self.assertIn("ReadAloudAction", DECK)
        for layout in ("two_col", "quote", "code"):
            self.assertIn(layout, DECK)
        # The image layout is deferred (no asset pipeline) — neither the type union nor
        # the parser may recognize it (a comment naming it is fine).
        self.assertNotIn('layout: "image"', SCHEMA)
        self.assertNotIn('case "image"', SCHEMA)

    def test_no_new_dependencies(self):
        self.assertIn('"embla-carousel-react"', PACKAGE)
        for name in ("dompurify", "react-markdown", "iframe-resizer"):
            self.assertNotIn(name, PACKAGE)
        for source in (FRAME, DECK, LINT, SCHEMA):
            imports = re.findall(r'from\s+"([^"]+)"', source)
            for spec in imports:
                self.assertTrue(
                    spec.startswith("@/") or spec.startswith(".") or spec in ("react", "lucide-react"),
                    f"unexpected import {spec}",
                )

    def test_teacher_form_has_no_artifact_option(self):
        # Authoring arrives in P7 (generate → preview → approve), never the manual form.
        self.assertNotIn('value="artifact"', TEACHER)


if __name__ == "__main__":
    unittest.main()
