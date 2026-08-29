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
from tests.teacher_sources import authoring_source, console_source


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
        header = _slice(CONSOLE, "R60 header", '{section === "activity" ? (')
        self.assertIn("search: { tab: tabItem.value }", header)

    def test_no_hidden_rooms(self):
        # Every section the console renders is a CLASS_SECTIONS value. The R47 rooms are
        # retired section values now (their content moved, not hidden).
        for retired in (
            '{section === "live" ? (',
            '{section === "classwork" ? (',
            '{section === "people" ? (',
            '{section === "grades" ? (',
            '{section === "review" ? (',
            '{section === "curriculum" ? (',
            "resourcesView",
        ):
            with self.subTest(retired=retired):
                self.assertNotIn(retired, CONSOLE)
        self.assertIn('{section === "students" ? (', CONSOLE)
        self.assertIn('{section === "content" ? (', CONSOLE)
        # Activity renders twice by design — the in-card body and the full-width
        # work-view face — both gated on the same section value.
        self.assertIn('{section === "activity" && !openAssignmentId && !openAssessmentId ? (', CONSOLE)
        self.assertIn('{section === "activity" && (openAssignmentId || openAssessmentId) ? (', CONSOLE)

    def test_open_work_overrides_a_stale_tab(self):
        # R60: old bookmarks and notification emails carry ?tab=classwork&assignment=… —
        # the work-item params, not the tab name, decide the room. Grading never hides.
        self.assertIn(
            'search.assignment || search.assessment ? "activity" : normalizeClassSection(search.tab)',
            CONSOLE,
        )


class StudentsTests(unittest.TestCase):
    STUDENTS = _slice(CONSOLE, '{section === "students" ? (', '{section === "activity" ? (')

    def test_students_is_the_landing_room(self):
        self.assertIn('return "students";', NAV)
        # And the student drill-down's back pill returns there.
        self.assertIn('search: { tab: "students" }', CONSOLE)

    def test_roster_admin_survives_the_merge(self):
        self.assertIn("Add students", self.STUDENTS)
        self.assertIn('<option value="__new__">New section…</option>', self.STUDENTS)

    def test_rows_carry_grades_and_activity(self):
        # The owner's ask verbatim: "students shows a list of students … with their info
        # like grades and activity."
        self.assertIn("gradeChipLabel(gradeSummaries.get(studentId))", self.STUDENTS)
        self.assertIn("studentContextLine(", self.STUDENTS)
        self.assertIn("liveByStudent.has(studentId)", self.STUDENTS)

    def test_gradebook_is_one_toggle_away(self):
        self.assertIn('studentsView === "gradebook"', self.STUDENTS)
        self.assertIn("<GradebookTable", self.STUDENTS)
        self.assertIn("Roster", self.STUDENTS)

    def test_grade_chip_mirrors_the_student_grades_contract(self):
        # Same released set and score precedence as fetchStudentGrades — the teacher's
        # chip and the student's own grades list can never disagree.
        helper = _slice(CONSOLE, "function gradeSummariesForClass(", "function gradeChipLabel(")
        self.assertIn('new Set(["complete", "returned", "graded"])', helper)
        self.assertIn("recipient.final_score ?? recipient.score", helper)


class ActivityTests(unittest.TestCase):
    ACTIVITY = _slice(
        CONSOLE,
        '{section === "activity" && !openAssignmentId && !openAssessmentId ? (',
        '{section === "students" ? (',
    )

    def test_live_strip_with_watch(self):
        self.assertIn("liveStudents.map", self.ACTIVITY)
        self.assertIn("Watch", self.ACTIVITY)
        self.assertIn('search: { tab: "overview", session: live.id }', self.ACTIVITY)
        self.assertIn("No one is live right now", self.ACTIVITY)

    def test_class_review_queue(self):
        self.assertIn("reviewRows.map", self.ACTIVITY)
        self.assertIn("To review", self.ACTIVITY)

    def test_work_list_is_quizzes_and_assignments_only(self):
        self.assertIn("activityItems.map", self.ACTIVITY)
        # Materials belong to Content — the memo filters them out.
        self.assertIn('.filter((entry) => entry.kind !== "material")', CONSOLE)

    def test_create_buttons_live_here(self):
        self.assertIn("New assignment", self.ACTIVITY)
        self.assertIn("New quiz", self.ACTIVITY)
        self.assertIn('setCreateOpen("assignment")', self.ACTIVITY)
        self.assertIn('setCreateOpen("assessment")', self.ACTIVITY)

    def test_work_item_views_take_the_room(self):
        work = _slice(
            CONSOLE,
            '{section === "activity" && (openAssignmentId || openAssessmentId) ? (',
            '{section === "content" ? (',
        )
        a = work.index("<AssignmentWorkView")
        b = work.index("<AssessmentWorkView")
        self.assertTrue(a < b)
        self.assertIn("{openAssignment ? (", work)
        self.assertIn(") : openAssessment ? (", work)
        self.assertIn("← Activity", work)


class ContentTests(unittest.TestCase):
    CONTENT = CONSOLE.split('{section === "content" ? (')[1]

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
        self.assertIn('{ tab: "activity", assignment: assignmentId }', NOTIFICATIONS)
        self.assertIn('{ tab: "activity", assessment: assessmentId }', NOTIFICATIONS)


class HomeQueueTests(unittest.TestCase):
    def test_home_has_the_global_to_review_queue(self):
        self.assertIn("function globalReviewRows(", CONSOLE)
        self.assertIn("<GlobalReviewQueue", CONSOLE)
        self.assertIn("To review", CONSOLE)
        self.assertIn('? { tab: "activity", assignment: row.itemId }', CONSOLE)
        self.assertIn(': { tab: "activity", assessment: row.itemId }', CONSOLE)


if __name__ == "__main__":
    unittest.main()
