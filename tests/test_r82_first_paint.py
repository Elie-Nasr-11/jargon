"""R82: nothing the first paint needs may live behind someone else's server.

The measured defect: `frontend/index.html` linked a render-blocking stylesheet
from fonts.googleapis.com. A render-blocking <link> to a third-party origin
holds the whole first paint hostage to that origin being reachable — the browser
parses the head, blocks on the stylesheet, and shows a blank page until the
request resolves or times out. Measured on an offline harness: first
contentful paint 12,536ms with the link, 100ms without it. That is not a
hypothetical: school and corporate networks block Google hosts routinely, and
a blocked font host meant a blank white screen for the length of a DNS timeout.

The fix is to own the critical path: self-hosted fonts, and the heavy screens
loaded on demand rather than shipped to every visitor before first paint.
"""
import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
SRC = FRONTEND / "src"

INDEX_HTML = (FRONTEND / "index.html").read_text(encoding="utf-8")
MAIN = (SRC / "main.tsx").read_text(encoding="utf-8")
STYLES = (SRC / "styles.css").read_text(encoding="utf-8")
PACKAGE = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
BACKDROP = (SRC / "components" / "AmbientBackdrop.tsx").read_text(encoding="utf-8")
VITE_CONFIG = (FRONTEND / "vite.config.ts").read_text(encoding="utf-8")

# The routes that used to pull a whole console into the entry chunk.
LAZY_ROUTES = {
    "teacher.tsx": "TeacherConsole",
    "teacher.class.$classId.tsx": "TeacherConsole",
    "teacher.class.$classId.student.$studentId.tsx": "TeacherConsole",
    "teacher.class.$classId.lesson.$lessonId.tsx": "LessonScreen",
    "learn.tsx": "StudentApp",
    "admin.tsx": "AdminPage",
    "platform.tsx": "AdminPage",
}


class IndexHtmlTests(unittest.TestCase):
    def test_the_head_reaches_no_third_party_origin(self):
        # Every href/src in the shell must be same-origin. An absolute URL here is
        # the R82 defect returning: first paint waiting on a host we do not run.
        urls = re.findall(r'(?:href|src)="([^"]+)"', INDEX_HTML)
        self.assertTrue(urls, "index.html should still reference its own assets")
        offenders = [u for u in urls if u.startswith(("http://", "https://", "//"))]
        self.assertEqual(
            offenders,
            [],
            f"index.html must not load anything cross-origin before first paint: {offenders}",
        )

    def test_the_google_fonts_link_stays_gone(self):
        self.assertNotIn("fonts.googleapis.com", INDEX_HTML)
        self.assertNotIn("fonts.gstatic.com", INDEX_HTML)


class SelfHostedFontTests(unittest.TestCase):
    def test_the_faces_are_dependencies_not_a_cdn_call(self):
        deps = PACKAGE["dependencies"]
        self.assertIn("@fontsource-variable/manrope", deps)
        self.assertIn("@fontsource/geist-mono", deps)

    def test_main_imports_the_design_system_faces(self):
        self.assertIn('import "@fontsource-variable/manrope";', MAIN)
        # The three weights the design system actually uses for mono.
        for weight in ("400", "500", "600"):
            self.assertIn(f'import "@fontsource/geist-mono/{weight}.css";', MAIN)

    def test_the_font_stack_names_the_self_hosted_family(self):
        # The variable package registers "Manrope Variable"; a stack that only says
        # "Manrope" silently renders the fallback everywhere.
        sans = STYLES.split("--font-sans:", 1)[1].split(";", 1)[0]
        self.assertIn('"Manrope Variable"', sans)
        self.assertIn('"Geist Mono"', STYLES.split("--font-mono:", 1)[1].split(";", 1)[0])


class BlockingStylesheetTests(unittest.TestCase):
    def test_fonts_are_never_inlined_into_the_stylesheet(self):
        # Vite base64-inlines assets under 4 kB, which swept eleven small font
        # subsets into the render-blocking stylesheet: +67 kB raw / +43 kB gzip
        # that every visitor downloads before first paint, for scripts almost
        # none of them render. Fonts must stay separate files so the browser
        # fetches a subset only when its unicode-range is actually painted.
        self.assertIn("assetsInlineLimit:", VITE_CONFIG)
        limit = VITE_CONFIG.split("assetsInlineLimit:", 1)[1].split("\n  },", 1)[0]
        for extension in ("woff2?", "ttf", "otf"):
            self.assertIn(extension, limit)
        self.assertIn("false", limit)


class DeferredWeightTests(unittest.TestCase):
    def test_three_js_loads_after_first_paint(self):
        # AmbientCanvas is the three.js plane. Only AmbientBackdrop may name it, and
        # only through a dynamic import — anyone importing it directly puts ~500 kB
        # of WebGL back in the entry chunk.
        self.assertIn('lazy(() =>\n  import("@/components/AmbientCanvas")', BACKDROP)
        for path in sorted(SRC.rglob("*.tsx")):
            if path.name in ("AmbientCanvas.tsx", "AmbientBackdrop.tsx"):
                continue
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(
                'from "@/components/AmbientCanvas"',
                text,
                f"{path.name} imports the WebGL canvas eagerly; render <AmbientBackdrop> instead",
            )

    def test_the_big_screens_load_on_demand(self):
        for filename, screen in LAZY_ROUTES.items():
            text = (SRC / "routes" / filename).read_text(encoding="utf-8")
            with self.subTest(route=filename):
                self.assertIn(f"const {screen} = lazy(() =>", text)
                self.assertIn("<Suspense fallback={<RouteLoader />}>", text)

    def test_the_admin_screen_lives_outside_the_route(self):
        # A route module is loaded to MATCH a URL, so anything in it ships to every
        # visitor. The screen itself belongs in features/.
        self.assertTrue((SRC / "features" / "admin" / "AdminPage.tsx").is_file())
        route = (SRC / "routes" / "admin.tsx").read_text(encoding="utf-8")
        self.assertLess(len(route.splitlines()), 60)


if __name__ == "__main__":
    unittest.main()
