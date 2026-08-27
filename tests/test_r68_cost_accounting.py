"""R68 — honest cost accounting in the model-usage ledger.

Found while building the launch price sheet (2026-08-27): the Anthropic adapters
reported inputTokens WITHOUT the cache-read share, while estimatedCostUsd assumes
OpenAI semantics (prompt total includes the cached share) and subtracts
cachedTokens to find the full-price share. On steady cached turns the read block
(~16.4k) exceeded the fresh input (~4k), the subtraction clamped fresh to zero,
and the whole fresh prompt was billed at the 10% cache rate — the admin ledger
understated real Anthropic spend roughly 2x.

The law, pinned here:
- both Anthropic usage sites (non-streaming + streaming) report inputTokens as
  the TOTAL prompt: fresh + cache writes + cache reads;
- the estimator keeps its one contract — subtract cachedTokens from a total that
  contains it (cache-write 1.25x premium stays unmodeled, a ~2%/turn undercount,
  recorded in DECISIONS);
- Sonnet 5 is priced explicitly at its permanent $2/$10 launch price so the
  longer prefix beats the generic $3/$15 sonnet row.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHAT = (ROOT / "supabase" / "functions" / "chat" / "index.ts").read_text(encoding="utf-8")


class AdapterTotalsTests(unittest.TestCase):
    def test_non_streaming_usage_totals_include_cache_reads(self):
        self.assertIn(
            "inputTokens:\n"
            "      Number(usage.input_tokens || 0) +\n"
            "      Number(usage.cache_creation_input_tokens || 0) +\n"
            "      Number(usage.cache_read_input_tokens || 0),",
            CHAT,
        )

    def test_streaming_usage_totals_include_cache_reads(self):
        self.assertIn(
            "inputTokens =\n"
            "        Number(usage.input_tokens || 0) +\n"
            "        Number(usage.cache_creation_input_tokens || 0) +\n"
            "        Number(usage.cache_read_input_tokens || 0);",
            CHAT,
        )

    def test_cached_tokens_stay_the_read_lane_only(self):
        self.assertEqual(
            CHAT.count("cachedTokens: Number(usage.cache_read_input_tokens || 0),"), 1
        )
        self.assertEqual(
            CHAT.count("cachedTokens = Number(usage.cache_read_input_tokens || 0);"), 1
        )


class EstimatorContractTests(unittest.TestCase):
    def test_the_estimator_states_and_keeps_the_total_prompt_contract(self):
        self.assertIn("inputTokens is the TOTAL prompt INCLUDING the cached share", CHAT)
        self.assertIn(
            "const cached = Math.max(0, Math.min(cachedTokens || 0, inputTokens || 0));",
            CHAT,
        )
        self.assertIn("const fresh = Math.max(0, (inputTokens || 0) - cached);", CHAT)

    def test_sonnet_5_priced_explicitly_ahead_of_the_generic_row(self):
        self.assertIn(
            '["claude-sonnet-5", { input: 2, cachedInput: 0.2, output: 10 }],', CHAT
        )
        # The generic family row survives for 4.x models, and the longest-prefix
        # sort is what lets the specific row win.
        self.assertIn('["claude-sonnet", { input: 3, cachedInput: 0.3, output: 15 }],', CHAT)
        self.assertIn("longest-first", CHAT)


if __name__ == "__main__":
    unittest.main()
