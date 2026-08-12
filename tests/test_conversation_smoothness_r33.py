from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONVO = ROOT / "frontend" / "src" / "student" / "useConversation.ts"
TRANSCRIPT = ROOT / "frontend" / "src" / "student" / "Transcript.tsx"
WINDOW = ROOT / "frontend" / "src" / "student" / "ChatWindow.tsx"
CHATBOX = ROOT / "frontend" / "src" / "student" / "Chatbox.tsx"
MESSAGES = ROOT / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts"
STYLES = ROOT / "frontend" / "src" / "styles.css"
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"


class SendLockHoldsUntilSettle(unittest.TestCase):
    """R33: the turn lock releases at SETTLE, not at envelope arrival. Releasing it while
    the reply was still pacing out let a second send scramble the transcript, re-enable
    retired quiz choices, and fork a duplicate session on a first turn."""

    @classmethod
    def setUpClass(cls):
        cls.convo = CONVO.read_text(encoding="utf-8")

    def test_lock_lifecycle(self):
        for fragment in (
            "const releaseSendLock = () => {",
            "if (!lockOwned) return;",
            # settle() itself releases the lock — no `finally` racing ahead of the pacer.
            "releaseSendLock();\n          };",
            # The in-flight registration resolves at lock release so busy-callers who
            # await it (artifact ready post) can actually retry successfully.
            "inFlightTurnRef.current = work.then((envelope) => lockDone.then(() => envelope));",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.convo)

    def test_session_pointer_lands_before_settle(self):
        # The first turn's session id must be readable the moment it exists, or a send
        # racing the pacer creates a SECOND learning session.
        self.assertIn(
            "if (!turnCancelled && envelope.session_id) setSession(envelope.session_id);",
            self.convo,
        )

    def test_lesson_switch_kills_the_pacer(self):
        for fragment in (
            "const pacerCleanupRef = useRef<(() => void) | null>(null);",
            "pacerCleanupRef.current?.();",
            "turnCancelled = true;",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.convo)

    def test_only_trailing_error_bubbles_are_dropped(self):
        # Errors deeper in the scrollback are history — a resend must not erase them.
        self.assertIn('if (!last || last.role !== "bot" || !last.isError) break;', self.convo)

    def test_stream_failure_keeps_the_partial_reply(self):
        # Prose the student already watched arrive stays in the error bubble instead of
        # vanishing, and retry re-sends in the register the turn was originally sent in.
        self.assertIn("const partial = streamedText.trim();", self.convo)
        self.assertIn("text: partial ? `${partial}\\n\\n${message}` : message,", self.convo)
        self.assertIn("retryMode: mode,", self.convo)


class StreamRendering(unittest.TestCase):
    """Raw inline markers must never stream as visible text, and the settle swap must not
    re-animate a reply the student already watched arrive."""

    @classmethod
    def setUpClass(cls):
        cls.transcript = TRANSCRIPT.read_text(encoding="utf-8")
        cls.messages = MESSAGES.read_text(encoding="utf-8")
        cls.styles = STYLES.read_text(encoding="utf-8")

    def test_streaming_body_strips_markers(self):
        for fragment in (
            ".replace(MATERIAL_MARKER_RE, \"\")",
            ".replace(FIGURE_MARKER_RE, \"\")",
            ".replace(ACTION_MARKER_RE, (_all, _mode, label: string) => label)",
            # A still-forming marker at the stream's edge is held back too.
            '.replace(/\\[\\[[a-z]*(?::[^\\]]*)?$/i, "")',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.transcript)

    def test_settle_swap_does_not_reanimate(self):
        self.assertIn("animate={isNew && !message.streamed}", self.transcript)
        self.assertIn("streamed?: boolean;", self.messages)

    def test_thinking_line_breathes(self):
        self.assertIn("thinking-pulse", self.transcript)
        self.assertIn("@keyframes thinking-pulse", self.styles)
        # Reduced motion opts out of the pulse like every other animation.
        self.assertIn(".thinking-pulse {\n    animation: none;", self.styles)

    def test_paced_sentences_keep_the_word_fade(self):
        convo = CONVO.read_text(encoding="utf-8")
        # The behind-the-model snapshot cuts BEFORE the boundary whitespace so the
        # sentence just released still renders as the animated tail, not a settled block.
        self.assertIn(
            "streamedText.slice(0, b[revealedCount - 1] ? b[revealedCount - 1].at : 0)",
            convo,
        )


