"""R42 — the class-first teacher hierarchy (owner decision 2026-08-18):

"I want things separated by classes ONLY … there should be one single hierarchy
for the whole thing … per lesson, you'll be able to build the curriculum within
each class. I don't think there should be a single builder space for everything."

Pins the structural contract of slice 1:
- The class workspace has exactly two sections — Students (landing) and
  Curriculum — and every legacy ?tab= value maps into one of them.
- The sidebar has no global Curriculum destination; classes are the hierarchy.
- The authoring studio is an exported, class-scoped component mounted (lazily)
  inside the class's Curriculum section; its selection rides the class route URL.
- /teacher/curriculum survives only as a redirect for old bookmarks.
- The old Overview strips live at the top of Students; the old Structure panel
  (a second tree, redundant with the studio outline) is retired.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
NAV = (FRONTEND / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
SIDEBAR = (FRONTEND / "features" / "teacher" / "shell" / "TeacherSidebar.tsx").read_text(
    encoding="utf-8"
)
SHELL = (FRONTEND / "features" / "teacher" / "shell" / "TeacherShell.tsx").read_text(
    encoding="utf-8"
)
CONSOLE = (FRONTEND / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
STUDIO = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
CLASS_ROUTE = (FRONTEND / "routes" / "teacher.class.$classId.tsx").read_text(encoding="utf-8")
NOTIFICATIONS = (FRONTEND / "components" / "NotificationsMenu.tsx").read_text(encoding="utf-8")


class ClassSectionsTests(unittest.TestCase):
    def test_class_workspace_has_exactly_students_and_curriculum(self):
        self.assertIn('export type ClassSection = "students" | "curriculum";', NAV)
        self.assertIn('{ value: "students", label: "Students" }', NAV)
        self.assertIn('{ value: "curriculum", label: "Curriculum" }', NAV)
        for retired in ('"overview"', '"structure", label'):
            with self.subTest(retired=retired):
                self.assertNotIn(f"value: {retired}", NAV)

    def test_legacy_tabs_map_into_the_two_sections(self):
        # Content-shaped legacy values land on Curriculum; everything else (including
        # the retired Overview and unknown/absent values) lands on Students.
        self.assertIn('case "curriculum":', NAV)
        self.assertIn('case "structure":', NAV)
        self.assertIn('case "lessons":', NAV)
        self.assertIn('case "resources":', NAV)
        self.assertIn('return "curriculum";', NAV)
        self.assertIn('return "students";', NAV)
        self.assertNotIn('return "overview"', NAV)
        self.assertNotIn('return "structure"', NAV)


class SidebarTests(unittest.TestCase):
    def test_sidebar_has_no_global_curriculum_destination(self):
        self.assertNotIn('"/teacher/curriculum"', SIDEBAR)
        self.assertNotIn('label="Curriculum"', SIDEBAR)
        # Classes remain the hierarchy: the active class expands into its section rows.
        self.assertIn("CLASS_SECTIONS.map", SIDEBAR)

    def test_active_view_is_home_or_class_only(self):
        self.assertIn('activeView: "home" | "class";', SIDEBAR)
        self.assertIn('activeView: "home" | "class";', SHELL)
        self.assertNotIn('"curriculum";', SHELL.split("activeView")[1][:80])


class ConsoleTests(unittest.TestCase):
    def test_studio_mounts_lazily_inside_the_class_curriculum_section(self):
        self.assertIn('import("@/routes/teacher.curriculum")', CONSOLE)
        self.assertIn("module.CurriculumStudio", CONSOLE)
        self.assertIn("<CurriculumStudio classId={item.id} />", CONSOLE)
        self.assertIn('{section === "curriculum" ? (', CONSOLE)

    def test_students_section_absorbs_the_overview_strips(self):
        students_block = CONSOLE.split('{section === "students" ? (')[1]
        self.assertIn("<ClassOverviewStrips", students_block.split("</div>")[0] + "</div>")
        # No standalone Overview section remains.
        self.assertNotIn('{section === "overview" ? (', CONSOLE)

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

    def test_class_level_deep_links_land_on_students(self):
        self.assertIn('search: { tab: "students" }', CONSOLE)
        self.assertIn('search: { tab: "students" }', NOTIFICATIONS)


class StudioTests(unittest.TestCase):
    def test_studio_is_an_exported_class_scoped_component(self):
        self.assertIn("export function CurriculumStudio({ classId }: { classId: string })", STUDIO)
        # The host (TeacherConsole) gates the teacher role; the studio must not re-gate
        # or render its own chrome (shell imports gone, class picker gone).
        self.assertNotIn("fetchPrimaryRole", STUDIO)
        self.assertNotIn('from "@/features/teacher/shell/TeacherShell"', STUDIO)
        self.assertNotIn('from "@/components/PageShell"', STUDIO)
        self.assertNotIn("Class scope", STUDIO)

    def test_selection_rides_the_class_route(self):
        self.assertIn('to: "/teacher/class/$classId"', STUDIO)
        self.assertIn('search: { tab: "curriculum", [type]: id }', STUDIO)
        self.assertIn('search: { tab: "curriculum" }', STUDIO)

    def test_legacy_route_redirects_into_the_first_class(self):
        self.assertIn('createFileRoute("/teacher/curriculum")', STUDIO)
        self.assertIn("fetchTeacherClasses(session.user.id)", STUDIO)
        self.assertIn('search: { tab: "curriculum", ...search }', STUDIO)
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
