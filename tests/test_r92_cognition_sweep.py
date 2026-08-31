"""R92 — scheduled cognition scoring.

A profile that only exists when a teacher presses a button is a profile that mostly
does not exist, and §19's steering has nothing to read. So a scheduler sweeps the
backlog. The interesting part is that the caller is a cron job: there is no user to
authorize, so the design has to be careful about what such a caller may do.

These pins hold the sweep's contract and its blast radius. The live proof (403 with
no key, 403 with a wrong key, real profiles written for students nobody pressed a
button for) is recorded in docs/HANDOFF.md — pins cannot check a running cron.
"""
import re
import unittest
from pathlib import Path

from tests.source_text import without_comments

ROOT = Path(__file__).resolve().parents[1]
SCORER = (ROOT / "supabase" / "functions" / "cognition-scorer" / "index.ts").read_text(
    encoding="utf-8"
)
MIGRATION = (
    ROOT / "supabase" / "migrations" / "20260831140000_r92_cognition_sweep.sql"
).read_text(encoding="utf-8")


class TheSchedulerHasItsOwnDoorTests(unittest.TestCase):
    def test_sweep_is_the_only_action_without_a_user(self):
        # Every other action resolves a real person first; the sweep branch returns
        # before fetchCurrentUser is ever reached.
        body = SCORER[SCORER.index("const action = cleanText(record.action);") :]
        sweep_at = body.index('if (action === "sweep")')
        user_at = body.index("await fetchCurrentUser(config)")
        self.assertLess(sweep_at, user_at, "the sweep must branch before the user lookup")
        for action in ("score_lesson", "profile", "list_lessons"):
            with self.subTest(action=action):
                self.assertGreater(body.index(f'action === "{action}"'), user_at)

    def test_the_key_comparison_does_not_leak_its_length_or_prefix(self):
        # A byte-by-byte early exit lets a caller walk the key one character at a time.
        self.assertIn("diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);", SCORER)
        self.assertIn("return diff === 0;", SCORER)

    def test_a_missing_key_is_refused_not_defaulted(self):
        self.assertIn("if (!presented) return false;", SCORER)
        self.assertIn(
            'if (!presented || !expected || presented.length !== expected.length) return false;',
            SCORER,
        )

    def test_the_secret_is_unreadable_to_users(self):
        # RLS on with NO policy: anon and authenticated can never select it; only the
        # service role (bypasses RLS) and postgres can.
        auth_block = MIGRATION[
            MIGRATION.index("create table if not exists public.cognition_sweep_auth") :
        ]
        auth_block = auth_block[: auth_block.index("create or replace view")]
        self.assertIn("enable row level security", auth_block)
        self.assertIn("revoke all on public.cognition_sweep_auth from anon, authenticated;", auth_block)
        self.assertNotIn("create policy", auth_block)


class TheSweepCannotReadStudentsOutTests(unittest.TestCase):
    def test_it_returns_counts_only(self):
        # The whole reason a user-less caller is acceptable: there is nothing to read.
        sweep = SCORER[SCORER.index("async function sweep(") : SCORER.index("async function readProfile(")]
        returned = sweep[sweep.rindex("return json({") :]
        for key in ("pairs_seen", "pairs_scored", "responses_scored", "errors", "took_ms"):
            with self.subTest(key=key):
                self.assertIn(key, returned)
        for leak in ("turns", "profile", "narrative", "note"):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, returned)

    def test_the_run_log_holds_no_student_text(self):
        sweep = SCORER[SCORER.index("async function sweep(") : SCORER.index("async function readProfile(")]
        # detail carries lesson ids and counts; a note or a quote would be student work.
        self.assertIn("detail.push({ lesson_id: lessonId, scored: result.scored", sweep)
        self.assertNotIn("note:", sweep)

    def test_a_killed_tick_still_leaves_a_row(self):
        # The log is opened before any scoring and patched at the end. A tick the edge
        # gateway cuts mid-flight would otherwise vanish entirely — and a scheduler
        # whose failures are invisible is indistinguishable from one that is dead.
        sweep = SCORER[SCORER.index("async function sweep(") : SCORER.index("async function readProfile(")]
        opened = sweep.index("openRunLog(config, startedAt)")
        self.assertLess(opened, sweep.index("runScoring(config, userId, lessonId)"))
        self.assertIn("closeRunLog(config, runId,", sweep)
        self.assertIn('finished_at: new Date().toISOString()', SCORER)
        self.assertIn("finished_at timestamptz", MIGRATION)

    def test_the_log_never_takes_the_run_down_with_it(self):
        # Bookkeeping that can fail a scoring run is worse than a lost row.
        helpers = SCORER[SCORER.index("async function openRunLog(") : SCORER.index("async function sweep(")]
        self.assertEqual(helpers.count(".catch(() =>"), 2)


