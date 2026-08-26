"""R65 — the recurring "Something went wrong on our side" bubble, finally traceable.

Live (2026-08-26, owner's log paste): every send in a lesson died in a loop —
auth 200 → learning_sessions select 200 → POST runtime_events 403 (42501, RLS) →
the student-safe bubble. Two stacked faults, one mask:

1. The client re-sends a pinned session_id the account cannot see under RLS
   (deleted row, another account's cached session, or a cross-lesson pairing).
   loadOrCreateSession treated the confirmed-empty read as FATAL, so every
   "Try again" replayed the identical failure forever.
2. The R32 setup-failure recorder — the thing built to make exactly this
   diagnosable — inserted its evidence with user_id NULL under the caller's
   JWT, and the runtime_events insert policy (user_id = auth.uid() or staff)
   rejected it. Every setup failure since R32 left a 403 where its reason
   should have been.

The student-safe error text deliberately masks every internal failure with one
bubble, which is why each recurrence of "the old error" was in fact a different
bug wearing the same face.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")


class StaleSessionSelfHealTests(unittest.TestCase):
    def test_a_stale_pointer_never_throws(self):
        # The fatal branch is gone outright — a confirmed-empty resume read falls
        # through to latest-or-create instead of bricking the lesson.
        self.assertNotIn("Learning session was not found.", CHAT)
        block = CHAT.split("async function loadOrCreateSession(", 1)[1]
        block = block[: block.index("\n}")]
        self.assertIn("if (session) return session;", block)
        self.assertIn("order=updated_at.desc&limit=1", block)
        # Fresh-open semantics unchanged: no session_id still creates a session.
        self.assertIn('stage: "intro"', block)

    def test_self_heal_is_scoped_to_confirmed_empty_reads(self):
        # A transport failure must still throw (loadFirst only returns null on an
        # empty 200) — self-healing may never mask a real outage.
        self.assertIn("never an outage", CHAT)

    def test_the_heal_is_recorded_so_recurrence_is_visible(self):
        self.assertIn('reason: "stale_session_pointer"', CHAT)
        self.assertIn("requested_session_id: sessionId", CHAT)


class TelemetryCarriesIdentityTests(unittest.TestCase):
    """The fix is IDENTITY, not privilege: chat still never holds the service key
    (the P8 posture pinned in test_artifact_live/test_memory_v1) — telemetry rows
    satisfy the runtime_events insert policy by carrying the authed user id."""

    def test_the_posture_is_intact_and_documented(self):
        self.assertNotIn("SERVICE_ROLE", CHAT)
        self.assertIn("The fix is IDENTITY, not privilege", CHAT)

    def test_the_setup_recorder_carries_the_authed_identity(self):
        # user_id null was exactly what the RLS policy rejected; post-auth setup
        # failures now record who hit them.
        self.assertIn("let authedUserId: string | null = null;", CHAT)
        self.assertIn("userId: authedUserId,", CHAT)
        setup_block = CHAT.split('payload: { reason: "setup_failed"', 1)[0][-800:]
        self.assertNotIn("userId: null", setup_block)

    def test_no_recorder_call_passes_a_null_identity(self):
        # Every runtime-event call site sends a resolved id (or authedUserId) — a
        # null user_id is an insert the policy will reject, i.e. silent telemetry.
        self.assertNotIn("userId: null", CHAT)


if __name__ == "__main__":
    unittest.main()
