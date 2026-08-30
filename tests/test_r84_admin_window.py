"""R84 — step 7 of the rebuild brief: the admin window, in the order an admin works.

    School (admin) — the three admin jobs, in order

      Setup    an ordered, stateful checklist driven by list_pilot_readiness, which
               already returns teacher/student/published-lesson counts per class and
               is barely used. "Biology 10: 24 students · no teacher · 0 published
               lessons."
      People   the directory. The only place accounts are created.
      Classes  the list. The only place classes are created.
      Health   live sessions, errors, cost. Read-only.

      "Seeding" dies; demo logins move to a fenced developer corner.

The brief's complaint about the old window was specific and these pins hold the
answer to each part of it: six tabs became four, a class could be created in two of
them and now cannot, and students arrived through three doors that did subtly
different things.
"""
import unittest
from pathlib import Path

from tests.admin_sources import admin_source


ROOT = Path(__file__).resolve().parents[1]
ADMIN_DIR = ROOT / "frontend" / "src" / "features" / "admin"
SURFACE = admin_source()
SETUP = (ADMIN_DIR / "SetupPanel.tsx").read_text(encoding="utf-8")
HEALTH = (ADMIN_DIR / "HealthPanel.tsx").read_text(encoding="utf-8")
IMPORTER = (ADMIN_DIR / "RosterImport.tsx").read_text(encoding="utf-8")
CORNER = (ADMIN_DIR / "DeveloperCorner.tsx").read_text(encoding="utf-8")
CLASSES = (ADMIN_DIR / "ClassesPanel.tsx").read_text(encoding="utf-8")
PAGE = (ADMIN_DIR / "AdminPage.tsx").read_text(encoding="utf-8")


class FourTabsTests(unittest.TestCase):
    def test_the_window_is_setup_people_classes_health(self):
        self.assertIn('const visibleTabs = ["setup", "people", "classes", "health"];', PAGE)

    def test_the_tab_set_no_longer_depends_on_who_you_are(self):
        # Cost used to be a platform-admin-only TAB, so the window had a different
        # shape for different people. admin-ops already withholds dollar totals
        # server-side; the screen renders what it is given.
        self.assertNotIn("isPlatformLevel\n    ? [", PAGE)
        self.assertNotIn('WorkspaceTab value="cost"', PAGE)

    def test_old_tab_links_resolve_to_the_screen_that_took_their_content(self):
        block = PAGE.split("export function normalizeAdminTab", 1)[1].split("\n}", 1)[0]
        for legacy, room in (
            ("overview", "setup"),
            ("seeding", "setup"),
            ("live", "health"),
            ("cost", "health"),
        ):
            with self.subTest(legacy=legacy):
                self.assertIn(f'{legacy}: "{room}"', block)


class SetupTests(unittest.TestCase):
    def test_the_checklist_the_server_already_sent_is_finally_rendered(self):
        # ReadinessChecklistItem has been in the payload since R51 and rendered
        # nowhere — that is what the brief means by "barely used".
        self.assertIn("item.checklist.map", SETUP)
        self.assertIn("ReadinessChecklistItem", SETUP)

    def test_worst_classes_come_first(self):
        self.assertIn("const STATUS_ORDER", SETUP)
        block = SETUP.split("const STATUS_ORDER", 1)[1].split("};", 1)[0]
        self.assertLess(block.index("blocked"), block.index("ready"))

    def test_every_missing_item_names_what_fixes_it(self):
        # R51's Overview showed the STATUS and threw the reasons away, so an admin
        # could read "Needs setup" and still not know what to do.
        self.assertIn("const FIX_FOR", SETUP)
        for label in (
            "Active teacher",
            "Active students",
            "Published lessons",
            "Work/resources prepared",
        ):
            with self.subTest(label=label):
                self.assertIn(f'"{label}":', SETUP)

    def test_the_summary_line_matches_the_brief_s_example(self):
        # "Biology 10: 24 students · no teacher · 0 published lessons."
        self.assertIn("item.student_count", SETUP)
        self.assertIn('item.teacher_count ? `${item.teacher_count} teacher` : "no teacher"', SETUP)
        self.assertIn("item.published_lesson_count", SETUP)


class OneDoorTests(unittest.TestCase):
    def test_classes_are_created_in_exactly_one_place(self):
        # The brief: "A class can be created in two of them."
        self.assertIn("adminCreateClass", CLASSES)
        self.assertEqual(SURFACE.count("adminCreateClass("), 1)
        # The importer picks an EXISTING class instead of naming one into being.
        self.assertIn("class: { id: target.id, name: target.name }", IMPORTER)
        self.assertIn("Choose a class…", IMPORTER)

    def test_accounts_are_created_in_exactly_one_place(self):
        # The brief: "students arrive through three different doors that do subtly
        # different things (one creates accounts, two only link existing ones)."
        self.assertEqual(SURFACE.count("invokeAdminSeed("), 1)
        self.assertIn("invokeAdminSeed", IMPORTER)
        self.assertIn("the only place accounts are created", SURFACE)

    def test_the_importer_reuses_the_organization_it_is_given(self):
        # Passing an existing id makes admin-seed reuse the row rather than create
        # one, which is how a pilot used to end up with the same class twice.
        self.assertIn("id: organization.id", IMPORTER)


def _without_comments(text: str) -> str:
    """The surface a person can read — comments about the release are not it."""
    out, i, n = [], 0, len(text)
    while i < n:
        if text.startswith("/*", i):
            i = text.find("*/", i)
            i = n if i == -1 else i + 2
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


class SeedingIsDeadTests(unittest.TestCase):
    def test_the_word_is_gone_from_what_an_admin_reads(self):
        # Scoped past comments deliberately: the release's own prose explains what
        # "Seeding" was, and a pin that forbids the word everywhere would forbid
        # writing down why it died.
        visible = _without_comments(SURFACE)
        self.assertNotIn("Seeding", visible)
        self.assertNotIn("seeding,", visible)
        self.assertNotIn('value="seeding"', visible)
        # The legacy ?tab=seeding link must still resolve, and that key lives in code.
        self.assertIn('seeding: "setup"', SURFACE)

    def test_demo_logins_are_fenced(self):
        # Platform admins only, folded shut, and labelled as what it is.
        self.assertIn("isPlatformAdmin ? <DeveloperCorner", PAGE)
        self.assertIn("Developer corner", CORNER)
        self.assertIn("const [open, setOpen] = useState(false);", CORNER)
        self.assertIn("do not use this to", CORNER)


class HealthTests(unittest.TestCase):
    def test_live_and_cost_are_one_question(self):
        self.assertIn("Live sessions", HEALTH)
        self.assertIn("AI/runtime operations", HEALTH)

    def test_it_is_read_only(self):
        # Refreshing is not an action on an object; nothing here writes.
        for write in ("invokeAdminSeed", "adminCreateClass", "adminUpdateClass", "adminSetMembership"):
            with self.subTest(write=write):
                self.assertNotIn(write, HEALTH)


if __name__ == "__main__":
    unittest.main()
