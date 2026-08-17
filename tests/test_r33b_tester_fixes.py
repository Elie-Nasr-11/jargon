from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
F = lambda *p: (ROOT.joinpath(*p)).read_text(encoding="utf-8")  # noqa: E731

MESSAGES = F("frontend", "src", "features", "student", "chat", "chatMessages.ts")
TRANSCRIPT = F("frontend", "src", "student", "Transcript.tsx")
STUDENT_APP = F("frontend", "src", "student", "StudentApp.tsx")
BRAIN = F("frontend", "src", "student", "BrainGraph.tsx")
HOME = F("frontend", "src", "student", "StudentHome.tsx")
API = F("frontend", "src", "lib", "api.ts")
ROOT_ROUTE = F("frontend", "src", "routes", "__root.tsx")
BOUNDARY = F("frontend", "src", "components", "ErrorBoundary.tsx")


class RawFigureMarkerNeverPrints(unittest.TestCase):
    """Live 2026-08-13: a reloaded transcript printed "[[figure:d5d82171-…]]" as text.
    The server keeps a marker whose figure RESOLVED (and strips the rest), so the client
    must restore figures on reload — and must strip any marker it still cannot resolve."""

    def test_figures_are_restored_from_the_persisted_turn(self):
        self.assertIn("figures: Array.isArray(payload.figures)", MESSAGES)

    def test_unresolved_markers_are_stripped_not_printed(self):
        self.assertIn("if (!figures?.length && FIGURE_MARKER_RE.test(text))", TRANSCRIPT)
        # Two strip sites: the streaming body and this settled-message fallback.
        self.assertEqual(TRANSCRIPT.count('.replace(FIGURE_MARKER_RE, "")'), 2)


class MediaStageBelongsToItsLesson(unittest.TestCase):
    """Live: "I was previously in math with this pdf open... I switched to biology and the
    math pdf automatically opened." Shell-owned stage state outlived the lesson."""

    def test_stage_closes_when_the_lesson_changes(self):
        for fragment in (
            "const stageLessonRef = useRef<string | null>(null);",
            "stageLessonRef.current !== liveLessonId",
            "stageClose();",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, STUDENT_APP)


class ClientCrashesAreVisibleAndContained(unittest.TestCase):
    """Live: "the 'something went wrong' keeps getting in the way". Crashes reported ONLY
    to window.__lovableEvents (absent in production), so they were invisible; and any
    render error took the whole page down through the router's root boundary."""

    def test_client_errors_reach_runtime_events(self):
        for fragment in (
            "export async function recordClientError(",
            'event_type: "controlled_error"',
            'source: "client"',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, API)
        # The root boundary records too, and shows the real message for a screenshot.
        self.assertIn("recordClientError(error, { boundary:", ROOT_ROUTE)
        self.assertIn("{error.message}", ROOT_ROUTE)

    def test_a_local_boundary_contains_transcript_crashes(self):
        for fragment in (
            "export class ErrorBoundary",
            "componentDidCatch",
            "void recordClientError(error, {",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, BOUNDARY)
        self.assertIn('label="student_transcript"', STUDENT_APP)
        self.assertIn("</ErrorBoundary>", STUDENT_APP)


class BrainIdeaNodesAreClickable(unittest.TestCase):
    """Live: "the brain is cool but nothing happens when i click on a node." Only lesson
    dots had a click; the idea nodes were inert tooltips."""

    def test_authored_ideas_open_their_lesson(self):
        # R38 selection model: an idea that belongs to a lesson offers that lesson on
        # its selection card; a lesson-less idea gets no button (no dead affordance).
        for fragment in (
            "onClick={() => armed() && onOpenLesson(selected.idea.lesson_id!)}",
            "{selected.idea.lesson_id ? (",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, BRAIN)


class MyJargonGroupsBySubject(unittest.TestCase):
    """Live: "maybe it should be split by topic"."""

    def test_words_group_under_subject_headings(self):
        for fragment in (
            "const groups: { subject: string; words: MyJargonWord[] }[] = [];",
            'const subject = word.subject || "Other";',
            "{groups.map((group) => (",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, HOME)


