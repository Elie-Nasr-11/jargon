"""R46 — the teacher console rebuilt to the sketchboard spec (owner: "go for it",
2026-08-19, after the drawing-board session).

The sketchboard (8 wireframe boards, drawn and revised with the owner) is the
spec. Its shape:

- Home = your classes, nothing else. No hero, no activity feed — each class
  card carries its own signals (students · sections, live now, to review).
- A class page has two tabs, Students (landing) and Curriculum. Review is a
  third REACHABLE section but not a tab: the "N to review" strip on Students
  is its door.
- Students = the roster. Rows carry live / needs-review / last-active signals;
  a live row gets a Watch shortcut straight into the session.
- Review = everything gradeable in one place: the assignment + quiz queues
  first, the gradebook table and the assign-work builders one click behind.
- Curriculum = the studio owns the whole surface (the old "Build for this
  class" card is gone). Resources get a dedicated library view
  (Curriculum › Resources) reached from the studio outline header.
- The editor only ever sees the class it's in (owner feedback on the sketch).
- The student page names the student, their section chip, and the class.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
NAV = (FRONTEND / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
CONSOLE = (FRONTEND / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
STUDIO = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
CLASS_ROUTE = (FRONTEND / "routes" / "teacher.class.$classId.tsx").read_text(encoding="utf-8")


def _slice(text: str, start: str, end: str) -> str:
    """The region of `text` between the first `start` and the next `end`."""
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


class HomeTests(unittest.TestCase):
    def test_home_is_just_the_class_grid(self):
        self.assertIn("Your classes", CONSOLE)
        # The hero and the hotlist feed are gone from the console; only the
        # NumberFlip odometer survives from that module.
        self.assertNotIn("<HotlistFeed", CONSOLE)
        self.assertNotIn("deriveHotlist", CONSOLE)
        self.assertNotIn("openHotlistItem", CONSOLE)
        self.assertIn('import { NumberFlip } from "@/features/teacher/HotlistFeed";', CONSOLE)

    def test_class_cards_carry_their_own_signals(self):
        self.assertIn("signals={classSignals(dashboard, item.id)}", CONSOLE)
        card = _slice(CONSOLE, "function ClassButton({", "function ClassDetail({")
        self.assertIn("live now", card)
        self.assertIn("quiet", card)
        self.assertIn("to review", card)
        self.assertIn("nothing to review", card)
        self.assertIn("sections ${signals.sections.join", card)

    def test_signals_derive_live_and_gradeable_from_the_dashboard(self):
        helper = _slice(CONSOLE, "function classSignals(", "function relTime(")
        self.assertIn('status !== "complete"', helper)  # live = an unfinished session
        self.assertIn('"submitted"', helper)  # to review = submitted work
        self.assertIn("assessmentAttempts", helper)


class ClassTabsTests(unittest.TestCase):
    def test_class_header_has_the_two_tab_pills(self):
        header = _slice(CONSOLE, "R46 sketchboard header", '{section === "students" ? (')
        self.assertIn('search: { tab: "students" }', header)
        self.assertIn('search: { tab: "curriculum" }', header)
        # Review is NOT a pill — its door is the strip on Students.
        self.assertNotIn('search: { tab: "review" }', header)

    def test_review_stays_out_of_the_sidebar_spine(self):
        self.assertNotIn('value: "review"', NAV)
        self.assertIn('case "review":', NAV)
        self.assertIn('case "gradebook":', NAV)
        self.assertIn('return "review";', NAV)


class StudentsSectionTests(unittest.TestCase):
    STUDENTS = _slice(CONSOLE, '{section === "students" ? (', '{section === "review" ? (')

    def test_review_strip_is_the_door_to_review(self):
        self.assertIn("to review — open Review", self.STUDENTS)
        self.assertIn('search: { tab: "review" }', self.STUDENTS)
        self.assertIn("Nothing to review.", self.STUDENTS)

    def test_roster_rows_carry_live_needs_review_and_last_active(self):
        self.assertIn("live now — ${lessonName(", self.STUDENTS)
        self.assertIn("waiting for your review", self.STUDENTS)
        self.assertIn("last active ${relTime(", self.STUDENTS)
        self.assertIn('"no sessions yet"', self.STUDENTS)
        self.assertIn("const lessonsDone", self.STUDENTS)

    def test_live_rows_get_a_watch_shortcut_into_the_session(self):
        self.assertIn("Watch", self.STUDENTS)
        self.assertIn('search: { tab: "overview", session: live.id }', self.STUDENTS)

    def test_roster_keeps_sections_and_enrolment(self):
        self.assertIn("Add students", self.STUDENTS)
        self.assertIn('<option value="__new__">New section…</option>', self.STUDENTS)


class ReviewSectionTests(unittest.TestCase):
    REVIEW = _slice(CONSOLE, '{section === "review" ? (', '{section === "curriculum" ? (')

    def test_review_gathers_everything_gradeable(self):
        self.assertIn("Review — everything gradeable", self.REVIEW)
        self.assertIn("<AssignmentGrading", self.REVIEW)
        self.assertIn("<AssessmentGrading", self.REVIEW)
        self.assertIn("← Students", self.REVIEW)
        self.assertIn('search: { tab: "students" }', self.REVIEW)

    def test_gradebook_and_assign_work_sit_one_click_behind(self):
        self.assertIn("Gradebook table", self.REVIEW)
        self.assertIn("<GradebookTable", self.REVIEW)
        self.assertIn("Assign work — assignments", self.REVIEW)
        self.assertIn("<AssignmentManager", self.REVIEW)
        self.assertIn("Assign work — quizzes", self.REVIEW)
        self.assertIn("<AssessmentManager", self.REVIEW)


class CurriculumSectionTests(unittest.TestCase):
    CURRICULUM = CONSOLE.split('{section === "curriculum" ? (')[1]

    def test_the_studio_owns_the_surface_and_the_builders_card_is_gone(self):
        self.assertIn("<CurriculumStudio classId={item.id} />", self.CURRICULUM)
        self.assertNotIn("Build for this class", CONSOLE)

    def test_resources_have_a_dedicated_library_view(self):
        self.assertIn("{resourcesView ? (", self.CURRICULUM)
        self.assertIn("Resources — this class's library", self.CURRICULUM)
        self.assertIn("Curriculum › Resources", self.CURRICULUM)
        self.assertIn("Lesson steps attach files FROM this", self.CURRICULUM)
        self.assertIn("← Back to the outline", self.CURRICULUM)
        self.assertIn("<ResourceManager", self.CURRICULUM)
        # The library is a view of the Curriculum tab, carried by ?view=.
        self.assertIn('resourcesView={search.view === "resources"}', CONSOLE)
        self.assertIn(
            'view: typeof search.view === "string" ? search.view : undefined', CLASS_ROUTE
        )

    def test_the_outline_header_opens_the_library(self):
        self.assertIn("onOpenResources", STUDIO)
        outline_header = _slice(STUDIO, ">\n            Outline\n          </span>", "</section>")
        self.assertIn("Resources", outline_header)
        self.assertIn('search: { tab: "curriculum", view: "resources" }', STUDIO)


class StudentPageTests(unittest.TestCase):
    def test_student_header_names_the_section_and_the_class(self):
        detail = _slice(CONSOLE, "function StudentDetail({", "function GradebookTable(")
        self.assertIn("section: string | null;", detail)
        self.assertIn("classLabel: string | null;", detail)
        self.assertIn("{section ? (", detail)
        self.assertIn("{classLabel ? (", detail)
        # The chip comes from THIS class's membership row.
        self.assertIn("membership.class_id === selectedClassId", CONSOLE)
        self.assertIn("?.section ?? null", CONSOLE)
        self.assertIn("classLabel={selectedClass?.name ?? null}", CONSOLE)


if __name__ == "__main__":
    unittest.main()
