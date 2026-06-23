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
HEADER_MENUS = ROOT / "frontend" / "src" / "components" / "HeaderMenus.tsx"
TEACHER_ROUTE = ROOT / "frontend" / "src" / "routes" / "teacher.tsx"


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
        cls.header_menus = HEADER_MENUS.read_text(encoding="utf-8")
        cls.teacher_route = TEACHER_ROUTE.read_text(encoding="utf-8")

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
        self.assertIn("Teacher dashboard", self.route)
        self.assertIn("/teacher/curriculum", self.route_tree)
        self.assertIn('to="/teacher/curriculum"', self.teacher_route)

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

    def test_student_lesson_menu_groups_curriculum_labels(self):
        self.assertIn("groupLessons", self.header_menus)
        self.assertIn("data-lesson-id", self.header_menus)
        chat_route = (ROOT / "frontend" / "src" / "routes" / "chat.tsx").read_text(encoding="utf-8")
        self.assertIn("lesson.curriculum_group", chat_route)
        self.assertIn("lesson.subject_title", chat_route)

    def test_default_authoring_blueprint_is_multisubject_logic_lesson(self):
        for fragment in (
            "Logic Foundations",
            "Clear Thinking",
            "Claims, Reasons, Evidence",
            "What Makes a Good Reason?",
            "logic.claims,logic.reasons,logic.evidence",
            "Because daily reading gives your brain more practice with words and ideas.",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.route)


if __name__ == "__main__":
    unittest.main()
