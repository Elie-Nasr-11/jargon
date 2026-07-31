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
# v6 slice B2 (2026-07-30): the P5c safe markdown subset retired with routes/chat.tsx is
# PORTED into the v6 transcript (mentor bubbles only), and student/ResourceCard.tsx is
# the universal §5 media renderer. The pins below hold the same invariants against the
# new mounts: React-node-only rendering, https-only links, the BLOCK_MD_RE gate, signed
# URLs, the nocookie rewrite, and progress telemetry.
TRANSCRIPT = (REPO / "frontend" / "src" / "student" / "Transcript.tsx").read_text()
RESOURCE_CARD = (REPO / "frontend" / "src" / "student" / "ResourceCard.tsx").read_text()
# 2026-07-31: URL resolution + the nocookie rewrite moved to resourceMedia.ts, shared by the
# card and the MediaStage so the invariants cannot drift between the two mounts.
RESOURCE_MEDIA = (REPO / "frontend" / "src" / "student" / "resourceMedia.ts").read_text()
MEDIA_STAGE = (REPO / "frontend" / "src" / "student" / "MediaStage.tsx").read_text()
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
        # P8 bumped 12 -> 16 so the student's own mentor-built rows (RLS-visible now)
        # can't evict curated materials from the window.
        self.assertIn("limit=16", select.group(0))

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
        # P8: the call site feeds curatedResources (context.resources minus mentor-built
        # rows) — generated cards only attach via the artifact_ready control.
        call = re.search(r"resourcesForResponse\(\s*curatedResources,.*?\);", CHAT, re.S)
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
    """P5c, re-anchored to the v6 transcript (slice B2): the hand-rolled markdown subset
    is back for mentor prose, with the same safety construction as the old surface —
    React nodes only (text nodes ARE the sanitizer), a lexical https-only link scheme,
    and the cheap BLOCK_MD_RE gate so plain replies keep the pre-wrap path."""

    def test_no_dangerous_html(self):
        # The JSX attribute form — a comment may name it, but nothing may USE it.
        self.assertNotIn("dangerouslySetInnerHTML=", TRANSCRIPT)
        self.assertNotIn("dangerouslySetInnerHTML=", RESOURCE_CARD)

    def test_block_pass_is_gated_and_scoped_to_mentor_prose(self):
        # The block renderer runs ONLY when block syntax is present…
        self.assertIn("const BLOCK_MD_RE =", TRANSCRIPT)
        self.assertIn("BLOCK_MD_RE.test(raw)", TRANSCRIPT)
        # …and only mentor bubbles opt in — student/teacher text stays literal pre-wrap.
        self.assertIn("markdown={!message.isError}", TRANSCRIPT)
        self.assertIn("{markdown ? renderInline(raw) : raw}", TRANSCRIPT)
        self.assertIn("whitespace-pre-wrap", TRANSCRIPT)

    def test_links_are_https_only_and_noopener(self):
        # The scheme is enforced LEXICALLY in both the tokenizer and the matcher — no
        # javascript:/data: vector exists because nothing else parses as a link.
        self.assertEqual(TRANSCRIPT.count("https:\\/\\/[^\\s)]+"), 2)
        self.assertIn('rel="noopener noreferrer"', TRANSCRIPT)

    def test_no_markdown_dependency(self):
        deps = {
            **PACKAGE.get("dependencies", {}),
            **PACKAGE.get("devDependencies", {}),
        }
        for name in ("react-markdown", "marked", "remark", "rehype", "dompurify", "markdown-it"):
            self.assertNotIn(name, deps)

    def test_tts_speaks_clean_text(self):
        self.assertIn("export function stripMarkdown", FORMAT_TS)
        self.assertIn("stripMarkdown(text)", READ_ALOUD)
        self.assertIn("SpeechSynthesisUtterance(speechText)", READ_ALOUD)
        self.assertIn("text: speechText", READ_ALOUD)

    def test_style_prompt_extension_landed(self):
        self.assertIn("dash list", CHAT)
        self.assertIn("Never use headings or links in replies.", CHAT)


