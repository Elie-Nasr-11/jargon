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
    def test_class_workspace_has_the_four_fixed_sections(self):
        # R47 four-tab console: the class spine is Live / Classwork / People / Grades —
        # every tab always visible (no hidden rooms), rendered from CLASS_SECTIONS.
        self.assertIn('export type ClassSection = "live" | "classwork" | "people" | "grades";', NAV)
        self.assertIn('{ value: "live", label: "Live" }', NAV)
        self.assertIn('{ value: "classwork", label: "Classwork" }', NAV)
        self.assertIn('{ value: "people", label: "People" }', NAV)
        self.assertIn('{ value: "grades", label: "Grades" }', NAV)
        for retired in ('"overview"', '"structure", label', '"review"', '"students"', '"curriculum"'):
            with self.subTest(retired=retired):
                self.assertNotIn(f"value: {retired}", NAV)

    def test_legacy_tabs_map_into_the_four_sections(self):
        # Content-shaped legacy values land on Classwork; grading-shaped ones on Grades;
        # the old Students landing (and unknown/absent) lands on Live.
        for case in ("curriculum", "structure", "lessons", "resources", "assignments", "assessments"):
            with self.subTest(case=case):
                self.assertIn(f'case "{case}":', NAV)
        self.assertIn('case "review":', NAV)
        self.assertIn('case "gradebook":', NAV)
        self.assertIn('return "classwork";', NAV)
        self.assertIn('return "grades";', NAV)
        self.assertIn('return "live";', NAV)
        self.assertNotIn('return "overview"', NAV)
        self.assertNotIn('return "students"', NAV)


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
    def test_studio_mounts_lazily_inside_the_class_classwork_section(self):
        self.assertIn('import("@/routes/teacher.curriculum")', CONSOLE)
        self.assertIn("module.CurriculumStudio", CONSOLE)
        self.assertIn("<CurriculumStudio", CONSOLE)
        self.assertIn('{section === "classwork" ? (', CONSOLE)

    def test_people_section_owns_the_roster_and_no_overview_remains(self):
        # R47: the old Students tab split — activity went to Live, the roster (sections,
        # enrolment) lives in People. No overview strips, no hidden review room.
        people_block = CONSOLE.split('{section === "people" ? (')[1].split(
            '{section === "grades" ? ('
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
        # Student-page back pill lands on Live; notification deep links land on Classwork
        # (grading lives ON the work now) — nothing points at the retired Students tab.
        self.assertIn('search: { tab: "live" }', CONSOLE)
        self.assertIn('tab: "classwork"', NOTIFICATIONS)
        self.assertNotIn('tab: "students"', CONSOLE)
        self.assertNotIn('tab: "students"', NOTIFICATIONS)


class StudioTests(unittest.TestCase):
    def test_studio_is_an_exported_class_scoped_component(self):
        self.assertIn("export function CurriculumStudio({", STUDIO)
        self.assertIn("classId: string;", STUDIO)
        # The host (TeacherConsole) gates the teacher role; the studio must not re-gate
        # or render its own chrome (shell imports gone, class picker gone).
        self.assertNotIn("fetchPrimaryRole", STUDIO)
        self.assertNotIn('from "@/features/teacher/shell/TeacherShell"', STUDIO)
        self.assertNotIn('from "@/components/PageShell"', STUDIO)
        self.assertNotIn("Class scope", STUDIO)

    def test_selection_rides_the_class_route(self):
        self.assertIn('to: "/teacher/class/$classId"', STUDIO)
        self.assertIn('search: { tab: "classwork", [type]: id }', STUDIO)
        self.assertIn('search: { tab: "classwork" }', STUDIO)

    def test_legacy_route_redirects_into_the_first_class(self):
        self.assertIn('createFileRoute("/teacher/curriculum")', STUDIO)
        self.assertIn("fetchTeacherClasses(session.user.id)", STUDIO)
        self.assertIn('search: { tab: "classwork", ...search }', STUDIO)
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
