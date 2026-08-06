"""Static invariants for Flow v3 Phase 1: the turn router + Continue affordance.

Repo convention: these tests read the TypeScript source of the chat edge function and
assert structural contracts, so a regression that would loosen the gates or silently
drop the router shows up in CI without a Deno toolchain.

Trimmed 2026-07-30 (trunk unification), then RE-ANCHORED later the same day (B1): the
v6 /learn surface sends control turns again — useConversation posts continue /
navigate / resume controls, the Transcript renders the Continue pill live-only on the
latest mentor message, and ChatWindow offers the revisit-return chip while the server
holds a revisit frame open. All server-side invariants are unchanged and stay pinned.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()
CHAT_MESSAGES = (
    REPO / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts"
).read_text()
WORKFLOW = (REPO / ".github" / "workflows" / "deploy-backend.yml").read_text()
MIGRATION = (
    REPO / "supabase" / "migrations" / "20260815000000_flow_v3_session_nav.sql"
).read_text()


class FlowV3RouterInvariants(unittest.TestCase):
    def test_router_exists_with_closed_kind_set(self):
        # Phase E: the router lives inside the merged assessTurn (one call classifies AND
        # grades); heuristicKind remains the outage fallback.
        self.assertIn("async function assessTurn(", CHAT)
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
        # Phase E: classification+grading are ONE call (assessTurn), batched with the code
        # judge and the student-turn insert — zero serial pre-mentor latency.
        batch = re.search(
            r"const \[assessed, gradedCode\] = await Promise\.all",
            CHAT,
        )
        self.assertIsNotNone(batch)
        self.assertIn("routerEligible || isTextExplanation", CHAT)

    def test_client_model_carries_the_continue_offer(self):
        # The shared transcript model (consumed by the v6 surface) maps
        # envelope.continue_offer, so the rendering surface gets the data path for free.
        self.assertIn("continueOffer", CHAT_MESSAGES)
        self.assertIn("continue_offer", CHAT_MESSAGES)

    def test_v6_surface_sends_control_turns(self):
        # Re-anchored (B1): the v6 hook posts the three structured controls the server
        # parses — continue (content-step acknowledge), navigate (revisit a completed
        # step), resume (return to the frontier).
        hook = (REPO / "frontend" / "src" / "student" / "useConversation.ts").read_text()
        for fragment in (
            'control: { type: "continue" }',
            'control: { type: "navigate", target_activity_id: targetActivityId }',
            'control: { type: "resume" }',
        ):
            self.assertIn(fragment, hook)
        # A failed control turn retries WITH its control — a failed navigate must retry as
        # navigation, not degrade into a bare text turn.
        self.assertIn("retryControl: options?.control", hook)

    def test_no_continue_button_is_rendered(self):
        # R31b (owner): "Remove continue. Always have advancement engaging." The button is
        # GONE — advancing is a conversational beat, so the surface must render no pill for
        # continue_offer at all. The envelope field survives (turn loop + replay unchanged).
        transcript = (REPO / "frontend" / "src" / "student" / "Transcript.tsx").read_text()
        self.assertNotIn("channel.sendContinue", transcript)
        self.assertNotIn("message.continueOffer.label", transcript)
        self.assertNotIn('"Continue"', transcript)
        # And the mentor is told plainly that no button exists, so it cannot point at one.
        self.assertIn("THERE IS NO CONTINUE BUTTON", CHAT)
        # R31e reflowed this rule onto one line when the blanket "no button of any
        # kind" claim was replaced (the hand-off pill IS a button). Same guarantee.
        self.assertIn("The student moves forward BY REPLYING TO YOU.", CHAT)

    def test_revisit_frame_offers_the_return_chip(self):
        window = (REPO / "frontend" / "src" / "student" / "ChatWindow.tsx").read_text()
        self.assertIn("return to where you were", window)
        self.assertIn("channel.sendResume", window)

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

    # removed 2026-07-30: test_client_stepper_and_resume_wired — the /chat stepper
    # (LessonMilestones) and its navigate/resume control turns retired with the old
    # surface; the v6 /learn surface has not reconnected them (see module docstring).


class FlowV3Preemption(unittest.TestCase):
    """Phase 4: latest-message-only grading + pre-emption notes (credit, never skip)."""

    def test_grader_scopes_to_latest_message(self):
        # The stale-credit fix: the gate reflects what the student can produce NOW.
        self.assertIn("LATEST message", CHAT)
        self.assertIn("NEVER evidence", CHAT)

    def test_grader_receives_upcoming_objectives(self):
        self.assertIn("const upcomingSteps", CHAT)
        self.assertIn("pre-emption detection ONLY", CHAT)

    def test_preempted_parse_is_typed_and_tolerant(self):
        self.assertIn("type PreemptedHit", CHAT)
        self.assertIn('"preempted"', CHAT)

    def test_preempted_notes_never_gate(self):
        # Notes are keyed by activity id and consumed only by the directive and the
        # step_contract — the gate machinery (whole function bodies, not just the
        # signatures) must never see them.
        self.assertIn("const preemptedHits", CHAT)
        apply_turn = re.search(r"function applyTurn\(.*?\n\}", CHAT, re.S)
        self.assertIsNotNone(apply_turn)
        self.assertNotIn("preempted", apply_turn.group(0))
        requirements_fn = re.search(
            r"function requirementsFor\(.*?\n\}", CHAT, re.S
        )
        self.assertIsNotNone(requirements_fn)
        self.assertNotIn("preempted", requirements_fn.group(0))

    def test_compressed_delivery_directive(self):
        self.assertIn('key: "present_step_preempted"', CHAT)
        self.assertIn("preempted_note", CHAT)

    def test_preempted_merged_never_replaced(self):
        merge = re.search(r"preempted: \{\s*\.\.\.preemptedBefore", CHAT)
        self.assertIsNotNone(merge)


if __name__ == "__main__":
    unittest.main()
