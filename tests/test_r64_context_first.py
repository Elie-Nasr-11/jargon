"""R64 — the context-first architecture, slice by slice.

Owner (2026-08-26): "I don't want to create just a list of things to watch out
for. We should create a system that understands the flow of the conversation and
can adapt to it… since it's an API, we have to find a smart way to give context
in the conversation as well as keep context up to date with the flow of the
lesson."

The target: one brain per turn, fully briefed — the machine is a ledger and a
validator, never an interpreter.

SLICE 1 (this file's first pins): the mentor's own turn classification
("student_action", judged with the full conversation in view) is authoritative
for the persisted state fold. The thin-context router keeps exactly two jobs —
selecting the pre-model directive (until the ladder dissolves in slice 3) and
the fallback when the mentor omits the field.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")


class MentorClassificationTests(unittest.TestCase):
    def test_the_contract_explains_why_the_mentor_classifies(self):
        self.assertIn('"student_action"', CHAT)
        self.assertIn("because you read the whole\nconversation and a keyword list does not", CHAT)

    def test_the_mentor_verdict_is_authoritative_with_router_fallback(self):
        self.assertIn("const foldKind: RoutedKind | null = mentorAction ?? routedKind;", CHAT)
        # The persisted fold consumes foldKind, not the router verdict.
        fold_site = CHAT.split("const foldKind", 1)[1][:900]
        self.assertIn("foldKind,\n      mentorMovement,", fold_site)

    def test_the_same_guards_as_the_router_path_apply(self):
        # Control turns carry no student message; code/MCQ are answer_attempt by
        # construction; the register ceiling still caps discharges.
        site = CHAT.split("const mentorActionRaw", 1)[1][:900]
        self.assertIn('answer.mode === "code" || answer.mode === "multiple_choice"', site)
        self.assertIn('"answer_attempt"', site)
        self.assertIn("applyModeCeiling(declaredMode, mentorActionRaw)", site)

    def test_disagreements_stay_auditable(self):
        # turn_kind keeps the ROUTER verdict; student_action rides beside it in the
        # stored payload, so a divergence is readable from one row.
        self.assertIn("envelope.turn_kind = routedKind ?? undefined", CHAT)
        self.assertIn("ROUTED_KINDS.has(partial.student_action)", CHAT)

    def test_the_draft_fold_stays_router_driven_for_directives(self):
        # Pre-model directive selection is the router's last job — the draft fold
        # deliberately still consumes routedKind.
        draft_site = CHAT.split("const draftState = applyTurn(", 1)[1][:400]
        self.assertIn("routedKind,", draft_site)


if __name__ == "__main__":
    unittest.main()
