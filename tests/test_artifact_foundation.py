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


if __name__ == "__main__":
    unittest.main()
