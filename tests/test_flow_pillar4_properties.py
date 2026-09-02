"""Flow rebuild Pillar 4: EXECUTABLE property tests over the real flow core.

Everything else in tests/ pins source text; this one runs the actual functions.
tests/flow_core.test.ts imports applyTurn / deriveTurn / applyModeCeiling / stepDone /
turnDirective from the chat function and asserts the invariants the deterministic
spine promises (gate monotonicity, the acknowledge doors, complete-iff-done, ladder
reachability + precedence, recognizer closure).

Mechanics: the chat fn's jsr type-import is unreachable offline and its Deno.serve
must not start under test, so this wrapper copies a stripped index.ts into a temp dir
next to the test file and runs `JARGON_FLOW_TEST=1 deno test --no-check` there. The
env guard lives at the bottom of index.ts; --no-check because a type error is not what
this suite is for.

On deno-check: chat carried 8 type errors for a long time, and one of them was real —
a TS2554 for the student_idea_mastery upsert that dropped its required conflict-key
argument, so the write failed on every turn and an empty catch hid it (R97). Nothing
ran deno check in CI; the older claim here that "the deploy pipeline enforces it" was
never true, and that is why the error sat there. The count is 7 as of 2026-09-02, and
a release that changes it says so in its handoff entry.

Skips (with a visible reason) when deno is not installed.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT_FN = ROOT / "supabase" / "functions" / "chat" / "index.ts"
DENO_SUITE = ROOT / "tests" / "flow_core.test.ts"

JSR_IMPORT = 'import "jsr:@supabase/functions-js/edge-runtime.d.ts";'


class FlowCoreProperties(unittest.TestCase):
    def test_the_flow_core_upholds_its_invariants(self):
        deno = shutil.which("deno")
        if not deno:
            self.skipTest("deno is not installed in this environment")
        source = CHAT_FN.read_text(encoding="utf-8")
        self.assertIn(JSR_IMPORT, source)
        self.assertIn('Deno.env.get("JARGON_FLOW_TEST")', source)
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            (scratch / "chat_index.ts").write_text(
                source.replace(JSR_IMPORT, "// jsr type import stripped for offline test"),
                encoding="utf-8",
            )
            shutil.copy(DENO_SUITE, scratch / "flow_core.test.ts")
            result = subprocess.run(
                [deno, "test", "--no-check", "--allow-env", "flow_core.test.ts"],
                cwd=scratch,
                env={
                    **os.environ,
                    "JARGON_FLOW_TEST": "1",
                    "DENO_NO_UPDATE_CHECK": "1",
                    "NO_COLOR": "1",
                },
                capture_output=True,
                text=True,
                timeout=180,
            )
        self.assertEqual(
            result.returncode,
            0,
            "flow core property tests failed:\n" + result.stdout + result.stderr,
        )
        # Every Deno.test in the suite ran (none filtered/skipped silently).
        expected = DENO_SUITE.read_text(encoding="utf-8").count("Deno.test(")
        self.assertIn(f"{expected} passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
