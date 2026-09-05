"""R101 — the Thinking tab just shows.

Rules, not shapes. Each holds something a future edit could quietly undo:

1. THE TAB DOES NOT ASK. There is no button that judges. Nothing in the frontend can
   trigger a model call; the sweep reads new work on its own, and (this release) finishes
   a lesson's tail two hours after the student leaves it.

2. THE WHOLE-STUDENT READ IS NUMBERS AND IDS. One request brings every judged response
   of a student, and it never carries `evidence`, `signals` or a `note` — the quotes stay
   on the per-lesson read, beside the response they belong to. The read is paged and
   capped by named constants, and a capped read says so.

3. THE QUEUE FINISHES WHAT IT STARTS. The five-response threshold and the probe exception
   both survive the redefinition, and a named aging interval joins them.

4. THE SCOPES AGREE WITH THE SCORER. thinking.ts and cognition-scorer cannot import each
   other, so the four thresholds they share are read from both files here.

5. NOTHING READS AS A GRADE, and the drawing has words for a screen reader.

The last class RUNS tests/thinking_view.test.ts against the real thinking.ts under deno,
the way tests/test_r93_room_view.py runs the room suite.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
COGNITION = SRC / "features" / "teacher" / "cognition"
LIB = SRC / "lib"

SCORER = (ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts").read_text(encoding="utf-8")
SCORER_CODE = without_comments(SCORER)
THINKING = (COGNITION / "thinking.ts").read_text(encoding="utf-8")
THINKING_CODE = without_comments(THINKING)
PANEL = (SRC / "features" / "teacher" / "console" / "CognitionPanel.tsx").read_text(encoding="utf-8")
PANEL_CODE = without_comments(PANEL)
API = (LIB / "api.ts").read_text(encoding="utf-8")
API_CODE = without_comments(API)
MIGRATION = (ROOT / "supabase" / "migrations" / "20261104000000_r101_sweep_aging.sql").read_text(encoding="utf-8")
SWEEP = (ROOT / "supabase" / "migrations" / "20260831140000_r92_cognition_sweep.sql").read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
COGNITION_DOC = (ROOT / "docs" / "COGNITION.md").read_text(encoding="utf-8")
SUITE = ROOT / "tests" / "thinking_view.test.ts"


def number_in(source: str, name: str) -> float:
    match = re.search(rf"const {name} = ([0-9.]+);", source)
    assert match, f"expected {name} to be a named constant"
    return float(match.group(1))


def block(source: str, start: str, end: str) -> str:
    body = source[source.index(start) :]
    return body[: body.index(end)]


class TheTabDoesNotAsk(unittest.TestCase):
    def test_nothing_in_the_frontend_can_trigger_a_judge_call(self) -> None:
        """A dead export is how the button comes back."""
        for name, source in (("panel", PANEL_CODE), ("api", API_CODE)):
            self.assertNotIn("scoreCognitionLesson", source, name)
            self.assertNotIn('"score_lesson"', source, name)
        self.assertNotIn("Read the thinking", PANEL_CODE)

    def test_the_panel_reads_the_whole_student_once(self) -> None:
        self.assertIn("fetchStudentThinking", PANEL_CODE)
        self.assertIn("export async function fetchStudentThinking(", API_CODE)
        self.assertIn('action: "student_view"', API_CODE)

    def test_the_line_that_replaced_the_button_says_when_it_reads(self) -> None:
        """R98's pin, restated for its new reason."""
        self.assertIn("fifteen minutes", PANEL_CODE)

    def test_the_per_response_quotes_still_come_from_the_lesson_read(self) -> None:
        """Lesson scope keeps the one read that carries evidence."""
        self.assertIn("fetchCognitionProfile", PANEL_CODE)
        self.assertIn("turn.evidence", PANEL)
        self.assertIn("turn.signals", PANEL)


