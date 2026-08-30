"""Location-independent access to the teacher console's source text.

Most teacher pins are text assertions over two files: the authoring route and
the console shell. Both grew past 4,000 lines, and splitting them is the point
of R78 — but a pin that names a file also pins the line's ADDRESS, so moving a
component would break dozens of tests that have no opinion about where it
lives. That asymmetry is failure mode 9 in the rebuild brief: the pins add drag
to removal and none to addition.

These helpers read the SURFACE, not the file. `authoring_source()` is the
authoring route plus every module under features/teacher/authoring/;
`console_source()` is the console shell plus every module under
features/teacher/console/. A pin written against them keeps its meaning after
a component moves, and still fails if the behaviour actually leaves.

Counting pins (`source.count(...)`) keep working too: moving code preserves the
count, duplicating it does not — which is exactly what a ratchet should catch.
"""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"

AUTHORING_ROUTE = SRC / "routes" / "teacher.curriculum.tsx"
AUTHORING_DIR = SRC / "features" / "teacher" / "authoring"
# R79: the lesson moved out of the studio's pane into its own screen. It is part
# of the same authoring surface, so pins that ask "does the console let a teacher
# do X to a lesson" keep reading one text.
LESSON_DIR = SRC / "features" / "teacher" / "lesson"
# R80: and the course outline is the other half of it.
COURSE_DIR = SRC / "features" / "teacher" / "course"
CONSOLE_SHELL = SRC / "features" / "teacher" / "TeacherConsole.tsx"
CONSOLE_DIR = SRC / "features" / "teacher" / "console"
# R81: Today is a room of the console, so it reads as part of the same surface.
TODAY_DIR = SRC / "features" / "teacher" / "today"


def _modules(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.suffix in (".ts", ".tsx")
    )


def _join(paths: list[Path]) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in paths if path.is_file())


def authoring_paths() -> list[Path]:
    """Every file that makes up the authoring surface, route first."""
    return (
        [AUTHORING_ROUTE]
        + _modules(AUTHORING_DIR)
        + _modules(COURSE_DIR)
        + _modules(LESSON_DIR)
    )


def console_paths() -> list[Path]:
    """Every file that makes up the console shell, entry point first."""
    return [CONSOLE_SHELL] + _modules(CONSOLE_DIR) + _modules(TODAY_DIR)


def authoring_source() -> str:
    return _join(authoring_paths())


def console_source() -> str:
    return _join(console_paths())


def teacher_source() -> str:
    """Both surfaces, for pins that only care that the console says something."""
    return authoring_source() + "\n" + console_source()
