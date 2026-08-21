"""R54 — brain graph polish: curated palette, dark glow, label restraint, smooth zoom.

Owner (2026-08-21): brain "colours are a bit dead" in both modes; "the glow on the
dark mode is not it"; "the labels are sometimes a bit too much"; zoom/drag "very
choppy".
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BRAIN = (ROOT / "frontend" / "src" / "student" / "BrainGraph.tsx").read_text(encoding="utf-8")


class PaletteTests(unittest.TestCase):
    def test_curated_subject_colors_replace_hue_rotation(self):
        # Eight hand-picked tag hues, each with a lifted dark-ladder variant; the
        # computed hsl-rotation scheme (muddy in-between angles) is gone.
        self.assertIn("const SUBJECT_COLORS", BRAIN)
        self.assertEqual(BRAIN.count("light: \"#"), 8)
        self.assertNotIn("subjectHue", BRAIN)
        self.assertIn("function subjectColor(rank: number, dark: boolean)", BRAIN)

    def test_hubs_carry_their_hue_on_both_ladders(self):
        self.assertIn("const color = subjectColor(n.tint ?? 0, pal.dark);", BRAIN)
        # The near-black ink coin is retired as a hub fill.
        self.assertNotIn("ctx.fillStyle = pal.ink92;\n          ctx.beginPath();", BRAIN)


class WashAndPerfTests(unittest.TestCase):
    def test_washes_prerasterize_once_and_blit_per_frame(self):
        # N radial gradients per frame was the biggest repaint cost ("very choppy").
        self.assertIn("const buildWashLayer = () => {", BRAIN)
        self.assertIn("ctx.drawImage(wash.canvas", BRAIN)
        # Theme flips rebuild the layer (colors are theme-dependent).
        idx = BRAIN.index("new MutationObserver")
        self.assertIn("buildWashLayer();", BRAIN[idx : idx + 200])

    def test_dark_glow_is_tighter_and_dimmer(self):
        self.assertIn("const rr = pal.dark ? reach * 0.82 : reach;", BRAIN)
        self.assertIn('withAlpha(color, 0.11)', BRAIN)

    def test_dpr_capped_at_ambient_canvas_convention(self):
        self.assertIn("Math.min(1.5, window.devicePixelRatio || 1)", BRAIN)

    def test_wheel_zoom_is_proportional_to_delta(self):
        # Fixed ±10% per wheel event made trackpad gestures a staircase.
        self.assertIn("Math.exp(-deltaPx * 0.0022)", BRAIN)
        self.assertIn("event.deltaMode === 1", BRAIN)


class LabelTests(unittest.TestCase):
    def test_labels_are_sans_sentence_case_everywhere(self):
        # The ALL-CAPS mono hub names shouted over the graph.
        self.assertNotIn("toUpperCase", BRAIN)
        self.assertNotIn("fontMono", BRAIN)

    def test_long_names_truncate_but_hover_shows_all(self):
        self.assertIn("function ellipsize(text: string, max: number)", BRAIN)
        self.assertIn("isHover ? n.label : ellipsize(n.label", BRAIN)

    def test_rest_state_names_only_the_anchors(self):
        # Raised zoom gates: lessons 0.9, ideas 1.25, words 1.7.
        self.assertIn("(zoom - 0.9) * 2.4", BRAIN)
        self.assertIn("(zoom - 1.25) * 2.2", BRAIN)
        self.assertIn("(zoom - 1.7) * 2.2", BRAIN)


if __name__ == "__main__":
    unittest.main()
