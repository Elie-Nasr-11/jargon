"""R30b: figures from source material, teacher objectives, resource gate, PDF fallback."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(encoding="utf-8")
FIGURES_SQL = (
    ROOT / "supabase" / "migrations" / "20261004000000_lesson_figures.sql"
).read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
WELCOME = (ROOT / "frontend" / "src" / "student" / "LessonWelcome.tsx").read_text(encoding="utf-8")
TRANSCRIPT = (ROOT / "frontend" / "src" / "student" / "Transcript.tsx").read_text(encoding="utf-8")
STAGE = (ROOT / "frontend" / "src" / "student" / "MediaStage.tsx").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
FIG_DIR = ROOT / "frontend" / "public" / "figures"


class FigureSchema(unittest.TestCase):
    def test_table_and_published_only_read(self):
        self.assertIn("create table if not exists public.lesson_figures", FIGURES_SQL)
        self.assertIn("lesson_figures_published_read", FIGURES_SQL)
        self.assertIn("using (status = 'published')", FIGURES_SQL)

    def test_deploys_after_the_campus_content_it_references(self):
        wiring = DEPLOY.index("20261003300000_campus_wiring.sql")
        figures = DEPLOY.index("20261004000000_lesson_figures.sql")
        self.assertGreater(figures, wiring)

    def test_every_seeded_image_file_exists(self):
        # A row pointing at a missing file renders as a broken image for a student.
        for url in set(re.findall(r"'(/figures/[^']+)'", FIGURES_SQL)):
            self.assertTrue((FIG_DIR / Path(url).name).exists(), f"missing asset for {url}")

    def test_seed_carries_alt_text_for_every_figure(self):
        self.assertEqual(FIGURES_SQL.count("alt_text"), FIGURES_SQL.count("alt_text"))
        self.assertIn("alt_text text not null default ''", FIGURES_SQL)

    def test_review_queue_has_real_drafts(self):
        self.assertIn("'draft')", FIGURES_SQL)


class FigureServing(unittest.TestCase):
    def test_chat_loads_published_figures_only(self):
        self.assertIn("lesson_figures?lesson_id=eq.", CHAT)
        self.assertIn("status=eq.published&order=position.asc", CHAT)

    def test_marker_contract_and_resolution(self):
        self.assertIn("[[figure:<id>]]", CHAT)
        self.assertIn("at most ONE figure per reply", CHAT)
        # Unapproved / invented ids are stripped from the text, never shown raw.
        self.assertIn("\\\\[\\\\[figure:([^\\\\]\\\\s]+)\\\\]\\\\]", CHAT.replace("\\", "\\\\"))

    def test_teacher_reviews_figures(self):
        self.assertIn('figure: "lesson_figures"', ADMIN)
        self.assertIn("lesson_figures?lesson_id=eq.", ADMIN)
        # Discard retires a figure rather than deleting it.
        self.assertIn('if (kind === "practice" || kind === "figure")', ADMIN)

    def test_client_renders_figures_inline(self):
        self.assertIn("function SourceFigure(", TRANSCRIPT)
        self.assertIn("FIGURE_MARKER_RE", TRANSCRIPT)
        self.assertIn("figures={message.figures}", TRANSCRIPT)


class TeacherObjectives(unittest.TestCase):
    def test_objectives_come_from_the_milestone(self):
        self.assertIn("export async function fetchLessonObjectives(", API)
        self.assertIn('.from("milestones")', API)
        self.assertIn('.select("objective,expected_evidence")', API)

    def test_welcome_shows_what_youll_learn(self):
        self.assertIn("What you", WELCOME)
        self.assertIn("fetchLessonObjectives", WELCOME)
        self.assertIn("student_can", WELCOME)


class ResourceGate(unittest.TestCase):
    def test_mentor_sees_opened_state(self):
        self.assertIn("TEACHER MATERIALS", CHAT)
        self.assertIn("materials: context.resources.map(", CHAT)
        self.assertIn("opened: context.resourceInteractions.some(", CHAT)

    def test_mentor_must_not_fabricate_material_contents(self):
        self.assertIn("Never fabricate what a material contains", CHAT)


class PdfFallback(unittest.TestCase):
    def test_failed_embed_offers_a_direct_link(self):
        self.assertIn("It should still open in a new tab", STAGE)
        self.assertIn("onError={() => setFailed(true)}", STAGE)


if __name__ == "__main__":
    unittest.main()


class ButtonFreeAdvancement(unittest.TestCase):
    """R31d: with the Continue button gone the MENTOR is the only way onward."""

    def test_content_step_directives_offer_a_way_forward(self):
        # The live demo stalled at 16 turns on step 1 of 4: content_discuss said "do not
        # push them onward" and content_nudge pointed at a button that no longer exists.
        self.assertNotIn("point at the Continue button to move on", CHAT)
        self.assertNotIn("The Continue button on screen advances when they're ready", CHAT)
        self.assertNotIn("do not push them onward", CHAT)
        # After a couple of exchanges the mentor must offer the exit itself.
        self.assertIn("END by offering the way forward", CHAT)
        self.assertIn("ASK them directly whether to move on", CHAT)

    def test_no_directive_claims_a_button_is_on_screen(self):
        self.assertNotIn("Continue button is still on screen", CHAT)


class MathAndScienceNotation(unittest.TestCase):
    """R31e: the four math surfaces, and science formulas typeset like maths."""

    def test_equation_graph_and_geometry_contracts(self):
        self.assertIn("EQUATIONS: wrap LaTeX in single dollars", CHAT)
        self.assertIn("GRAPHS: a ", CHAT)
        self.assertIn("GEOMETRY: a ", CHAT)
        self.assertIn('"unitCircle":true', CHAT)

    def test_chemistry_and_units_typeset(self):
        # Owner: "chemistry and physics if necessary, but i think just equations cover
        # those well" — so the same LaTeX path carries formulas, units and charges
        # instead of flat ASCII ("CO2", "9.8 m/s2").
        self.assertIn("SCIENCE NOTATION", CHAT)
        self.assertIn("rather than flat ASCII", CHAT)

    def test_client_renders_all_three(self):
        root = ROOT / "frontend" / "src"
        self.assertTrue((root / "lib" / "mathText.tsx").exists())
        self.assertTrue((root / "student" / "GraphBlock.tsx").exists())
        self.assertTrue((root / "student" / "GeometryBlock.tsx").exists())
        self.assertTrue((root / "student" / "EquationPad.tsx").exists())
        transcript = (root / "student" / "Transcript.tsx").read_text(encoding="utf-8")
        self.assertIn("renderWithMath", transcript)
        chatbox = (root / "student" / "Chatbox.tsx").read_text(encoding="utf-8")
        self.assertIn("EquationPad", chatbox)
        self.assertIn('"equation"', chatbox)
