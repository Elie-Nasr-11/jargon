"""Trimmed 2026-07-30 (trunk unification / MVP scope): the teacher-console
auto-extract wiring this module pinned (autoExtract on upload, the PDF text →
page previews → OCR fallback chain, extractChunks' return-value dispatch) was cut
with the media pipeline — TeacherConsole no longer contains any of it, so those
pins were removed rather than repointed.

What survives is the contract that wiring used to feed, and it still holds:
approval gates what the mentor sees. The chat edge function reads lesson
resources with status='approved' only, so nothing a teacher has not reviewed can
reach a student regardless of how the text got extracted. That invariant is
pinned below.
"""

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHAT = (REPO / "supabase" / "functions" / "chat" / "index.ts").read_text()


class ApprovalGatesMentorVisibleResources(unittest.TestCase):
    def test_approval_still_gates_what_the_mentor_sees(self):
        # If chat stops filtering on approved, any future extraction path would start
        # publishing unreviewed text to students.
        self.assertIn("status=eq.approved", CHAT)


if __name__ == "__main__":
    unittest.main()
