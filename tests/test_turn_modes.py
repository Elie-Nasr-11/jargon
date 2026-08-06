"""Static invariants for v5.0 P2: student-declared conversation modes.

The load-bearing rules this file pins:
- A declared mode is a property of the MESSAGE, a separate axis from
  lesson_activities.mode (a property of the STEP). P2 does not touch the eight authored
  step types, so nothing in a live curriculum changes behavior.
- Absent or unrecognized mode → today's behavior exactly. An older client, or a typo,
  must never brick a lesson.
- Discuss/Open can NEVER discharge a gate. This is enforced by handing applyTurn a
  routedKind it already refuses to grade (Flow v3 masking), NOT by a second guard —
  so there stays exactly one place gates can be reasoned about.
- The `null` kind must be lifted by the ceiling too: legacy-null lets the stuck cap stamp
  understanding_at, which would let a Discuss turn close a gate.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()


class DeclaredTurnMode(unittest.TestCase):
    def test_mode_vocabulary_is_closed_and_excludes_checkpoints(self):
        # Phase A: exactly three registers; quiz/assignment are teacher posts and "open"
        # folded into discuss (legacy values map tolerantly in studentTurnMode).
        block = CHAT[CHAT.index("const STUDENT_TURN_MODES") :][:400]
        for mode in ("lesson", "practice", "discuss"):
            self.assertIn(f'"{mode}"', block)
        # 'checkpoints' is a view-only surface that never sends a turn — if it ever appears
        # here, something is routing a model call through the work dock.
        self.assertNotIn('"checkpoints"', block)

    def test_unknown_mode_degrades_to_legacy(self):
        fn = CHAT[CHAT.index("function studentTurnMode(") :][:500]
        self.assertIn("STUDENT_TURN_MODES.has(value)", fn)
        self.assertIn("null", fn)
        # Legacy ids from pre-Phase-A clients map instead of bricking.
        self.assertIn('if (value === "open") return "discuss";', fn)
        self.assertIn('if (value === "quiz" || value === "assignment") return "lesson";', fn)

    def test_ceiling_lifts_null_and_attempt_kinds_for_conversation_modes(self):
        fn = CHAT[CHAT.index("function applyModeCeiling(") :]
        fn = fn[: fn.index("\n}")]
        # Phase A: discuss AND practice are capped — neither ever discharges a lesson
        # gate; lesson (and legacy-null) pass the router verdict through.
        self.assertIn('mode !== "discuss" && mode !== "practice"', fn)
        self.assertIn("return kind", fn)
        # The three kinds that could otherwise discharge a gate.
        for kind in ('kind === null', 'kind === "answer_attempt"', 'kind === "continue_signal"'):
            self.assertIn(kind, fn)
        self.assertIn('return "question"', fn)

    def test_control_turns_bypass_the_ceiling(self):
        # Continue / navigate are deliberate button presses, not conversation: a student in
        # Discuss must still be able to press Continue on a content step.
        site = CHAT[CHAT.index("const routedKind: RoutedKind | null =") :][:600]
        self.assertIn("routedKindRaw", site)
        # Phase A: MCQ taps are buttons on server-rendered options — exempt like controls.
        self.assertIn('answer?.mode === "multiple_choice"', site)
        self.assertIn("applyModeCeiling(declaredMode, routedKindRaw)", site)

    def test_ceiling_is_applied_before_the_gates_see_it(self):
        # routedKind must be capped at its single definition site, upstream of every
        # consumer — not re-derived anywhere later.
        self.assertEqual(CHAT.count("applyModeCeiling("), 2)  # definition + one call site

    def test_gate_timestamps_have_exactly_two_writers(self):
        # applyTurn (the turn path) and loadStepState (the documented one-time v2 backfill).
        # A third writer would be a second place a gate could close, defeating the ceiling.
        gates = ("code_passed_at", "quiz_passed_at", "understanding_at", "acknowledged_at")
        assignments = [
            m.start()
            for g in gates
            for m in re.finditer(rf"\b(?:after|seeded)\.{g}\s*=", CHAT)
        ]
        self.assertTrue(assignments)
        apply_start = CHAT.index("function applyTurn(")
        apply_end = CHAT.index("\n}", CHAT.index("return after;", apply_start))
        load_start = CHAT.index("async function loadStepState(")
        load_end = CHAT.index("\nfunction stepDone(", load_start)
        for pos in assignments:
            in_apply = apply_start < pos < apply_end
            in_load = load_start < pos < load_end
            self.assertTrue(
                in_apply or in_load,
                f"gate timestamp written outside applyTurn/loadStepState at offset {pos}",
            )

    def test_step_mode_axis_is_untouched(self):
        # The authored eight-mode constraint is P2-untouched; conflating the two axes is the
        # specific mistake this phase was designed to avoid.
        self.assertIn("const LEARNING_MODES", CHAT)
        self.assertNotIn("student_turn_mode", CHAT)


if __name__ == "__main__":
    unittest.main()


class PhaseAConsolidation(unittest.TestCase):
    """Brain-first Phase A: three modes, Continue-only advancing, mode_offer pills,
    mentor_preferences retired."""

    def test_practice_owns_its_register(self):
        self.assertIn('key: "practice_register",', CHAT)
        self.assertIn("PRACTICE register — nothing here touches the lesson's gates", CHAT)

    def test_typed_readiness_is_the_only_text_door(self):
        # The router-outage fallback acknowledges ONLY readiness-shaped text — ordinary
        # sentences never advance a content step.
        fn = CHAT[CHAT.index("function applyTurn(") :]
        fn = fn[: fn.index("\nfunction ")]
        self.assertIn("CONTINUE_SIGNAL_RE.test(", fn)
        self.assertNotIn("} else {\n        after.acknowledged_at = nowIso;", fn)

    def test_mode_offer_contract_end_to_end(self):
        # Mentor proposes (JSON field), orchestrator validates + gates to beat-closing
        # turns, control accept turn gets its own directive, prose must not duplicate.
        self.assertIn('"mode_offer": null', CHAT)
        # R31e widened the set with "lesson" — the way back from a register that
        # cannot advance. The contract is otherwise unchanged.
        self.assertIn(
            'mode_offer?: { mode: "practice" | "discuss" | "lesson"; topic: string; label: string } | null;',
            CHAT,
        )
        self.assertIn('key: "mode_offer_accept",', CHAT)
        self.assertIn("const beatClosed =", CHAT)
        self.assertIn("envelope.mode_offer = null;", CHAT)
        self.assertIn("PILL carries the action", CHAT)

    def test_mentor_preferences_retired_from_the_prompt(self):
        self.assertNotIn("policy.mentor_mode", CHAT)
        self.assertNotIn("mentor_mode: mentorMode", CHAT.split("policy: {")[1][:600])


if __name__ == "__main__":
    unittest.main()
