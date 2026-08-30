"""The teacher console spine — R47's fixed-room contract, carried by R60's three rooms.

R47 established the shape (fixed rooms rendered FROM CLASS_SECTIONS, work-item views
that take precedence, grading that never hides). R60 folded the four rooms into three
after the owner's directive ("students, activity, and content — we keep things super
simple"):

- **Students** (landing) — who's in the class and how they're doing: the roster with
  sections and enrolment, each row carrying a live dot, last activity and a grade
  chip; the full gradebook one toggle away.
- **Activity** — what's happening and what's out for work: live students with Watch,
  the class To-review queue, every quiz and assignment in one list; an open work item
  takes the room full-width (the R47 precedence contract, scoped to the tab).
- **Content** — what gets taught: the studio (units + lessons + materials).

Principles that survive from R47 verbatim: tabs render FROM CLASS_SECTIONS (pills and
sidebar can't disagree); no hidden rooms; grading never hides — notification deep
links land on the item's student-work view, and an open ?assignment/?assessment wins
over the URL's ?tab so old links keep working.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source, console_source, people_source


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
NAV = (FRONTEND / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
CONSOLE = console_source()
STUDIO = authoring_source()
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
        header = _slice(CONSOLE, "R60 header", '{section === "today" &&')
        self.assertIn("search: { tab: tabItem.value }", header)

    def test_no_hidden_rooms(self):
        # Every section the console renders is a CLASS_SECTIONS value. The R47 rooms are
        # retired section values now (their content moved, not hidden).
        for retired in (
            '{section === "live" ? (',
            '{section === "classwork" ? (',
            '{section === "students" ? (',
            '{section === "grades" ? (',
            '{section === "review" ? (',
            '{section === "curriculum" ? (',
            "resourcesView",
        ):
            with self.subTest(retired=retired):
                self.assertNotIn(retired, CONSOLE)
        self.assertIn('{section === "people" ? (', CONSOLE)
        self.assertIn('{section === "course" ? (', CONSOLE)
        # R83: Settings is a section the console renders but NOT a pill — the one
        # deliberate exception to "every section is a CLASS_SECTIONS value", because
        # it is a screen a teacher opens once a term (Law 4).
        self.assertIn('{section === "settings" ? (', CONSOLE)
        self.assertIn('aria-label="Class settings"', CONSOLE)
        # R81: Today renders twice by design — the in-card body and the full-width
        # work-view face — both gated on the same section value.
        self.assertIn('{section === "today" && !openAssignmentId && !openAssessmentId ? (', CONSOLE)
        self.assertIn('{section === "today" && (openAssignmentId || openAssessmentId) ? (', CONSOLE)

    def test_open_work_overrides_a_stale_tab(self):
        # R60: old bookmarks and notification emails carry ?tab=classwork&assignment=… —
        # the work-item params, not the tab name, decide the room. Grading never hides.
        self.assertIn(
            'search.assignment || search.assessment ? "today" : normalizeClassSection(search.tab)',
            CONSOLE,
        )


class PeopleTests(unittest.TestCase):
    """R47's Students room, renamed and rebuilt as People (R83).

    The room is its own module now, so these read the module rather than slicing a
    marker out of the concatenated console — the room's contract is unchanged.
    """

    PEOPLE = people_source()

    def test_people_is_a_room_the_back_pill_returns_to(self):
        # R81: Today is the landing; People is still where a student drill-down
        # returns to, because that is the room the student was listed in.
        self.assertIn('return "today";', NAV)
        self.assertIn('search: { tab: "people" }', CONSOLE)

    def test_roster_admin_survives_the_merge(self):
        # R83 says what the button does: it picks from students the school already
        # registered. It has never created an account and now it reads that way.
        self.assertIn("Add from the school directory", self.PEOPLE)
        self.assertIn('<option value="__new__">New section…</option>', self.PEOPLE)

    def test_a_student_can_be_removed_from_the_class(self):
        # The other half of the brief's roster contract. Removal is a membership
        # status, never a delete, and it is confirmed by name.
        self.assertIn("Remove from this class?", self.PEOPLE)
        self.assertIn("onRemove(removing)", self.PEOPLE)

    def test_rows_carry_grades_and_activity(self):
        # The owner's ask verbatim: "students shows a list of students … with their info
        # like grades and activity."
        self.assertIn("gradeChipLabel(gradeSummaries.get(studentId))", self.PEOPLE)
        self.assertIn("studentContextLine(", self.PEOPLE)
        self.assertIn("liveByStudent.has(studentId)", self.PEOPLE)

    def test_gradebook_is_one_toggle_away(self):
        self.assertIn('view === "gradebook"', self.PEOPLE)
        self.assertIn("<GradebookTable", self.PEOPLE)
        self.assertIn("Roster", self.PEOPLE)

    def test_grade_chip_mirrors_the_student_grades_contract(self):
        # Same released set and score precedence as fetchStudentGrades — the teacher's
        # chip and the student's own grades list can never disagree.
        helper = _slice(CONSOLE, "function gradeSummariesForClass(", "function gradeChipLabel(")
        self.assertIn('new Set(["complete", "returned", "graded"])', helper)
        self.assertIn("recipient.final_score ?? recipient.score", helper)


class TodayTests(unittest.TestCase):
    """R47's Activity room, rebuilt as Today (R81) — same two live surfaces, leading
    the landing instead of hiding one tab away."""

    TODAY = _slice(CONSOLE, "export function TodayScreen(", "function ")

    def test_live_strip_with_watch(self):
        self.assertIn("live.map", self.TODAY)
        self.assertIn("Watch", self.TODAY)
        self.assertIn("onWatch(row.studentId, row.sessionId)", self.TODAY)
        self.assertIn('search: { tab: "overview", session: sessionId }', CONSOLE)
        self.assertIn("No one is in a lesson right now", self.TODAY)

    def test_class_review_queue(self):
        self.assertIn("toMark.map", self.TODAY)
        self.assertIn("Waiting on you", self.TODAY)

    def test_the_work_list_moved_to_the_lesson_that_owns_it(self):
        # R47 listed every quiz and assignment at class scope. R79 gave each lesson its
        # own Work section, and R81 removed the class-level list rather than keep two.
        self.assertNotIn("activityItems", CONSOLE)
        self.assertNotIn("Quizzes &amp; assignments", CONSOLE)

    def test_creation_moved_to_the_lesson_too(self):
        # Law 2: work is created ON the lesson it belongs to, never from a class-level
        # button that then asks which lesson.
        self.assertNotIn("New assignment", self.TODAY)
        self.assertNotIn("New quiz", self.TODAY)

    def test_work_item_views_take_the_room(self):
        work = _slice(
            CONSOLE,
            '{section === "today" && (openAssignmentId || openAssessmentId) ? (',
            '{section === "course" ? (',
        )
        a = work.index("<AssignmentWorkView")
        b = work.index("<AssessmentWorkView")
        self.assertTrue(a < b)
        self.assertIn("{openAssignment ? (", work)
        self.assertIn(") : openAssessment ? (", work)
        self.assertIn("← Activity", work)


class ContentTests(unittest.TestCase):
    CONTENT = CONSOLE.split('{section === "course" ? (')[1]

    def test_the_content_room_is_the_course_screen(self):
        # R47 handed the studio the class's work items so the outline could list them.
        # R80: work belongs to the lesson that carries it, so the Course screen takes
        # the class id and nothing else — the room is one hierarchy again.
        self.assertIn("<CourseScreen", self.CONTENT)
        self.assertIn("classId={item.id}", self.CONTENT)
        self.assertNotIn("workItems={workItems}", self.CONTENT)

    def test_class_wide_material_keeps_a_door(self):
        # Material that belongs to no single lesson is rare; the class owns the dialog
        # and the Course screen's menu opens it.
        self.assertIn('onAddMaterial={() => setCreateOpen("material")}', self.CONTENT)

    def test_three_create_dialogs_survive(self):
        self.assertIn('createOpen === "assignment"', CONSOLE)
        self.assertIn('createOpen === "assessment"', CONSOLE)
        self.assertIn('createOpen === "material"', CONSOLE)

    def test_content_list_creates_content_not_work(self):
        # Assignments and quizzes are created in Activity; the studio's + Create menu
        # offers only the things students learn from.
        outline = _slice(STUDIO, "export function CourseOutline({", "function UnitBlock(")
        self.assertIn("Add a unit", outline)
        self.assertNotIn("Assignment", outline)
        self.assertNotIn("Quiz", outline)

    def test_the_list_replaced_the_outline_tree(self):
        self.assertIn("export function CourseOutline({", STUDIO)
        self.assertNotIn("function Outline({", STUDIO)
        self.assertNotIn("outlineOpen", STUDIO)
        self.assertNotIn("<aside", STUDIO)
        self.assertIn("units={course.outlineUnits}", STUDIO)

    def test_work_views_live_in_the_grading_files(self):
        self.assertIn("export function AssignmentWorkView({", ASSIGNMENT_VIEW)
        self.assertIn("export function AssessmentWorkView({", ASSESSMENT_VIEW)
        self.assertIn("Mark complete", ASSIGNMENT_VIEW)
        self.assertIn("Return result", ASSESSMENT_VIEW)
        self.assertIn("← Activity", ASSIGNMENT_VIEW)
        self.assertIn("← Activity", ASSESSMENT_VIEW)


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
        self.assertIn('typeof ref.assignment_id === "string"', NOTIFICATIONS)
        self.assertIn('typeof ref.assessment_id === "string"', NOTIFICATIONS)
        self.assertIn('{ tab: "today", assignment: assignmentId }', NOTIFICATIONS)
        self.assertIn('{ tab: "today", assessment: assessmentId }', NOTIFICATIONS)


class HomeQueueTests(unittest.TestCase):
    def test_home_has_the_global_to_review_queue(self):
        self.assertIn("function globalReviewRows(", CONSOLE)
        self.assertIn("<GlobalReviewQueue", CONSOLE)
        self.assertIn("To review", CONSOLE)
        self.assertIn('? { tab: "today", assignment: row.itemId }', CONSOLE)
        self.assertIn(': { tab: "today", assessment: row.itemId }', CONSOLE)


if __name__ == "__main__":
    unittest.main()
