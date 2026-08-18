"""Trimmed 2026-07-30 (first: HeaderMenus removed in the MVP strip; then, trunk
unification): AppSidebar/ClassCanvas retired with the old /chat student shell —
the shared features/student/lessonGroups.ts helper is now consumed by the v6
surface's student/LessonTree.tsx, which these pins repoint to. The teacher entry
point to the studio stays in the TeacherSidebar shell (docs/MVP_SCOPE.md §1/§2).
The studio itself (studio-lite) is KEPT."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FUNCTION = ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"
SUPABASE = ROOT / "frontend" / "src" / "lib" / "supabase.ts"
CHAT_FUNCTION = ROOT / "supabase" / "functions" / "chat" / "index.ts"
ROUTE = ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx"
ROUTE_TREE = ROOT / "frontend" / "src" / "routeTree.gen.ts"
LESSON_GROUPS = ROOT / "frontend" / "src" / "features" / "student" / "lessonGroups.ts"
LESSON_TREE = ROOT / "frontend" / "src" / "student" / "LessonTree.tsx"
# R42: the studio is reached through a class's Curriculum section (teacherNav), not a
# sidebar destination of its own.
TEACHER_SIDEBAR = ROOT / "frontend" / "src" / "features" / "teacher" / "shell" / "TeacherSidebar.tsx"
TEACHER_NAV = ROOT / "frontend" / "src" / "features" / "teacher" / "shell" / "teacherNav.ts"


class CurriculumAuthoringStudioStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.function = FUNCTION.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")
        cls.supabase = SUPABASE.read_text(encoding="utf-8")
        cls.chat = CHAT_FUNCTION.read_text(encoding="utf-8")
        cls.route = ROUTE.read_text(encoding="utf-8")
        cls.route_tree = ROUTE_TREE.read_text(encoding="utf-8")
        cls.lesson_groups = LESSON_GROUPS.read_text(encoding="utf-8")
        cls.lesson_tree = LESSON_TREE.read_text(encoding="utf-8")
        cls.teacher_sidebar = TEACHER_SIDEBAR.read_text(encoding="utf-8")

    def test_curriculum_admin_function_is_privileged_and_scoped(self):
        for fragment in (
            'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
            "async function fetchCurrentUser",
            "async function assertCanAuthor",
            "platform_admins",
            "organization_memberships",
            "class_memberships",
            "Curriculum author access is required.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

        frontend_source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / "frontend" / "src").rglob("*")
            if path.suffix in {".ts", ".tsx"}
        )
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", frontend_source)

    def test_curriculum_admin_supports_required_actions_and_tables(self):
        for fragment in (
            '"save_lesson_blueprint"',
            '"publish_lesson"',
            '"archive_lesson"',
            "subjects",
            "courses",
            "course_versions",
            "units",
            "lessons",
            "milestones",
            "lesson_activities",
            "quiz_items",
            "lesson_completion_rules",
            "lesson_resources",
            "lesson_resource_placements",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.function)

    def test_frontend_exposes_authoring_route_and_edge_function(self):
        self.assertIn('"curriculum-admin"', self.supabase)
        self.assertIn('functionUrl("curriculum-admin")', self.api)
        self.assertIn("invokeCurriculumAdmin", self.api)
        self.assertIn("fetchCurriculumAuthoringData", self.api)
        self.assertIn('createFileRoute("/teacher/curriculum")', self.route)
        # R42 class-first: the studio mounts inside a class workspace; its breadcrumb is
        # rooted at the class's Curriculum section (clearing the selection), not at a
        # standalone studio page.
        self.assertIn('{ label: "Curriculum", onClick: goRoot }', self.route)
        self.assertIn("/teacher/curriculum", self.route_tree)
        # R42 class-first: the sidebar has no global Curriculum destination anymore — the
        # studio is reached through a class's Curriculum section row. The legacy route
        # stays only as a redirect for old bookmarks.
        self.assertNotIn('navigate({ to: "/teacher/curriculum" })', self.teacher_sidebar)
        self.assertIn('{ value: "curriculum", label: "Curriculum" }', TEACHER_NAV.read_text(encoding="utf-8"))

    def test_authoring_types_cover_blueprint_contract(self):
        for fragment in (
            "export type CurriculumBlueprint",
            "export type CurriculumAdminResponse",
            "export type CurriculumAuthoringData",
            'type: "discussion" | "code" | "reflection" | "multiple_choice" | "file"',
            'response_mode: "text" | "code" | "multiple_choice" | "file"',
            "resource_ids?: string[]",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.types)

    def test_drafts_are_hidden_from_student_lesson_flow(self):
        self.assertIn('eq("publication_status", "published")', self.api)
        self.assertIn("includeDrafts: true", self.api)
        self.assertIn("publication_status=eq.published", self.chat)
        self.assertIn("lesson_resources?lesson_id=eq.", self.function)
        self.assertIn("status=eq.draft", self.function)
        self.assertIn('status: "published"', self.function)

    def test_student_surfaces_group_lessons_by_curriculum_unit(self):
        # HeaderMenus/buildLessonTree gave way to the shared groupByUnit helper: the
        # student lesson catalog (v6 LessonTree) groups by unit with a course-title fallback.
        self.assertIn("export function groupByUnit", self.lesson_groups)
        self.assertIn('lesson.unit_title || lesson.course_title || "Lessons"', self.lesson_groups)
        self.assertIn("groupByUnit", self.lesson_tree)

    # removed: test_default_authoring_blueprint_is_multisubject_logic_lesson — the
    # hardcoded "Logic Foundations / Clear Thinking / Claims, Reasons, Evidence" default
    # blueprint no longer exists anywhere in the codebase after the curriculum-authoring
    # redesign (the studio now starts empty and content comes from server data / AI drafts).
    # Every assertion in that test targeted the removed seed content, so it was dropped.


if __name__ == "__main__":
    unittest.main()
