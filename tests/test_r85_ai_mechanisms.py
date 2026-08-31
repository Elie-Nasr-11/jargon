"""R85 — step 8 of the rebuild brief: four AI mechanisms, replacing twelve buttons.

    The principle: the assistant is the empty state and the default, never a button.
    A teacher should not decide to use AI. They should find that the work is already
    started.

      A. Things arrive already drafted
      B. Empty states do the work
      C. One command surface, not N buttons
      D. Selection-scoped refinement

    Non-negotiables: never writes · always attributed · always reversible · grounded by
    default · one provider.

This release is judged by what it REMOVED. The brief names failure mode 3 as mine —
"'AI assist at every building point' became a literal button at every building point.
The ask was for capability; I delivered chrome" — so these pins hold the buttons down
as much as they hold the mechanisms up.
"""
import unittest
from pathlib import Path

from tests.source_text import without_comments

from tests.teacher_sources import authoring_source, console_source


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
TEACHER = SRC / "features" / "teacher"
ASSIST_DIR = TEACHER / "assist"

ASSIST = "\n".join(
    path.read_text(encoding="utf-8") for path in sorted(ASSIST_DIR.glob("*.ts*"))
)
REFINE = (ASSIST_DIR / "SelectionRefine.tsx").read_text(encoding="utf-8")
ASK = (ASSIST_DIR / "AskJargon.tsx").read_text(encoding="utf-8")
PROPOSAL = (ASSIST_DIR / "proposal.ts").read_text(encoding="utf-8")
STEPS = (TEACHER / "lesson" / "LessonSteps.tsx").read_text(encoding="utf-8")
HEADER = (TEACHER / "lesson" / "LessonHeader.tsx").read_text(encoding="utf-8")
SCREEN = (TEACHER / "lesson" / "LessonScreen.tsx").read_text(encoding="utf-8")
ADMIN = (ROOT / "supabase" / "functions" / "curriculum-admin" / "index.ts").read_text(
    encoding="utf-8"
)
SURFACE = authoring_source() + "\n" + console_source()




class ButtonsRemovedTests(unittest.TestCase):
    def test_the_draft_field_button_is_deleted_not_deprecated(self):
        self.assertFalse(
            (TEACHER / "DraftFieldButton.tsx").exists(),
            "DraftFieldButton.tsx should be deleted — the brief says delete, not deprecate",
        )
        self.assertNotIn("DraftFieldButton", SURFACE)

    def test_no_screen_offers_to_draft_a_field_for_you(self):
        # The chrome this release removes: a control whose whole content is an offer of
        # help, standing next to a field in case you want it. Scoped to the VERB forms —
        # "Draft" the noun is a publication state the lexicon keeps ("not yet
        # published"), and a pin that forbade the word outright would forbid that too.
        visible = without_comments(SURFACE)
        for chrome in (
            '"Draft this for me"',
            '"Improve what\'s written"',
            ">Draft steps with AI<",
            "Draft knowledge",
        ):
            with self.subTest(chrome=chrome):
                self.assertNotIn(chrome, visible)
        # The one "Draft the steps" left is the INSTRUCTION sent to the model, not a
        # label a teacher reads — it lives inside draftBriefFor's prompt string.
        brief = STEPS.split("function draftBriefFor", 1)[1].split("\n}", 1)[0]
        self.assertIn("Draft the steps for the lesson", brief)
        self.assertNotIn("Draft the steps", without_comments(STEPS).replace(brief, ""))


class MechanismABTests(unittest.TestCase):
    """A things arrive already drafted / B empty states do the work."""

    def test_an_empty_lesson_drafts_its_steps_on_arrival(self):
        # No press. The brief's wording is "Nothing here yet — here are six steps
        # drafted from pages 31–45", not "here is a button that would draft them".
        self.assertIn("void draft();", STEPS)
        self.assertIn("if (steps.length || proposal || drafting || declined || busy) return;", STEPS)
        empty = STEPS.split("steps.length === 0 && !proposal", 1)[1].split("{proposal ?", 1)[0]
        self.assertNotIn("Draft the steps", empty)

    def test_it_refuses_to_draft_from_nothing(self):
        # A lesson with no title, no objective and no book has nothing to draft FROM;
        # proposing anyway is how an assistant produces confident nonsense.
        self.assertIn(
            "if (!lesson.title?.trim() && !objective.trim() && !sourceLabel) return;", STEPS
        )

    def test_it_asks_once_per_lesson(self):
        self.assertIn("const askedFor = useRef<string | null>(null);", STEPS)
        self.assertIn("askedFor.current = lesson.id;", STEPS)

    def test_a_dismissal_is_remembered(self):
        self.assertIn("setDeclined(true);", STEPS)


