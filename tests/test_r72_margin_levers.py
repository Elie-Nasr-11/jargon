"""R72 — the margin levers: auto-tier routing and the context diet.

The Opus 5 pricing benchmark (DECISIONS, 2026-08-27) settled that routing is not
an optimization but a precondition of the price sheet: Opus on literally every
turn costs $195-391 per student-year to serve, so a defensible 2x quote exceeds
a school's entire textbook budget for 6-8 subjects. These two levers are what
make benchmark-quality teaching sellable — worth ~34-42% and ~22% respectively.

The law, pinned here:
- BOTH levers are env-flagged and DEFAULT OFF. With TUTOR_AUTOTIER and
  TUTOR_CONTEXT_DIET unset the function behaves exactly as it did before, so
  this ships dark and is A/B'd on our own accounts first.
- Auto-tiering is one-directional. A turn goes cheap only when every condition
  says the machine already decided it (a quiz tap it graded, a control press, a
  bare move-on). Teaching, grading prose, revisits, help requests and anything
  unrecognised stay on the benchmark. Being wrong toward the benchmark costs
  money; being wrong toward the cheap lane costs a student their lesson.
- The context diet only tapers turns the LIVING SUMMARY covers: it engages only
  when a running summary exists, and never touches the most recent six turns,
  because immediate continuity is exactly what R30 widened the window to fix.

The routing behavior itself is pinned executably in tests/flow_core.test.ts
("R72: only machine-decided turns take the cheap lane"), which runs the real
exported function; these pins hold the wiring and the defaults.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
FLOW = (ROOT / "tests" / "flow_core.test.ts").read_text(encoding="utf-8")


class DefaultOffTests(unittest.TestCase):
    def test_both_levers_default_off(self):
        self.assertIn('envText("TUTOR_AUTOTIER", "off").toLowerCase() === "on"', CHAT)
        self.assertIn('envText("TUTOR_CONTEXT_DIET", "off").toLowerCase() === "on"', CHAT)

    def test_the_mentor_lane_is_the_benchmark_when_the_flag_is_off(self):
        block = CHAT.split("const mentorRoute: ModelRoute =", 1)[1][:600]
        self.assertIn("autoTierEnabled()", block)
        self.assertIn(': "default"', block)


class AutoTierWiringTests(unittest.TestCase):
    def test_the_cheap_lane_is_a_real_route_with_its_own_model(self):
        self.assertIn('type ModelRoute = "default" | "understanding" | "mechanical";', CHAT)
        self.assertIn('mechanical: "claude-haiku-4-5",', CHAT)
        self.assertIn('envText("TUTOR_MODEL_MECHANICAL", fallback)', CHAT)

    def test_the_benchmark_model_is_untouched(self):
        self.assertIn('default: "claude-opus-5",', CHAT)

    def test_the_cheap_lane_runs_cheap_settings(self):
        self.assertIn('const cheapLane = route === "understanding" || route === "mechanical";', CHAT)
        self.assertIn('if (route === "understanding" || route === "mechanical") return 0.2;', CHAT)

    def test_every_guard_signal_reaches_the_router(self):
        site = CHAT.split("const mentorRoute: ModelRoute =", 1)[1][:900]
        for signal in (
            "presentsThisTurn,",
            "isTextExplanation,",
            "quizLive,",
            "inRevisit,",
            "helpRequest:",
            "controlType:",
            "answerMode:",
            "routedKind,",
        ):
            self.assertIn(signal, site)

    def test_both_call_paths_use_the_chosen_route(self):
        self.assertIn("callModelStream(\n          messages,\n          mentorRoute,", CHAT)
        self.assertIn("await callModel(messages, true, mentorRoute);", CHAT)
        # No stray hard-coded mentor lane left behind.
        self.assertNotIn('await callModel(messages, true, "default");', CHAT)

    def test_routing_behavior_is_pinned_executably(self):
        self.assertIn("R72: only machine-decided turns take the cheap lane", FLOW)
        self.assertIn("autoTierRoute,", FLOW)


class ContextDietTests(unittest.TestCase):
    def test_the_diet_needs_a_summary_and_spares_recent_turns(self):
        block = CHAT.split("history: context.recentTurns", 1)[1][:400]
        self.assertIn("contextDietEnabled() && hasRunningSummary && index >= 6 ? 400 : 1200", block)

    def test_the_summary_guard_is_derived_from_the_session(self):
        self.assertIn(
            'typeof session.running_summary === "string" && session.running_summary.length > 0',
            CHAT,
        )

    def test_the_window_itself_is_unchanged(self):
        # The diet tapers old turns; it never shortens the window, which would drop
        # turns the summary may not have reached yet.
        self.assertIn(".slice(0, 16)", CHAT)


if __name__ == "__main__":
    unittest.main()
