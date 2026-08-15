from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
F = lambda *p: (ROOT.joinpath(*p)).read_text(encoding="utf-8")  # noqa: E731

MESSAGES = F("frontend", "src", "features", "student", "chat", "chatMessages.ts")
TRANSCRIPT = F("frontend", "src", "student", "Transcript.tsx")
STUDENT_APP = F("frontend", "src", "student", "StudentApp.tsx")
BRAIN = F("frontend", "src", "student", "BrainMap.tsx")
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
        for fragment in (
            "const ideaLessonId =",
            "onClick={ideaLessonId ? () => onOpenLesson(ideaLessonId) : undefined}",
            # Emergent ideas have no lesson: no pointer, no dead click.
            'className={`bmap-node${ideaLessonId ? " cursor-pointer" : ""}`}',
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