class MechanismCTests(unittest.TestCase):
    """C one command surface, not N buttons."""

    def test_it_is_one_bar_opened_by_a_chord(self):
        self.assertIn('event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)', ASK)
        self.assertIn("Ask Jargon", ASK)

    def test_the_screen_supplies_the_context_not_the_bar(self):
        # So it scales to fifty capabilities without this file growing a switch over
        # every screen in the product. R87 made the contract richer than a command
        # list — the screen declares the FIELDS a proposal may land in — but the
        # direction of the dependency is the point and is unchanged.
        self.assertIn("targets: AssistTarget[]", ASK)
        self.assertIn("suggestions: AssistSuggestion[]", ASK)
        self.assertIn("<AskJargon", SCREEN)
        self.assertIn("targets={assistTargets}", SCREEN)

    def test_the_lesson_offers_what_the_brief_names(self):
        # "on a lesson it offers to rewrite the objective, add a check, simplify the
        # reading level"
        for label in ("Write the objective", "Simplify the reading level"):
            with self.subTest(label=label):
                self.assertIn(label, SCREEN)

    def test_the_bar_says_that_nothing_is_saved(self):
        self.assertIn("nothing is saved until you press Save", ASK)


class MechanismDTests(unittest.TestCase):
    """D selection-scoped refinement."""

    def test_the_affordance_appears_only_after_a_selection(self):
        # "This is the only place a visible AI control belongs, because the selection
        # already declared the target."
        self.assertIn("{range && !disabled ? (", REFINE)
        self.assertIn("setRange(end - start >= 3 ? { start, end } : null);", REFINE)

    def test_it_offers_the_three_the_brief_names(self):
        for label in ('label: "shorter"', 'label: "simpler"', 'label: "more concrete"'):
            with self.subTest(label=label):
                self.assertIn(label, REFINE)

    def test_it_replaces_the_selection_and_nothing_else(self):
        self.assertIn(
            "onChange(value.slice(0, range.start) + trimmed + value.slice(range.end));", REFINE
        )


class NonNegotiableTests(unittest.TestCase):
    def test_never_writes(self):
        for writer in (
            "saveCurriculumLessonMeta",
            "upsertCurriculumStep",
            "invokeCurriculumAdmin",
            "supabase.from",
        ):
            with self.subTest(writer=writer):
                self.assertNotIn(writer, ASSIST)

    def test_always_reversible(self):
        # One undo returns exactly what was there.
        self.assertIn("setUndoTo(value);", REFINE)
        self.assertIn("onChange(undoTo);", REFINE)
        self.assertIn("previous: T;", PROPOSAL)

    def test_always_attributed(self):
        self.assertIn("origin: string;", PROPOSAL)
        # The steps proposal says so on its face, and says nothing is saved.
        self.assertIn("proposed step", STEPS)
        self.assertIn("Nothing is saved yet", STEPS)

    def test_grounded_by_default(self):
        # If the lesson has book pages, the draft uses them without being asked.
        self.assertIn("draftBriefFor(lesson, objective, sourceLabel)", STEPS)
        self.assertIn("`From ${sourceLabel}.`", STEPS)

    def test_one_provider(self):
        # "Authoring currently runs on OPENAI_API_KEY while the mentor runs Opus 5.
        # Lesson quality is what a school judges — unify onto the benchmark."
        self.assertIn("function authoringProvider()", ADMIN)
        self.assertIn('ANTHROPIC_API_KEY', ADMIN)
        self.assertIn('if (authoringProvider() === "anthropic") {', ADMIN)
        # Every authoring generation goes through the one choke point.
        self.assertEqual(ADMIN.count("async function callModelJson("), 1)
        self.assertIn("https://api.anthropic.com/v1/messages", ADMIN)

    def test_the_old_provider_still_works_where_it_is_the_only_key(self):
        # A deployment with only OPENAI_API_KEY must not break on this release.
        block = ADMIN.split("function authoringProvider()", 1)[1].split("\n}", 1)[0]
        self.assertIn("return keyFor(other) ? other : wanted;", block)
        self.assertIn("AUTHORING_PROVIDER", block)


if __name__ == "__main__":
    unittest.main()
