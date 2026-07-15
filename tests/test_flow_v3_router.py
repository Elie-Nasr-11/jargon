"""Static invariants for Flow v3 Phase 1: the turn router + Continue affordance.

Repo convention: these tests read the TypeScript source of the chat edge function and
assert structural contracts, so a regression that would loosen the gates or silently
drop the router shows up in CI without a Deno toolchain.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()
CHAT_TSX = (REPO / "frontend" / "src" / "routes" / "chat.tsx").read_text()
WORKFLOW = (REPO / ".github" / "workflows" / "deploy-backend.yml").read_text()
MIGRATION = (
    REPO / "supabase" / "migrations" / "20260815000000_flow_v3_session_nav.sql"
).read_text()


class FlowV3RouterInvariants(unittest.TestCase):
    def test_router_exists_with_closed_kind_set(self):
        self.assertIn("async function classifyTurn(", CHAT)
        self.assertIn("function heuristicKind(", CHAT)
        for kind in (
            "answer_attempt",
            "question",
            "continue_signal",
            "tangent",
            "meta",
        ):
            self.assertIn(f'"{kind}"', CHAT)

    def test_apply_turn_carries_routed_kind(self):
        signature = re.search(r"function applyTurn\((.*?)\): StepState", CHAT, re.S)
        self.assertIsNotNone(signature)
        self.assertIn("routedKind", signature.group(1))

    def test_force_ack_cap_is_gone(self):
        # The old attempts<3 force-acknowledge trap must not return: a question-shaped
        # turn on a content step never silently advances anymore.
        self.assertNotIn("before.attempts < 3", CHAT)

    def test_acknowledge_requires_continue_signal_when_routed(self):
        self.assertIn('routedKind === "continue_signal"', CHAT)
        # Masking: routed non-attempts never set understanding.
        self.assertIn('routedKind === null || routedKind === "answer_attempt"', CHAT)

    def test_continue_offer_in_envelope(self):
        self.assertIn("continue_offer?:", CHAT)
        self.assertIn("envelope.continue_offer", CHAT)
        self.assertIn("turn_kind", CHAT)

    def test_control_turn_parsed(self):
        self.assertIn("body.control", CHAT)
        self.assertIn('controlType === "continue"', CHAT)

    def test_new_directives_present(self):
        for key in ("question_answer", "content_discuss", "content_nudge", "meta_reply"):
            self.assertIn(f'key: "{key}"', CHAT)

    def test_router_runs_parallel_with_graders(self):
        # The router must live inside the same Promise.all as the graders (zero serial
        # latency), not as its own awaited call.
        batch = re.search(
            r"const \[gradedUnderstanding, gradedCode, routerResult\] = await Promise\.all",
            CHAT,
        )
        self.assertIsNotNone(batch)

    def test_client_continue_pill_wired(self):
        self.assertIn("continueOffer", CHAT_TSX)
        self.assertIn('control: { type: "continue" }', CHAT_TSX)

    def test_migration_whitelisted_and_additive(self):
        self.assertIn("20260815000000_flow_v3_session_nav.sql", WORKFLOW)
        for column in ("steps_done", "preempted", "nav"):
            self.assertIn(column, MIGRATION)
        self.assertIn("add column if not exists", MIGRATION)


if __name__ == "__main__":
    unittest.main()
