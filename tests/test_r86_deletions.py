"""R86 — step 9 of the rebuild brief, and the last one.

    9  Delete the old routes. Not deprecate. Delete.   [Deletes:] the remainder

Part 6 said how: "A new surface built beside the old one, screen by screen, with the
old route deleted the moment its replacement lands." The redirects were the "beside";
this step removes them, along with everything else the rebuild left behind.

These pins are almost all `assertFalse(...exists())`, which is what a subtraction
release's pins look like. They are the ratchet Law 6 asks for: a future release that
wants any of this back has to say so out loud.
"""
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
ROUTE_TREE = (SRC / "routeTree.gen.ts").read_text(encoding="utf-8")
ROOT_ROUTE = (SRC / "routes" / "__root.tsx").read_text(encoding="utf-8")

# Every route the app has, after step 9.
LIVE_ROUTES = {
    "__root.tsx",
    "index.tsx",
    "login.tsx",
    "learn.tsx",
    "teacher.tsx",
    "teacher.class.$classId.tsx",
    "teacher.class.$classId.lesson.$lessonId.tsx",
    "teacher.class.$classId.student.$studentId.tsx",
    "admin.tsx",
    "platform.tsx",
}


class TheOldRoutesAreGoneTests(unittest.TestCase):
    def test_the_authoring_route_is_deleted(self):
        # The last one. R80 left it as a 72-line redirect; a redirect is a
        # deprecation, and the brief says not to.
        self.assertFalse((SRC / "routes" / "teacher.curriculum.tsx").exists())
        self.assertNotIn("/teacher/curriculum", ROUTE_TREE)
        self.assertNotIn("TeacherCurriculum", ROUTE_TREE)

    def test_the_route_set_is_exactly_the_rebuilt_surface(self):
        # A ratchet on the whole router: adding a route means editing this list, which
        # means saying which screen it is. R43-R76 added surfaces without ever removing
        # one — failure mode 1, the single largest cause.
        found = {p.name for p in (SRC / "routes").glob("*.tsx")}
        self.assertEqual(found, LIVE_ROUTES)


class AnOldLinkStillLandsTests(unittest.TestCase):
    """Deleting the redirects makes the 404 the landing for every retired URL."""

    def test_a_signed_in_person_is_taken_to_their_own_home(self):
        block = ROOT_ROUTE.split("function NotFoundComponent()", 1)[1].split("\n}", 1)[0]
        self.assertIn("fetchPrimaryRole(session.access_token, session.user.id)", block)
        self.assertIn("navigate({ ...roleHomeNav(role), replace: true })", block)

    def test_a_signed_out_person_is_sent_to_sign_in(self):
        block = ROOT_ROUTE.split("function NotFoundComponent()", 1)[1].split("\n}", 1)[0]
        self.assertIn('navigate({ to: "/login", replace: true })', block)

    def test_it_never_strands_someone_silently(self):
        # If the role lookup fails we do NOT bounce them somewhere they may not be
        # allowed — the page shows, and it says what happened.
        self.assertIn("setStranded(true)", ROOT_ROUTE)
        self.assertIn("That page has moved.", ROOT_ROUTE)
        self.assertNotIn("404", ROOT_ROUTE)


class TheRemainderTests(unittest.TestCase):
    def test_unused_vendored_components_are_gone(self):
        # ~3,100 lines of shadcn components no screen ever imported. Vite tree-shook
        # them, so this was never about bytes — failure mode 7 was that you cannot see
        # a room you cannot read.
        for name in ("sidebar", "chart", "menubar", "calendar", "form", "table", "card", "badge"):
            with self.subTest(name=name):
                self.assertFalse((SRC / "components" / "ui" / f"{name}.tsx").exists())

    def test_the_components_still_in_use_survived(self):
        for name in ("button", "dialog", "input", "tabs", "sonner", "tooltip"):
            with self.subTest(name=name):
                self.assertTrue((SRC / "components" / "ui" / f"{name}.tsx").exists())

    def test_other_unimported_modules_are_gone(self):
        for path in (
            SRC / "lib" / "subjectIcon.ts",
            SRC / "lib" / "error-page.ts",
            SRC / "student" / "FlipNumber.tsx",
        ):
            with self.subTest(path=path.name):
                self.assertFalse(path.exists())

    def test_nothing_still_imports_what_was_deleted(self):
        deleted = (
            "components/ui/sidebar",
            "components/ui/chart",
            "components/ui/card",
            "components/ui/table",
            "lib/subjectIcon",
            "lib/error-page",
            "student/FlipNumber",
            "routes/teacher.curriculum",
        )
        text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in SRC.rglob("*.ts*")
            if path.is_file()
        )
        for name in deleted:
            with self.subTest(name=name):
                self.assertNotIn(f'"@/{name}"', text)


if __name__ == "__main__":
    unittest.main()
