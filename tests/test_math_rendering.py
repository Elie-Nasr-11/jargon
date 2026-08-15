"""R29 math surface: KaTeX equations, graph/geometry figures, and the equation pad."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT / "frontend" / "src"
MATH = (FE / "lib" / "mathText.tsx").read_text(encoding="utf-8")
PLOT = (FE / "lib" / "plotExpression.ts").read_text(encoding="utf-8")
GRAPH = (FE / "student" / "GraphBlock.tsx").read_text(encoding="utf-8")
GEOM = (FE / "student" / "GeometryBlock.tsx").read_text(encoding="utf-8")
PAD = (FE / "student" / "EquationPad.tsx").read_text(encoding="utf-8")
CHATBOX = (FE / "student" / "Chatbox.tsx").read_text(encoding="utf-8")
TRANSCRIPT = (FE / "student" / "Transcript.tsx").read_text(encoding="utf-8")
MESSAGES = (FE / "features" / "student" / "chat" / "chatMessages.ts").read_text(encoding="utf-8")
STYLES = (FE / "styles.css").read_text(encoding="utf-8")
MAIN = (FE / "main.tsx").read_text(encoding="utf-8")
PKG = (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
CHAT_FN = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")


class EquationRendering(unittest.TestCase):
    def test_katex_is_a_dependency_and_styled(self):
        self.assertIn('"katex"', PKG)
        self.assertIn('import "katex/dist/katex.min.css";', MAIN)
        self.assertIn(".math-display", STYLES)

    def test_render_is_locked_down(self):
        # The single injection seam must disable KaTeX's markup-emitting macros and
        # never throw on a malformed formula.
        self.assertIn("throwOnError: false", MATH)
        self.assertIn("trust: false", MATH)

    def test_markdown_and_math_interleave_both_ways(self):
        # R33c: markdown is the OUTER pass now (splitting on math first cut
        # "**What is $d$?**" into fragments that could not match bold, so a student read
        # the asterisks). The original invariant still holds in the other direction:
        # `2*x*y` inside a formula must not become italics. The overlap rule is what
        # keeps both true — a markdown match counts only when it is disjoint from every
        # formula or contains one whole.
        self.assertIn("function renderInlineMd(", TRANSCRIPT)
        self.assertIn("const spans = mathSpans(text);", TRANSCRIPT)
        self.assertIn(
            "end <= s.start || start >= s.end || (start <= s.start && end >= s.end)",
            TRANSCRIPT,
        )
        self.assertIn("if (!allowed(start, end)) continue;", TRANSCRIPT)
        # The span helper is exported from the one math seam, not re-derived here.
        self.assertIn("export function mathSpans(", MATH)

    def test_dollar_syntax_does_not_eat_prices(self):
        # "it cost $5 and $8 total" must stay prose: no leading/trailing space in the
        # body, no newline, and no digit after the closing delimiter.
        self.assertIn(r"\$(?![0-9])", MATH)
        self.assertIn(r"[^\s$](?:[^$\n]*[^\s$])?", MATH)


class FigureBlocks(unittest.TestCase):
    def test_fences_parse_to_figures(self):
        self.assertIn('fenceLang === "graph" || fenceLang === "geometry"', MESSAGES)
        # Unparseable JSON degrades to visible source, never a blank hole.
        self.assertIn('{ kind: "code", code: { language: "jargon", source: body } }', MESSAGES)

    def test_transcript_renders_figures(self):
        self.assertIn("function FigureBlock(", TRANSCRIPT)
        self.assertIn('segment.kind === "figure"', TRANSCRIPT)

    def test_plotting_never_evals(self):
        # A curve must not be a code-execution path: no eval, no Function constructor.
        self.assertNotIn("eval(", PLOT)
        self.assertNotIn("new Function", PLOT)
        # Own-property membership only — "constructor" must not resolve as a function.
        self.assertIn("Object.prototype.hasOwnProperty.call", PLOT)

    def test_unary_minus_binds_looser_than_power(self):
        # -x^2 must be -(x^2), so u sits between * and ^ in the precedence table.
        self.assertIn('{ "+": 1, "-": 1, "*": 2, "/": 2, u: 2.5, "^": 3 }', PLOT)

    def test_incomplete_expressions_fail_loudly(self):
        self.assertIn("Incomplete expression", PLOT)

    def test_graph_breaks_at_discontinuities(self):
        # tan(x) must not draw a vertical line through its asymptote.
        self.assertIn("jumpLimit", GRAPH)

    def test_geometry_keeps_shapes_true(self):
        # One scale for both axes, or circles become ellipses and right angles lie.
        self.assertIn("const scale = Math.min(", GEOM)
        self.assertIn("unitCircle", GEOM)


class EquationComposer(unittest.TestCase):
    def test_pad_is_in_the_plus_menu(self):
        self.assertIn('setPlusView("equation")', CHATBOX)
        self.assertIn("Write an equation", CHATBOX)
        self.assertIn("<EquationPad", CHATBOX)

    def test_pad_previews_and_inserts_dollar_math(self):
        self.assertIn("<MathPreview", PAD)
        self.assertIn("onInsert(`$${tex}$`)", PAD)
        # Templates carry a cursor slot so the caret lands inside the fraction.
        self.assertIn('"\\\\frac{}{}"', PAD)

    def test_symbol_coverage(self):
        for symbol in ("theta", "pi", "sqrt", "\\\\le", "\\\\sin", "\\\\cos", "\\\\tan"):
            self.assertIn(symbol, PAD)


class MentorMathContract(unittest.TestCase):
    def test_prompt_teaches_all_three_surfaces(self):
        self.assertIn("MATH AND FIGURES", CHAT_FN)
        self.assertIn("EQUATIONS:", CHAT_FN)
        self.assertIn("GRAPHS:", CHAT_FN)
        self.assertIn("GEOMETRY:", CHAT_FN)

    def test_prompt_forbids_giving_away_the_figure(self):
        self.assertIn("Never dump a figure the student should be building themselves", CHAT_FN)


if __name__ == "__main__":
    unittest.main()
