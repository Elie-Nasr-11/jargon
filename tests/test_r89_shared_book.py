"""R89 — a shared book stops being a wall.

The owner's second screenshot: "Course organization scope was not found." on the same
Ask Jargon request R88 had just fixed. The scope was being sent correctly; the server
refused it. `courseScopeForLesson` throws for any lesson whose COURSE has no owning
organization, and in this product every course linked to a class is exactly that — a
shared book. So the refusal covered the whole library, and it covered every lesson-
scoped action, not just the assistant: save, publish, archive, duplicate all route
through the same function.

Two fixes, pinned here:

1. The assistant asks the question it should have been asking. Not "does this teacher
   own the book?" but "does this teacher teach this class?" — which is how
   `duplicate_course` has always authorized, and which works against the deployed
   function today. The grounding then comes from the screen, and is better for it:
   it sees words the teacher has typed and not saved.

2. `courseScopeForLesson` stops pre-empting authorization. R50 already designed the
   sentence a teacher should read here ("make a copy for this class"); throwing an
   internal string before `assertCanAuthor` could say it meant nobody ever read it.
   And the lesson screen now says the same thing itself, so the wall has a door.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
SCOPE = (SRC / "features" / "teacher" / "assist" / "scope.ts").read_text(encoding="utf-8")
BRIEF = (SRC / "features" / "teacher" / "lesson" / "lessonBrief.ts").read_text(encoding="utf-8")
SCREEN = (SRC / "features" / "teacher" / "lesson" / "LessonScreen.tsx").read_text(encoding="utf-8")


class TheServerStopsPreEmptingAuthorizationTests(unittest.TestCase):
    def test_a_shared_course_no_longer_throws_before_the_check(self):
        # The whole bug in one line. An org-less course is a designed state, not a
        # missing row, and assertCanAuthor is what knows what to say about it.
        self.assertNotIn("Course organization scope was not found.", without_comments(ADMIN))
        self.assertIn(
            'organizationId: course.organization_id ? String(course.organization_id) : "",',
            ADMIN,
        )

    def test_a_genuinely_missing_course_still_fails(self):
        # Relaxing the org must not relax the row: no course at all is still an error.
        self.assertIn('if (!course) throw new Error("Lesson course was not found.");', ADMIN)

    def test_the_sentence_a_teacher_reads_is_still_there(self):
        # R50's message is the whole point of letting the check speak.
        self.assertIn("This is a shared book, so it can't be edited directly.", ADMIN)


class TheAssistantAsksAboutTheClassTests(unittest.TestCase):
    def test_the_lesson_screen_scopes_to_the_class_and_its_organization(self):
        # organizationId + classId is the pair duplicate_course authorizes on, and the
        # only pair that works while every course is a shared book.
        self.assertRegex(
            SCREEN, r"organizationId\s*\?\s*\{ organizationId, classId, brief \}"
        )

    def test_it_falls_back_to_the_lesson_rather_than_to_nothing(self):
        # If the class summary has not loaded there is still a scope — sending neither
        # is the R88 failure, and a fallback that reintroduces it is not a fallback.
        self.assertRegex(SCREEN, r":\s*\{ lessonId: lessonId, classId, brief \}")

    def test_one_scope_serves_every_mechanism_on_the_screen(self):
        # The panel, selection-refine and the arrival proposal all failed the same way
        # because each carried its own idea of scope. Now there is one.
        self.assertIn("assistScope={assistScope}", SCREEN)
        self.assertIn("...assistScope }}", SCREEN)


class TheGroundingComesFromTheScreenTests(unittest.TestCase):
    def test_the_brief_carries_what_the_server_used_to_read(self):
        for line in ("Subject:", "Course:", "Unit:", "Lesson:", "Other lessons in this unit:"):
            with self.subTest(line=line):
                self.assertIn(line, BRIEF)
        self.assertIn("This lesson's current steps:", BRIEF)

    def test_it_reads_the_live_fields_not_the_saved_row(self):
        # The point of moving grounding to the client: a title drafted against an
        # objective the teacher just typed should see that objective.
        self.assertIn("live: { title: string; objective: string", BRIEF)
        self.assertIn("live.objective.trim()", BRIEF)

    def test_the_brief_rides_the_scope_to_the_wire(self):
        self.assertIn("referenceText: scope.brief || undefined", SCOPE)


class TheWallHasADoorTests(unittest.TestCase):
    def test_the_lesson_screen_says_when_its_book_is_shared(self):
        self.assertIn("is a shared book", SCREEN)
        self.assertIn("Make a copy for this class", SCREEN)

    def test_it_sends_the_teacher_where_the_copy_actually_works(self):
        # The fork replaces the lesson ids, so forking FROM the lesson would strand the
        # teacher on an id that no longer belongs to their class. The Course screen owns
        # it; this points there.
        self.assertRegex(SCREEN, r'search: \{ tab: "course" \}')

    def test_the_notice_is_derived_from_the_course_not_hard_coded(self):
        self.assertRegex(SCREEN, r"course && !course\.organization_id \? course\.title : null")


if __name__ == "__main__":
    unittest.main()
