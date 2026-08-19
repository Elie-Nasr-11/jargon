"""R45 — the consolidated class (owner directive, 2026-08-18):

"There shouldn't be multiple organisations for one teacher. … Why do we have classes and
then courses? … You create a class, and in the class, I have a curriculum — you wrote
the curriculum for the class, not for a course. … If you have another section of the
class, you just go into your students section and you input all of your students as
multiple sections."

Owner-confirmed scope: sections assign EXISTING registered accounts (creation stays with
the admin); classes stay admin-created; existing class content is preserved, flattened.

Pins:
- One school per teacher: no org grouping or org names in teacher chrome.
- The curriculum is written FOR the class: the outline is a flat Units → Lessons list,
  "+ Unit" auto-creates the class's invisible backing course when needed, the breadcrumb
  hides subject/course, and the books machinery is demoted to a collapsed drawer.
- Sections live in the Students tab: a `section` label on class_memberships (migration
  registered in the deploy workflow), teacher-managed via three curriculum-admin actions.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
FUNCTION = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
MIGRATION = ROOT / "supabase" / "migrations" / "20261010000000_class_sections.sql"
WORKFLOW = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")
TYPES = (FRONTEND / "lib" / "types.ts").read_text(encoding="utf-8")
NAV = (FRONTEND / "features" / "teacher" / "shell" / "teacherNav.ts").read_text(encoding="utf-8")
SIDEBAR = (FRONTEND / "features" / "teacher" / "shell" / "TeacherSidebar.tsx").read_text(
    encoding="utf-8"
)
CONSOLE = (FRONTEND / "features" / "teacher" / "TeacherConsole.tsx").read_text(encoding="utf-8")
STUDIO = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")


class OneSchoolPerTeacherTests(unittest.TestCase):
    def test_org_grouping_helpers_are_retired(self):
        self.assertNotIn("groupClassesByOrg", NAV)
        self.assertNotIn("organizationName", NAV)
        self.assertNotIn("groupClassesByOrg", SIDEBAR)
        self.assertNotIn("organizationName", CONSOLE)

    def test_class_lists_render_flat(self):
        self.assertIn("classes.map((cls) => classRow(cls))", SIDEBAR)


class SectionsTests(unittest.TestCase):
    def test_migration_exists_and_is_registered(self):
        self.assertTrue(MIGRATION.exists())
        migration = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("add column if not exists section text", migration)
        self.assertIn("20261010000000_class_sections.sql", WORKFLOW)

    def test_roster_actions_are_registered_and_authorized(self):
        for action in (
            '"list_enrollable_students"',
            '"enroll_students"',
            '"set_member_section"',
        ):
            with self.subTest(action=action):
                self.assertIn(f"if (action === {action})", FUNCTION)
        body = FUNCTION.split("async function listEnrollableStudents")[1]
        self.assertIn("assertCanAuthor(config, actorId, scope.organizationId, scope.classId)", body)
        # Enroll validates the pool (org students only) and upserts on the unique pair,
        # so a re-enroll reactivates instead of failing.
        self.assertIn("are not active students of this organization", FUNCTION)
        self.assertIn("class_memberships?on_conflict=class_id,user_id", FUNCTION)

    def test_client_wrappers_and_membership_shape(self):
        self.assertIn("export async function fetchEnrollableStudents", API)
        self.assertIn("export function enrollStudents", API)
        self.assertIn("export function setMemberSection", API)
        self.assertIn('"id,class_id,user_id,role,status,created_at,section"', API)
        self.assertIn("section?: string | null;", TYPES)

    def test_students_tab_groups_by_section(self):
        self.assertIn("sectionGroups", CONSOLE)
        self.assertIn('"No section"', CONSOLE)
        self.assertIn("Add students", CONSOLE)
        self.assertIn("New section…", CONSOLE)
        # Account creation stays with the admin — the dialog says so.
        self.assertIn("New accounts are created by", CONSOLE)


class ClassIsTheCourseTests(unittest.TestCase):
    def test_outline_is_flat_units(self):
        self.assertIn("units={outlineUnits}", STUDIO)
        self.assertIn("const classUnits = useMemo", STUDIO)
        # The outline header creates units, not subjects.
        outline = STUDIO.split("function Outline({")[1].split("function OutlineRow(")[0]
        self.assertIn("onAddUnit", outline)
        self.assertNotIn("onAddSubject", outline)
        self.assertNotIn('"subject"', outline)

    def test_new_unit_auto_creates_the_backing_course(self):
        self.assertIn("const addUnitToClass = ()", STUDIO)
        self.assertIn("Could not create the class curriculum home.", STUDIO)
        # The backing course/subject are titled after the class (they leak nowhere else).
        self.assertIn("title: selectedClass!.name,", STUDIO)

    def test_breadcrumb_hides_subject_and_course(self):
        self.assertNotIn("label: path.subject.title", STUDIO)
        self.assertNotIn("label: path.course.title", STUDIO)
        self.assertIn("label: path.unit.title", STUDIO)

    def test_books_machinery_is_demoted_to_a_drawer(self):
        self.assertIn("Books &amp; shared content", STUDIO)
        self.assertIn("const [booksOpen, setBooksOpen] = useState(false);", STUDIO)

    def test_shared_units_stay_honest_without_eating_the_title(self):
        # Long peer lists live in the tooltip; the row shows a short "shared" chip and
        # the meta span can never squeeze the label out (max-w + truncate).
        self.assertIn('annotation ? "shared" : null,', STUDIO)
        self.assertIn("metaTitle={annotation ?? undefined}", STUDIO)
        self.assertIn("max-w-[45%] shrink-0 truncate", STUDIO)


if __name__ == "__main__":
    unittest.main()
