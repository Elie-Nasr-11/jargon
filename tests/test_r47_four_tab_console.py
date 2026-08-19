"""R47 — the four-tab teacher console (owner-approved synthesis "Steal These Flows").

The recipe: Google Classroom's skeleton + SchoolAI's live layer. A class is exactly
four fixed rooms, each answering one teacher question:

- **Live** (landing) — what's happening right now: this class's unfinished sessions,
  Watch straight into one; quiet state lists recent activity.
- **Classwork** — what's the work: ONE list (units as topic headings; lessons,
  assignments, quizzes, materials beneath), ONE + Create menu; a lesson click opens
  the editor full-width, a work-item click opens its student-work view where grading
  happens ON the work.
- **People** — who's in it: roster, sections, enrolment. Admin only, no activity.
- **Grades** — how are they doing: the gradebook matrix as a visible tab (a rollup).

Plus: Home carries a global cross-class To-review queue, and notification deep links
land on the item's student-work view (grading never hides).

Principles pinned here: tabs render FROM CLASS_SECTIONS (pills and sidebar can't
disagree); no hidden rooms (no state-dependent sections); one + Create; hierarchy is
metadata, not navigation (no outline tree, no aside).
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
NAV = (FRONTEND / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
CONSOLE = (FRONTEND / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
STUDIO = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
CLASS_ROUTE = (FRONTEND / "routes" / "teacher.class.$classId.tsx").read_text(encoding="utf-8")
NOTIFICATIONS = (FRONTEND / "components" / "NotificationsMenu.tsx").read_text(encoding="utf-8")
ASSIGNMENT_VIEW = (FRONTEND / "features" / "teacher" / "AssignmentGrading.tsx").read_text(
    encoding="utf-8"
)
ASSESSMENT_VIEW = (FRONTEND / "features" / "teacher" / "AssessmentGrading.tsx").read_text(
    encoding="utf-8"
)


def _slice(text: str, start: str, end: str) -> str:
    """The region of `text` between the first `start` and the next `end`."""
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


class TabSpineTests(unittest.TestCase):
    def test_pills_render_from_class_sections(self):
        # ONE source of truth: the header pills map CLASS_SECTIONS (as the sidebar does),
        # so a new tab can never exist in one place and not the other.
        self.assertIn("CLASS_SECTIONS.map((tabItem)", CONSOLE)
        header = _slice(CONSOLE, "R47 header", '{section === "live" ? (')
        self.assertIn("search: { tab: tabItem.value }", header)

    def test_no_hidden_rooms(self):
        # Every section the console renders is a CLASS_SECTIONS value — the old
        # state-dependent rooms (review behind a strip, resources behind a button) are gone.
        for retired in (
            '{section === "students" ? (',
            '{section === "review" ? (',
            '{section === "curriculum" ? (',
            "resourcesView",
            "to review — open Review",
            "Review & assign work",
        ):
            with self.subTest(retired=retired):
                self.assertNotIn(retired, CONSOLE)
        for room in ("live", "classwork", "people", "grades"):
            with self.subTest(room=room):
                self.assertIn(f'{{section === "{room}" ? (', CONSOLE)


class LiveTests(unittest.TestCase):
    LIVE = _slice(CONSOLE, '{section === "live" ? (', '{section === "people" ? (')

    def test_live_lists_unfinished_sessions_with_watch(self):
        self.assertIn("liveStudents.map", self.LIVE)
        self.assertIn("Watch", self.LIVE)
        self.assertIn('search: { tab: "overview", session: live.id }', self.LIVE)

    def test_quiet_state_shows_recent_activity(self):
        self.assertIn("No one is live right now", self.LIVE)
        self.assertIn("last active ${relTime(", self.LIVE)
        self.assertIn('"no sessions yet"', self.LIVE)

    def test_live_is_the_landing_room(self):
        # Unknown/absent ?tab= lands on Live (normalizeClassSection default).
        self.assertIn('return "live";', NAV)
        # And the student page's back pill returns there.
        self.assertIn('search: { tab: "live" }', CONSOLE)


class PeopleTests(unittest.TestCase):
    PEOPLE = _slice(CONSOLE, '{section === "people" ? (', '{section === "grades" ? (')

    def test_people_is_roster_admin_only(self):
        self.assertIn("Add students", self.PEOPLE)
        self.assertIn('<option value="__new__">New section…</option>', self.PEOPLE)
        # Activity context lives in Live now — People rows carry none of it.
        self.assertNotIn("live now", self.PEOPLE)
        self.assertNotIn("Watch", self.PEOPLE)
        self.assertNotIn("relTime(", self.PEOPLE)


class GradesTests(unittest.TestCase):
    def test_gradebook_is_a_visible_tab_not_a_drawer(self):
        grades = _slice(CONSOLE, '{section === "grades" ? (', "</section>")
        self.assertIn("<GradebookTable", grades)
        self.assertNotIn("<Collapsible", grades)


class ClassworkTests(unittest.TestCase):
    CLASSWORK = CONSOLE.split('{section === "classwork" ? (')[1]

    def test_work_item_views_take_precedence_over_the_studio(self):
        # Render order: open assignment → open quiz → the studio (list + editors).
        a = self.CLASSWORK.index("<AssignmentWorkView")
        b = self.CLASSWORK.index("<AssessmentWorkView")
        c = self.CLASSWORK.index("<CurriculumStudio")
        self.assertTrue(a < b < c)
        self.assertIn("{openAssignment ? (", self.CLASSWORK)
        self.assertIn(") : openAssessment ? (", self.CLASSWORK)

    def test_console_hands_work_items_to_the_studio(self):
        self.assertIn("workItems={workItems}", self.CLASSWORK)
        self.assertIn("onOpenItem={(kind, id)", self.CLASSWORK)
        self.assertIn("onCreate={(kind) => setCreateOpen(kind)}", self.CLASSWORK)

    def test_one_create_menu_with_three_dialogs(self):
        self.assertIn('createOpen === "assignment"', CONSOLE)
        self.assertIn('createOpen === "assessment"', CONSOLE)
        self.assertIn('createOpen === "material"', CONSOLE)
        # The studio's list carries the single + Create menu.
        menu = _slice(STUDIO, "function ClassworkList({", "function OutlineRow(")
        for label in ('{ kind: "assignment", label: "Assignment" }', '{ kind: "assessment", label: "Quiz" }', '{ kind: "material", label: "Material" }'):
            with self.subTest(label=label):
                self.assertIn(label, menu)
        self.assertIn("onAddUnit()", menu)

    def test_studio_list_replaced_the_outline_tree(self):
        self.assertIn("function ClassworkList({", STUDIO)
        self.assertNotIn("function Outline({", STUDIO)
        self.assertNotIn("outlineOpen", STUDIO)
        self.assertNotIn("<aside", STUDIO)
        # Units group the work items via their lesson; strays never vanish.
        self.assertIn("Other classwork", STUDIO)
        self.assertIn("units={outlineUnits}", STUDIO)

    def test_work_views_live_in_the_grading_files(self):
        self.assertIn("export function AssignmentWorkView({", ASSIGNMENT_VIEW)
        self.assertIn("export function AssessmentWorkView({", ASSESSMENT_VIEW)
        # Grading stays on the work: score + return controls, and the quiz view keeps
        # its per-item review + final return (pinned strings shared with older suites).
        self.assertIn("Mark complete", ASSIGNMENT_VIEW)
        self.assertIn("Return result", ASSESSMENT_VIEW)
        self.assertIn("← Classwork", ASSIGNMENT_VIEW)
        self.assertIn("← Classwork", ASSESSMENT_VIEW)


class RoutingTests(unittest.TestCase):
    def test_class_route_carries_work_item_params_and_no_view(self):
        self.assertIn(
            'assignment: typeof search.assignment === "string" ? search.assignment : undefined',
            CLASS_ROUTE,
        )
        self.assertIn(
            'assessment: typeof search.assessment === "string" ? search.assessment : undefined',
            CLASS_ROUTE,
        )
        self.assertNotIn("view", CLASS_ROUTE)

    def test_notifications_deep_link_to_the_work_item(self):
        # ref carries assignment_id / assessment_id (stamped by the notification writers);
        # parse defensively and fall back to the Classwork list.
        self.assertIn('typeof ref.assignment_id === "string"', NOTIFICATIONS)
        self.assertIn('typeof ref.assessment_id === "string"', NOTIFICATIONS)
        self.assertIn('{ tab: "classwork", assignment: assignmentId }', NOTIFICATIONS)
        self.assertIn('{ tab: "classwork", assessment: assessmentId }', NOTIFICATIONS)


class HomeQueueTests(unittest.TestCase):
    def test_home_has_the_global_to_review_queue(self):
        self.assertIn("function globalReviewRows(", CONSOLE)
        self.assertIn("<GlobalReviewQueue", CONSOLE)
        self.assertIn("To review", CONSOLE)
        # Rows deep-link into the item's student-work view in its class.
        self.assertIn('? { tab: "classwork", assignment: row.itemId }', CONSOLE)
        self.assertIn(': { tab: "classwork", assessment: row.itemId }', CONSOLE)


if __name__ == "__main__":
    unittest.main()
