"""R60b — the lesson editor a lazy teacher can use.

Owner (2026-08-25): "we should also simplify the lesson building view. remember, the
users are lazy and not tech savvy."

Before: ~90 controls on one scrolling page — a 14-field basics form, 8 add-step
chips, ~25 controls per expanded step, and THREE independent Save buttons whose
unsaved state was invisible. After: a lesson reads as title + objective + steps;
everything else folds away; one save owns saving.

R79 rebuilt the editor as its own screen (four sections at /teacher/class/$id/
lesson/$id). Every contract below survived the rebuild and is re-stated against
its new home: the one Save moved from a sticky bottom bar into the sticky header,
and "Advanced settings" became the settings dialog behind the header's menu.
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
LESSON = FRONTEND / "features" / "teacher" / "lesson"
STUDIO = authoring_source()
KNOWLEDGE = (FRONTEND / "features" / "teacher" / "KnowledgeCard.tsx").read_text(encoding="utf-8")
SCREEN = (LESSON / "LessonScreen.tsx").read_text(encoding="utf-8")
HEADER = (LESSON / "LessonHeader.tsx").read_text(encoding="utf-8")
SETTINGS = (LESSON / "LessonSettings.tsx").read_text(encoding="utf-8")
STEPS = (LESSON / "LessonSteps.tsx").read_text(encoding="utf-8")


def _slice(text: str, start: str, end: str) -> str:
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


STEP = _slice(STUDIO, "export function StepCard({", "\nfunction ")


class OneSaveTests(unittest.TestCase):
    def test_the_per_form_save_buttons_are_gone(self):
        self.assertNotIn("Save lesson basics", STUDIO)
        self.assertNotIn("Save step", STEP.split("{/* R48:")[0])
        # The strip's historical comment may mention it; no BUTTON carries the label.
        self.assertNotIn(">Save step<", STUDIO)

    def test_one_save_owns_saving(self):
        self.assertIn('"Everything is saved"', HEADER)
        self.assertIn("unsaved change", HEADER)
        # R79: it rides the header, which sticks, so it is reachable from anywhere in
        # a long lesson without scrolling back up.
        self.assertIn("sticky top-0", SCREEN)
        self.assertEqual(SCREEN.count("onSave={saveAll}"), 1)

    def test_children_register_dirty_state_not_moved_state(self):
        # The registry holds flush closures; child field state stays in the children.
        self.assertIn("const flushers = useRef(new Map<string, () => void>());", SCREEN)
        self.assertIn("registerDirty", SCREEN)
        self.assertIn("unregisterDirty", SCREEN)
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
        self.assertIn('saveAll();\n              authoring.setPublication("publish_lesson");', SCREEN)

    def test_steps_flush_before_meta(self):
        # The meta path may refetch; a step write racing it would visually revert.
        body = _slice(SCREEN, "const saveAll = useCallback", "}, [stepDirty, meta, authoring]);")
        self.assertLess(body.index("flushers.current.get(id)?.()"), body.index("saveMeta"))

    def test_meta_save_is_optimistic_once_the_milestone_exists(self):
        # Same race, structural fix: an existing milestone saves via the optimistic
        # path (no refetch); only the FIRST save (server-assigned id) reloads.
        body = _slice(STUDIO, "const saveMeta = useCallback(", "const upsertStep")
        self.assertIn("if (!existing) {", body)
        self.assertIn("optimistic(", body)


class QuietByDefaultTests(unittest.TestCase):
    def test_the_lesson_shows_title_and_objective_only(self):
        self.assertIn('aria-label="Lesson title"', HEADER)
        self.assertIn('aria-label="Lesson objective"', HEADER)
        for folded in ('label="Level"', 'label="Mentor prompt"', 'label="Help ceiling"'):
            with self.subTest(folded=folded):
                self.assertNotIn(folded, HEADER)
                self.assertIn(folded, SETTINGS)
        self.assertIn("Lesson settings…", SCREEN)

    def test_the_eight_chips_became_one_grouped_menu(self):
        self.assertIn("Add a step", STEPS)
        for group in ('group: "Teach"', 'group: "Practice"', 'group: "Assess"'):
            with self.subTest(group=group):
                self.assertIn(group, STEPS)
        # Still single-sourced from the mode vocabulary.
        self.assertIn("MODE_META.filter", STEPS)
        self.assertIn("defaultStepForMode(meta.mode)", STEPS)

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
        self.assertIn('label="Lesson actions"', HEADER)
        self.assertIn('"Delete lesson"', SCREEN)
        self.assertIn('"Move to another unit…"', SCREEN)
        self.assertIn("Publish", HEADER)
        self.assertIn("lesson.publication_status", HEADER)

    def test_knowledge_card_is_quiet_but_its_badge_still_loads(self):
        self.assertIn("bodyOpen", KNOWLEDGE)
        # The eager load survives — the "N to review" badge IS the summary.
        self.assertIn("void load();", KNOWLEDGE)
        self.assertIn("to review", KNOWLEDGE)


if __name__ == "__main__":
    unittest.main()
