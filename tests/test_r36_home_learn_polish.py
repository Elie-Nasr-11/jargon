"""R36: the four-part polish slice (owner brief, 2026-08-16 afternoon).

1. SELF-HEALING SEND — production showed transient faults reaching students as the
   "something went wrong on our side" line: an edge-runtime worker-churn 500 with no
   function log (observed live at 14:19), and watchdog aborts racing a server that
   finished anyway. invokeTypedChat now retries transient shapes (network, 5xx,
   non-envelope bodies, watchdog aborts) with backoff, reusing the same client_msg_id
   so B4 dedup replays instead of double-processing. 4xx refusals surface at once;
   once streamed text is on screen, no silent re-send.
2. SIDEBAR TRUTH — the Learn tree rendered the FULL catalog while a class's scoped
   list was in flight ("lessons that shouldn't be there, then they disappear").
   A skeleton now holds the space until the right list resolves.
3. WARM TABS — one idle-time warm of every other tab's surfaces through the same
   cached() keys the real reads use, so first switches paint from cache.
4. THE NIGHT SKY — BrainMap v4 retired in favor of BrainSky: words/ideas as stars on
   a plane, lessons as 3D constellations above it, hover card top-right, every star
   click opens something real.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
API = (ROOT / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
APP = (ROOT / "frontend" / "src" / "student" / "StudentApp.tsx").read_text(encoding="utf-8")
SKY = (ROOT / "frontend" / "src" / "student" / "BrainSky.tsx").read_text(encoding="utf-8")
HOME = (ROOT / "frontend" / "src" / "student" / "StudentHome.tsx").read_text(encoding="utf-8")


class SendIsSelfHealing(unittest.TestCase):
    def test_transient_shapes_are_tagged_retriable(self):
        for fragment in (
            "function retriable(message: string): Error",
            'throw retriable("We couldn\'t reach the mentor just then. Retrying…");',
            "throw response.status >= 500 ? retriable(message) : new Error(message);",
            'throw retriable("The mentor took too long to answer. Try again in a moment.");',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, API)

    def test_retry_loop_backs_off_and_respects_streams(self):
        self.assertIn("const MAX_ATTEMPTS = 3;", API)
        self.assertIn("const BACKOFF_MS = [800, 2500];", API)
        # Streamed text on screen forbids a silent re-send.
        self.assertIn("if (!canRetry || deltasSeen || attempt === MAX_ATTEMPTS - 1) break;", API)
        # The retry reuses the same input (same client_msg_id) — no re-stamping inside.
        self.assertIn("return await invokeTypedChatAttempt(input, () => {", API)
        self.assertNotIn("client_msg_id: uid()", API)


class SidebarNeverShowsTheWrongLessons(unittest.TestCase):
    def test_pending_scope_renders_skeleton_not_catalog(self):
        self.assertIn("const scopedLessonsPending =", APP)
        self.assertIn("classes === null || (scopeClassId != null && classLessons == null);", APP)
        self.assertIn("{scopedLessonsPending ? (", APP)
        self.assertIn("lessons={scopeClassId ? (classLessons ?? []) : conversation.lessons}", APP)
        self.assertNotIn("lessons={classLessons ?? conversation.lessons}", APP)

    def test_completion_handoff_obeys_the_same_scope(self):
        self.assertIn(
            "const handoffList = scopeClassId ? (classLessons ?? []) : conversation.lessons;", APP
        )


class TabsWarmAtIdle(unittest.TestCase):
    def test_warm_covers_every_tab_surface(self):
        block = API[API.index("export function warmStudentSurfaces") :][:2200]
        for key in (
            '"catalog:"',
            '"classes"',
            '"progress"',
            '"ideas"',
            '"student_links"',
            '"idea_mastery"',
            '"vocab_terms"',
            '"my_jargon"',
            '"assessments"',
        ):
            with self.subTest(key=key):
                self.assertIn(key, block)
        self.assertIn("prefetchLesson(session.lesson_id)", block)

    def test_shell_warms_when_idle(self):
        self.assertIn("warmStudentSurfaces(scopeClassId)", APP)
        self.assertIn("requestIdleCallback", APP)


class TheNightSky(unittest.TestCase):
    def test_words_and_ideas_lie_on_the_plane_lessons_rise_above(self):
        self.assertIn("function planeSpot(", SKY)
        self.assertIn("function constellationFor(", SKY)
        self.assertIn("CONSTELLATION_ALT_BASE", SKY)
        # Layout is deterministic — a sky that rearranges per visit is noise.
        self.assertIn("function hash01(", SKY)
        self.assertNotIn("Math.random", SKY)

    def test_progress_lights_the_constellation_and_current_breathes(self):
        self.assertIn("const litCount = Math.round(node.lit * node.stars.length);", SKY)
        self.assertIn("node.current && !reduced", SKY)

    def test_hover_card_sits_top_right_and_every_click_opens_something(self):
        self.assertIn('className="pointer-events-none absolute right-2.5 top-2.5', SKY)
        self.assertIn('if (node.kind === "lesson") onOpenLesson(node.lesson.id);', SKY)
        self.assertIn(
            'else if (node.kind === "idea" && node.idea.lesson_id) onOpenLesson(node.idea.lesson_id);',
            SKY,
        )
        self.assertIn(
            'else if (node.kind === "word" && node.collected) onOpenWord(node.word.term);', SKY
        )

    def test_reduced_motion_and_offscreen_are_respected(self):
        self.assertIn("prefersReducedMotion()", SKY)
        self.assertIn("IntersectionObserver", SKY)
        self.assertIn("document.hidden", SKY)

    def test_home_feeds_the_sky_and_word_clicks_land_in_my_jargon(self):
        self.assertIn("<BrainSky", HOME)
        self.assertIn("words={jargonWords ?? []}", HOME)
        self.assertIn("onOpenWord={openWord}", HOME)
        self.assertIn("jargonAnchorRef.current?.scrollIntoView", HOME)
        self.assertIn("highlightTerm={highlightTerm}", HOME)
        # The old SVG map is retired.
        self.assertFalse((ROOT / "frontend" / "src" / "student" / "BrainMap.tsx").exists())


if __name__ == "__main__":
    unittest.main()