class OneScoringBodyTests(unittest.TestCase):
    def test_the_button_and_the_scheduler_score_identically(self):
        # If these diverged, a swept profile and a pressed one could disagree about the
        # same student — the rubric would mean two different things.
        self.assertIn("async function runScoring(", SCORER)
        self.assertIn("await runScoring(config, userId, lessonId)", SCORER)
        scorer_body = SCORER[SCORER.index("async function scoreLesson(") : SCORER.index("async function runScoring(")]
        self.assertIn("runScoring(config, userId, lessonId)", scorer_body)

    def test_runscoring_carries_no_authorization_of_its_own(self):
        # It is the shared body; each caller brings its own door. A check in here would
        # be a second, divergent one.
        guts = SCORER[SCORER.index("async function runScoring(") : SCORER.index("async function sweep(")]
        self.assertNotIn("assertCanViewStudent", guts)
        self.assertNotIn("isSweepCaller", guts)


class TheSweepIsBoundedTests(unittest.TestCase):
    def test_a_tick_reserves_room_for_the_pair_it_is_about_to_start(self):
        # A fixed cut-off cannot know whether the next pair will take forty seconds or
        # need a retry; measuring the priciest pair so far can.
        self.assertIn("SWEEP_BUDGET_MS", SCORER)
        self.assertIn(
            "if (Date.now() - startedAt + slowestPairMs > SWEEP_BUDGET_MS) break;", SCORER
        )
        self.assertIn("slowestPairMs = Math.max(slowestPairMs, Date.now() - pairStartedAt);", SCORER)

    def test_the_batch_is_capped_however_the_caller_asks(self):
        self.assertIn("Math.max(1, Math.min(SWEEP_BATCH_MAX, Math.round(requested)))", SCORER)

    def test_one_bad_pair_never_ends_the_run(self):
        sweep = SCORER[SCORER.index("async function sweep(") : SCORER.index("async function readProfile(")]
        self.assertIn("errors += 1;", sweep)
        self.assertIn("} catch (error) {", sweep)


