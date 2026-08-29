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


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
STUDIO = (FRONTEND / "routes" / "teacher.curriculum.tsx").read_text(encoding="utf-8")
API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")


class OldBuilderIsGoneTests(unittest.TestCase):
    def test_structure_detail_no_longer_exists(self):
        self.assertNotIn("function StructureDetail(", STUDIO)
        self.assertNotIn("Lifecycle", STUDIO)

    def test_only_lessons_open_an_editor(self):
        self.assertIn(
            'const selection: Selection = search.lesson ? { type: "lesson", id: search.lesson } : null;',
            STUDIO,
        )

    def test_stale_pane_urls_normalize_to_the_outline(self):
        # Old bookmarks carrying ?unit/?course/?subject replace-navigate to plain
        # Content instead of resurrecting a pane.
        self.assertIn("if (!search.lesson && (search.subject || search.course || search.unit))", STUDIO)
        self.assertIn("replace: true", STUDIO)

    def test_duplicate_lands_on_the_outline_not_a_pane(self):
        # R44's fork no longer auto-selects the course node (the "builder appears
        # unbidden" path) — the success message carries the story instead.
        dup = STUDIO.split("const duplicateSharedCourse", 1)[1].split("const crumbs", 1)[0]
        self.assertNotIn("selectFromId", dup)
        self.assertIn("This class now edits its own copy", dup)


class InlineUnitAdminTests(unittest.TestCase):
    def test_unit_renames_in_place(self):
        self.assertIn("function UnitRenameInput({", STUDIO)
        self.assertIn("renamingUnitId === unit.id", STUDIO)
        # Commit is a no-op when the title is unchanged or emptied — a misclick into
        # rename can never fire a write.
        self.assertIn("if (title && current && title !== current.title)", STUDIO)

    def test_new_unit_mounts_straight_into_rename(self):
        # "New unit" -> type the name -> Enter is the whole flow; no pane, no form.
        self.assertIn("if (id) setRenamingUnitId(id);", STUDIO)

    def test_unit_delete_lives_on_the_row_and_keeps_the_empty_gate(self):
        self.assertIn('"Delete unit"', STUDIO)
        self.assertIn("canDeleteUnit={(id) => lessonsForUnit(id).length === 0}", STUDIO)
        self.assertIn('onDeleteUnit={(id) => deleteNode("unit", id)}', STUDIO)


class BuildEntryTests(unittest.TestCase):
    def test_course_build_finally_has_a_door(self):
        # R57 shipped unreachable (the course pane had no in-app link). The entry is now
        # a visible button on the Content toolbar. R77 renamed it: planning a course's
        # units and lessons is not a rival "build from material" path — it is the step
        # that makes the shape, with material as an optional input inside it.
        self.assertIn("Add units &amp; lessons", STUDIO)
        self.assertIn("onClick={openCourseBuild}", STUDIO)
        self.assertIn("<AiOutlinePanel", STUDIO)

    def test_build_resolves_the_backing_course_like_new_unit_does(self):
        # One resolution for both doors — no second course-creation path to drift.
        self.assertIn("const ensureBackingCourse = async (", STUDIO)
        build = STUDIO.split("const openCourseBuild", 1)[1].split(";", 5)[0]
        self.assertIn("ensureBackingCourse(accessToken, targetClassId)", build)
        add_unit = STUDIO.split("const addUnitToClass", 1)[1].split("const openCourseBuild", 1)[0]
        self.assertIn("ensureBackingCourse(accessToken, targetClassId)", add_unit)

    def test_adding_a_lesson_has_exactly_one_door(self):
        # R60 gave "+ Lesson" a menu whose first item was the material path. R75 removed
        # the menu entirely: there is one builder, and it asks about reference material
        # itself. What R60 cared about — the material path is not buried — is stronger
        # now, because it is the only path.
        # Scoped to the unit's add-lesson menu specifically — other menus in this room
        # (the outline's + Create, the step overflow) are unrelated and still stand.
        self.assertNotIn("lessonMenuFor", STUDIO)
        self.assertNotIn("Start blank", STUDIO)
        self.assertIn("onAdd={() => onBuildLesson(unit.id)}", STUDIO)

    def test_content_list_carries_materials_only(self):
        # Assignments and quizzes moved to Activity; the outline's work rows are the
        # teaching materials.
        self.assertIn(
            'workItems={workItems.filter((entry) => entry.kind === "material")}', STUDIO
        )


class SharedBookTests(unittest.TestCase):
    def test_the_fork_banner_reaches_the_outline_root(self):
        # R50's guarantee: the server's "duplicate first" refusal always points at a
        # button that exists. With the panes gone that button must live on the list.
        self.assertIn("function SharedCourseNotice({", STUDIO)
        root_face = STUDIO.split("selection === null ? (", 1)[1].split("<ClassworkList", 1)[0]
        self.assertIn("<SharedCourseNotice", root_face)


class CachedLinksTests(unittest.TestCase):
    def test_class_links_are_cached_and_invalidated(self):
        # This ran uncached on every studio mount. Same surfaceCache discipline as the
        # authoring snapshot; any curriculum-admin write busts both.
        self.assertIn("cached(`classLinks:${classIds.slice().sort().join(\",\")}`", API)
        self.assertIn('invalidateSurface("classLinks:");', API)


if __name__ == "__main__":
    unittest.main()
