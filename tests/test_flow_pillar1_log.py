"""Flow rebuild Pillar 1: the server-written flow event log.

The turn's flow facts (register shift, revisit open/close, checkpoint attach, step
advance) are RECORDED by the chat fn where each is decided, ride the envelope and the
persisted mentor payload, and the transcript renders section boundaries from that
record. Client inference (arc diffs, choices shape) survives only as the fallback for
turns persisted before the log existed.

Why: every flow bug in the 2026-08 test rounds — phantom Discuss sections, a practice
drill announced as CHECKPOINT, section churn — was a client re-DERIVATION of state the
server had already decided and not written down.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT_FN = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "frontend" / "src" / "lib" / "types.ts").read_text(encoding="utf-8")
MESSAGES = (ROOT / "frontend" / "src" / "features" / "student" / "chat" / "chatMessages.ts").read_text(
    encoding="utf-8"
)
TRANSCRIPT = (ROOT / "frontend" / "src" / "student" / "Transcript.tsx").read_text(encoding="utf-8")


class ServerWritesTheLog(unittest.TestCase):
    def test_the_event_vocabulary_is_closed(self):
        # One discriminated union, shared verbatim by server and client mirrors. New
        # kinds are a deliberate schema change, not an ad-hoc string.
        for kind in (
            '{ kind: "mode_changed"; from: string; to: string; cause: "picker" | "pill" }',
            '{ kind: "revisit_opened"; target_activity_id: string; target_title: string }',
            '{ kind: "revisit_resumed"; frontier_activity_id: string }',
            '{ kind: "checkpoint_opened" }',
        ):
            with self.subTest(kind=kind):
                self.assertIn(kind, CHAT_FN)
                self.assertIn(kind, TYPES)
        self.assertIn('kind: "step_advanced";', CHAT_FN)
        self.assertIn('kind: "step_advanced";', TYPES)

    def test_events_are_assembled_where_the_turn_is_decided(self):
        self.assertIn("const flowLog: FlowEvent[] = [];", CHAT_FN)
        self.assertIn("if (flowLog.length) envelope.flow = flowLog;", CHAT_FN)

    def test_a_register_shift_requires_a_persisted_student_turn(self):
        # The phantom-Discuss root cause: a declared mode on a turn that left no student
        # row is NOT a student action. Both the mode_changed event and the mentor stamp
        # key on the same persistence condition as the student-turn insert itself.
        self.assertIn("const studentTurnPersisted = Boolean(answer && content);", CHAT_FN)
        # Anchor on the assembly push (from: the previous register), not the replay
        # normalizer, which also mentions the kind.
        block = CHAT_FN[CHAT_FN.index('from: previousStudentMode ?? "lesson",') - 700:]
        block = block[: block.index("});") + 3]
        self.assertIn("studentTurnPersisted &&", block)
        self.assertIn('declaredMode !== (previousStudentMode ?? "lesson")', block)

    def test_the_cause_names_the_student_action(self):
        # Only two actions change a register: a hand-off pill or the composer picker.
        self.assertIn('cause: controlType === "mode_offer" ? "pill" : "picker",', CHAT_FN)

    def test_checkpoint_opened_is_lesson_register_only(self):
        # R33c server-side: a practice/discuss drill never announces a checkpoint. The
        # register comes from the persisted record, not the raw declared mode.
        self.assertIn(
            '(studentTurnPersisted ? declaredMode : null) ?? previousStudentMode ?? "lesson"',
            CHAT_FN,
        )
        self.assertIn('if (quizFirstAttach && turnRegister === "lesson")', CHAT_FN)
        # And it marks the FIRST attach — the same moment quiz_presented_at stamps.
        self.assertIn(
            'finalFlow.nextAction === "choose" && !finalState.quiz_presented_at;', CHAT_FN
        )

    def test_step_advanced_carries_what_the_divider_needs(self):
        for fragment in (
            'kind: "step_advanced",\n        to_activity_id: advanceToActivityId,',
            "step: nextIndex + 1,",
            "total: context.activities.length,",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, CHAT_FN)

    def test_navigation_actions_are_recorded(self):
        self.assertIn('if (navAction === "revisit") {\n      flowLog.push({\n        kind: "revisit_opened",', CHAT_FN)
        self.assertIn('} else if (navAction === "resume") {\n      flowLog.push({\n        kind: "revisit_resumed",', CHAT_FN)

    def test_replays_keep_the_record(self):
        # A dedup replay of a stored envelope must keep its flow log — same passthrough
        # contract as continue_offer/navigation. Unknown kinds drop; absent stays absent.
        self.assertIn("function flowEventsFrom(value: unknown): FlowEvent[] | undefined {", CHAT_FN)
        self.assertIn("flow: flowEventsFrom(partial.flow),", CHAT_FN)


class ClientRendersTheRecord(unittest.TestCase):
    def test_the_log_survives_reload_and_rides_the_live_message(self):
        self.assertIn(
            "flow: Array.isArray(payload.flow) ? (payload.flow as FlowEvent[]) : undefined,",
            MESSAGES,
        )
        self.assertIn("flow: envelope.flow?.length ? envelope.flow : undefined,", MESSAGES)

    def test_logged_turns_never_infer_boundaries(self):
        # On a flow-bearing turn: checkpoints come from checkpoint_opened, and a bare arc
        # diff can never open a section (the churn source). Legacy turns keep inference.
        self.assertIn('flow.some((e) => e.kind === "checkpoint_opened")', TRANSCRIPT)
        self.assertIn(
            'flow.some((e) => e.kind === "revisit_opened" || e.kind === "revisit_resumed")',
            TRANSCRIPT,
        )
        # The legacy inferences are still present, gated behind the flow check.
        self.assertIn("current.arc.step !== arcStep", TRANSCRIPT)
        self.assertIn('(message.turnMode ?? "lesson") === "lesson" &&', TRANSCRIPT)

    def test_a_recorded_revisit_names_the_jump(self):
        # Before the log a revisit silently re-pointed the step eyebrow backwards — the
        # exact "flow hops around" read. Now the divider says Revisit.
        self.assertIn('e.kind === "revisit_opened") && !opensCheckpoint', TRANSCRIPT)
        self.assertIn("`Revisit · ${stepEyebrowLabel(arc) ?? spec.label}`", TRANSCRIPT)


if __name__ == "__main__":
    unittest.main()