class TheWholeStudentReadIsNumbersAndIds(unittest.TestCase):
    def columns(self) -> str:
        match = re.search(r"const STUDENT_VIEW_COLUMNS =(.*?);", SCORER_CODE, re.S)
        assert match, "the whole-student select must be a named constant"
        return match.group(1)

    def test_the_select_never_carries_a_quote(self) -> None:
        columns = self.columns()
        for forbidden in ("evidence", "signals", "note", "*"):
            self.assertNotIn(forbidden, columns, f"the whole-student read carries {forbidden}")
        self.assertIn("DIMENSIONS.join", columns)
        self.assertIn("PROBE_DIMENSIONS.join", columns)

    def test_the_read_is_paged_and_capped_by_name(self) -> None:
        self.assertGreater(number_in(SCORER_CODE, "STUDENT_VIEW_MAX_ROWS"), 0)
        self.assertEqual(number_in(SCORER_CODE, "PAGE_ROWS"), 1000)
        paged = block(SCORER_CODE, "async function selectPaged(", "\n}\n")
        self.assertIn("offset=", paged)
        self.assertIn("truncated", paged)

    def test_the_action_resolves_a_person_and_returns_the_truth_about_the_cap(self) -> None:
        body = block(SCORER_CODE, "async function studentView(", "\nDeno.serve(")
        self.assertIn("assertCanViewStudent(config, actorId, userId)", body)
        self.assertIn("selectPaged(", body)
        self.assertIn("STUDENT_VIEW_COLUMNS", body)
        self.assertIn("truncated: ledger.truncated", body)

    def test_the_router_resolves_the_user_before_the_action(self) -> None:
        """R92's order rule, extended: the sweep is the only user-less action."""
        router = SCORER_CODE[SCORER_CODE.index("const action = cleanText(record.action);") :]
        user_at = router.index("await fetchCurrentUser(config)")
        self.assertGreater(router.index('action === "student_view"'), user_at)

    def test_the_read_is_a_read(self) -> None:
        """No write leaves this action; a viewing surface that wrote would be a new door."""
        body = block(SCORER_CODE, "async function studentView(", "\nDeno.serve(")
        for verb in ("POST", "PATCH", "DELETE", "PUT"):
            self.assertNotIn(verb, body)


class TheQueueFinishesWhatItStarts(unittest.TestCase):
    HAVING = re.compile(
        r"having count\(\*\) >= (\d+) or bool_or\(lt\.payload \? 'probe'\) "
        r"or max\(lt\.created_at\) < now\(\) - interval '(\d+) hours?';"
    )

    def test_the_threshold_and_the_probe_exception_survive_beside_the_aging_rule(self) -> None:
        match = self.HAVING.search(MIGRATION)
        assert match, "the R101 view must carry all three rules on one HAVING line"
        original = re.search(r"having count\(\*\) >= (\d+)", SWEEP)
        assert original
        self.assertEqual(match.group(1), original.group(1), "the R92 threshold must not drift")
        self.assertGreaterEqual(int(match.group(2)), 1)

    def test_the_document_names_the_same_interval(self) -> None:
        """A rule the doc states differently from the schema is two rules."""
        match = self.HAVING.search(MIGRATION)
        assert match
        words = {"1": "one hour", "2": "two hours", "3": "three hours"}
        self.assertIn(words[match.group(2)], COGNITION_DOC)

    def test_the_window_and_the_grants_are_kept(self) -> None:
        self.assertIn("interval '30 days'", MIGRATION)
        self.assertIn("revoke all on public.cognition_sweep_queue from anon, authenticated;", MIGRATION)
        self.assertIn("grant select on public.cognition_sweep_queue to service_role;", MIGRATION)

    def test_it_is_in_the_deploy_list(self) -> None:
        """An unlisted migration never runs."""
        self.assertIn("supabase/migrations/20261104000000_r101_sweep_aging.sql", DEPLOY)


class TheScopesAgreeWithTheScorer(unittest.TestCase):
    def test_the_four_shared_thresholds_are_the_same_number_in_both_files(self) -> None:
        for name in (
            "UNAIDED_AT_OR_BELOW",
            "SUPPORTED_AT_OR_ABOVE",
            "WEAK_AT_OR_BELOW",
            "PROFICIENT_AT_OR_ABOVE",
        ):
            with self.subTest(name=name):
                self.assertEqual(number_in(THINKING_CODE, name), number_in(SCORER_CODE, name))

    def test_the_delayed_dimensions_keep_the_profiles_window(self) -> None:
        """buildProfile's .slice(-5), so lesson scope agrees with the stored profile."""
        self.assertEqual(number_in(THINKING_CODE, "PROBE_WINDOW"), 5)
        self.assertIn(".slice(-5)", SCORER_CODE)

    def test_the_pattern_needs_lessons_and_concurrence(self) -> None:
        """§16: "no single signal" is structural, not a convention."""
        self.assertGreaterEqual(number_in(THINKING_CODE, "PATTERN_MIN_LESSONS"), 3)
        self.assertGreaterEqual(number_in(THINKING_CODE, "PATTERN_MIN_SIGNALS"), 2)


