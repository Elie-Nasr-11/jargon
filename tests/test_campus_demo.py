"""The campus demo: Mathematics, Biology and History classes built from the source PDFs."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase" / "migrations"
TRIG = (MIG / "20261003000000_campus_trigonometry.sql").read_text(encoding="utf-8")
BIO = (MIG / "20261003100000_campus_biology.sql").read_text(encoding="utf-8")
HIST = (MIG / "20261003200000_campus_history.sql").read_text(encoding="utf-8")
WIRING = (MIG / "20261003300000_campus_wiring.sql").read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
READINGS = ROOT / "frontend" / "public" / "readings"
ALL = TRIG + BIO + HIST + WIRING


class CampusDeploys(unittest.TestCase):
    def test_all_four_registered_after_the_sweep(self):
        sweep = DEPLOY.index("20260713000000_book_f_only_catalog.sql")
        for name in (
            "20261003000000_campus_trigonometry.sql",
            "20261003100000_campus_biology.sql",
            "20261003200000_campus_history.sql",
            "20261003300000_campus_wiring.sql",
        ):
            self.assertIn(name, DEPLOY)
            self.assertGreater(DEPLOY.index(name), sweep)

    def test_wiring_runs_last(self):
        # Classes link to courses and checkpoints bind quiz items, so content first.
        self.assertGreater(
            DEPLOY.index("20261003300000_campus_wiring.sql"),
            DEPLOY.index("20261003200000_campus_history.sql"),
        )


class SourcePdfsAreServed(unittest.TestCase):
    def test_five_readings_committed(self):
        for name in (
            "trigonometry-afl.pdf",
            "photosynthesis-paper.pdf",
            "broken-heart-of-america-i.pdf",
            "broken-heart-of-america-ii.pdf",
            "the-middle-classes.pdf",
        ):
            self.assertTrue((READINGS / name).is_file(), f"missing reading {name}")

    def test_resources_use_relative_urls(self):
        # Relative so the same row works in local dev and in production.
        self.assertIn("'/readings/trigonometry-afl.pdf'", WIRING)
        self.assertNotIn("onrender.com/readings", WIRING)

    def test_scanned_papers_carry_approved_text_chunks(self):
        # The maths and biology PDFs are scans with NO text layer — without these chunks
        # extract_knowledge would read nothing from them.
        self.assertIn("resource_text_chunks", WIRING)
        self.assertIn("'approved'", WIRING)
        self.assertIn("Outcomes assessed", WIRING)
        self.assertIn("arrays of pigments within protein complexes", WIRING)


class ContentIsGroundedInTheSources(unittest.TestCase):
    def test_trig_covers_the_papers_outcomes(self):
        for outcome in ("unit circle", "radian", "Pythagorean", "double", "geometric", "arithmetic"):
            self.assertIn(outcome, TRIG, f"trig content missing {outcome}")
        # The paper's own questions appear as practice.
        self.assertIn("a_2 = 0.2", TRIG)
        self.assertIn(r"\tan^2 x = 1", TRIG)

    def test_biology_covers_the_papers_outcomes(self):
        for outcome in ("photolysis", "Calvin", "ATP synthase", "limiting", "thylakoid", "rubisco"):
            self.assertIn(outcome, BIO, f"biology content missing {outcome}")
        # Its MCQs are the paper's MCQs, with the paper's correct answers.
        self.assertIn("Arrays of pigments within protein complexes", BIO)
        self.assertIn("Electrons from water molecules", BIO)

    def test_history_quotes_the_readings(self):
        self.assertIn("February 29, 1916", HIST)
        self.assertIn("Universal Welfare Association", HIST)
        self.assertIn("worth more dead than alive", HIST)
        self.assertIn("The era of the bourgeoisie is over", HIST)
        self.assertIn("false equivalence", HIST)


class MathContentUsesTheNewRenderers(unittest.TestCase):
    def test_equations_are_latex_not_ascii(self):
        self.assertIn(r"$$a_n = a_1 + (n-1)d$$", TRIG)
        self.assertIn(r"\frac{\pi}{2}", TRIG + BIO + HIST)

    def test_figures_ride_fenced_blocks(self):
        self.assertIn("```geometry", TRIG)
        self.assertIn('"unitCircle": true', TRIG)
        self.assertIn("```graph", TRIG)
        # Biology's limiting-factor curves are a real plot, not a description of one.
        self.assertIn("```graph", BIO)

    def test_plotted_expressions_are_parseable(self):
        # Every expression in a ```graph block must be inside the plotter's grammar.
        allowed = re.compile(r"^[0-9x+\-*/^(),.\s]|sin|cos|tan|sqrt|abs|ln|log|exp|min|max|pi|e$")
        for expr in re.findall(r'"expression":\s*"([^"]+)"', ALL):
            stripped = re.sub(r"sin|cos|tan|sqrt|abs|ln|log|exp|min|max|pi|e", "", expr)
            self.assertRegex(stripped, r"^[0-9x+\-*/^(),.\s]*$", f"unplottable expression {expr}")
            self.assertTrue(allowed.search(expr), expr)


class CampusRoster(unittest.TestCase):
    def test_three_classes_with_all_students(self):
        for name in ("Mathematics 10", "Biology 10", "History 10"):
            self.assertIn(name, WIRING)
        for email in ("carl@example.com", "elissar@example.com", "elie@example.com"):
            self.assertIn(email, WIRING)
        self.assertIn("demo-student@example.com", WIRING)

    def test_each_class_has_due_work_and_a_returned_grade(self):
        self.assertIn("'assignment'", WIRING)
        self.assertIn("'returned'", WIRING)
        self.assertIn("now() + interval '6 days'", WIRING)

    def test_skips_cleanly_without_the_demo_org(self):
        self.assertIn("skipping class wiring", WIRING)


class CampusKnowledge(unittest.TestCase):
    def test_every_lesson_step_binds_ideas(self):
        # idea_keys on steps is what lights mastery, recall openers and tier grading.
        for text in (TRIG, BIO, HIST):
            self.assertIn("idea_keys = excluded.idea_keys", text)

    def test_cross_subject_links_exist(self):
        # Biology reaches into maths; history reaches into the reasoning course.
        self.assertIn("'limiting-factors', 'trig-graphs'", BIO)
        self.assertIn("'false-equivalence', 'claims-vs-reasons'", HIST)

    def test_teacher_practice_banks_are_guarded(self):
        for text in (TRIG, BIO, HIST):
            self.assertIn("where p.idea_key = v.idea_key and p.prompt = v.prompt", text)

    def test_draft_queues_for_the_knowledge_card(self):
        self.assertIn("'half-angle'", TRIG)
        self.assertIn("'rubisco'", BIO)
        self.assertIn("'restrictive-covenant'", HIST)


if __name__ == "__main__":
    unittest.main()
