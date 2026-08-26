"""R64 — the context-first architecture, all three slices.

Owner (2026-08-26): "I don't want to create just a list of things to watch out
for. We should create a system that understands the flow of the conversation and
can adapt to it… since it's an API, we have to find a smart way to give context
in the conversation as well as keep context up to date with the flow of the
lesson."

The target: one brain per turn, fully briefed — the machine is a ledger and a
validator, never an interpreter.

SLICE 1 — the mentor's own turn classification ("student_action", judged with
the full conversation in view) is authoritative for the persisted state fold;
the cheap heuristic draft only shapes the pre-model machinery and covers the
omitted-field fallback. turn_kind persists what actually drove the fold.

SLICE 2 — the mentor maintains the session's running summary ITSELF
("flow_summary", a full rewrite each turn), so promises made and unresolved
asks survive past the verbatim window; the old cheap-model summarizer stays as
the dormant fallback.

SLICE 3 — the world brief: a `flow` payload key (absorbing step_contract)
carries the mechanical truth of the turn, the conversational directive ladder
dissolves into standing SYSTEM-prompt rules + flow.room facts, and the
pre-model classify task is deleted (assessTurn is grade-only, called only when
a hard understanding gate needs a verdict).

Behavioral truth lives in tests/flow_core.test.ts (kept-rung witnesses, the
dissolved-shapes-fall-to-brief net, fuzz). These pins hold the source contract
still.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")


class MentorClassificationTests(unittest.TestCase):
    def test_the_contract_explains_why_the_mentor_classifies(self):
        self.assertIn('"student_action"', CHAT)
        self.assertIn("because you read the whole\nconversation and a keyword list does not", CHAT)

    def test_the_mentor_verdict_is_authoritative_with_heuristic_fallback(self):
        self.assertIn("const foldKind: RoutedKind | null = mentorAction ?? routedKind;", CHAT)
        # The persisted fold consumes foldKind, not the draft kind.
        fold_site = CHAT.split("const foldKind", 1)[1][:1400]
        self.assertIn("foldKind,\n      mentorMovement,", fold_site)

    def test_the_same_guards_as_the_draft_path_apply(self):
        # Control turns carry no student message; code/MCQ are answer_attempt by
        # construction; the register ceiling still caps discharges.
        site = CHAT.split("const mentorActionRaw", 1)[1][:900]
        self.assertIn('answer.mode === "code" || answer.mode === "multiple_choice"', site)
        self.assertIn('"answer_attempt"', site)
        self.assertIn("applyModeCeiling(declaredMode, mentorActionRaw)", site)

    def test_the_fold_that_happened_is_what_persists(self):
        # turn_kind records what DROVE the fold (the mentor's ceilinged verdict, or
        # the draft when omitted); student_action rides beside it RAW, so a
        # register-ceilinged claim stays auditable from one stored row.
        self.assertIn("envelope.turn_kind = foldKind ?? undefined", CHAT)
        self.assertIn("ROUTED_KINDS.has(partial.student_action)", CHAT)

    def test_the_draft_fold_stays_heuristic_driven_for_the_machinery(self):
        # Pre-model machinery (kept rungs, the world brief) deliberately still
        # consumes the draft routedKind.
        draft_site = CHAT.split("const draftState = applyTurn(", 1)[1][:400]
        self.assertIn("routedKind,", draft_site)

    def test_the_classify_task_is_deleted(self):
        self.assertNotIn("TASK 1 — CLASSIFY", CHAT)
        self.assertIn("You grade ONE student message", CHAT)
        # The heuristic is the ONLY pre-model kind source for free text.
        self.assertIn("? heuristicKind(content).kind", CHAT)
        self.assertNotIn("routerResult", CHAT)
        # router_disagreement telemetry retired with the router (type/passthrough
        # stay for stored-payload replays).
        self.assertNotIn("const routerDisagreement", CHAT)
        self.assertNotIn("envelope.router_disagreement = true", CHAT)


class FlowSummaryTests(unittest.TestCase):
    """Slice 2: the living, mentor-maintained conversation summary."""

    def test_the_output_contract_demands_a_fresh_rewrite_each_turn(self):
        self.assertIn('"flow_summary": ""', CHAT)
        self.assertIn('Set "flow_summary" EVERY turn', CHAT)
        # Replacement, never a delta — and the loop is closed: what the mentor
        # writes is what it reads back as conversation_so_far.
        self.assertIn('It fully REPLACES "conversation_so_far"', CHAT)
        self.assertIn("any PROMISE you made", CHAT)
        self.assertIn("any UNRESOLVED ask", CHAT)

    def test_the_summary_is_sanitized_and_clamped(self):
        self.assertIn("const mentorFlowSummary =", CHAT)
        self.assertIn('parsed.flow_summary.replace(/\\s+/g, " ").trim().slice(0, 1200)', CHAT)

    def test_the_store_keeps_the_fallback_dormant(self):
        self.assertIn("async function storeMentorFlowSummary(", CHAT)
        block = CHAT.split("async function storeMentorFlowSummary(", 1)[1][:900]
        # summarized_turns tracks the TRUE student-turn count, so the cheap-model
        # fallback's early-exit stays satisfied while the mentor does this job.
        self.assertIn("summarized_turns: studentRows.length", block)
        self.assertIn("running_summary: summary", block)

    def test_scheduling_prefers_the_mentor_and_falls_back(self):
        self.assertIn(
            "mentorFlowSummary\n          ? storeMentorFlowSummary(config, sessionId, mentorFlowSummary)\n          : refreshRunningSummary(config, userId, sessionId, lessonId)",
            CHAT,
        )


class WorldBriefTests(unittest.TestCase):
    """Slice 3: the `flow` payload key + the dissolved ladder."""

    def test_flow_absorbs_step_contract_and_rides_before_the_directive(self):
        self.assertNotIn("step_contract:", CHAT)
        flow_site = CHAT.index("flow: {\n            step: {")
        directive_site = CHAT.index("directive: directive.text,")
        self.assertLess(flow_site, directive_site)
        for field in (
            "presented:", "owed: flowOwed", "requirements: {", "attempts: draftState.attempts",
            "quiz_presented:", "quiz_active:", "preempted_note:",
            'pace: paceBrisk ? "brisk" : "calm"', "register: declaredMode", "room: flowRoom",
        ):
            with self.subTest(field=field):
                self.assertIn(field, CHAT)

    def test_owed_names_integrity_before_pacing(self):
        owed = CHAT.split("const flowOwed =", 1)[1][:900]
        for phrase in ("a submission", "a code run", "a quiz tap", "their own words", "an acknowledgement", '"nothing"'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, owed)
        self.assertLess(owed.index("a code run"), owed.index("their own words"))

    def test_the_prompt_teaches_the_brief_and_the_empty_directive(self):
        self.assertIn('"flow" is the orchestrator\'s mechanical', CHAT)
        self.assertIn('"directive" is an event instruction: usually EMPTY', CHAT)
        self.assertIn("YOU decide what\nthe student's message means", CHAT)

    def test_the_standing_rule_blocks_exist(self):
        for block in (
            "STEP TYPES — flow.step.type says what kind of step you are on",
            "CONVERSATION FLOW — how a step breathes between its gates",
            "CLOSING A STEP:",
        ):
            with self.subTest(block=block):
                self.assertIn(block, CHAT)

    def test_the_brief_default_presents_unshown_steps(self):
        self.assertIn(
            'directive.key === "present_step" ||\n      (directive.key === "brief" && !presentedBefore)',
            CHAT,
        )
        self.assertIn("when flow.presented is false and no directive event says otherwise, THIS reply presents", CHAT)

    def test_closing_a_step_triggers_on_owed_nothing(self):
        self.assertIn('when flow.owed reads "nothing" on a presented step', CHAT)
        # The skip-shaped exception survives R63 verbatim in spirit: one line, no
        # new question, never re-asking "Shall we continue?" at someone who said go.
        self.assertIn("SKIP EXCEPTION", CHAT)

    def test_revisits_present_a_quiet_brief(self):
        # Revisit turns hand the mentor nothing-owed and no room facts — the revisit
        # directives are authoritative there, and CLOSING A STEP explicitly stands
        # down ("A revisit never ends anything").
        self.assertIn("const flowOwed = inRevisit\n      ? \"nothing\"", CHAT)
        self.assertIn("if (!inRevisit) {", CHAT)
        self.assertIn("A\nrevisit never ends anything.", CHAT)

    def test_pace_rides_the_brief_not_directive_mutations(self):
        self.assertIn("const paceBrisk = briskPace(context.recentTurns);", CHAT)
        self.assertIn('flow.pace reads "brisk"', CHAT)
        self.assertNotIn("PACE: this student has repeatedly asked to move faster — be brisk.", CHAT)


if __name__ == "__main__":
    unittest.main()
