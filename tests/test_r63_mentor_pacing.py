"""R63 — mentor-steered pacing: simple spoken language must move the lesson.

Owner (2026-08-26), after reviewing Elissar's live session (689bd990): three
explicit skip requests and a shouted YESYES never discharged a pacing gate, while
the mentor verbally agreed and asked another question each time. Root cause: gate
movement keyed on a classifier whose entire "wants to move on" vocabulary was
three polite words, and whose taxonomy filed frustration under meta.

The fix, direction B of the brainstorm: THE MODEL DECIDES WHAT THE STUDENT MEANT;
THE MACHINE ONLY DECIDES WHAT THE RULES ALLOW. The mentor returns a structured
movement decision from full conversational context; the state machine executes it
on pacing gates (acknowledge/understanding) and refuses OUT LOUD on integrity
gates (quiz/code/linked work). Widened recognizers remain as the router-outage
fallback; repeated skips flip the session brisk.

Behavioral truth lives in tests/flow_core.test.ts (the deno harness RUNS the four
verbatim Elissar messages through the real functions). These pins hold the source
contract still.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
FLOW_TESTS = (ROOT / "tests" / "flow_core.test.ts").read_text(encoding="utf-8")

ELISSAR_FIXTURES = [
    "no can we move on now",
    "I said move on I dont want to name anything now. next part od the lesson",
    "gooooo next fast",
    "YESYESYEYSEYSYYSYSYSYSS",
]


class RouterTaxonomyTests(unittest.TestCase):
    def test_continue_signal_owns_the_impatient_register(self):
        self.assertIn("in ANY register", CHAT)
        self.assertIn("both complains ", CHAT)
        self.assertIn("and demands forward motion is continue_signal, not meta", CHAT)

    def test_frustration_alone_stays_meta_but_never_a_movement_demand(self):
        self.assertIn("frustration WITHOUT a demand to move on", CHAT)


class SkipRecognizerTests(unittest.TestCase):
    def test_the_recognizer_exists_and_is_fallback_only_by_design(self):
        self.assertIn("export function isSkipRequest(", CHAT)
        self.assertIn("impatience doesn't look like", CHAT.lower())

    def test_refusal_and_question_vetoes_are_present(self):
        # "no I don't want to move on" and "what comes next" must never advance.
        self.assertIn("SKIP_NEGATION_RE", CHAT)
        self.assertIn("SKIP_INTERROGATIVE_RE", CHAT)

    def test_the_elissar_fixtures_are_permanent(self):
        for fixture in ELISSAR_FIXTURES:
            with self.subTest(fixture=fixture):
                self.assertIn(fixture, FLOW_TESTS)
        self.assertIn("her session happens again", FLOW_TESTS)


class MentorMovementTests(unittest.TestCase):
    def test_the_output_contract_carries_movement(self):
        self.assertIn('"movement": null', CHAT)
        self.assertIn("MOVES THE LESSON THIS TURN", CHAT)
        # The gaslighting shape is banned by name: agree then ask again.
        self.assertIn("never\nagree to move and then ask another question", CHAT.replace("\r", ""))

    def test_movement_is_pacing_only(self):
        self.assertIn("mentorMovement: \"advance\" | null = null", CHAT)
        self.assertIn("movement can never skip graded work", CHAT)
        # Discharges: acknowledge + understanding; the integrity gates keep their
        # exclusive doors (code run, quiz pass, work submission).
        self.assertIn('routedKind === "continue_signal" || mentorMovement === "advance"', CHAT)

    def test_movement_respects_the_register_ceiling_and_revisits(self):
        self.assertIn('applyModeCeiling(declaredMode, "continue_signal") === "continue_signal"', CHAT)
        self.assertIn("parsed.movement === \"advance\" &&\n      !inRevisit", CHAT)

    def test_movement_persists_for_audit_and_pace(self):
        self.assertIn('movement: partial.movement === "advance" ? "advance" : undefined', CHAT)


class SpokenRefusalTests(unittest.TestCase):
    def test_integrity_gates_refuse_out_loud(self):
        # Silence is what read as gaslighting: agree in words, refuse in behavior.
        self.assertIn("an integrity gate refuses OUT LOUD", CHAT)
        self.assertIn("can't be skipped", CHAT)

    def test_skip_shaped_concludes_drop_the_ritual_question(self):
        self.assertIn("they already said go", CHAT)
        self.assertIn("no new question", CHAT)


class PaceMemoryTests(unittest.TestCase):
    def test_brisk_pace_exists_and_is_windowed(self):
        self.assertIn("export function briskPace(", CHAT)
        self.assertIn("signals >= 2", CHAT)

    def test_brisk_directives_compress_the_ritual(self):
        self.assertIn("repeatedly asked to move faster", CHAT)
        self.assertIn("no questions-window", CHAT)


class NarrativeAlignmentTests(unittest.TestCase):
    def test_whats_next_is_bound_to_the_real_arc(self):
        # Elissar was promised "processing" while the actual next step was
        # "Naming the purpose" — the arc titles are now the only source of truth.
        self.assertIn("WHAT'S NEXT", CHAT)
        self.assertIn("never guess, reorder, or promise a topic the arc doesn't show next", CHAT)


if __name__ == "__main__":
    unittest.main()
