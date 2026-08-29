"""R42 — the class-first teacher hierarchy (owner decision 2026-08-18):

"I want things separated by classes ONLY … there should be one single hierarchy
for the whole thing … per lesson, you'll be able to build the curriculum within
each class. I don't think there should be a single builder space for everything."

Pins the structural contract of slice 1, updated through R47:
- Classes are the single hierarchy; the class workspace's sidebar spine renders
  from CLASS_SECTIONS (four fixed rooms since R47 — see test_r47), and every
  legacy ?tab= value maps into a section.
- The sidebar has no global Curriculum destination.
- The authoring studio is an exported, class-scoped component mounted (lazily)
  inside the class's Classwork section; its selection rides the class route URL.
- /teacher/curriculum survives only as a redirect for old bookmarks.
- The old Structure panel and Overview strips stay retired.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import AUTHORING_ROUTE, authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
NAV = (FRONTEND / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
SIDEBAR = (FRONTEND / "features" / "teacher" / "shell" / "TeacherSidebar.tsx").read_text(
    encoding="utf-8"
)
SHELL = (FRONTEND / "features" / "teacher" / "shell" / "TeacherShell.tsx").read_text(
    encoding="utf-8"
)
CONSOLE = console_source()
STUDIO = authoring_source()
CLASS_ROUTE = (FRONTEND / "routes" / "teacher.class.$classId.tsx").read_text(encoding="utf-8")
NOTIFICATIONS = (FRONTEND / "components" / "NotificationsMenu.tsx").read_text(encoding="utf-8")


class ClassSectionsTests(unittest.TestCase):
    def test_class_workspace_has_the_three_fixed_sections(self):
        # R60 three-room console: the class spine is Students / Activity / Content —
        # every tab always visible (no hidden rooms), rendered from CLASS_SECTIONS.
        self.assertIn('export type ClassSection = "students" | "activity" | "content";', NAV)
        self.assertIn('{ value: "students", label: "Students" }', NAV)
        self.assertIn('{ value: "activity", label: "Activity" }', NAV)
        self.assertIn('{ value: "content", label: "Content" }', NAV)
        for retired in (
            '"live", label',
            '"classwork", label',
            '"people", label',
            '"grades", label',
            '"overview"',
            '"structure", label',
            '"review", label',
            '"curriculum", label',
        ):
            with self.subTest(retired=retired):
                self.assertNotIn(f"value: {retired}", NAV)

    def test_legacy_tabs_map_into_the_three_sections(self):
        # Happening/work-shaped legacy values land on Activity; content-shaped ones on
        # Content; people/grades-shaped and unknown/absent land on Students (default).
        for case in ("live", "assignments", "assessments", "review"):
            with self.subTest(case=case):
                self.assertIn(f'case "{case}":', NAV)
        for case in ("classwork", "curriculum", "structure", "lessons", "resources"):
            with self.subTest(case=case):
                self.assertIn(f'case "{case}":', NAV)
        self.assertIn('return "activity";', NAV)
        self.assertIn('return "content";', NAV)
        self.assertIn('return "students";', NAV)
        self.assertNotIn('return "overview"', NAV)
        self.assertNotIn('return "live"', NAV)


class SidebarTests(unittest.TestCase):
    def test_sidebar_has_no_global_curriculum_destination(self):
        self.assertNotIn('"/teacher/curriculum"', SIDEBAR)
        self.assertNotIn('label="Curriculum"', SIDEBAR)
        # R75: the sidebar no longer repeats the class sections — they were rendered
        # BOTH here and as pills in the console, which is the duplication the owner hit
        # ("why are the page links in two places"). The pills won: they sit next to the
        # content they switch. The sidebar keeps classes only.
        self.assertNotIn("CLASS_SECTIONS.map", SIDEBAR)

    def test_active_view_is_home_or_class_only(self):
        self.assertIn('activeView: "home" | "class";', SIDEBAR)
        self.assertIn('activeView: "home" | "class";', SHELL)
        self.assertNotIn('"curriculum";', SHELL.split("activeView")[1][:80])


class ConsoleTests(unittest.TestCase):
    def test_studio_mounts_lazily_inside_the_class_content_section(self):
        self.assertIn('import("@/features/teacher/course/CourseScreen")', CONSOLE)
        self.assertIn("module.CourseScreen", CONSOLE)
        self.assertIn("<CourseScreen", CONSOLE)
        self.assertIn('{section === "content" ? (', CONSOLE)

    def test_students_section_owns_the_roster_and_no_overview_remains(self):
        # R60: the roster (sections, enrolment) lives in Students, now with each row's
        # grades + activity context. No overview strips, no hidden review room.
        people_block = CONSOLE.split('{section === "students" ? (')[1].split(
            "<Dialog open={enrollOpen}"
        )[0]
        self.assertIn("Add students", people_block)
        self.assertNotIn("ClassOverviewStrips", CONSOLE)
        self.assertFalse(
            (FRONTEND / "features" / "teacher" / "ClassOverview.tsx").exists(),
            "ClassOverview.tsx should be deleted (strips replaced by Live rows)",
        )
        # No standalone Overview or Review sections remain.
        self.assertNotIn('{section === "overview" ? (', CONSOLE)
        self.assertNotIn('{section === "review" ? (', CONSOLE)

    def test_structure_panel_is_retired_and_linked_courses_survive(self):
        self.assertNotIn("ClassStructurePanel", CONSOLE)
        self.assertFalse(
            (FRONTEND / "features" / "teacher" / "ClassStructurePanel.tsx").exists(),
            "ClassStructurePanel.tsx should be deleted (redundant with the studio outline)",
        )
        # R43: the courses panel lives INSIDE the studio (it scopes the outline), so the
        # console no longer mounts it directly.
        self.assertIn("<LinkedCoursesPanel", STUDIO)
        self.assertNotIn("LinkedCoursesPanel", CONSOLE)

    def test_class_level_deep_links_land_on_the_new_sections(self):
        # Student-page back pill lands on Students; notification deep links land on
        # Activity (grading lives ON the work) — nothing points at the retired rooms.
        self.assertIn('search: { tab: "students" }', CONSOLE)
        self.assertIn('tab: "activity"', NOTIFICATIONS)
        self.assertNotIn('tab: "live"', CONSOLE)
        self.assertNotIn('tab: "classwork"', NOTIFICATIONS)


class StudioTests(unittest.TestCase):
    def test_the_course_screen_is_class_scoped(self):
        # R42 made the studio a component the class mounts. R80 replaced it with the
        # Course screen, which keeps the contract: it takes a class and nothing else.
        self.assertIn("export function CourseScreen({", STUDIO)
        self.assertIn("classId: string;", STUDIO)
        # The host (TeacherConsole) gates the teacher role; the studio must not re-gate
        # or render its own chrome (shell imports gone, class picker gone).
        # Scoped to the studio's own module: it is mounted INSIDE the console, so it
        # must not draw shell chrome. (The lesson screen is a route of its own and does
        # render a shell — that is why this reads the studio rather than the surface.)
        studio_module = AUTHORING_ROUTE.read_text(encoding="utf-8")
        self.assertNotIn("fetchPrimaryRole", studio_module)
        self.assertNotIn('from "@/features/teacher/shell/TeacherShell"', studio_module)
        self.assertNotIn('from "@/components/PageShell"', studio_module)
        self.assertNotIn("Class scope", studio_module)

    def test_a_lesson_has_its_own_address(self):
        # R42 put the selection in the URL so lesson editing was deep-linkable inside
        # the class. R79 finished the thought: the lesson IS a route, so the link is an
        # address rather than a query parameter, and Back works.
        self.assertIn('to: "/teacher/class/$classId"', STUDIO)
        self.assertIn('search: { tab: "content" }', STUDIO)
        self.assertIn('to: "/teacher/class/$classId/lesson/$lessonId"', STUDIO)
        self.assertIn("params: { classId, lessonId }", STUDIO)

    def test_legacy_route_redirects_into_the_first_class(self):
        self.assertIn('createFileRoute("/teacher/curriculum")', STUDIO)
        self.assertIn("fetchTeacherClasses(session.user.id)", STUDIO)
        # R79/R80: a lesson link forwards to the lesson's own address; anything else
        # lands on the class's Course screen.
        self.assertIn('to: "/teacher/class/$classId/lesson/$lessonId"', STUDIO)
        self.assertIn('search: { tab: "content" }', STUDIO)
        self.assertIn("replace: true", STUDIO)

    def test_class_route_carries_the_studio_selection_params(self):
        for param in ("subject", "course", "unit", "lesson"):
            with self.subTest(param=param):
                self.assertIn(
                    f'{param}: typeof search.{param} === "string" ? search.{param} : undefined,',
                    CLASS_ROUTE,
                )


if __name__ == "__main__":
    unittest.main()
