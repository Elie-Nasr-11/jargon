"""R93 — the class-level cognition view.

R90 reads one student in one lesson; R92 makes those readings appear on their own.
This is the first surface that reads ACROSS a class, and the thing it exists to resist
is the class average: "this room is at 2.7 / 4" is the rubric's §15 failure one level
up, and a teacher can do nothing with it on Monday.

The pin that matters most here is the LAST class: the room view groups students by the
move §19 would make for them, which only means something if it agrees with what the
mentor actually does. Those are two files that cannot import each other, so the pin
reads both.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SCORER = (ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts").read_text(
    encoding="utf-8"
)
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
FRONTEND = ROOT / "frontend" / "src"
ROOM = (FRONTEND / "features" / "teacher" / "cognition" / "room.ts").read_text(encoding="utf-8")
PANEL = (
    FRONTEND / "features" / "teacher" / "cognition" / "ClassRoomPanel.tsx"
).read_text(encoding="utf-8")
LABELS = (FRONTEND / "features" / "teacher" / "cognition" / "labels.ts").read_text(
    encoding="utf-8"
)
TODAY = (FRONTEND / "features" / "teacher" / "today" / "TodayScreen.tsx").read_text(
    encoding="utf-8"
)
API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")


class TheRoomIsAskedAsARoomTests(unittest.TestCase):
    def test_the_class_is_authorized_once_not_per_student(self):
        # assertCanViewStudent answers "may this actor see this person?", which is the
        # wrong question for a room: a teacher who could see 11 of 12 would get a view
        # that quietly lied about the twelfth.
        self.assertIn("async function assertCanViewClass(", SCORER)
        view = SCORER[SCORER.index("async function classView(") :]
        view = view[: view.index("\nfunction summarizeRoom(")]
        self.assertIn("await assertCanViewClass(config, actorId, classId)", view)
        self.assertNotIn("assertCanViewStudent", view)

    def test_the_class_door_has_the_same_three_doors_as_the_student_one(self):
        # If the two disagreed about who a teacher is, a room view and a student view
        # could each admit someone the other refuses.
        door = SCORER[SCORER.index("async function assertCanViewClass(") :]
        door = door[: door.index("\n// R92: the SCHEDULER's door.")]
        for check in ("platform_admins", "class_memberships", "organization_memberships"):
            with self.subTest(check=check):
                self.assertIn(check, door)
        self.assertIn("role=eq.teacher", door)
        self.assertIn("status=eq.active", door)

    def test_a_class_view_needs_a_user_unlike_the_sweep(self):
        # The sweep is the ONLY user-less action (R92). This one resolves a person.
        body = SCORER[SCORER.index("const action = cleanText(record.action);") :]
        self.assertGreater(
            body.index('action === "class_view"'), body.index("await fetchCurrentUser(config)")
        )

    def test_independent_reads_do_not_serialize(self):
        # This view loads on the class landing screen every time a teacher opens one.
        # The roster and the course links do not depend on each other, and neither do
        # the lesson walk and the profile read — six sequential round trips for a shape
        # that needs four is latency a teacher pays on every visit.
        view = SCORER[SCORER.index("async function classView(") :]
        view = view[: view.index("\nfunction summarizeSections(")]
        self.assertEqual(view.count("await Promise.all(["), 2)
        self.assertIn("const [roster, links] = await Promise.all([", view)
        self.assertIn("const [classLessons, profiles] = await Promise.all([", view)

    def test_a_lesson_is_reached_through_the_real_hierarchy(self):
        # lessons has NO course_id. The path is courses -> course_versions -> units ->
        # lessons, and the single-hop guess 400'd on the first live probe — which would
        # have broken this view for every class that links a course, i.e. nearly all of
        # them, with no offline test noticing.
        self.assertNotIn("lessons?course_id=", SCORER)
        walk = SCORER[SCORER.index("async function lessonsOfCourses(") :]
        walk = walk[: walk.index("\nasync function classView(")]
        self.assertLess(walk.index("course_versions?course_id=in."), walk.index("units?course_version_id=in."))
        self.assertLess(walk.index("units?course_version_id=in."), walk.index("lessons?unit_id=in."))

    def test_every_version_of_a_course_counts(self):
        # A student may have worked a lesson a later version replaced; their thinking
        # about it is still this class's business.
        walk = SCORER[SCORER.index("async function lessonsOfCourses(") :]
        walk = walk[: walk.index("\nasync function classView(")]
        self.assertNotIn("order=", walk)
        self.assertNotIn("limit=1&", walk)

    def test_the_lesson_scope_never_rides_in_the_query_string(self):
        # A course with a hundred lessons would put a hundred ids into a URL, and a
        # request that failed on length would fail for exactly the biggest classes.
        view = SCORER[SCORER.index("async function classView(") :]
        view = view[: view.index("\nfunction summarizeRoom(")]
        self.assertNotIn("lesson_id=in.(", view)
        self.assertIn("classLessons && !classLessons.has(cleanText(row.lesson_id))", view)

    def test_the_roster_is_the_room_not_the_scored_rows(self):
        # A room view built from the profiles table would silently shrink to whoever
        # happened to be read — the students who need attention most would vanish.
        view = SCORER[SCORER.index("async function classView(") :]
        view = view[: view.index("\nfunction summarizeRoom(")]
        roster_at = view.index("class_memberships?class_id=eq.")
        profiles_at = view.index("cognition_profiles?user_id=in.")
        self.assertLess(roster_at, profiles_at)
        # The rule, not the call shape — this assertion was written as the latter and
        # broke one release later when the roll-up gained a section argument. What
        # matters is that the answer is built by walking the ROSTER's ids, and that a
        # student with no profiles still produces a row rather than being skipped.
        built = view[view.index("const students = studentIds.map(") :]
        built = built[: built.index("return json({")]
        self.assertIn("rollUpStudent(", built)
        self.assertIn("?? []", built)
        self.assertNotIn("profiles.map(", view)

    def test_unread_students_are_reported_not_hidden(self):
        self.assertIn('group = "unread"', SCORER)
        self.assertIn("unread: students.length - read.length", SCORER)
        self.assertIn("Not read yet", ROOM)


class TheRoomSaysNothingAboutStudentWorkTests(unittest.TestCase):
    def test_the_response_carries_ids_and_numbers_only(self):
        # Names are resolved in the browser from the roster the console already holds;
        # narratives and notes stay behind the per-student door.
        view = SCORER[SCORER.index("async function classView(") :]
        view = view[: view.index("\nfunction summarizeRoom(")]
        select = re.search(r"cognition_profiles\?user_id=in\.[^`]*", view).group(0)
        for leak in ("narrative", "note", "evidence", "signals", "objective"):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, select)

    def test_nothing_is_collapsed_into_one_number(self):
        # §15, one level up, written as the rule rather than as a word search — the
        # word-search version of this pin caught the judge prompt's own "never a
        # percentage" instruction, which is the FIFTH time a shape-shaped pin has
        # fired on the code that enforces the very thing it was guarding.
        #
        # Two structural facts carry it. A student keeps all eight dimensions (the
        # roll-up is eight medians, not one score)...
        roll = SCORER[SCORER.index("function rollUpStudent(") :]
        roll = roll[: roll.index("\nasync function classView(")]
        self.assertIn("for (const dim of DIMENSIONS) {", roll)
        self.assertIn("dims[dim] = median(values);", roll)

        # ...and the ROOM holds no dimension value at all, only counts of students.
        summary = SCORER[SCORER.index("function summarizeRoom(") :]
        summary = summary[: summary.index("\n// R92: the run log")]
        returned = summary[summary.rindex("return {") :]
        for field in ("students", "read", "unread", "weakest", "groups"):
            with self.subTest(field=field):
                self.assertIn(field, returned)
        for dimension in ("retrieval", "reasoning", "elaboration"):
            with self.subTest(dimension=dimension):
                self.assertNotIn(dimension, returned)
        # "weakest" counts students per dimension; it never carries a value.
        self.assertIn("students: read.filter((student) => {", summary)

    def test_the_wire_type_does_not_promise_top_level_dimensions(self):
        # The dimensions arrive NESTED under `dims`. Declaring RoomStudent as
        # `CognitionDims & {...}` let `student.reasoning` compile and be undefined
        # forever — and quietly invited the exact reading this view forbids. Keeping
        # them nested makes the rule a compile error rather than a convention.
        api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")
        block = api[api.index("export type RoomStudent = ") :]
        block = block[: block.index("\n};")]
        self.assertNotIn("CognitionDims &", block)
        self.assertIn("dims: CognitionDims;", block)

    def test_the_rendered_room_shows_no_dimension_value(self):
        # The strongest form of §15 for this surface, and structural rather than a word
        # search (a "/4" search matches Tailwind's own border-warning/40): NEITHER
        # rendering file reads a dimension value at all. What a teacher sees is which
        # group a student is in and what to do about it — the eight numbers live one
        # click away, on the student, where they have a lesson and evidence beside them.
        for name, text in (("room", ROOM), ("panel", PANEL)):
            with self.subTest(surface=name):
                body = without_comments(text)
                self.assertNotIn(".dims", body)
                self.assertNotIn("average", body.lower())

    def test_the_grouping_is_not_a_ranking(self):
        # Sorting students by score would turn a teaching aid into a league table.
        self.assertNotIn("sort((a, b) => b.dims", ROOM)
        self.assertIn("Nothing here ranks students", ROOM)


class TheRoomAnswersATeachersQuestionTests(unittest.TestCase):
    def test_the_headline_is_a_teaching_decision_not_a_number(self):
        self.assertIn("export function roomHeadline(", ROOM)
        self.assertIn("a lesson to reteach, not", ROOM)

    def test_dependency_outranks_a_weak_dimension_in_the_headline_too(self):
        # Same precedence as §19 itself: a room being carried by the tutor is a worse
        # problem than a room that merely finds one thing hard, so it is the sentence
        # a teacher gets even when some dimension is weaker.
        headline = ROOM[ROOM.index("export function roomHeadline(") :]
        self.assertLess(
            headline.index("an assistance problem before it is a content one"),
            headline.index("a lesson to reteach, not"),
        )

    def test_needs_splits_by_dimension(self):
        # "Four students need reasoning" is a lesson; "four students need something"
        # is not.
        self.assertIn('`needs:${student.focus}`', ROOM)

    def test_the_alarm_is_read_before_the_good_news(self):
        rank = ROOM[ROOM.index("const GROUP_RANK") : ROOM.index("export function roomGroups")]
        order = re.findall(r"(\w+): (\d)", rank)
        self.assertEqual(
            [name for name, _ in sorted(order, key=lambda row: int(row[1]))],
            ["dependent", "needs", "mastered", "steady", "unread"],
        )

    def test_a_teacher_can_reach_the_student_from_the_room(self):
        self.assertIn("onOpenStudent(student.user_id)", PANEL)
        self.assertIn("onOpenStudent={onOpenStudent}", TODAY)

    def test_the_moves_are_addressed_to_a_person_not_a_model(self):
        # §19's own move text is written AT the mentor ("RETRIEVAL FIRST:"); a teacher
        # cannot act on that. These are the same moves, said to a person.
        self.assertIn("DIMENSION_MOVE", LABELS)
        moves = LABELS[LABELS.index("export const DIMENSION_MOVE") :]
        self.assertNotIn("RETRIEVAL FIRST", moves)
        self.assertNotIn("MAKE THEM REASON", moves)
        self.assertIn("Ask them to recall it before you give it back.", moves)

    def test_one_home_for_the_dimension_vocabulary(self):
        # Two copies of a label list drift, and the two surfaces would then disagree
        # about what "elaboration" is called.
        self.assertIn('from "@/features/teacher/cognition/labels"', ROOM)
        panel = (
            FRONTEND / "features" / "teacher" / "console" / "CognitionPanel.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn('from "@/features/teacher/cognition/labels"', panel)
        self.assertNotIn('label: "Recalls the knowledge"', panel)

    def test_it_lands_on_the_class_landing_screen(self):
        self.assertIn("ClassRoomPanel", TODAY)
        self.assertIn("fetchClassCognition", API)


class TheRoomAgreesWithTheMentorTests(unittest.TestCase):
    """The one that matters. A room view saying "these four are leaning on the tutor"
    while the mentor treats them as fine would be worse than no view at all — and chat
    and cognition-scorer are two edge functions that cannot import each other, so the
    only thing holding them together is this."""

    def test_the_floor_is_the_same_three_responses(self):
        self.assertIn("const STEER_FLOOR = 3;", SCORER)
        self.assertIn("if (based < 3) return null;", CHAT)
        self.assertIn("turnsScored < STEER_FLOOR", SCORER)

    def test_weak_and_proficient_are_the_same_numbers(self):
        self.assertIn("const WEAK_AT_OR_BELOW = 2;", SCORER)
        self.assertIn("const PROFICIENT_AT_OR_ABOVE = 3;", SCORER)
        # chat's learnerSteer: weak is <= 2, and its mastery rule keys on >= 3.
        self.assertIn("if (value <= 2) weakAll.push(key);", CHAT)
        self.assertIn("retrieval >= 3", CHAT)

    def test_the_priority_order_is_identical(self):
        def priority(text: str) -> list[str]:
            block = text[text.index("const STEER_PRIORITY = [") :]
            return re.findall(r'"(\w+)"', block[: block.index("] as const;")])

        self.assertEqual(priority(SCORER), priority(CHAT))
        self.assertEqual(priority(SCORER)[0], "retrieval")

    def test_the_dependency_rule_is_the_same_rule(self):
        # chat: independence <= 2 AND scaffold_recent >= 3.
        self.assertIn(
            "independence !== null && independence <= 2 && recent !== null && recent >= 3", CHAT
        )
        roll = SCORER[SCORER.index("function rollUpStudent(") :]
        roll = roll[: roll.index("\nasync function classView(")]
        self.assertIn("independence <= WEAK_AT_OR_BELOW", roll)
        self.assertIn("recent >= PROFICIENT_AT_OR_ABOVE", roll)
        # ...and it is checked BEFORE mastery, in both, because §19 says so.
        self.assertLess(roll.index('group = "dependent"'), roll.index('group = "mastered"'))

    def test_the_mastery_rule_is_the_same_three_dimensions(self):
        roll = SCORER[SCORER.index("function rollUpStudent(") :]
        roll = roll[: roll.index("\nasync function classView(")]
        mastery = roll[roll.index('} else if ('): roll.index('group = "mastered"')]
        for dimension in ("retrieval", "reasoning", "independence"):
            with self.subTest(dimension=dimension):
                self.assertIn(dimension, mastery)
        chat_mastery = CHAT[CHAT.index("const mastered =") : CHAT.index("if (mastered) {")]
        for dimension in ("retrieval", "reasoning", "independence"):
            with self.subTest(dimension=dimension, side="chat"):
                self.assertIn(dimension, chat_mastery)

    def test_an_absent_value_is_absent_in_both(self):
        # Number(null) is 0 and 0 is finite — the bug R91's property test caught. The
        # room does the same arithmetic over the same columns, so it needs the same
        # guard or it would read a missing trend as "steady".
        self.assertIn("function numOrNull(value: unknown): number | null", SCORER)
        self.assertIn("const numOrNull = (value: unknown): number | null =>", CHAT)


if __name__ == "__main__":
    unittest.main()