class AFlakyJudgeIsRetriedNotMisdiagnosedTests(unittest.TestCase):
    """The first two scheduled ticks each lost one pair of two to "invalid JSON", and
    the obvious reading — a talkative student truncating the reply — was wrong: a
    bigger output budget changed nothing, and the third tick scored the same pair
    cleanly from byte-identical input. The reply is simply not always the JSON it was
    asked for. So: one retry, and an error that carries enough shape to tell the next
    cause apart from this one without ever quoting a student."""

    def test_an_unparseable_reply_is_tried_once_more(self):
        self.assertIn("async function judgeWithRetry(", SCORER)
        self.assertIn("await judgeWithRetry(sections.join(", SCORER)
        retry = SCORER[SCORER.index("async function judgeWithRetry(") :]
        retry = retry[: retry.index("\n}\n")]
        self.assertEqual(retry.count("await callJudge("), 2)

    def test_only_unparseable_replies_retry(self):
        # A refusal, a budget overrun, a timeout or an API error would come back the
        # same way twice; retrying them buys nothing and costs a model call.
        self.assertIn("if (!errorMessage(error).startsWith(UNPARSEABLE)) throw error;", SCORER)
        self.assertIn('const UNPARSEABLE = "The scoring model returned invalid JSON.";', SCORER)
        # The thrower uses the same constant, so the two can never drift apart.
        self.assertIn("throw new Error(`${UNPARSEABLE} ${judgeShape(", SCORER)

    def test_the_retry_cannot_eat_the_tick(self):
        self.assertIn("const JUDGE_TIMEOUT_MS = 80_000;", SCORER)
        self.assertIn("const JUDGE_RETRY_TIMEOUT_MS = 45_000;", SCORER)
        self.assertIn("callJudge(userPrompt: string, timeoutMs: number)", SCORER)
        self.assertIn("setTimeout(() => controller.abort(), timeoutMs)", SCORER)

    def test_a_failure_names_its_own_shape(self):
        # "invalid JSON" alone cost an afternoon on the wrong theory. These four facts
        # separate an empty reply, a refusal, a prose preamble and a broken string.
        shape = SCORER[SCORER.index("function judgeShape(") :][:600]
        for fact in ("stop=", "blocks=", "chars=", "json="):
            with self.subTest(fact=fact):
                self.assertIn(fact, shape)

    def test_the_shape_carries_no_student_text(self):
        # It goes into the run log, which platform admins read. The parser's own
        # message is cut at the first comma — exactly where V8 begins quoting the
        # document back at you.
        shape = SCORER[SCORER.index("function judgeShape(") :][:600]
        self.assertIn('.split(",")[0]', shape)
        for leak in ("text.slice", "userPrompt", "part.text"):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, shape)

    def test_truncation_still_says_so(self):
        # It was not the cause here, but it remains a real failure mode and a
        # perfect-until-cut-off object still parses as "invalid JSON" without this.
        self.assertIn('cleanText(data?.stop_reason) === "max_tokens"', SCORER)
        self.assertIn("ran past its output budget", SCORER)

    def test_a_failed_pair_stays_queued_for_the_next_tick(self):
        # Self-healing: nothing is written for a failed pair, so its turns are still
        # unscored and the queue view still returns it.
        self.assertIn("cts.id is null", MIGRATION)


class TheQueueAgreesWithTheJudgeTests(unittest.TestCase):
    def test_the_queue_uses_the_same_constructed_response_test(self):
        # A queue that disagreed with isConstructedResponse would either burn model
        # calls on turns the judge skips, or hide turns it would have scored.
        sql = without_comments(MIGRATION)
        self.assertIn("lt.payload->>'code'", sql)
        self.assertIn("length(trim(coalesce(nullif(lt.payload->>'text', ''), lt.content, ''))) >= 25", sql)
        self.assertIn("MIN_CONSTRUCTED_CHARS = 25", SCORER)

    def test_scored_turns_leave_the_queue(self):
        self.assertIn("left join public.cognition_turn_scores cts", MIGRATION)
        self.assertIn("cts.id is null", MIGRATION)

    def test_a_queued_pair_can_actually_drain(self):
        # If one call scored fewer responses than the queue threshold, a pair could
        # requeue forever: score 4 of 5, still 1 unscored... except the threshold is
        # 5 NEW responses, so it would leave the queue — and silently never finish.
        # The call must be able to take at least a threshold's worth in one go.
        per_call = int(re.search(r"MAX_SCORED_PER_CALL = (\d+)", SCORER).group(1))
        threshold = int(re.search(r"having count\(\*\) >= (\d+)", MIGRATION).group(1))
        self.assertGreaterEqual(per_call, threshold)

    def test_the_threshold_is_at_or_above_the_steering_floor(self):
        # §19 will not steer under three judged responses (R91), so queueing a pair
        # with fewer would spend a model call that changes nothing.
        self.assertIn("having count(*) >= 5", MIGRATION)

    def test_the_queue_is_not_readable_by_users(self):
        self.assertIn("revoke all on public.cognition_sweep_queue from anon, authenticated;", MIGRATION)
        self.assertIn("grant select on public.cognition_sweep_queue to service_role;", MIGRATION)


if __name__ == "__main__":
    unittest.main()
