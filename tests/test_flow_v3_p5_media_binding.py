"""Static invariants for Flow v3 Phase 5: media step→resource binding, teacher attach
controls, and the safe markdown pass.

Repo convention: read the TypeScript source and pin structural contracts so a regression
that would silently unbind materials, mutate shared context, or reintroduce an HTML
injection surface shows up in CI without a Deno/browser toolchain.
"""

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()
CHAT_TSX = (REPO / "frontend" / "src" / "routes" / "chat.tsx").read_text()
CURRICULUM = (REPO / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text()
API = (REPO / "frontend" / "src" / "lib" / "api.ts").read_text()
FORMAT_TS = (REPO / "frontend" / "src" / "lib" / "format.ts").read_text()
READ_ALOUD = (
    REPO / "frontend" / "src" / "components" / "ReadAloudAction.tsx"
).read_text()
PACKAGE = json.loads((REPO / "frontend" / "package.json").read_text())


class MediaBindingRuntimeInvariants(unittest.TestCase):
    """P5a: the chat runtime reads the step binding and attaches bound materials."""

    def test_resource_select_carries_binding(self):
        select = re.search(r"lesson_resources\?lesson_id=[^`]*", CHAT)
        self.assertIsNotNone(select)
        self.assertIn("activity_id", select.group(0))
        self.assertIn("limit=12", select.group(0))

    def test_selection_is_step_aware(self):
        signature = re.search(
            r"function resourcesForResponse\((.*?)\): LessonChatResource\[\]",
            CHAT,
            re.S,
        )
        self.assertIsNotNone(signature)
        self.assertIn("activityId", signature.group(1))
        self.assertIn("presentedBefore", signature.group(1))
        # The bound filter compares the resource's binding to the effective step.
        self.assertIn('String(resource.activity_id || "") === activityId', CHAT)

    def test_call_site_passes_effective_step(self):
        call = re.search(r"resourcesForResponse\(\s*context\.resources,.*?\);", CHAT, re.S)
        self.assertIsNotNone(call)
        self.assertIn("context.activity", call.group(0))
        self.assertIn("presentedBefore", call.group(0))

    def test_unbound_fallback_preserved(self):
        # Pins the load-bearing pieces of the unbound-lesson fallback (first resource on
        # the boot turn, the request regex); the full equivalence argument lives in the
        # resourcesForResponse ladder comments and the P5 review.
        self.assertIn("[resources[0]]", CHAT)
        self.assertIn("RESOURCE_REQUEST_RE", CHAT)
        self.assertIn("pull up", CHAT)

    def test_cap_and_copy_before_sort(self):
        fn = re.search(
            r"function resourcesForResponse\(.*?\n\}", CHAT, re.S
        )
        self.assertIsNotNone(fn)
        body = fn.group(0)
        self.assertIn(".slice(0, 3)", body)
        # Never mutate context.resources: the re-rank sorts a spread copy.
        self.assertIn("[...chosen].sort", body)

    def test_media_directive_is_honest_when_unbound(self):
        self.assertIn("NO resource card is attached", CHAT)


class TeacherAttachInvariants(unittest.TestCase):
    """P5b: the curriculum studio binds materials to steps via activity_id."""

    def test_step_card_has_attach_section(self):
        self.assertIn("Attached materials", CURRICULUM)
        self.assertIn("patchResourceLocal", CURRICULUM)
        self.assertIn(
            "updateLessonResource(resourceId, { activity_id: activityId })",
            CURRICULUM,
        )

    def test_temp_step_ids_cannot_bind(self):
        # A just-created step's temp id would violate the resource FK — the controls
        # must wait for the server id swap.
        self.assertIn('startsWith("temp-")', CURRICULUM)

    def test_api_pick_widened(self):
        pick = re.search(
            r"export async function updateLessonResource\(.*?\)\s*\{",
            API,
            re.S,
        )
        self.assertIsNotNone(pick)
        self.assertIn('"activity_id"', pick.group(0))

    def test_drafts_flagged(self):
        self.assertIn("Drafts never reach students", CURRICULUM)


class SafeMarkdownInvariants(unittest.TestCase):
    """P5c: the markdown pass stays React-node-only, https-only, dependency-free."""

    def test_no_dangerous_html(self):
        # The JSX attribute form — a comment may name it, but nothing may USE it.
        self.assertNotIn("dangerouslySetInnerHTML=", CHAT_TSX)

    def test_links_are_https_only_with_rel(self):
        self.assertIn('rel="noopener noreferrer"', CHAT_TSX)
        # The scheme is enforced LEXICALLY in the inline regex — no javascript:/data:
        # vector can ever parse as a link.
        self.assertIn("https:\\/\\/[^\\s)]+", CHAT_TSX)

    def test_no_markdown_dependency(self):
        deps = {
            **PACKAGE.get("dependencies", {}),
            **PACKAGE.get("devDependencies", {}),
        }
        for name in ("react-markdown", "marked", "remark", "rehype", "dompurify", "markdown-it"):
            self.assertNotIn(name, deps)

    def test_plain_replies_keep_legacy_path(self):
        # The block renderer is gated: no block syntax → the untouched pre-wrap path.
        self.assertIn("BLOCK_MD_RE", CHAT_TSX)
        self.assertIn("whitespace-pre-wrap text-body-lg text-foreground", CHAT_TSX)

    def test_tts_speaks_clean_text(self):
        self.assertIn("export function stripMarkdown", FORMAT_TS)
        self.assertIn("stripMarkdown(text)", READ_ALOUD)
        self.assertIn("SpeechSynthesisUtterance(speechText)", READ_ALOUD)
        self.assertIn("text: speechText", READ_ALOUD)

    def test_style_prompt_extension_landed(self):
        self.assertIn("dash list", CHAT)
        self.assertIn("Never use headings or links in replies.", CHAT)


if __name__ == "__main__":
    unittest.main()
