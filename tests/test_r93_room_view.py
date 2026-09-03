"""R93: EXECUTABLE property tests over the room derivations.

The rest of tests/test_r93_class_room.py pins source text. This one RUNS
frontend/src/features/teacher/cognition/room.ts — the file that decides what a
teacher actually reads when they open a class — against tests/room_view.test.ts.

Mechanics, the same shape as the Pillar-4 flow harness: room.ts, labels.ts and the
shared formatter it uses all sit behind the frontend's "@/" path alias, which deno
cannot resolve, so this copies them into a temp dir beside the suite with the aliases
rewritten to relative paths and the type-only import of the API types dropped (deno
does not need it to run).

Skips (with a visible reason) when deno is not installed.
"""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
COGNITION = ROOT / "frontend" / "src" / "features" / "teacher" / "cognition"
LIB = ROOT / "frontend" / "src" / "lib"
SUITE = ROOT / "tests" / "room_view.test.ts"


def _portable(source: str) -> str:
    """Frontend module -> something deno can run standalone."""
    # The API types are type-only here; deno does not need them to execute.
    source = re.sub(r'import type \{[^}]*\} from "@/lib/api";\n', "", source)
    source = re.sub(
        r'import \{([^}]*)\} from "@/features/teacher/cognition/labels";',
        r'import {\1} from "./labels.ts";',
        source,
    )
    # countOf lives with the other formatters (R98) so one pluraliser serves the app.
    source = re.sub(
        r'import \{([^}]*)\} from "@/lib/format";',
        r'import {\1} from "./format.ts";',
        source,
    )
    # RoomStudent / RoomSummary came from the API module; the suite supplies shapes.
    source = source.replace("import type { RoomStudent, RoomSummary } from", "// import type { RoomStudent, RoomSummary } from")
    source = source.replace("students: RoomStudent[]", "students: any[]")
    source = source.replace("students: RoomStudent[];", "students: any[];")
    source = source.replace("room: RoomSummary | null | undefined", "room: any")
    source = source.replace("import type { CognitionDims } from", "// import type { CognitionDims } from")
    source = source.replace("keyof CognitionDims", "string")
    return source


class RoomViewProperties(unittest.TestCase):
    def test_the_room_view_upholds_its_promises(self):
        deno = shutil.which("deno")
        if not deno:
            self.skipTest("deno is not installed in this environment")
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            for name in ("labels.ts", "room.ts"):
                (scratch / name).write_text(
                    _portable((COGNITION / name).read_text(encoding="utf-8")), encoding="utf-8"
                )
            (scratch / "format.ts").write_text(
                _portable((LIB / "format.ts").read_text(encoding="utf-8")), encoding="utf-8"
            )
            (scratch / "room_view.test.ts").write_text(
                SUITE.read_text(encoding="utf-8"), encoding="utf-8"
            )
            result = subprocess.run(
                [deno, "test", "--no-check", "--no-lock", "-A", "room_view.test.ts"],
                cwd=scratch,
                capture_output=True,
                text=True,
                timeout=300,
            )
        self.assertEqual(result.returncode, 0, f"{result.stdout}\n{result.stderr}")
        # Every Deno.test in the suite ran — a green run that quietly filtered half the
        # properties is the failure mode this harness exists to prevent (Pillar 4).
        expected = SUITE.read_text(encoding="utf-8").count("Deno.test(")
        self.assertIn(f"{expected} passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