if __name__ == "__main__":
    unittest.main()


class BoldSurvivesMath(unittest.TestCase):
    """Live: "**What is $d$?**" printed its asterisks. Math split the string BEFORE the
    markdown pass, so neither "**What is " nor "?**" could match the bold pattern."""

    def test_markdown_is_the_outer_pass(self):
        self.assertIn("function renderRunWithMath(", TRANSCRIPT)
        # renderInline no longer wraps everything in renderWithMath first.
        self.assertIn("function renderInline(text: string, vocab?: VocabPass): ReactNode[] {\n  return renderInlineMd(text, vocab);", TRANSCRIPT)
        # Emphasis renders its inner content through math, so bold spanning a formula works.
        self.assertIn('renderRunWithMath(bold[1], undefined, `b${i}`)', TRANSCRIPT)
        self.assertIn('renderRunWithMath(italic[1], undefined, `i${i}`)', TRANSCRIPT)


class SectionsStopChurning(unittest.TestCase):
    """Live: LESSON / PRACTICE / CHECKPOINT flip-flopped on every exchange, and a practice
    drill was announced as a CHECKPOINT."""

    def test_only_a_lesson_spine_quiz_is_a_checkpoint(self):
        self.assertIn('(message.turnMode ?? "lesson") === "lesson" &&', TRANSCRIPT)

    def test_mcq_tap_keeps_the_students_register(self):
        # Pillar 2 made R33c structural: sendChoice reads the register at its one owner
        # (useConversation) instead of trusting the call site to thread it.
        self.assertIn("void conversation.sendChoice(choiceId, label);", STUDENT_APP)
        self.assertIn('{ mode: "multiple_choice", choice_id: choiceId, client_msg_id: uid() },\n        registerRef.current,', CONVO)


class PickedOptionIsVerdictNeutral(unittest.TestCase):
    """Live: a check mark sat on an option the next reply called "Not quite"."""

    def test_no_checkmark_on_the_retired_pick(self):
        self.assertIn("your pick", TRANSCRIPT)
        self.assertNotIn("<Check ", TRANSCRIPT)


CHAT_FN = F("supabase", "functions", "chat", "index.ts")
CONVO = F("frontend", "src", "student", "useConversation.ts")


class ModeHandoffsLeaveARecord(unittest.TestCase):
    """Live (Elie's session, DB): a mentor turn stamped "discuss" sat in the transcript
    with NO student turn before it — tapping a mode pill sent an EMPTY body, and the
    server only persists a student turn when there is content. On reload a Discuss
    section opened out of nowhere: "the flow hops around through modes"."""

    def test_the_pill_label_rides_as_the_turn_text(self):
        self.assertIn("{ mode: \"text\", text: offer.label, client_msg_id: uid() },", CONVO)

    def test_control_turns_are_never_graded(self):
        # Making the label visible is only safe because a control turn is excluded from
        # the understanding grader as well as the router.
        block = CHAT_FN[CHAT_FN.index("const isTextExplanation =") :][:900]
        self.assertIn("!controlType &&", block)
        # The router already excluded controls; the grader now does too.
        self.assertIn("!controlType && answer?.mode === \"text\" && Boolean(content)", CHAT_FN)


class SidebarFollowsTheOpenLesson(unittest.TestCase):
    """Live: "the sidebar menu sometimes shows a class other than the selected lesson."
    scopeClassId fell back to classes[0], so a lesson opened from Home or the brain map
    could belong to a different class than the tree on screen."""

    def test_scope_switches_to_the_class_that_owns_the_lesson(self):
        for fragment in (
            "const syncedLessonRef = useRef<string | null>(null);",
            "if (classLessons.some((lesson) => lesson.id === liveLessonId))",
            "onSelectClass(candidate.id);",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, STUDENT_APP)
