"""R87 — Ask Jargon becomes a sidebar with a conversation in it.

R85 shipped mechanism C as a ⌘K palette: a list of commands in a box in the middle
of the screen. It did the job and felt like a menu. The owner's note was that an
assistant should "open into a sidebar as all assistants do" — so it is a panel, down
the right, and you talk to it.

The point of these pins is that it is a SIDEBAR and not an overlay: opening it
shrinks the page rather than covering the controls it exists to help with. The four
non-negotiables from step 8 are re-pinned here because a conversation makes them
easier to lose than a command list did.
"""
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
ASK = (SRC / "features" / "teacher" / "assist" / "AskJargon.tsx").read_text(encoding="utf-8")
SHELL = (SRC / "features" / "teacher" / "shell" / "TeacherShell.tsx").read_text(encoding="utf-8")
SCREEN = (SRC / "features" / "teacher" / "lesson" / "LessonScreen.tsx").read_text(encoding="utf-8")
PROPOSAL = (SRC / "features" / "teacher" / "assist" / "useFieldProposal.ts").read_text(
    encoding="utf-8"
)


class ItIsASidebarTests(unittest.TestCase):
    def test_the_shell_gives_it_a_slot_beside_the_page(self):
        # A sibling of the stage inside the shell's flex row — which is what makes the
        # page shrink instead of being covered. Walked at 1440px: 1180 -> 780.
        self.assertIn("assistant?: ReactNode;", SHELL)
        self.assertIn("{assistant}", SHELL)
        self.assertIn("assistant={", SCREEN)

    def test_it_is_a_panel_not_a_modal(self):
        self.assertIn('<aside', ASK)
        self.assertIn('aria-label="Ask Jargon"', ASK)
        # On a wide screen it takes width in the row; on a narrow one there is no width
        # to take, so it covers.
        self.assertIn("lg:static", ASK)
        self.assertIn("lg:w-[400px]", ASK)
        self.assertIn("lg:shrink-0", ASK)
        # The R85 palette's centred scrim is gone.
        self.assertNotIn("fixed inset-0", ASK)

    def test_the_bell_no_longer_sits_on_top_of_it(self):
        # It was fixed to the VIEWPORT, so the panel opened underneath it and the bell
        # swallowed the panel's own close button. Found by walking.
        self.assertNotIn('className="fixed right-3 top-3', SHELL)
        self.assertIn('className="absolute right-3 top-3', SHELL)


class ItIsAConversationTests(unittest.TestCase):
    def test_turns_have_two_sides(self):
        self.assertIn('role: "you"', ASK)
        self.assertIn('role: "jargon"', ASK)
        self.assertIn('kind: "thinking"', ASK)
        self.assertIn('kind: "proposal"', ASK)

    def test_it_grows_from_the_bottom(self):
        # Next to the composer, the way a chat does — not from the top with a field of
        # empty space under it.
        self.assertIn("flex-col justify-end", ASK)

    def test_the_empty_state_still_does_the_work(self):
        # Mechanism B: an empty conversation offers what this screen is good at rather
        # than an empty box and a blinking cursor.
        self.assertIn("suggestions.map", ASK)
        self.assertIn("What would you like to change about this", ASK)


class TheNonNegotiablesSurviveTests(unittest.TestCase):
    def test_never_writes(self):
        for writer in ("saveCurriculumLessonMeta", "upsertCurriculumStep", "supabase.from"):
            with self.subTest(writer=writer):
                self.assertNotIn(writer, ASK)
        self.assertIn("nothing is saved until you press Save", ASK)

    def test_always_attributed(self):
        # Every proposal names the field it is for, so a conversation can never leave
        # you wondering what just changed.
        self.assertIn("{targetLabel}", ASK)
        self.assertIn("Nothing is saved yet.", ASK)

    def test_always_reversible(self):
        self.assertIn("previous: string;", ASK)
        self.assertIn("apply(turn.previous)", ASK)
        self.assertIn("Undo", ASK)

    def test_the_screen_owns_the_fields_not_the_panel(self):
        # The panel asks; the lesson decides what a proposal may land in.
        self.assertIn("targets: AssistTarget[]", ASK)
        self.assertIn("apply: (text: string) => void", ASK)
        self.assertIn("assistTargets", SCREEN)


class OneOfferPerFieldTests(unittest.TestCase):
    def test_an_arrival_proposal_clears_once_the_field_is_filled(self):
        # Found by walking: accepting the panel's proposal left mechanism A's arrival
        # proposal sitting under the same field, offering the same job twice.
        self.assertIn(
            "if (!wantsProposal(current) && state.status === \"offered\") setState({ status: \"idle\" });",
            PROPOSAL,
        )


if __name__ == "__main__":
    unittest.main()
