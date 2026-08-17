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
GRAPH = (ROOT / "frontend" / "src" / "student" / "BrainGraph.tsx").read_text(encoding="utf-8")
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


class TheKnowledgeGraph(unittest.TestCase):
    """v5 (owner pick after the night-sky metaphor was rejected): an Obsidian-style
    force-directed graph — nodes for lessons/ideas/words/course hubs, edges for the
    student's REAL relations, hover lights the neighborhood while the rest dims."""

    def test_layout_is_physics_but_deterministic(self):
        self.assertIn("const REPULSION", GRAPH)
        self.assertIn("const SPRING", GRAPH)
        self.assertIn("function hash01(", GRAPH)
        self.assertNotIn("Math.random", GRAPH)
        # The graph settles BEFORE first paint — it never opens mid-explosion — and
        # remembered positions keep rebuilds calm (R38 load-time snapping fix).
        self.assertIn("for (let i = 0; i < settleTicks; i += 1)", GRAPH)
        self.assertIn("posMemory.current.set(n.id, { x: n.x, y: n.y });", GRAPH)

    def test_edges_are_real_relations(self):
        for fragment in (
            '"word-lesson"',
            '"idea-lesson"',
            '"idea-idea"',
            '"lesson-course"',
            "ideaIndex.get(link.from_key)",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, GRAPH)

    def test_selection_dims_everything_but_the_neighborhood(self):
        # R38: focus follows the SELECTION (click), never hover — sweeping the pointer
        # across the graph must not flip through cards or dim states.
        self.assertIn("const neighbors = picked >= 0 ? adjacency[picked] : null;", GRAPH)
        self.assertIn("const DIM", GRAPH)
        self.assertNotIn("setHover", GRAPH)

    def test_clicks_select_and_only_the_card_button_navigates(self):
        # R38 (owner: "let's not have false clicks"): a node click SELECTS (camera
        # glides in, card appears); empty-space click clears and glides home. The
        # card's explicit button is the only navigation.
        self.assertIn("selectApi.current?.select(pan.downIndex);", GRAPH)
        self.assertIn("selectApi.current?.clear(true);", GRAPH)
        # R39: the card ARMS 400ms after appearing, so a double-click's second press
        # can never land on a button that just materialized under the cursor.
        self.assertIn("const armed = () => performance.now() - selectedAt.current > 400;", GRAPH)
        self.assertIn("onClick={() => armed() && onOpenLesson(selected.lesson.id)}", GRAPH)
        self.assertIn("onClick={() => armed() && onOpenLesson(selected.idea.lesson_id!)}", GRAPH)
        self.assertIn("onClick={() => armed() && onOpenWord(selected.word.term)}", GRAPH)
        # R39: node dragging is gone — press-drag anywhere pans.
        self.assertNotIn("dragNode", GRAPH)

    def test_rebuilds_are_content_keyed_and_non_destructive(self):
        # R40 (whole-page jank + "camera resets by itself"): Home hands down STABLE
        # identities, the graph rebuilds only when content changes, and a legitimate
        # rebuild keeps the student's camera and selection.
        self.assertIn(
            "const bands = useMemo(() => masteryBands(ideaMastery), [ideaMastery]);", HOME
        )
        self.assertIn("mastery={bands.byKey}", HOME)
        self.assertIn("const graph = useMemo(() => buildGraph(graphInputs.current), [graphKey]);", GRAPH)
        self.assertIn("if (!cameraLive.current) {", GRAPH)
        self.assertIn("const previousSelectedId = selectedIdRef.current;", GRAPH)
        # The selection zoom glide and its release.
        self.assertIn("camTarget.current = {", GRAPH)
        self.assertIn("if (zoomHome) camTarget.current = { ...home };", GRAPH)

    def test_reduced_motion_and_offscreen_are_respected(self):
        self.assertIn("prefersReducedMotion()", GRAPH)
        self.assertIn("IntersectionObserver", GRAPH)
        self.assertIn("document.hidden", GRAPH)

    def test_home_feeds_the_graph_and_word_clicks_land_in_my_jargon(self):
        self.assertIn("<BrainGraph", HOME)
        self.assertIn("words={jargonWords ?? []}", HOME)
        self.assertIn("vocabTerms={vocabTerms}", HOME)
        self.assertIn("onOpenWord={openWord}", HOME)
        self.assertIn("jargonAnchorRef.current?.scrollIntoView", HOME)
        # The sky renderers are fully retired.
        self.assertFalse((ROOT / "frontend" / "src" / "student" / "BrainSky.tsx").exists())
        self.assertFalse((ROOT / "frontend" / "src" / "student" / "BrainMap.tsx").exists())


if __name__ == "__main__":
    unittest.main()
