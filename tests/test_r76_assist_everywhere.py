"""R76 — an assistant at every building point, and one kind of building.

Owner: "at every building point there should be an ai assistant to help draft
content (steps, titles, summaries, ...)" and "building from material should not
be a separate thing ever."

Before this, drafting existed only for a whole lesson and a whole step list — the
big, rare acts — while the small writing that makes up most of authoring (a
title, an objective, the mentor prompt) had no help at all. And the builder
opened by demanding an upload, which framed working-from-material as a different
kind of building rather than the same act with a source attached.

The law, pinned here:
- ONE generation path for short fields (mode "text_field"), returning ONE string
  and writing NOTHING — the teacher's own save is still the only thing that
  commits, so an assist can always be edited away or ignored.
- Every drafted field is on an allow-list with its own guidance and length cap;
  an unknown field is refused rather than free-form prompted.
- Authorization rides whatever the field is attached to, exactly like every other
  authoring action — a lesson-scoped draft checks the lesson's course scope.
- The assist IMPROVES rather than replaces: it passes the field's current value.
- The builder asks what the lesson should teach FIRST; reference material is an
  optional input beneath it, not the panel's premise.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(encoding="utf-8")
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
BUTTON = (ROOT / "frontend" / "src" / "features" / "teacher" / "DraftFieldButton.tsx").read_text(encoding="utf-8")
STUDIO = (ROOT / "frontend" / "src" / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")


class ServerContractTests(unittest.TestCase):
    def test_short_field_drafting_is_one_mode(self):
        self.assertIn('if (mode === "text_field") {', ADMIN)
        self.assertIn('return json({ status: "ok", draft: { field, text } });', ADMIN)

    def test_fields_are_an_allow_list_not_free_form(self):
        block = ADMIN.split('if (mode === "text_field") {', 1)[1][:2600]
        for field in (
            "lesson_title:",
            "lesson_objective:",
            "unit_title:",
            "tutor_prompt:",
            "assignment_instructions:",
            "summary:",
        ):
            self.assertIn(field, block)
        self.assertIn('throw new Error("field is not one this assistant drafts.");', ADMIN)

    def test_every_field_caps_its_own_length(self):
        block = ADMIN.split('if (mode === "text_field") {', 1)[1][:2600]
        # Six fields, six caps (the seventh "max:" is the Record type's own declaration).
        self.assertEqual(block.count("        max: "), 6)
        self.assertIn("clampText(cleanText(result.text), spec.max)", ADMIN)

    def test_drafting_authorizes_like_every_other_authoring_action(self):
        block = ADMIN.split('if (mode === "text_field") {', 1)[1][:3000]
        self.assertIn("await assertCanAuthor(config, actorId, ctx.organizationId", block)
        self.assertIn('throw new Error("lesson_id or organization_id is required.");', block)

    def test_drafting_writes_nothing(self):
        block = ADMIN.split('if (mode === "text_field") {', 1)[1].split("\n  if (mode ===", 1)[0]
        for writer in ("insertRow(", "patchRows(", "upsertByConflict(", "applyLessonPublish("):
            self.assertNotIn(writer, block)


class ClientTests(unittest.TestCase):
    def test_the_helper_returns_text_only(self):
        self.assertIn("export async function draftTextField(input: {", API)
        self.assertIn('mode: "text_field"', API)
        self.assertIn("export type DraftableField =", API)

    def test_the_assist_improves_rather_than_replaces(self):
        self.assertIn("current: current?.trim() || undefined", BUTTON)
        self.assertIn('{current?.trim() ? "Improve" : label}', BUTTON)

    def test_the_assist_never_saves(self):
        # It hands the field a draft; committing stays the teacher's Save.
        for writer in ("saveCurriculumLessonMeta", "upsertCurriculumStep", "invokeCurriculumAdmin"):
            self.assertNotIn(writer, BUTTON)

    def test_the_written_fields_carry_an_assist(self):
        for field in ('field="lesson_title"', 'field="lesson_objective"', 'field="tutor_prompt"'):
            self.assertIn(field, STUDIO)


class OneKindOfBuildingTests(unittest.TestCase):
    def test_the_builder_asks_before_it_demands_material(self):
        self.assertIn("<h4 className=\"text-body font-medium text-foreground\">New lesson</h4>", STUDIO)
        self.assertIn("What should this lesson teach?", STUDIO)
        self.assertIn("Reference material (optional)", STUDIO)

    def test_the_ask_comes_before_the_upload(self):
        panel = STUDIO.split("function BuildFromMaterialPanel(", 1)[1]
        self.assertLess(
            panel.index("What should this lesson teach?"),
            panel.index("Reference material (optional)"),
        )

    def test_material_was_never_required_and_still_is_not(self):
        self.assertIn("(!referenceText.trim() && !prompt.trim())", STUDIO)
        self.assertIn("Say what the lesson should teach first.", STUDIO)


if __name__ == "__main__":
    unittest.main()
