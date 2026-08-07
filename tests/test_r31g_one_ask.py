"""R31g: one ask per reply, enforced by the server instead of asked for by the prompt.

R31e shipped "EXACTLY ONE ASK PER REPLY" as SYSTEM_PROMPT + directive text and its own
handoff called it "unproven until a real run". The first real run broke it. Verbatim, from
a live camp-cn-l3 turn on prod (session 60aec4cf), closing a content step:

    "... because these movements often need to be coordinated closely with the other eye
     functions. Does that make sense? Are you ready to move on to how these nerves affect
     eye position when they're not working properly?"

Two asks. The filler check is the damaging half, not just clutter: the reply that stacks it
is the content_discuss wrap whose whole job is to collect a readiness signal, and a bare
"yes" to THAT pair is ambiguous between "I follow" and "move me on" — while
CONTINUE_SIGNAL_RE reads it as the latter and advances the lesson.

So the rule now has a deterministic backstop in the same block that already decides what
[[action:]], [[material:]] and [[figure:]] markers are legal. These tests execute the real
regexes lifted out of the edge function — a string assertion would not have caught the
lookbehind bugs this class of guard invites.
"""
from pathlib import Path
import json
import re
import subprocess
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT_PATH = ROOT / "supabase" / "functions" / "chat" / "index.ts"
CHAT = CHAT_PATH.read_text(encoding="utf-8")


def _guard_source() -> str:
    """Lift the guard verbatim out of index.ts so the test runs the SHIPPING regexes."""
    start = CHAT.index("const FILLER_ASK_PATTERNS")
    end = CHAT.index("type StepRequirements", start)
    src = CHAT[start:end]
    # Strip the TS-only annotations; the bodies are plain JS.
    src = src.replace("const FILLER_ASK_PATTERNS: RegExp[] =", "const FILLER_ASK_PATTERNS =")
    src = re.sub(r"function (\w+)\(([\w]+): string\): (?:string|number)", r"function \1(\2)", src)
    return src


GUARD_JS = _guard_source()


def strip(reply: str) -> str:
    """Run stripFillerAsks in node and return what a student would actually read."""
    script = (
        GUARD_JS
        + "\nconst input = JSON.parse(process.argv[1]);"
        + "\nprocess.stdout.write(JSON.stringify(stripFillerAsks(input)));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(reply)],
        capture_output=True, text=True, cwd=ROOT, timeout=60,
    )
    if out.returncode != 0:
        raise AssertionError(f"guard failed to run: {out.stderr.strip()}")
    return json.loads(out.stdout)


class TheLiveRegression(unittest.TestCase):
    """The exact reply that proved the prompt-only rule does not hold."""

    LIVE = (
        "The **oculomotor nerve (III)** takes care of the remaining muscles because these "
        "movements need to be coordinated closely with the other eye functions. Does that "
        "make sense? Are you ready to move on to how these nerves affect eye position when "
        "they're not working properly?"
    )

    def test_the_filler_check_is_gone(self):
        self.assertNotIn("Does that make sense?", strip(self.LIVE))

    def test_the_real_ask_survives_intact(self):
        kept = strip(self.LIVE)
        self.assertIn(
            "Are you ready to move on to how these nerves affect eye position "
            "when they're not working properly?",
            kept,
        )

    def test_exactly_one_ask_remains(self):
        self.assertEqual(strip(self.LIVE).count("?"), 1)

    def test_the_teaching_before_it_is_untouched(self):
        self.assertIn(
            "takes care of the remaining muscles because these movements need to be "
            "coordinated closely with the other eye functions.",
            strip(self.LIVE),
        )

    def test_no_seam_is_left_where_the_check_was_removed(self):
        kept = strip(self.LIVE)
        self.assertNotIn("  ", kept, "doubled space left behind by the removal")
        self.assertNotIn(" ?", kept)


class TheAskIsNeverEmptied(unittest.TestCase):
    """The dead end R31e fixed must not come back as 'guard ate the only question'."""

    def test_a_lone_comprehension_check_is_left_alone(self):
        # Here the check IS the ask — stripping it would leave no way onward.
        for lone in (
            "Here's how the three nerves divide the six muscles. Does that make sense?",
            "So VI drives the lateral rectus and IV the superior oblique. Make sense?",
            "That's the whole rule. Any questions?",
        ):
            self.assertEqual(strip(lone), lone, f"stripped the only ask: {lone!r}")

    def test_every_reply_that_arrived_with_a_question_still_has_one(self):
        for reply in (
            "Does that make sense? Which nerve moves the lateral rectus?",
            "Make sense? Got it? Which nerve moves the lateral rectus?",
            "Any questions? Are you with me? Is that clear? Shall we continue?",
        ):
            self.assertGreaterEqual(
                strip(reply).count("?"), 1, f"guard emptied the ask: {reply!r}"
            )

    def test_a_pile_of_fillers_collapses_to_the_single_real_ask(self):
        kept = strip("Make sense? Got it? Which nerve moves the lateral rectus?")
        self.assertEqual(kept, "Which nerve moves the lateral rectus?")

    def test_a_reply_with_no_question_at_all_is_returned_unchanged(self):
        plain = "The abducens nerve supplies the lateral rectus. Nothing to answer here."
        self.assertEqual(strip(plain), plain)


class RealQuestionsAreNotCollateral(unittest.TestCase):
    """Content questions that merely resemble a check must survive."""

    def test_a_genuine_content_question_is_never_treated_as_filler(self):
        for reply in (
            "Which of these makes sense given the palsy picture? And what would you expect?",
            "Does that eye sit down and out, or up and in? Which nerve explains it?",
            "What do you notice? Why would CN III cause a droopy lid?",
        ):
            kept = strip(reply)
            self.assertEqual(
                kept.count("?"), reply.count("?"), f"ate a real question: {reply!r}"
            )

    def test_sentence_internal_phrasing_is_not_matched(self):
        # "make sense" mid-sentence is prose, not a tag question.
        reply = "Try to make sense of the pattern first. Which nerve moves the eye outward?"
        self.assertEqual(strip(reply), reply)


class ItIsActuallyWiredIn(unittest.TestCase):
    """A guard nothing calls is a guard that does not exist."""

    def test_the_reply_passes_through_the_guard(self):
        self.assertIn(
            "envelope.reply = stripFillerAsks(String(envelope.reply || \"\"));", CHAT
        )

    def test_it_runs_after_the_marker_guards_not_before(self):
        # Ordering matters: it must reason about the text the student will read, once
        # unresolved [[figure:]]/[[material:]] markers are already gone.
        self.assertLess(
            CHAT.index("R30: resolve [[figure:id]] markers"),
            CHAT.index("envelope.reply = stripFillerAsks("),
        )

    def test_the_prompt_rule_it_backs_is_still_there(self):
        # The guard is a backstop, not a replacement — the model should still aim for one ask.
        self.assertIn("EXACTLY ONE ASK PER REPLY", CHAT)


if __name__ == "__main__":
    unittest.main()