class NothingReadsAsAGrade(unittest.TestCase):
    def test_the_sentence_builder_prints_no_percentage(self) -> None:
        sentence = block(THINKING_CODE, "export function scopeSentence(", "\n}\n")
        self.assertNotIn("%", sentence)
        self.assertNotIn("* 100", THINKING_CODE)

    def test_the_drawing_has_words(self) -> None:
        """A line with no label is a decoration; a screen reader gets the same facts."""
        svg = block(PANEL, "function Sparkline(", "\n}\n")
        self.assertIn('role="img"', svg)
        self.assertIn("aria-label={label}", svg)
        self.assertIn("sparklineLabel(", PANEL_CODE)

    def test_a_dimension_row_wraps_before_it_starves_its_label(self) -> None:
        """R98's rule: fixed-width children, so the row must be allowed to wrap."""
        row = block(PANEL, "function DimensionRow(", "\n}\n")
        self.assertIn("min-w-0", row)
        self.assertIn("flex-wrap", row)

    def test_the_selector_groups_its_scopes_and_the_cap_is_shown(self) -> None:
        self.assertIn("<optgroup", PANEL_CODE)
        self.assertIn("truncationNote(", PANEL_CODE)


class TheDocumentKeepsUp(unittest.TestCase):
    def test_cognition_md_describes_the_read_and_the_rule(self) -> None:
        self.assertIn("student_view", COGNITION_DOC)
        self.assertIn("two hours", COGNITION_DOC)


def _portable(source: str) -> str:
    """Frontend module -> something deno can run standalone (test_r93_room_view's recipe)."""
    source = re.sub(r'import type \{[^}]*\} from "@/lib/api";\n', "", source)
    source = re.sub(r'import type \{[^}]*\} from "@/lib/types";\n', "", source)
    source = re.sub(
        r'import \{([^}]*)\} from "@/features/teacher/cognition/labels";',
        r'import {\1} from "./labels.ts";',
        source,
    )
    source = re.sub(
        r'import \{([^}]*)\} from "@/lib/format";',
        r'import {\1} from "./format.ts";',
        source,
    )
    source = source.replace("import type { CognitionDims } from", "// import type { CognitionDims } from")
    source = source.replace("keyof CognitionDims", "string")
    return source


class ThinkingViewProperties(unittest.TestCase):
    def test_the_thinking_view_upholds_its_promises(self) -> None:
        deno = shutil.which("deno")
        if not deno:
            self.skipTest("deno is not installed in this environment")
        expected = SUITE.read_text(encoding="utf-8").count("Deno.test(")
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            for name in ("labels.ts", "thinking.ts"):
                (scratch / name).write_text(
                    _portable((COGNITION / name).read_text(encoding="utf-8")), encoding="utf-8"
                )
            (scratch / "format.ts").write_text(
                _portable((LIB / "format.ts").read_text(encoding="utf-8")), encoding="utf-8"
            )
            (scratch / "thinking_view.test.ts").write_text(
                SUITE.read_text(encoding="utf-8"), encoding="utf-8"
            )
            result = subprocess.run(
                [deno, "test", "--no-check", "--no-lock", "-A", "thinking_view.test.ts"],
                cwd=scratch,
                capture_output=True,
                text=True,
                timeout=300,
                env={"PATH": "/usr/bin:/bin:/usr/local/bin", "HOME": tmp, "TZ": "UTC", "NO_COLOR": "1",
                     "DENO_DIR": str(scratch / ".deno")},
            )
        self.assertEqual(result.returncode, 0, f"{result.stdout}\n{result.stderr}")
        # Pillar 4's rule: every property listed must have RUN — none silently filtered.
        self.assertIn(f"{expected} passed", result.stdout, result.stdout)


if __name__ == "__main__":
    unittest.main()
