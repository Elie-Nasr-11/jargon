from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
CONVO = (ROOT / "frontend" / "src" / "student" / "useConversation.ts").read_text(encoding="utf-8")


class ProjectAssist(unittest.TestCase):
    """Wael's path 3: "assist with a project based on the lesson such as a presentation
    or essay". The mentor co-builds (student supplies the claims, mentor structures);
    a presentation ask flips the consent-first P8 offer to a DECK build the student
    downloads. Integrity holds: never write the piece for them."""

    def test_prompt_carries_the_co_build_posture(self):
        for fragment in (
            "PROJECT ASSIST:",
            "help them build it without doing it for them",
            "THEY say what each part should",
            "an outline they assembled beats a draft they copied",
            "never before the thinking is theirs",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, CHAT)

    def test_presentation_ask_is_detected(self):
        self.assertIn("const PROJECT_DECK_REQUEST_RE", CHAT)
        # Both eligibility rungs accept the project ask (re-open + trigger), so a
        # presentation request works even after a passive offer was already spent.
        self.assertEqual(CHAT.count("PROJECT_DECK_REQUEST_RE.test(content)"), 3)

    def test_offer_flips_to_a_deck_with_agreeing_prose(self):
        for fragment in (
            "const projectDeckAsk = artifactOfferEligible && PROJECT_DECK_REQUEST_RE.test(content);",
            '"Build these slides"',
            # The directive and the pill must describe the SAME build.
            "[Build these slides]",
            "per your PROJECT ASSIST rules",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, CHAT)
        # The struggling-sim flavor is unchanged.
        self.assertIn('"Build me a quick activity"', CHAT)
        self.assertIn('kind: "html_sim"', CHAT)

    def test_client_echo_names_the_deck_build(self):
        self.assertIn('offer.kind === "deck" ? "Yes — build the slides"', CONVO)


if __name__ == "__main__":
    unittest.main()
