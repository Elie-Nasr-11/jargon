"""R50 — authoring on SHARED (org-less) books gets a designed refusal, not a uuid crash.

Prod find (owner screenshot + postgres logs, 2026-08-20): clicking "+ Lesson" on a unit
of a GLOBAL book (course with organization_id NULL) sent organizationId "" into
assertCanAuthor's membership query — organization_memberships?organization_id=eq. —
and the teacher saw the raw Postgres banner 'invalid input syntax for type uuid: ""'.
Every curriculum-admin write action funnels through assertCanAuthor, so every write on
shared content crashed the same way.

Pinned contracts:
- assertCanAuthor refuses empty organizationId with the duplicate-first message BEFORE
  any uuid filter (platform admins still pass — they author global content directly).
- The studio's shared-course notice ALSO renders for a global book with no peer classes
  (isGlobal), so the "Duplicate for this class" affordance the refusal points at always
  exists. The R43 peers copy and the R44 Duplicate action stay verbatim (their pins).
"""
from pathlib import Path
import unittest
from tests.teacher_sources import authoring_source


ROOT = Path(__file__).resolve().parents[1]
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
STUDIO = authoring_source()


def _slice(text: str, start: str, end: str) -> str:
    tail = text.split(start, 1)
    assert len(tail) == 2, f"marker not found: {start!r}"
    return tail[1].split(end, 1)[0]


class SharedBookGuardTests(unittest.TestCase):
    def test_empty_org_never_reaches_a_uuid_filter(self):
        # The guard sits AFTER the platform-admin check (they may author global books)
        # and BEFORE the org-membership queries (which 400 on an empty uuid).
        body = _slice(ADMIN, "async function assertCanAuthor(", "\n}\n")
        guard = body.index("if (!organizationId) {")
        first_org_query = body.index("organization_memberships?organization_id=eq.")
        platform_check = body.index("platform_admins?user_id=eq.")
        self.assertLess(platform_check, guard)
        self.assertLess(guard, first_org_query)
        self.assertIn("This is a shared book, so it can't be edited directly.", body)
        self.assertIn('"Duplicate for this class"', body)

    def test_global_books_always_offer_the_fork(self):
        # The refusal points at the notice's Duplicate button — which must render even
        # when no peer class links the book (previously peers-gated only).
        self.assertIn("const isGlobal = !course.organization_id;", STUDIO)
        self.assertIn("peers.length || isGlobal", STUDIO)
        self.assertIn("This is a shared book — duplicate it to edit or add lessons", STUDIO)

    def test_r43_r44_contracts_survive(self):
        # Pinned elsewhere too; asserted here so this file fails loudly if the R50 copy
        # branch ever eats them.
        self.assertIn("This course is shared — changes here also reach", STUDIO)
        self.assertIn("Duplicate for this class", STUDIO)
        self.assertIn("duplicateSharedCourse(sharedNotice.courseId)", STUDIO)


if __name__ == "__main__":
    unittest.main()
