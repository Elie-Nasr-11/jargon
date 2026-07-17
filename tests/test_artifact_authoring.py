"""Static invariants for Artifacts v1 P7: studio authoring (generate → approve).

The generate action must stay READ-ONLY (a draft round-trip; the separate approve step
persists), the server lint must mirror the frontend FORBIDDEN table, and the studio must
preview through the SAME ArtifactFrame/DeckRenderer students use. These read the source so
regressions show up in CI without a Deno/browser toolchain.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ADMIN = (REPO / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text()
FRONTEND = REPO / "frontend" / "src"
API = (FRONTEND / "lib" / "api.ts").read_text()
TYPES = (FRONTEND / "lib" / "types.ts").read_text()
DECK = (FRONTEND / "components" / "DeckRenderer.tsx").read_text()
CURRICULUM = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text()


class ArtifactGenerateBackend(unittest.TestCase):
    def test_generate_has_artifact_branch_both_kinds(self):
        self.assertIn('if (mode === "artifact")', ADMIN)
        self.assertIn('artifact_kind: "deck"', ADMIN)
        self.assertIn('artifact_kind: "html_sim"', ADMIN)
        self.assertIn("artifact_html", ADMIN)

    def test_model_call_gains_opts_and_override(self):
        self.assertIn("function artifactModel(", ADMIN)
        self.assertIn("OPENAI_MODEL_ARTIFACT", ADMIN)
        self.assertIn("maxTokens", ADMIN)
        self.assertIn("timeoutMs", ADMIN)
        self.assertIn("AbortController", ADMIN)

    def test_server_lint_is_byte_identical_to_frontend(self):
        # THREE copies of the FORBIDDEN table exist (Deno functions can't share
        # modules): frontend/src/lib/artifact-lint.ts (reference), curriculum-admin
        # (P7 studio), artifact-live (P8 live generation). Pin all three regex source
        # sets equal, not just "some tokens present".
        lint_ts = (REPO / "frontend" / "src" / "lib" / "artifact-lint.ts").read_text()
        live = (REPO / "supabase" / "functions" / "artifact-live" / "index.ts").read_text()

        def labels_and_res(text: str) -> set:
            return set(re.findall(r'\{\s*label:\s*"([^"]+)",\s*re:\s*(/[^\n]+?/[a-z]*)\s*\}', text))

        front = labels_and_res(lint_ts)
        self.assertTrue(front, "frontend FORBIDDEN table not parsed")
        self.assertEqual(front, labels_and_res(ADMIN))
        self.assertEqual(front, labels_and_res(live))

    def test_deck_validator_present(self):
        self.assertIn("ARTIFACT_DECK_MAX_BYTES", ADMIN)
        self.assertIn("function validateDeck(", ADMIN)

    def test_artifact_branch_asserts_author(self):
        branch = re.search(r'if \(mode === "artifact"\).*?throw new Error\("Unsupported generate mode', ADMIN, re.S)
        self.assertIsNotNone(branch)
        self.assertIn("assertCanAuthor", branch.group(0))

    def test_generate_stays_read_only(self):
        # The artifact branch must not persist anything — only the model call + validation.
        branch = re.search(r'if \(mode === "artifact"\).*?throw new Error\("Unsupported generate mode', ADMIN, re.S)
        self.assertIsNotNone(branch)
        for writer in ("insertRow", "patchRows", "upsertByConflict", "deleteRows"):
            self.assertNotIn(writer, branch.group(0))


class ArtifactAuthoringClientWire(unittest.TestCase):
    def test_generate_wrapper_supports_artifact(self):
        self.assertIn('"artifact"', API)
        self.assertIn("artifactKind", API)
        self.assertIn("brief", API)

    def test_response_type_carries_artifact_fields(self):
        self.assertIn("artifact_html?: string", TYPES)
        self.assertIn("deck?: DeckSpec", TYPES)

    def test_create_artifact_resource_shape(self):
        self.assertIn("export async function createArtifactResource(", API)
        block = re.search(
            r"export async function createArtifactResource\(.*?return data as LessonResource;",
            API,
            re.S,
        )
        self.assertIsNotNone(block)
        body = block.group(0)
        self.assertIn('resource_type: "artifact"', body)
        self.assertIn('status: "published"', body)
        self.assertIn("activity_id: input.activityId", body)
        self.assertIn("metadata: { artifact }", body)
        self.assertIn("artifacts/", body)
        # Best-effort orphan cleanup on insert failure.
        self.assertIn(".remove([path])", body)

    def test_deck_renderer_gates_read_aloud(self):
        self.assertIn("readAloud = true", DECK)
        self.assertIn("active && readAloud", DECK)


class ArtifactStudioPanel(unittest.TestCase):
    def test_panel_exists_and_previews_both(self):
        self.assertIn("function ArtifactGeneratePanel(", CURRICULUM)
        self.assertIn("<ArtifactFrame", CURRICULUM)
        self.assertIn("<DeckRenderer", CURRICULUM)
        # Preview mounts DeckRenderer with read-aloud off (no student session).
        self.assertIn("readAloud={false}", CURRICULUM)

    def test_panel_gates_on_saved_step(self):
        # A temp (unsaved) step can't own the resource FK — generate/approve wait for it.
        self.assertIn("bindable", CURRICULUM)
        self.assertIn("Save this step first", CURRICULUM)

    def test_approve_relints_before_publish(self):
        approve = re.search(r"const approve = \(\) => \{.*?\};", CURRICULUM, re.S)
        self.assertIsNotNone(approve)
        self.assertIn("lintArtifactHtml", approve.group(0))


if __name__ == "__main__":
    unittest.main()