class ComposerAndScroll(unittest.TestCase):
    """The composer stays typeable during a turn (busy only gates Send/Run), autoscroll
    stops fighting the stream, and a scrolled-up student has a way back."""

    @classmethod
    def setUpClass(cls):
        cls.window = WINDOW.read_text(encoding="utf-8")
        cls.chatbox = CHATBOX.read_text(encoding="utf-8")

    def test_busy_gates_send_not_typing(self):
        self.assertIn("busy?: boolean;", self.chatbox)
        self.assertIn("!disabled && !busy && !uploading", self.chatbox)
        self.assertIn('code.trim().length > 0 && !disabled && !busy', self.chatbox)
        # The window passes the split: hold = hard lock, in-flight turn = busy.
        self.assertIn("disabled={held}", self.window)
        self.assertIn("busy={sending}", self.window)

    def test_streaming_scroll_is_instant(self):
        # Restarting a smooth scroll ~12x/second made the view crawl behind the text.
        self.assertIn("const sameMessage = keyId === lastKeyIdRef.current;", self.window)
        self.assertIn(
            'behavior: first || sameMessage || prefersReducedMotion() ? "auto" : "smooth"',
            self.window,
        )

    def test_jump_to_latest_exists(self):
        self.assertIn("Jump to latest", self.window)
        self.assertIn("setScrolledUp", self.window)


class OffersSurviveTheSession(unittest.TestCase):
    """The Resources pill reports the accumulated tray, not just the latest turn, and a
    reloaded session re-seeds its materials from the restored transcript."""

    @classmethod
    def setUpClass(cls):
        cls.convo = CONVO.read_text(encoding="utf-8")

    def test_resources_offer_is_sticky(self):
        self.assertIn("resources: next.resources || current.resources", self.convo)

    def test_reload_reseeds_resources(self):
        for fragment in (
            "const restoredResources: LessonChatResource[] = [];",
            "setResources(restoredResources);",
            "setOffers((current) => ({ ...current, resources: true }));",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.convo)


class MentorPromptDataHooks(unittest.TestCase):
    """Anti-repetition rules are only followable with data in view: the mentor sees all
    its recent questions (not just the last fragment) and how its last replies began."""

    @classmethod
    def setUpClass(cls):
        cls.chat = CHAT_FN.read_text(encoding="utf-8")

    def test_openers_ride_the_payload(self):
        self.assertIn("function mentorOpenersFromTurns", self.chat)
        self.assertIn("recent_openers: mentorOpenersFromTurns(context.recentTurns)", self.chat)
        self.assertIn("student.recent_openers shows how your last replies began", self.chat)

    def test_questions_window_widened(self):
        # All question sentences per turn (up to 2) across 6 turns, capped at 8 — a
        # repeated exercise shape posed mid-reply used to be invisible.
        self.assertIn("if (mentorTurns > 6) break;", self.chat)
        self.assertIn("if (out.length >= 8) return out;", self.chat)

    def test_grader_sees_the_mentor_last_question_in_full(self):
        # The NAMED-CRITERION rule keys off the mentor's most recent question; the 200-char
        # history slices routinely truncated it.
        self.assertIn("const lastMentorTurn = recentTurns.find", self.chat)
        self.assertIn("Mentor's most recent message in full", self.chat)

    def test_explanation_pending_escalates(self):
        # The flat re-ask: byte-identical coaching on attempt 1 and attempt 4 is gone.
        self.assertIn("const escalation =", self.chat)
        self.assertIn("draftState.attempts >= 2", self.chat)

    def test_reply_first_is_stated_not_implied(self):
        # The streaming extractor hard-depends on `reply` being the first key; the
        # contract now says so instead of relying on example ordering.
        self.assertIn('The FIRST key must be "reply"', self.chat)
        self.assertIn('The first key of the object MUST be "reply"', self.chat)

    def test_brain_points_at_the_real_payload_key(self):
        self.assertIn('- BRAIN: "brain" (when present)', self.chat)
        self.assertNotIn("turn.brain", self.chat)


class MentorTurnCacheShape(unittest.TestCase):
    """The mentor payload ships as stable + live text blocks so the Anthropic prompt
    cache actually hits; the OpenAI path strips the cache marker it cannot parse."""

    @classmethod
    def setUpClass(cls):
        cls.chat = CHAT_FN.read_text(encoding="utf-8")

    def test_payload_is_partitioned(self):
        for fragment in (
            "const MENTOR_STABLE_PAYLOAD_KEYS = new Set([",
            "function mentorUserContent(payload: DbRow): DbRow[] {",
            "content: mentorUserContent({",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.chat)

    def test_openai_path_sanitizes_cache_markers(self):
        self.assertIn("function sanitizeForOpenAI", self.chat)
        self.assertIn("messages: sanitizeForOpenAI(messages)", self.chat)

    def test_attachments_append_to_existing_blocks(self):
        # The payload already rides as text blocks — attachments must append, never
        # replace the authoritative payload.
        self.assertIn("const existing = Array.isArray(msgs[1].content)", self.chat)

    def test_streamed_reply_salvage(self):
        # A malformed final JSON no longer eats prose the student already read.
        self.assertIn("mentor_json_salvaged_from_stream", self.chat)
        self.assertIn('parsed = { reply: streamedReply.trim() };', self.chat)


if __name__ == "__main__":
    unittest.main()
