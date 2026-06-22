from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPLETE_ROADMAP = ROOT / "docs" / "COMPLETE_ROADMAP.md"
ROADMAP = ROOT / "docs" / "ROADMAP.md"
DECISIONS = ROOT / "docs" / "DECISIONS.md"
PRODUCT_ARCHITECTURE = ROOT / "docs" / "PRODUCT_ARCHITECTURE.md"
OPEN_QUESTIONS = ROOT / "docs" / "OPEN_QUESTIONS.md"


class CompleteRoadmapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.complete = COMPLETE_ROADMAP.read_text(encoding="utf-8")
        cls.roadmap = ROADMAP.read_text(encoding="utf-8")
        cls.decisions = DECISIONS.read_text(encoding="utf-8")
        cls.architecture = PRODUCT_ARCHITECTURE.read_text(encoding="utf-8")
        cls.open_questions = OPEN_QUESTIONS.read_text(encoding="utf-8")

    def test_complete_roadmap_has_twelve_numbered_phases(self):
        phases = re.findall(r"(?m)^## Phase (\d+):", self.complete)
        self.assertEqual([str(i) for i in range(1, 13)], phases)

    def test_short_roadmap_points_to_complete_roadmap_and_live_state(self):
        self.assertIn("docs/COMPLETE_ROADMAP.md", self.roadmap)
        self.assertIn("Phase 0 is effectively complete", self.roadmap)
        self.assertIn("teacher dashboard + media foundation", self.complete)

    def test_lesson_resources_are_private_chat_media_by_default(self):
        for phrase in (
            "lesson-resources",
            "Default visibility is `class_private`",
            "Use signed URLs for uploaded files",
            "Do not expose uploaded classroom media as public URLs by default",
            "resources appear inside the conversation",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.complete)

    def test_resource_types_and_interfaces_are_locked(self):
        for resource_type in (
            "video",
            "audio",
            "pdf",
            "flipbook",
            "youtube",
            "image",
            "link",
            "document",
        ):
            with self.subTest(resource_type=resource_type):
                self.assertIn(resource_type, self.complete)

        self.assertIn("resources?: LessonChatResource[]", self.complete)
        self.assertIn("type ResourceInteractionEvent", self.complete)
        self.assertIn('"shown" | "opened" | "played" | "paused" | "completed" | "downloaded"', self.complete)

    def test_product_architecture_defines_resources_and_interactions(self):
        for heading in ("Lesson Resource", "Resource Interaction"):
            with self.subTest(heading=heading):
                self.assertRegex(self.architecture, rf"(?m)^### {re.escape(heading)}$")

        self.assertIn("Teacher-uploaded lesson resources are first-class curriculum support", self.architecture)
        self.assertIn("Mentor may not claim resource completion unless resource interaction records exist", self.architecture)

    def test_decisions_separate_teacher_resources_from_student_file_answers(self):
        self.assertIn("Lesson Resources Are First-Class Chat Media", self.decisions)
        self.assertIn("not the same thing as student file answers", self.decisions)
        self.assertIn("YouTube is stored as an external URL", self.decisions)
        self.assertIn("automated media extraction and transcription run", self.open_questions)


if __name__ == "__main__":
    unittest.main()
