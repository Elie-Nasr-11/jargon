from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ARCHITECTURE = ROOT / "docs" / "PRODUCT_ARCHITECTURE.md"
IDENTITY = ROOT / "supabase" / "migrations" / "0004_identity_and_roles.sql"
CURRICULUM = ROOT / "supabase" / "migrations" / "0005_curriculum_hierarchy.sql"
RECORDS = ROOT / "supabase" / "migrations" / "0006_learning_records.sql"
SECURITY_FOLLOWUP = ROOT / "supabase" / "migrations" / "0007_foundation_security_followup.sql"

LESSON_IDS = (
    "lesson1",
    "lesson2",
    "lesson3",
    "lesson4",
    "lesson5",
    "coding1",
    "coding2",
    "coding3",
    "coding4",
    "coding5",
)


class ChatLmsBuildoutMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.architecture = PRODUCT_ARCHITECTURE.read_text(encoding="utf-8")
        cls.identity = IDENTITY.read_text(encoding="utf-8")
        cls.curriculum = CURRICULUM.read_text(encoding="utf-8")
        cls.records = RECORDS.read_text(encoding="utf-8")
        cls.security_followup = SECURITY_FOLLOWUP.read_text(encoding="utf-8")
        cls.identity_lower = cls.identity.lower()
        cls.curriculum_lower = cls.curriculum.lower()
        cls.records_lower = cls.records.lower()
        cls.security_followup_lower = cls.security_followup.lower()

    def test_product_architecture_locks_chat_first_lms_contract(self):
        for phrase in (
            "chat-first LMS",
            "teacher-led classes",
            "guide, quiz, grade, recommend, and flag",
            "structured authoring first",
            "Document/PDF import is deferred",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.architecture)

        for term in (
            "Organization",
            "Class",
            "Course",
            "Milestone",
            "Evidence",
            "Mastery",
            "Assignment",
            "Quiz",
            "Recommendation",
        ):
            with self.subTest(term=term):
                self.assertRegex(self.architecture, rf"(?m)^### {re.escape(term)}$")

    def test_identity_migration_adds_role_tables_and_keeps_profiles_display_only(self):
        for table in (
            "organizations",
            "platform_admins",
            "organization_memberships",
            "classes",
            "class_memberships",
        ):
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.identity_lower)
                self.assertIn(f"alter table public.{table} enable row level security", self.identity_lower)

        self.assertIn("add column if not exists avatar_url text", self.identity_lower)
        self.assertIn("add column if not exists preferences jsonb", self.identity_lower)
        self.assertNotIn("alter table public.profiles\n  add column if not exists role", self.identity_lower)

    def test_identity_migration_uses_db_controlled_authorization_helpers(self):
        for function in (
            "is_platform_admin",
            "is_org_member",
            "is_org_admin",
            "is_org_teacher",
            "is_class_member",
            "is_class_teacher",
            "can_view_student",
        ):
            with self.subTest(function=function):
                self.assertIn(f"function public.{function}", self.identity_lower)
                self.assertIn(f"revoke all on function public.{function}", self.identity_lower)
                self.assertIn(f"grant execute on function public.{function}", self.identity_lower)

        self.assertIn("raw_user_meta_data", (ROOT / "supabase" / "migrations" / "0001_init.sql").read_text())
        self.assertNotIn("raw_user_meta_data", self.identity)
        self.assertNotIn("user_metadata", self.identity_lower)

    def test_identity_migration_hardens_private_learner_access(self):
        self.assertIn(
            "revoke execute on function public.handle_new_user() from public, anon, authenticated",
            self.identity_lower,
        )
        for table in (
            "profiles",
            "chat_messages",
            "code_submissions",
            "learning_sessions",
            "learning_turns",
            "lesson_attempts",
            "student_mastery",
        ):
            with self.subTest(table=table):
                self.assertIn(f"revoke all privileges on table public.{table} from anon", self.identity_lower)

    def test_identity_policies_cover_cross_student_class_and_org_boundaries(self):
        required_policy_fragments = (
            "public.is_org_member(id)",
            "public.is_org_admin(id)",
            "public.is_org_teacher(organization_id)",
            "public.is_class_member(id)",
            "public.is_class_teacher(id)",
            "public.can_view_student(id)",
            "student_cm.user_id = target_user_id",
            "teacher_cm.user_id = auth.uid()",
        )
        for fragment in required_policy_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.identity)

    def test_curriculum_migration_adds_hierarchy_without_recreating_lessons(self):
        for table in ("subjects", "courses", "course_versions", "units", "milestones"):
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.curriculum_lower)
                self.assertIn(f"alter table public.{table} enable row level security", self.curriculum_lower)

        self.assertNotIn("create table public.lessons", self.curriculum_lower)
        self.assertIn("alter table public.lessons", self.curriculum_lower)
        self.assertIn("add column if not exists unit_id", self.curriculum_lower)
        self.assertIn("add column if not exists publication_status", self.curriculum_lower)
        self.assertIn("add column if not exists milestone_id", self.curriculum_lower)

    def test_curriculum_migration_seeds_v1_course_units_and_milestones(self):
        for seed_id in (
            "logic-coding-foundations",
            "jargon-foundations",
            "jargon-foundations-v1",
            "jargon-foundations-processes",
            "jargon-foundations-coding",
        ):
            with self.subTest(seed_id=seed_id):
                self.assertIn(f"'{seed_id}'", self.curriculum)

        for lesson_id in LESSON_IDS:
            with self.subTest(lesson_id=lesson_id):
                self.assertIn(f"'{lesson_id}-milestone'", self.curriculum)
                self.assertIn(f"'{lesson_id}'", self.curriculum)

        self.assertIn("set milestone_id = lesson_id || '-milestone'", self.curriculum_lower)
        self.assertIn("on conflict (id) do update set", self.curriculum_lower)

    def test_curriculum_policies_keep_org_content_member_scoped(self):
        for fragment in (
            "status = 'published' and organization_id is null",
            "organization_id is not null and public.is_org_member(organization_id)",
            "c.organization_id is not null and public.is_org_member(c.organization_id)",
            "public.is_org_admin(c.organization_id)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.curriculum)

    def test_records_migration_adds_quizzes_assignments_evidence_and_audit(self):
        for table in (
            "quiz_items",
            "quiz_attempts",
            "assignments",
            "assignment_recipients",
            "assignment_submissions",
            "learning_evidence",
            "teacher_notes",
            "mentor_recommendations",
            "grade_overrides",
            "audit_events",
        ):
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.records_lower)
                self.assertIn(f"alter table public.{table} enable row level security", self.records_lower)

    def test_records_migration_expands_mastery_without_discarding_existing_table(self):
        self.assertNotIn("drop table public.student_mastery", self.records_lower)
        self.assertIn("alter table public.student_mastery", self.records_lower)
        for column in (
            "attempt_count",
            "latest_score",
            "confidence",
            "common_error_patterns",
            "last_practiced_at",
        ):
            with self.subTest(column=column):
                self.assertIn(f"add column if not exists {column}", self.records_lower)

    def test_records_policies_expose_student_work_to_owner_and_managed_teachers(self):
        for fragment in (
            "public.can_view_student(user_id)",
            "user_id = auth.uid()",
            "public.can_manage_assignment(assignment_id)",
            "teacher_id = auth.uid()",
            "public.can_view_student(student_id)",
            "public.is_org_admin(organization_id)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.records)

    def test_records_seed_at_least_one_popup_quiz_checkpoint(self):
        for quiz_id in ("lesson1-purpose-check", "coding2-condition-check"):
            with self.subTest(quiz_id=quiz_id):
                self.assertIn(f"'{quiz_id}'", self.records)

        self.assertIn("question_type", self.records_lower)
        self.assertIn("'multiple_choice'", self.records)
        self.assertIn("correct_choice_ids", self.records_lower)

    def test_security_followup_revokes_anon_private_foundation_tables(self):
        for table in (
            "organizations",
            "platform_admins",
            "organization_memberships",
            "classes",
            "class_memberships",
            "profiles",
            "chat_messages",
            "code_submissions",
            "learning_sessions",
            "learning_turns",
            "lesson_attempts",
            "student_mastery",
            "quiz_attempts",
            "assignments",
            "assignment_recipients",
            "assignment_submissions",
            "learning_evidence",
            "teacher_notes",
            "mentor_recommendations",
            "grade_overrides",
            "audit_events",
        ):
            with self.subTest(table=table):
                self.assertIn(
                    f"revoke all privileges on table public.{table} from anon",
                    self.security_followup_lower,
                )

    def test_security_followup_removes_anon_helper_function_execute(self):
        for function_signature in (
            "is_platform_admin()",
            "is_org_member(uuid)",
            "is_org_admin(uuid)",
            "is_org_teacher(uuid)",
            "is_class_member(uuid)",
            "is_class_teacher(uuid)",
            "can_view_student(uuid)",
            "is_assignment_recipient(uuid)",
            "can_manage_assignment(uuid)",
        ):
            with self.subTest(function=function_signature):
                self.assertIn(
                    f"revoke execute on function public.{function_signature} from anon",
                    self.security_followup_lower,
                )


if __name__ == "__main__":
    unittest.main()
