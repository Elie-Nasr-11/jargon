"""Chat-flow Phase 2 (2026-08-02): SSE streaming pins. The mentor call streams when the
client opts in with stream:true — delta events carry the reply text (extracted live from
the JSON contract's first key), and the terminal `envelope` event delivers the same
envelope the JSON path would have returned, status included. Deterministic early returns
(controls, replays, refusals) stay plain JSON. The rate limiter's dedicated serial round
trip is gone — the count rides loadContext's wave 1."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
CONVO = ROOT / "frontend" / "src" / "student" / "useConversation.ts"
MESSAGES = ROOT / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts"
TRANSCRIPT = ROOT / "frontend" / "src" / "student" / "Transcript.tsx"


class ChatStreamingStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chat_fn = CHAT_FN.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.convo = CONVO.read_text(encoding="utf-8")
        cls.messages = MESSAGES.read_text(encoding="utf-8")
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")

    def test_server_stream_opt_in_and_sse_wrapper(self):
        for fragment in (
            "const wantsStream = body.stream === true;",
            "function sseResponse(",
            'send("delta", JSON.stringify({ text }))',
            "if (wantsStream) return sseResponse(finishTurn);",
            "return await finishTurn(null);",
            '"Content-Type": "text/event-stream"',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)
        # The terminal event carries status + the whole envelope (success or typedError).
        self.assertIn(
            "JSON.stringify({ status: response.status, envelope: await response.json() })",
            self.chat_fn,
        )

    def test_server_reply_extractor_and_provider_streams(self):
        for fragment in (
            "function makeReplyExtractor(",
            "async function callModelStream(",
            "async function callOpenAIStream(",
            "async function callAnthropicStream(",
            "stream_options: { include_usage: true }",
            # The streaming call is mentor-turn-only, gated on the delta callback. The
            # extractor callback also accumulates the reply so a malformed final JSON
            # can be salvaged from the prose the student already watched arrive.
            "? await callModelStream(",
            "makeReplyExtractor((text) => {",
            "streamedReply += text;",
            ": await callModel(messages, true, \"default\")",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)
        # Anthropic streaming still enforces the truncation guard.
        self.assertIn("if (stopReason === \"max_tokens\")", self.chat_fn)

    def test_rate_limiter_folded_into_wave_one(self):
        self.assertNotIn("isChatRateLimited", self.chat_fn)
        for fragment in (
            "recentStudentSends,",
            "context.recentStudentSends >= CHAT_RATE_LIMIT_MAX",
            # Counted in wave 1: student rows only, windowed, capped at max+1.
            "role=eq.student&created_at=gte.",
            "CHAT_RATE_LIMIT_MAX + 1",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat_fn)

    def test_client_streams_and_watchdog(self):
        for fragment in (
            "onDelta?: (text: string) => void;",
            "stream: input.onDelta ? true : undefined,",
            'includes("text/event-stream")',
            # Inactivity watchdog for streams; bigger flat budget for the JSON path
            # (the old generic 30s aborted while the server finished anyway).
            "armWatchdog(input.onDelta ? 60_000 : 120_000);",
            "armWatchdog(60_000);",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.api)
        # Non-SSE responses (controls, replays, refusals, old server) parse as before.
        self.assertIn("if (!isSse || !response.body)", self.api)

    def test_client_paints_deltas_into_thinking_placeholder(self):
        # Round 22g: deltas release SENTENCE BY SENTENCE — each completed sentence is held
        # ~0.15s/word (clamped) before the next lands, so students read one at a time.
        # R33 retuned the pacing (200ms/4s ceiling read as dead air between sentences).
        self.assertIn("const onDelta = (text: string) => {", self.convo)
        self.assertIn("const WORD_MS = 150;", self.convo)
        self.assertIn("const HOLD_MIN_MS = 350;", self.convo)
        self.assertIn("const HOLD_MAX_MS = 2_500;", self.convo)
        self.assertIn("Math.min(HOLD_MAX_MS, Math.max(HOLD_MIN_MS, words * WORD_MS))", self.convo)
        # The settle never jumps ahead of the reading: a mid-pace envelope waits its turn.
        self.assertIn("pendingSettle = settle;", self.convo)
        # The placeholder type carries the streamed text; the transcript renders it.
        self.assertIn('role: "thinking"; text?: string', self.messages)
        self.assertIn("message.text ? (", self.transcript)


if __name__ == "__main__":
    unittest.main()