class InlineMediaTable(unittest.TestCase):
    """Slice B2: the DESIGN_V6 §5 media table renders through ONE card — the same
    component in the transcript and the Resources panel — with the old surface's
    security/telemetry invariants pinned here."""

    def test_youtube_gets_the_nocookie_rewrite(self):
        self.assertIn("youtube-nocookie.com/embed/", RESOURCE_MEDIA)
        # The rewrite runs on the youtube branch of URL resolution — never the raw URL
        # first — and an unrecognizable URL falls back out of the iframe path. Both mounts
        # (the inline card and the media stage) resolve through this one function.
        self.assertIn('youtubeEmbedUrl(resource.external_url || "")', RESOURCE_MEDIA)
        self.assertIn("resolveResourceUrl", RESOURCE_CARD)
        self.assertIn("resolveResourceUrl", MEDIA_STAGE)

    def test_uploads_are_signed_lazily_and_only_on_open(self):
        # Signing happens inside open/run handlers, never on mount: listing a lesson's
        # materials must not mint URLs nobody opens, and persisted signed URLs (long
        # expired by replay) are only a last-resort fallback.
        self.assertIn("getLessonResourceSignedUrl({", RESOURCE_MEDIA)
        self.assertIn('source_type: "upload"', RESOURCE_MEDIA)
        # The artifact run path still signs inline in the card (TEXT fetch, never a link).
        self.assertIn("getLessonResourceSignedUrl({", RESOURCE_CARD)

    def test_inline_players_are_scoped_per_kind(self):
        # The generic iframe mounts ONLY for pdf/youtube; video/audio/image use native
        # elements. Artifacts are excluded from BOTH generic paths (pinned in the
        # foundation suite) — their HTML never reaches these players.
        self.assertIn(
            'resource.resource_type === "pdf" || resource.resource_type === "youtube"',
            RESOURCE_CARD,
        )
        self.assertIn('const INLINE_KINDS = new Set(["pdf", "youtube", "video", "audio", "image"])', RESOURCE_CARD)
        self.assertIn("<video", RESOURCE_CARD)
        self.assertIn("<audio", RESOURCE_CARD)
        self.assertIn("<img", RESOURCE_CARD)

    def test_everything_else_opens_noopener(self):
        self.assertIn('window.open(url, "_blank", "noopener,noreferrer")', RESOURCE_CARD)

    def test_telemetry_covers_the_table(self):
        # `shown` fires once on mount; media fires played/paused/completed WITH progress
        # (seconds + percent) — this feeds the mentor's "don't claim they watched it"
        # honesty rule, so losing an event class would let the mentor lie politely.
        self.assertIn('event_type: "shown"', RESOURCE_CARD)
        self.assertIn('track("opened")', RESOURCE_CARD)
        self.assertIn('track("played", mediaProgress(event.currentTarget))', RESOURCE_CARD)
        self.assertIn('track("paused", mediaProgress(event.currentTarget))', RESOURCE_CARD)
        self.assertIn('track("completed", mediaProgress(event.currentTarget))', RESOURCE_CARD)
        self.assertIn("progress_seconds", RESOURCE_CARD)
        self.assertIn("progress_percent", RESOURCE_CARD)
        # Artifact telemetry: the frame's played/paused passthrough + deck completion.
        self.assertIn("onTelemetry={(event) => track(event)}", RESOURCE_CARD)
        self.assertIn('track("completed", { progress_percent: 100 })', RESOURCE_CARD)

    def test_transcript_and_panel_share_the_card(self):
        panel = (REPO / "frontend" / "src" / "student" / "ResourcesPanel.tsx").read_text()
        self.assertIn('from "@/student/ResourceCard"', panel)
        self.assertIn('from "@/student/ResourceCard"', TRANSCRIPT)


if __name__ == "__main__":
    unittest.main()
