"""Location-independent access to the admin window's source text.

Same idea as `teacher_sources`, for the other console. The admin screen lived
in `routes/admin.tsx` until R82 moved its body to `features/admin/AdminPage.tsx`
so the route could load it on demand — and that move broke 37 pins that had no
opinion about where the screen lives, only about what it does. That is failure
mode 9 in the rebuild brief: pins that add drag to moving code and none to
adding it.

`admin_source()` reads the SURFACE — the route plus every module under
features/admin/ — so a pin keeps its meaning after the screen moves, and still
fails if the behaviour actually leaves.
"""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"

ADMIN_ROUTE = SRC / "routes" / "admin.tsx"
ADMIN_DIR = SRC / "features" / "admin"


def _modules(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.suffix in (".ts", ".tsx")
    )


def admin_paths() -> list[Path]:
    """Every file that makes up the admin window, route first."""
    return [ADMIN_ROUTE] + _modules(ADMIN_DIR)


def admin_source() -> str:
    return "\n".join(
        path.read_text(encoding="utf-8") for path in admin_paths() if path.is_file()
    )
