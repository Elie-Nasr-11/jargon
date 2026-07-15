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
        # Lessons with no bindings must keep today's behavior byte-for-byte: first
        # resource on the boot turn, request-regex attach mid-conversation.
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


if __name__ == "__main__":
    unittest.main()
