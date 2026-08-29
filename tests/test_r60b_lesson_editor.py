"""R60b — the lesson editor a lazy teacher can use.

Owner (2026-08-25): "we should also simplify the lesson building view. remember, the
users are lazy and not tech savvy."

Before: ~90 controls on one scrolling page — a 14-field basics form, 8 add-step
chips, ~25 controls per expanded step, and THREE independent Save buttons whose
unsaved state was invisible. After: a lesson reads as title + objective + steps;
everything else folds under Advanced; one sticky save bar owns saving.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
STUDIO = authoring_source()
KNOWLEDGE = (FRONTEND / "features" / "teacher" / "KnowledgeCard.tsx").read_text(encoding="utf-8")


def _slice(text: str, start: str, end: str) -> str:
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


DETAIL = _slice(STUDIO, "function LessonDetail({", "function LessonMetaForm({")
META = _slice(STUDIO, "function LessonMetaForm({", "function StepCard({")
STEP = _slice(STUDIO, "function StepCard({", "function LessonPreview({")


class OneSaveTests(unittest.TestCase):
    def test_the_per_form_save_buttons_are_gone(self):
        self.assertNotIn("Save lesson basics", STUDIO)
        self.assertNotIn("Save step", STEP.split("{/* R48:")[0])
        # The strip's historical comment may mention it; no BUTTON carries the label.
        self.assertNotIn(">Save step<", STUDIO)

    def test_one_sticky_bar_owns_saving(self):
        self.assertIn('"All changes saved"', DETAIL)
        self.assertIn("unsaved change", DETAIL)
        self.assertEqual(DETAIL.count("Save changes"), 1)
        self.assertIn("sticky bottom-0", DETAIL)

    def test_children_register_dirty_state_not_moved_state(self):
        # The registry holds flush closures; child field state stays in the children.
        self.assertIn("const flushers = useRef(new Map<string, () => void>());", DETAIL)
        self.assertIn("registerDirty", DETAIL)
        self.assertIn("unregisterDirty", DETAIL)
        # Both children participate.
        self.assertIn('onDirtyState("meta", touched, () => flushRef.current());', META)
        self.assertIn("onDirtyState(activity.id, touched, () => flushRef.current());", STEP)
        # The temp-id → server-id swap can't leave a stale dirty entry behind.
        self.assertIn("useEffect(() => () => onUnregister(activity.id), [activity.id", STEP)

    def test_saving_a_step_no_longer_slams_the_card_shut(self):
        # flush = the old save() minus setOpen(false): the bar saves N cards at once and
        # closing them all would throw the teacher's place away.
        save_body = _slice(STEP, "const save = () => {", "const flushRef")
        self.assertNotIn("setOpen(false)", save_body)
        self.assertIn("setTouched(false)", save_body)

    def test_publish_flushes_before_publishing(self):
        idx = DETAIL.index("saveAll();\n                onPublish();")
        self.assertGreater(idx, 0)

    def test_steps_flush_before_meta(self):
        # The meta path may refetch; a step write racing it would visually revert.
        body = _slice(DETAIL, "const saveAll = useCallback", "}, [dirtyIds]);")
        self.assertIn('if (id !== "meta")', body)

    def test_meta_save_is_optimistic_once_the_milestone_exists(self):
        # Same race, structural fix: an existing milestone saves via the optimistic
        # path (no refetch); only the FIRST save (server-assigned id) reloads.
        body = _slice(STUDIO, "const saveLessonMeta = (", "const upsertStep")
        self.assertIn("if (!existing) {", body)
        self.assertIn("optimistic(", body)


class QuietByDefaultTests(unittest.TestCase):
    def test_basics_show_title_and_objective_only(self):
        visible = _slice(META, "Lesson basics", "<Collapsible")
        self.assertIn('label="Lesson title"', visible)
        self.assertIn('label="Lesson objective"', visible)
        for folded in ('label="Level"', 'label="Mentor prompt"', 'label="Help ceiling"'):
            with self.subTest(folded=folded):
                self.assertNotIn(folded, visible)
        self.assertIn("Advanced settings", META)

    def test_the_eight_chips_became_one_grouped_menu(self):
        self.assertIn("Add step", DETAIL)
        for group in ('group: "Teach"', 'group: "Practice"', 'group: "Assess"'):
            with self.subTest(group=group):
                self.assertIn(group, DETAIL)
        # Still single-sourced from the mode vocabulary.
        self.assertIn("MODE_META.filter", DETAIL)
        self.assertIn("defaultStepForMode(meta.mode)", DETAIL)

    def test_a_step_reads_as_title_prompt_choices_work(self):
        # Everything else sits under the per-step Advanced collapsible, and the R48
        # work strip stays OUT of it — linked work is the step's contract.
        open_face = _slice(STEP, "{open ? (", "<Collapsible")
        self.assertIn('label="Step title"', open_face)
        self.assertIn("config.promptLabel", open_face)
        self.assertIn("showChoices", open_face)
        self.assertIn("R48: assignment/assessment steps run on a REAL work item", open_face)
        for folded in ('label="Learning mode"', "Attached materials", "ArtifactGeneratePanel"):
            with self.subTest(folded=folded):
                self.assertNotIn(folded, open_face)

    def test_lesson_lifecycle_lives_in_the_header(self):
        self.assertIn('label="Lesson actions"', DETAIL)
        self.assertIn('"Delete lesson"', DETAIL)
        self.assertIn('"Move to unit…"', DETAIL)
        self.assertIn("Publish", DETAIL)
        self.assertIn("lesson.publication_status", DETAIL)

    def test_knowledge_card_is_quiet_but_its_badge_still_loads(self):
        self.assertIn("bodyOpen", KNOWLEDGE)
        # The eager load survives — the "N to review" badge IS the summary.
        self.assertIn("void load();", KNOWLEDGE)
        self.assertIn("to review", KNOWLEDGE)


if __name__ == "__main__":
    unittest.main()
