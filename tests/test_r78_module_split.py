"""R78 — step 2 of the rebuild brief: the teacher surface is readable.

Owner directive 2026-08-28 ("go for step 2 please"), against the brief's own
step 2: "Split the mega-files. No behaviour change. Outline, lesson editor, step
editor, builder, dialogs — separate modules. Nothing can be designed while it's
unreadable."

Before: teacher.curriculum.tsx 6,301 lines and TeacherConsole.tsx 4,501 lines —
two files holding the whole teacher product. After: two entry points that own
state and write paths, and a module per surface underneath them.

Pinned contracts:
- No file in the teacher surface exceeds a working ceiling. This is a RATCHET,
  not a description: the console got to 16k lines because nothing ever said stop.
- Every module says what it is in a doc block at the top. A file you have to read
  to identify is the thing the brief is trying to end.
- Nothing is declared twice. The split moved code; it did not copy it.
- Test pins read the SURFACE, never a mega-file's path (see teacher_sources.py),
  so a component can move without breaking a pin that has no opinion on location.
- The studio still loads on demand — the split must not have made the Students
  landing pull the authoring chunk.
"""
from pathlib import Path
import re
import unittest

from tests.teacher_sources import (
    AUTHORING_ROUTE,
    CONSOLE_SHELL,
    authoring_paths,
    authoring_source,
    console_paths,
    console_source,
)


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
AUTHORING = SRC / "features" / "teacher" / "authoring"
CONSOLE = SRC / "features" / "teacher" / "console"

# The ceiling for a module. ClassDetail is the largest at ~1,030 lines and is next
# in the queue to be rebuilt; nothing may grow past it without a deliberate raise.
LINE_CEILING = 1_100
# The two entry points are still oversized — CurriculumStudio and the console
# shell are what steps 3-7 of the brief replace. Their allowance is DEBT, written
# down so it can only fall.
ENTRY_ALLOWANCE = {
    "routes/teacher.curriculum.tsx": 1_800,
    "features/teacher/TeacherConsole.tsx": 1_100,
}

TEACHER_FILES = sorted(
    list((SRC / "features" / "teacher").rglob("*.ts"))
    + list((SRC / "features" / "teacher").rglob("*.tsx"))
    + [AUTHORING_ROUTE, SRC / "routes" / "teacher.tsx"]
)


class ModuleSizeTests(unittest.TestCase):
    def test_no_teacher_file_exceeds_the_ceiling(self):
        oversized = {}
        for path in TEACHER_FILES:
            if not path.is_file():
                continue
            name = path.relative_to(SRC).as_posix()
            lines = path.read_text(encoding="utf-8").count("\n") + 1
            if lines > ENTRY_ALLOWANCE.get(name, LINE_CEILING):
                oversized[name] = lines
        self.assertEqual(
            oversized,
            {},
            "a teacher file grew past the ceiling — split it rather than raising this",
        )

    def test_the_entry_points_stayed_thin(self):
        # The route and the console keep state and write paths; the surfaces moved out.
        route = AUTHORING_ROUTE.read_text(encoding="utf-8")
        shell = CONSOLE_SHELL.read_text(encoding="utf-8")
        self.assertLess(route.count("\n") + 1, 1_900)
        self.assertLess(shell.count("\n") + 1, 1_100)


class ModuleShapeTests(unittest.TestCase):
    def test_the_authoring_surface_is_split_by_job(self):
        for name in (
            "types.ts",           # shapes that cross module boundaries
            "localState.ts",      # the pure outline algebra
            "stepModel.tsx",      # what kinds of step exist
            "fields.tsx",         # labelled input / textarea / select
            "dragList.tsx",       # the shared drag surface
            "Outline.tsx",        # units + lessons as one tree
            "DetailPane.tsx",     # whatever the outline has selected
            "LessonDetail.tsx",   # one lesson, open for editing
            "StepCard.tsx",       # one step, open for editing
            "referenceInput.tsx", # choosing the material a generation reads
            "generatePanels.tsx", # generate, show the diff, refine, write
            "lessonPackage.ts",   # writing a generated lesson in one call
        ):
            with self.subTest(module=name):
                self.assertTrue((AUTHORING / name).is_file())

    def test_the_console_is_split_by_room_and_manager(self):
        for name in (
            "derive.ts",              # every number the console shows
            "chrome.tsx",             # the small repeated parts
            "ClassDetail.tsx",        # one class, three rooms
            "ResourceManager.tsx",    # material
            "AssignmentManager.tsx",  # assignments
            "AssessmentManager.tsx",  # quizzes
            "GradebookTable.tsx",     # grades
            "StudentDetail.tsx",      # one student
            "GlobalReviewQueue.tsx",  # what is waiting, across classes
        ):
            with self.subTest(module=name):
                self.assertTrue((CONSOLE / name).is_file())

    def test_every_module_says_what_it_is(self):
        for path in authoring_paths() + console_paths():
            with self.subTest(module=path.name):
                head = path.read_text(encoding="utf-8").lstrip()
                self.assertTrue(
                    head.startswith("/**"),
                    f"{path.name} opens without a doc block saying what it holds",
                )

    def test_nothing_was_copied_only_moved(self):
        surface = authoring_source() + "\n" + console_source()
        for symbol in (
            "function LessonDetail(", "function StepCard(", "function ClassworkList(",
            "function DetailPane(", "function AiOutlinePanel(", "function AiStepsPanel(",
            "function ClassDetail(", "function StudentDetail(", "function GradebookTable(",
            "function ResourceManager(", "function AssignmentManager(",
            "function AssessmentManager(",
        ):
            with self.subTest(symbol=symbol):
                self.assertEqual(surface.count(symbol), 1)

    def test_the_studio_still_loads_on_demand(self):
        # R42's chunking: the Students landing must not pull the authoring code.
        console = console_source()
        self.assertIn("lazy(() =>", console)
        self.assertIn('import("@/routes/teacher.curriculum")', console)


class PinLocationTests(unittest.TestCase):
    """Failure mode 9 in the brief: pins that add drag to removal and none to addition."""

    MEGA = re.compile(r'"(teacher\.curriculum\.tsx|TeacherConsole\.tsx)"')

    def test_no_pin_reads_a_mega_file_by_path(self):
        offenders = []
        for path in sorted((ROOT / "tests").glob("test_*.py")):
            text = path.read_text(encoding="utf-8")
            for match in self.MEGA.finditer(text):
                line = text[: match.start()].count("\n") + 1
                offenders.append(f"{path.name}:{line}")
        self.assertEqual(
            offenders,
            [],
            "read the surface via tests/teacher_sources.py so the pin survives a move",
        )


if __name__ == "__main__":
    unittest.main()
