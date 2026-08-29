"""R53 — light-mode palette revision, brain light colors, login redesign, table clip.

Owner directives (2026-08-20): "revise the light mode color palette because the colors
are too dark and its just not right all in all", "revamp the colors of the brain in
light mode", "the design of the login based on the rest of the platform", "revise the
table scroll thing because they dont clip cleanly on horizontal scroll".

The diagnosis behind the palette pin: the light SURFACES were already the white
daylight ladder — what read as dark was the CHROME (active tabs, primary buttons,
voice orb, brain hubs all painted near-black `--foreground`). R53 moves primary
interactive chrome to the platform blue on both ladders; graphite stays for text ink.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import console_source


ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
TABS = (ROOT / "frontend" / "src" / "components" / "WorkspaceTabs.tsx").read_text(
    encoding="utf-8"
)
BRAIN = (ROOT / "frontend" / "src" / "student" / "BrainGraph.tsx").read_text(encoding="utf-8")
LOGIN = (ROOT / "frontend" / "src" / "routes" / "login.tsx").read_text(encoding="utf-8")
CONSOLE = console_source()


class PrimaryChromeTests(unittest.TestCase):
    def test_primary_tokens_exist_on_both_ladders(self):
        # Light ladder: the lesson blue; dark ladder: a lifted blue for charcoal.
        self.assertIn("--primary: #4f6bfd;", CSS)
        self.assertIn("--primary-ink: #ffffff;", CSS)
        self.assertIn("--primary: #5f76fd;", CSS)

    def test_btn_primary_wears_the_blue(self):
        body = CSS.split(".btn-primary {", 1)[1].split("}", 1)[0]
        self.assertIn("background: var(--primary);", body)
        self.assertIn("color: var(--primary-ink);", body)
        self.assertNotIn("var(--foreground)", body)

    def test_shadcn_primary_maps_to_the_blue(self):
        self.assertIn("--color-primary: var(--primary);", CSS)
        self.assertIn("--color-primary-foreground: var(--primary-ink);", CSS)

    def test_workspace_tabs_active_state_is_primary(self):
        self.assertIn("data-[state=active]:bg-primary", TABS)
        self.assertIn("data-[state=active]:text-primary-foreground", TABS)
        self.assertNotIn("data-[state=active]:bg-foreground", TABS)


class BrainLightTests(unittest.TestCase):
    def test_course_hubs_carry_their_subject_hue(self):
        # R53 gave light-mode hubs their hue (dark kept ink coins); R54 extended the
        # hue fill to BOTH ladders via the curated SUBJECT_COLORS cycle. The living
        # contract: hub fill comes from subjectColor, never bare ink.
        self.assertIn("const color = subjectColor(n.tint ?? 0, pal.dark);", BRAIN)
        self.assertIn("ctx.fillStyle = color;", BRAIN)

    def test_lesson_tiers_step_one_ink_lighter_in_light(self):
        # The mid grays massed into a dark cloud against white — light mode uses the
        # next-lighter ink tier for touched/untouched lessons.
        idx = BRAIN.index("massed into a dark cloud")
        window = BRAIN[idx : idx + 400]
        self.assertIn("? pal.ink62", window)
        self.assertIn(": pal.ink30", window)


class LoginTests(unittest.TestCase):
    def test_rainbow_wash_is_retired(self):
        self.assertNotIn("GradientCard", LOGIN)
        self.assertIn('<AmbientCanvas intensity={0.16} hue="--ambient-neutral" />', LOGIN)

    def test_card_and_fields_speak_the_platform_language(self):
        self.assertIn("rounded-card border border-border bg-depth-card shadow-raised", LOGIN)
        self.assertEqual(LOGIN.count("jargon-input"), 2)

    def test_brand_pill_rations_the_aurora_to_one_dot(self):
        self.assertIn("var(--aurora-1), var(--aurora-2), var(--aurora-3)", LOGIN)
        self.assertIn("Jargon AI tutor", LOGIN)

    def test_demo_access_disclosure_survives(self):
        # The pinned entry story: deterministic demo emails, password never embedded.
        self.assertIn("Demo access", LOGIN)
        self.assertIn("demo-student@example.com", LOGIN)


class TableClipTests(unittest.TestCase):
    def test_table_scroll_signals_more_content_with_scroll_fades(self):
        body = CSS.split(".table-scroll {", 1)[1].split("}", 1)[0]
        self.assertIn("no-repeat local", body)
        self.assertIn("no-repeat scroll", body)

    def test_sticky_cell_is_opaque_with_an_edge_lip(self):
        body = CSS.split(".table-sticky-cell {", 1)[1].split("}", 1)[0]
        self.assertIn("position: sticky;", body)
        self.assertIn("background: var(--depth-card);", body)
        self.assertIn("inset -1px 0 0 var(--border)", body)

    def test_gradebook_rows_are_hairline_rows_not_row_cards(self):
        # Rounded row-cards sliced mid-strip at the clip edge when scrolled; rows in
        # a .table-scroll are full-bleed hairline rows with the Student column pinned.
        self.assertIn('table className="min-w-[920px] w-full border-collapse text-left"', CONSOLE)
        self.assertIn('"table-sticky-cell z-[1] px-3 py-3"', CONSOLE)
        self.assertNotIn("border-separate border-spacing-y-2", CONSOLE)
        self.assertNotIn("rounded-l-2xl", CONSOLE)
        self.assertNotIn("rounded-r-2xl", CONSOLE)


if __name__ == "__main__":
    unittest.main()
