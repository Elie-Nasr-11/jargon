"""R88 — the assistant always says what it is looking at, and fields show their text.

The owner sent a screenshot of the live app. Ask Jargon, asked to rewrite a lesson
title, answered "lesson_id or organization_id is required." — R87 rebuilt the panel
and dropped the scope from the request. Every ~1,300 pins passed, and the offline
walk passed too, because the mock answered a question production refuses.

So the pins here are not "AskJargon.tsx contains lessonId". They are the rule the
server actually enforces, checked against every call in the frontend: a draft names
the lesson or the organization it is for. Wherever that call moves, or whoever adds
the next one, this fails if the scope is missing.

The same screenshot showed two fields hiding their own contents — a title cut off
mid-word inside a one-line input, an objective cut off by rows={2} — so the second
half pins that a text field is as tall as its text.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
ASK = (SRC / "features" / "teacher" / "assist" / "AskJargon.tsx").read_text(encoding="utf-8")
SCREEN = (SRC / "features" / "teacher" / "lesson" / "LessonScreen.tsx").read_text(encoding="utf-8")
HEADER = (SRC / "features" / "teacher" / "lesson" / "LessonHeader.tsx").read_text(encoding="utf-8")
AUTO = (SRC / "components" / "AutoTextarea.tsx").read_text(encoding="utf-8")
SCOPE = (SRC / "features" / "teacher" / "assist" / "scope.ts").read_text(encoding="utf-8")


def call_arguments(source: str, callee: str) -> list[str]:
    """Every argument list passed to `callee(`, brace-balanced so nesting survives."""
    found = []
    for match in re.finditer(re.escape(callee) + r"\(", source):
        depth = 0
        start = match.end()
        for index in range(start, len(source)):
            char = source[index]
            if char in "({[":
                depth += 1
            elif char in ")}]":
                depth -= 1
                if depth == 0:
                    found.append(source[start:index])
                    break
    return found


def draft_call_sites() -> list[tuple[Path, str]]:
    sites = []
    for path in sorted(SRC.rglob("*.ts")) + sorted(SRC.rglob("*.tsx")):
        if path.name == "api.ts":
            continue  # the definition, not a call
        text = path.read_text(encoding="utf-8")
        for arguments in call_arguments(text, "draftTextField"):
            sites.append((path, arguments))
    return sites


class EveryDraftIsScopedTests(unittest.TestCase):
    def test_there_are_call_sites_to_check(self):
        # A pin that passes because it found nothing is worse than no pin.
        self.assertGreaterEqual(len(draft_call_sites()), 3)

    def test_every_draft_names_a_lesson_or_an_organization(self):
        # curriculum-admin: `if (!organizationId) throw new Error("lesson_id or
        # organization_id is required.")`. This is that rule, on the client side of
        # the wire, checked at every call rather than at the one that broke.
        #
        # R89 routed every call through draftScopeArgs, so a call may satisfy this by
        # naming the ids itself OR by spreading the one funnel — which the next test
        # pins to name them. Keying only on the literal ids was this pin failing the
        # same way it has failed three releases running: bound to a shape, not a rule.
        for path, arguments in draft_call_sites():
            with self.subTest(path=str(path.relative_to(ROOT))):
                self.assertTrue(
                    "lessonId" in arguments
                    or "organizationId" in arguments
                    or "draftScopeArgs(" in arguments,
                    f"draftTextField in {path.name} sends no scope — production "
                    f"refuses it:\n{arguments}",
                )

    def test_the_funnel_itself_sends_the_scope(self):
        # The one place the ids reach the wire, so the test above can trust the spread.
        args = call_arguments(SCOPE, "draftScopeArgs")
        self.assertTrue(args, "draftScopeArgs is gone — the funnel the pin above trusts")
        body = SCOPE[SCOPE.index("export function draftScopeArgs") :]
        self.assertIn("lessonId: scope.lessonId", body)
        self.assertIn("organizationId: scope.organizationId", body)
        self.assertIn("classId: scope.classId", body)

    def test_the_scope_is_a_type_not_a_convention(self):
        # The union is the server's rule expressed so a call site CANNOT omit it:
        # dropping the ids from LessonScreen is a compile error, not a red bubble.
        self.assertIn("export type AssistScope", SCOPE)
        self.assertIn("| { organizationId: string; lessonId?: string }", SCOPE)
        self.assertIn("| { lessonId: string; organizationId?: string }", SCOPE)
        self.assertIn("export type AssistContext = { kind: string; name: string } & AssistScope;", ASK)

    def test_the_lesson_screen_supplies_it(self):
        self.assertRegex(SCREEN, r"const assistScope = useMemo<AssistScope>")
        self.assertIn("...assistScope }}", SCREEN)

    def test_no_assist_mechanism_can_be_mounted_unscoped(self):
        # SelectionRefine once took `lessonId?: string | null` — the same hole, one
        # call site away. Every mechanism now takes the union, so none can.
        for name in ("SelectionRefine.tsx", "useFieldProposal.ts"):
            with self.subTest(module=name):
                text = (SRC / "features" / "teacher" / "assist" / name).read_text(encoding="utf-8")
                self.assertIn("scope: AssistScope;", text)
                self.assertNotIn("lessonId?: string | null;", text)


class ATypedRequestGoesWhereItSaysTests(unittest.TestCase):
    def test_the_words_pick_the_field_a_starter_still_declares_its_own(self):
        # Walked: after the "Rewrite the title" starter, typing "Make the objective
        # shorter and plainer." came back labelled TITLE — the picker stayed where the
        # starter left it. A starter knows its field, so it still wins; a sentence is
        # read for one.
        self.assertIn("wantedTargetId ?? routeByWords(prompt) ?? targetId", ASK)
        self.assertIn("if (picked.id !== targetId) setTargetId(picked.id);", ASK)

    def test_the_earliest_label_wins(self):
        # "rewrite the title so it matches the objective" is a request about the title.
        self.assertIn("at >= 0 && (!best || at < best.at)", ASK)


class FieldsShowTheirTextTests(unittest.TestCase):
    def test_the_title_is_not_a_one_line_input(self):
        # "Twelve pairs: reading the map" rendered as "Twelve pairs: reading the m".
        # Read past the comments — the comment explaining the removal says "<input".
        self.assertNotIn("<input", without_comments(HEADER))
        self.assertRegex(HEADER, r"<AutoTextarea[^>]*\n(\s+.*\n)*?\s+singleLine")

    def test_the_objective_is_not_capped_at_two_rows(self):
        self.assertNotIn("rows={2}", without_comments(HEADER))
        self.assertIn('aria-label="Lesson objective"', HEADER)

    def test_a_field_grows_to_its_value(self):
        self.assertIn("el.style.height = `${Math.min(wanted, max)}px`", AUTO)
        # The cap is read off the live styles, so it survives a type-scale change.
        self.assertIn("getComputedStyle(el)", AUTO)

    def test_it_re_measures_when_its_width_changes(self):
        # This is the case that produced the screenshot: opening the assistant takes
        # 400px off the page, every line re-wraps, and a height measured before that
        # is wrong. A grow-on-type-only implementation would still clip.
        self.assertIn("ResizeObserver", AUTO)
        self.assertIn("clientWidth === lastWidth", AUTO)

    def test_a_title_still_never_takes_a_newline(self):
        self.assertIn('replace(/[\\r\\n]+/g, " ")', AUTO)
        self.assertIn('if (singleLine && event.key === "Enter"', AUTO)


if __name__ == "__main__":
    unittest.main()
