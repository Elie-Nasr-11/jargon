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
MILESTONES = (
    REPO / "frontend" / "src" / "components" / "LessonMilestones.tsx"
).read_text()
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




class FlowV3PromptLoosening(unittest.TestCase):
    """Phase 2: the prompt allows real conversation; misses key on routing."""

    def test_shape_rule_split(self):
        self.assertIn("Shape on ATTEMPT turns", CHAT)
        self.assertIn("Shape on CONVERSATION turns", CHAT)

    def test_tangent_budget_replaces_wall(self):
        self.assertIn("Tangents get a budget, not a wall", CHAT)
        self.assertIn('key: "tangent_engage"', CHAT)

    def test_question_carveout(self):
        self.assertIn("when the student asks YOU a question", CHAT)

    def test_open_ended_miss_keys_on_routing(self):
        miss = re.search(r"const openEndedMiss.*?: null;", CHAT, re.S)
        self.assertIsNotNone(miss)
        self.assertIn("routedKind", miss.group(0))


class FlowV3Backtracking(unittest.TestCase):
    """Phase 3: the cursor can move backward — revisit/resume with hard safety rails."""

    def test_navigate_and_resume_controls_parsed(self):
        self.assertIn('controlType === "navigate"', CHAT)
        self.assertIn('controlType === "resume"', CHAT)
        self.assertIn("target_activity_id", CHAT)

    def test_revisit_neutralizes_every_gate(self):
        # A revisited step must never re-grade or re-pass: requirements go all-false…
        self.assertIn("const requirements: StepRequirements = inRevisit", CHAT)
        # …and deterministic grading + record writes are suppressed outright.
        self.assertIn("staleQuizAnswer || inRevisit", CHAT)
        self.assertIn("!staleQuizAnswer && !inRevisit", CHAT)

    def test_revisit_flow_forced_conversational(self):
        # With all-false requirements stepDone is trivially true — the flow override is
        # what stops a revisit of step 2 from completing the whole lesson.
        self.assertIn("const draftFlow = inRevisit", CHAT)
        self.assertIn("const finalFlow = inRevisit", CHAT)
        done_guard = re.search(
            r"activitiesDoneThisTurn =\s*!advancing &&\s*(?://[^\n]*\n\s*)*!inRevisit",
            CHAT,
        )
        self.assertIsNotNone(done_guard)

    def test_advancement_blocked_inside_revisit(self):
        advance_guard = re.search(
            r"finishedCurrentActivity =\s*(?://[^\n]*\n\s*)*!inRevisit &&",
            CHAT,
        )
        self.assertIsNotNone(advance_guard)

    def test_nav_frame_and_steps_done_persisted(self):
        self.assertIn("nav: navFrame", CHAT)
        self.assertIn("...stepsDoneBefore", CHAT)
        # Resume restores the frontier's snapshot, validated by activity_id.
        self.assertIn("paused_step_state", CHAT)

    def test_navigation_on_envelope(self):
        self.assertIn("envelope.navigation", CHAT)

    def test_navigate_back_router_kind(self):
        self.assertIn('"navigate_back"', CHAT)
        self.assertIn('key: "navigate_back_offer"', CHAT)

    def test_revisit_directives_present(self):
        for key in ("revisit_open", "revisit_converse", "resume_recap"):
            self.assertIn(f'key: "{key}"', CHAT)

    def test_arc_carries_done_set(self):
        self.assertIn("steps_done?", CHAT)

    def test_client_stepper_and_resume_wired(self):
        self.assertIn('control: { type: "navigate", target_activity_id:', CHAT_TSX)
        self.assertIn('control: { type: "resume" }', CHAT_TSX)
        self.assertIn("revisitFrontier", CHAT_TSX)
        self.assertIn("onNavigate", MILESTONES)


if __name__ == "__main__":
    unittest.main()
