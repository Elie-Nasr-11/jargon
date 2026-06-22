from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT_FUNCTION = ROOT / "supabase" / "functions" / "chat" / "index.ts"


class SupabaseChatFunctionStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CHAT_FUNCTION.read_text(encoding="utf-8")

    def test_legacy_messages_contract_is_preserved(self):
        self.assertIn("function isLegacyRequest", self.source)
        self.assertIn("Array.isArray(body.messages)", self.source)
        self.assertIn("async function handleLegacyRequest", self.source)
        self.assertIn("return json({ reply:", self.source)

    def test_typed_request_contract_is_supported(self):
        for field in ("lesson_id", "session_id", "answer", "mentor_preferences"):
            self.assertIn(field, self.source)
        for mode in ("text", "code", "multiple_choice", "file"):
            self.assertIn(mode, self.source)
        self.assertIn("async function handleTypedRequest", self.source)

    def test_mentor_preferences_are_normalized_and_prompted(self):
        self.assertIn("function normalizeMentorPreferences", self.source)
        for value in ("brief", "balanced", "guided", "neutral", "encouraging", "low", "medium", "high"):
            self.assertIn(value, self.source)

    def test_typed_response_envelope_contains_required_fields(self):
        helper = self.source[
            self.source.index("function makeEnvelope") : self.source.index("function typedError")
        ]
        for field in (
            "status",
            "reply",
            "session_id",
            "lesson_id",
            "stage",
            "response_mode",
            "choices",
            "exercise",
            "assessment",
            "next_action",
            "guardrail",
        ):
            self.assertIn(field, helper)

    def test_controlled_ai_and_config_error_paths_exist(self):
        self.assertIn("OPENAI_API_KEY is not configured.", self.source)
        self.assertIn("Mentor returned invalid JSON.", self.source)
        self.assertIn("typedError(errorMessage(err)", self.source)
        self.assertIn("return typedError(\"lesson_id is required.\"", self.source)

    def test_runtime_persistence_tables_are_used(self):
        for table in (
            "learning_sessions",
            "learning_turns",
            "lesson_attempts",
            "lesson_activities",
            "quiz_items",
            "quiz_attempts",
            "learning_evidence",
            "student_mastery",
            "mentor_recommendations",
        ):
            self.assertIn(table, self.source)
        self.assertIn("fetchCurrentUser", self.source)
        self.assertIn("loadOrCreateSession", self.source)
        self.assertIn("writeEvidenceAndMastery", self.source)
        self.assertIn("maybeWriteRecommendation", self.source)

    def test_guardrails_and_course_flow_are_explicit_in_prompt(self):
        self.assertIn("structured course conversation", self.source)
        self.assertIn("natural speech -> baby Jargon -> Jargon pseudocode -> Python bridge", self.source)
        self.assertIn("guardrail", self.source)
        for action in ("retry", "rescue", "complete"):
            self.assertIn(action, self.source)

    def test_orchestrator_loads_lesson_context_before_prompting(self):
        self.assertIn("async function loadContext", self.source)
        for fragment in (
            "milestones?id=eq",
            "quiz_items?lesson_id=eq",
            "recent_turns",
            "recent_attempts",
            "mastery_summary",
            "orchestrator_flow",
            "deterministic_assessment",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.source)

    def test_deterministic_flow_owns_state_and_completion(self):
        self.assertIn("function flowFor", self.source)
        self.assertIn("function sessionStatus", self.source)
        self.assertIn('stage: "complete"', self.source)
        self.assertIn('nextAction: "complete"', self.source)
        self.assertIn('nextAction: "choose"', self.source)
        self.assertIn('responseMode: "multiple_choice"', self.source)
        self.assertIn("retry_count", self.source)
        self.assertIn("rescue_count", self.source)
        self.assertIn('answer.mode === "text" || answer.mode === "file"', self.source)
        self.assertIn('stage: "assessment"', self.source)

    def test_structured_records_are_written_by_orchestrator(self):
        for fragment in (
            'insertRow(config, "quiz_attempts"',
            'insertRow(config, "learning_evidence"',
            'insertRow(config, "mentor_recommendations"',
            'insertRow(config, "student_mastery"',
            "student_mastery?user_id=eq.",
            "graded_by: \"system\"",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.source)
        self.assertRegex(self.source, r"patchRows\(\s*config,\s*`learning_sessions\?")

    def test_resources_are_loaded_and_returned_in_typed_envelope(self):
        for fragment in (
            "resources?: LessonChatResource[]",
            "lesson_resources?lesson_id=eq.",
            "resource_interactions?user_id=eq.",
            "lesson_resources: context.resources.map",
            "resource_interactions: context.resourceInteractions",
            "resourcesForResponse(context.resources, answer)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.source)


if __name__ == "__main__":
    unittest.main()
