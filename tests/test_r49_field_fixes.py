"""R49 — field-feedback triage (tester screenshot, 2026-08-20 8:22 AM).

Three reports, three fixes:
1. "On sign in should open to the home page" — every role-home redirect now goes
   through roleHomeNav, which stamps ?section=home for students. Bare /learn deep
   links keep meaning the conversation (absent section = Learn stays the in-app
   default) — only the sign-in/role redirects opt into Home.
2. "The YouTube video about the Unit circle is not loading" — prod data fix (two
   dead video ids in the campus math course, both verified via YouTube oEmbed and
   replaced with verified Khan Academy videos). Nothing to pin in source; the
   incident note lives in docs/DECISIONS.md.
3. "Starting a lesson is glitching" — the Aug 16–20 chat outage: a deploy left the
   chat function answering bare runtime 500s on every POST with NO logs, NO
   telemetry, and nothing red anywhere. Pinned guards: the deploy workflow now
   smoke-checks that freshly deployed functions answer TYPED JSON (a bare 5xx fails
   the run), and the chat function's catch paths console.error synchronously so a
   post-mortem always has evidence in function_logs.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"

API = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")
LOGIN = (FRONTEND / "routes" / "login.tsx").read_text(encoding="utf-8")
INDEX = (FRONTEND / "routes" / "index.tsx").read_text(encoding="utf-8")
LEARN = (FRONTEND / "routes" / "learn.tsx").read_text(encoding="utf-8")
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")
DEPLOY_YML = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")


class SignInLandsOnHomeTests(unittest.TestCase):
    def test_role_home_nav_stamps_home_for_students(self):
        self.assertIn("export function roleHomeNav(", API)
        self.assertIn('return to === "/learn" ? { to, search: { section: "home" } } : { to };', API)

    def test_signin_and_root_redirects_use_the_nav_helper(self):
        # All three login navigations + the root redirect ride roleHomeNav; no caller
        # navigates to a bare roleHome(role) any more.
        self.assertEqual(LOGIN.count("roleHomeNav(role)"), 3)
        self.assertNotIn("to: roleHome(role)", LOGIN)
        self.assertIn("throw redirect(roleHomeNav(role));", INDEX)

    def test_bare_learn_deep_links_keep_meaning_the_conversation(self):
        # The tester's ask is about SIGN-IN, not the app's in-session default — a
        # bookmark to /learn (no params) still opens the conversation.
        self.assertIn('section ?? "learn"', LEARN)


class ChatOutageGuardTests(unittest.TestCase):
    def test_chat_failures_log_synchronously(self):
        # During the outage the ONLY failure writer was a background telemetry insert
        # that never flushed. Both catch paths now console.error first.
        self.assertIn('console.error("chat_turn_failed"', CHAT)
        self.assertIn('console.error("chat_request_failed"', CHAT)

    def test_deploy_workflow_smoke_checks_typed_responses(self):
        # A broken-on-arrival function must fail the DEPLOY RUN, not wait for a student:
        # a garbage POST must return the function's typed JSON refusal, never a bare 5xx.
        self.assertIn("Smoke-check deployed functions answer typed responses", DEPLOY_YML)
        smoke = DEPLOY_YML.split("Smoke-check deployed functions", 1)[1]
        self.assertIn("for fn in chat assessment-admin curriculum-admin; do", smoke)
        self.assertIn('if [ "$code" -ge 500 ]', smoke)
        self.assertIn("jq -e .", smoke)


if __name__ == "__main__":
    unittest.main()
