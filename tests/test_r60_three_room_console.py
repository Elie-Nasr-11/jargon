"""R60 — the old builder dies for real; Content is a list you edit in place.

Owner (2026-08-25): "why is the old curriculum builder back?? … lets just have the
teachers view have students, activity, and content … we keep things super simple.
remember, the users are lazy and not tech savvy."

What was actually back: the pre-R47 `StructureDetail` node-editor pane survived inside
the studio as the DetailPane for subject/course/unit selections, and R56/R57 hung
their AI panels on it — so reaching "Build from material" swapped the clean list for
the old builder chrome, and "Duplicate for this class" auto-selected a course pane
with no other door. This file pins the cure. The console-side room contract lives in
test_r47_four_tab_console (rewritten for the three rooms).
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
STUDIO = authoring_source()
API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")


class OldBuilderIsGoneTests(unittest.TestCase):
    def test_structure_detail_no_longer_exists(self):
        self.assertNotIn("function StructureDetail(", STUDIO)
        self.assertNotIn("Lifecycle", STUDIO)

    def test_only_lessons_open_an_editor(self):
        # R79: and an editor is no longer a pane — a lesson has its own address, so the
        # old ?lesson= link forwards there rather than swapping the outline out.
        self.assertIn('to: "/teacher/class/$classId/lesson/$lessonId"', STUDIO)
        self.assertIn("params: { classId: first.id, lessonId: search.lesson }", STUDIO)
        self.assertNotIn("const selection: Selection", STUDIO)

    def test_stale_pane_urls_normalize_to_the_outline(self):
        # Old bookmarks carrying ?unit/?course/?subject replace-navigate to plain
        # Content instead of resurrecting a pane.
        # R80: the studio page is gone entirely — the old URL forwards into the class.
        self.assertIn('to: "/teacher/class/$classId"', STUDIO)
        self.assertIn('search: { tab: "content" }', STUDIO)
        self.assertIn("replace: true", STUDIO)

    def test_duplicate_lands_on_the_outline_not_a_pane(self):
        # R44's fork no longer auto-selects the course node (the "builder appears
        # unbidden" path) — the success message carries the story instead.
        dup = STUDIO.split("const duplicateSharedCourse", 1)[1].split("\n  return {", 1)[0]
        self.assertNotIn("selectFromId", dup)
        self.assertIn("This class now edits its own copy", dup)


class InlineUnitAdminTests(unittest.TestCase):
    def test_unit_renames_in_place(self):
        self.assertIn("function UnitNameInput({", STUDIO)
        self.assertIn("renaming={renamingUnitId === unit.id}", STUDIO)
        # Commit is a no-op when the title is unchanged or emptied — a misclick into
        # rename can never fire a write.
        self.assertIn("if (title && current && title !== current.title)", STUDIO)

    def test_new_unit_mounts_straight_into_rename(self):
        # "New unit" -> type the name -> Enter is the whole flow; no pane, no form.
        self.assertIn("if (id) setRenamingUnitId(id);", STUDIO)

    def test_unit_delete_lives_on_the_row_and_keeps_the_empty_gate(self):
        self.assertIn('label: "Delete this unit"', STUDIO)
        self.assertIn("disabled: busy || lessons.length > 0,", STUDIO)
        self.assertIn('onDeleteUnit={(unitId) => course.deleteNode("unit", unitId)}', STUDIO)


class BuildEntryTests(unittest.TestCase):
    def test_course_build_finally_has_a_door(self):
        # R57 shipped unreachable (the course pane had no in-app link). The entry is now
        # a visible button on the Content toolbar. R77 renamed it: planning a course's
        # units and lessons is not a rival "build from material" path — it is the step
        # that makes the shape, with material as an optional input inside it.
        self.assertIn("Add units &amp; lessons", STUDIO)
        self.assertIn("onClick: openCourseBuild", STUDIO)
        self.assertIn("onBuildCourse={openCourseBuild}", STUDIO)
        self.assertIn("<AiOutlinePanel", STUDIO)

    def test_build_resolves_the_backing_course_like_new_unit_does(self):
        # One resolution for both doors — no second course-creation path to drift.
        self.assertIn("const ensureBackingCourse = useCallback(", STUDIO)
        build = STUDIO.split("const openCourseBuild", 1)[1].split(";", 5)[0]
        self.assertIn("ensureBackingCourse(accessToken)", build)
        add_unit = STUDIO.split("const addUnit = useCallback(", 1)[1].split("const addLesson", 1)[0]
        self.assertIn("ensureBackingCourse(accessToken)", add_unit)

    def test_adding_a_lesson_has_exactly_one_door(self):
        # R60 gave "+ Lesson" a menu whose first item was the material path. R75 removed
        # the menu entirely: there is one builder, and it asks about reference material
        # itself. What R60 cared about — the material path is not buried — is stronger
        # now, because it is the only path.
        # Scoped to the unit's add-lesson menu specifically — other menus in this room
        # (the outline's + Create, the step overflow) are unrelated and still stand.
        self.assertNotIn("lessonMenuFor", STUDIO)
        self.assertNotIn("Start blank", STUDIO)
        # R80: one Add per level, naming its target — and an empty unit offers the
        # drafted alternative in its own empty state rather than a second button.
        self.assertIn("onAddLesson={() => onAddLesson(unit.id)}", STUDIO)
        self.assertIn("Add a lesson", STUDIO)

    def test_the_outline_carries_units_and_lessons_only(self):
        # R60 moved assignments and quizzes to Activity and left materials on the
        # outline. R80 moved those to the lesson that shows them, so the outline is
        # units and lessons — one hierarchy, nothing hanging off it.
        self.assertIn("units: Array<{ unit: CurriculumUnit }>;", STUDIO)
        outline = STUDIO.split("export function CourseOutline(", 1)[1].split("function UnitBlock(", 1)[0]
        self.assertNotIn("workItems", outline)


class SharedBookTests(unittest.TestCase):
    def test_the_fork_banner_reaches_the_outline_root(self):
        # R50's guarantee: the server's "duplicate first" refusal always points at a
        # button that exists. With the panes gone that button must live on the list.
        # R80: the notice is part of the Course screen itself, above the outline.
        face = STUDIO.split("export function CourseScreen(", 1)[1].split("<CourseOutline", 1)[0]
        self.assertIn("course.sharedNotice", face)
        self.assertIn("Make a copy for this class", face)


class CachedLinksTests(unittest.TestCase):
    def test_class_links_are_cached_and_invalidated(self):
        # This ran uncached on every studio mount. Same surfaceCache discipline as the
        # authoring snapshot; any curriculum-admin write busts both.
        self.assertIn("cached(`classLinks:${classIds.slice().sort().join(\",\")}`", API)
        self.assertIn('invalidateSurface("classLinks:");', API)


if __name__ == "__main__":
    unittest.main()
