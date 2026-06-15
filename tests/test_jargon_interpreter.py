import random
import string
import unittest

from jargon_examples import extract_code, load_example, run_example
from jargon_interpreter import JargonLimits, StructuredJargonInterpreter, run_sandboxed


class StructuredJargonInterpreterTests(unittest.TestCase):
    def run_code(self, code, **kwargs):
        return StructuredJargonInterpreter().run(code, **kwargs)

    def test_basic_assignment_print_and_comments(self):
        result = self.run_code(
            """
            SET x (2 + 3) # this is ignored
            PRINT x
            PRINT "not # a comment"
            """
        )

        self.assertEqual(result["output"], ["5", "not # a comment"])
        self.assertEqual(result["memory"]["x"], 5)
        self.assertEqual(result["errors"], [])

    def test_full_line_slash_comments_are_ignored(self):
        result = self.run_code(
            """
            // Starter comment
            SET x (2)
            IF x is equal to 2 THEN
                // Nested comment
                REPEAT 2 times
                    // Loop comment
                    PRINT x
                END
            END
            """
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["output"], ["2", "2"])
        self.assertEqual(result["errors"], [])

    def test_slash_comments_do_not_break_strings_or_floor_division(self):
        result = self.run_code(
            """
            PRINT "not // a comment"
            PRINT 5 // 2
            """
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["output"], ["not // a comment", "2"])

    def test_inline_slash_comment_is_controlled_error(self):
        result = self.run_code("SET x (1) // not supported")

        self.assertEqual(result["status"], "error")
        self.assertTrue(any("Invalid SET syntax" in error for error in result["errors"]))

    def test_condition_precedence_uses_and_before_or(self):
        result = self.run_code(
            """
            SET a (1)
            SET b (0)
            SET c (0)
            IF a is equal to 1 OR b is equal to 1 AND c is equal to 1 THEN
                PRINT "true"
            ELSE
                PRINT "false"
            END
            """
        )

        self.assertEqual(result["output"], ["true"])

    def test_nested_if_else_does_not_steal_outer_else(self):
        result = self.run_code(
            """
            SET x (1)
            SET y (2)
            IF x is equal to 1 THEN
                IF y is equal to 3 THEN
                    PRINT "inner true"
                ELSE
                    PRINT "inner false"
                END
            ELSE
                PRINT "outer false"
            END
            """
        )

        self.assertEqual(result["output"], ["inner false"])

    def test_repeat_count_can_be_expression(self):
        result = self.run_code(
            """
            SET count (3)
            SET values ([])
            REPEAT count times
                ADD count to values
            END
            PRINT len(values)
            """
        )

        self.assertEqual(result["memory"]["values"], [3, 3, 3])
        self.assertEqual(result["output"], ["3"])

    def test_repeat_until_and_index_assignment(self):
        result = self.run_code(
            """
            SET i (0)
            SET values ([0, 0, 0])
            REPEAT_UNTIL i reaches end of values
                SET values[i] (i + 10)
                SET i (i + 1)
            END
            PRINT values
            """
        )

        self.assertEqual(result["memory"]["values"], [10, 11, 12])
        self.assertEqual(result["output"], ["[10, 11, 12]"])

    def test_for_each_uses_iterable_expression(self):
        result = self.run_code(
            """
            SET total (0)
            REPEAT_FOR_EACH item in [1, 2, 3]
                SET total (total + item)
            END
            PRINT total
            """
        )

        self.assertEqual(result["output"], ["6"])

    def test_break_exits_innermost_loop(self):
        result = self.run_code(
            """
            SET seen ([])
            REPEAT 2 times
                REPEAT 3 times
                    ADD "inner" to seen
                    BREAK
                END
                ADD "outer" to seen
            END
            PRINT seen
            """
        )

        self.assertEqual(result["memory"]["seen"], ["inner", "outer", "inner", "outer"])

    def test_ask_uses_preset_answers_and_clears_between_runs(self):
        interpreter = StructuredJargonInterpreter()

        first = interpreter.run(
            """
            ASK "Age?" as age
            PRINT age
            """
        )
        self.assertEqual(first["ask"], "Age?")
        self.assertEqual(first["ask_var"], "age")

        second = interpreter.run(
            """
            ASK "Age?" as age
            PRINT age
            """,
            preset_answers={"age": 42},
        )
        self.assertIsNone(second["ask"])
        self.assertIsNone(second["ask_var"])
        self.assertEqual(second["output"], ["42"])

    def test_ask_can_consume_sequential_answers(self):
        result = self.run_code(
            """
            ASK "First?" as first
            ASK "Second?" as second
            PRINT first + second
            """,
            answers=["2", "3"],
        )

        self.assertEqual(result["output"], ["5"])
        self.assertEqual(result["memory"]["first"], 2)
        self.assertEqual(result["memory"]["second"], 3)

    def test_missing_end_reports_error(self):
        result = self.run_code(
            """
            IF 1 is equal to 1 THEN
                PRINT "never reached"
            """
        )

        self.assertIn("Missing END", result["output"][0])
        self.assertEqual(result["errors"], ["Missing END for block starting with: IF 1 is equal to 1 THEN"])

    def test_unsafe_expression_is_rejected(self):
        result = self.run_code('PRINT __import__("os").system("echo unsafe")')

        self.assertEqual(len(result["output"]), 1)
        self.assertIn("not allowed", result["output"][0])

    def test_invalid_condition_inside_loop_does_not_crash(self):
        result = self.run_code(
            """
            REPEAT_UNTIL missing_variable is equal to 1
                PRINT "loop body"
            END
            """
        )

        self.assertTrue(any("missing_variable" in error for error in result["errors"]))

    def test_result_includes_hardening_status_fields(self):
        result = self.run_code("PRINT 1")

        self.assertEqual(result["status"], "ok")
        self.assertFalse(result["truncated"])
        self.assertEqual(result["limits_hit"], [])

    def test_top_level_break_is_controlled_error(self):
        result = self.run_code("BREAK")

        self.assertEqual(result["status"], "error")
        self.assertIn("BREAK used outside of a loop", result["errors"][0])

    def test_non_string_source_is_controlled_error(self):
        result = self.run_code(123)

        self.assertEqual(result["status"], "error")
        self.assertIn("Source code must be a string", result["errors"][0])

    def test_oversized_source_and_line_are_rejected(self):
        tiny_source_limit = JargonLimits(max_source_chars=5)
        source_result = StructuredJargonInterpreter(limits=tiny_source_limit).run("PRINT 1")
        self.assertEqual(source_result["status"], "limit_exceeded")
        self.assertIn("max_source_chars", source_result["limits_hit"])

        tiny_line_limit = JargonLimits(max_line_chars=3)
        line_result = StructuredJargonInterpreter(limits=tiny_line_limit).run("PRINT 1")
        self.assertEqual(line_result["status"], "limit_exceeded")
        self.assertIn("max_line_chars", line_result["limits_hit"])

    def test_too_many_lines_and_block_depth_are_rejected(self):
        line_limited = JargonLimits(max_lines=1)
        line_result = StructuredJargonInterpreter(limits=line_limited).run("PRINT 1\nPRINT 2")
        self.assertEqual(line_result["status"], "limit_exceeded")
        self.assertIn("max_lines", line_result["limits_hit"])

        depth_limited = JargonLimits(max_block_depth=1)
        depth_result = StructuredJargonInterpreter(limits=depth_limited).run(
            """
            IF 1 is equal to 1 THEN
                IF 1 is equal to 1 THEN
                    PRINT 1
                END
            END
            """
        )
        self.assertEqual(depth_result["status"], "limit_exceeded")
        self.assertIn("max_block_depth", depth_result["limits_hit"])

    def test_expression_size_depth_and_unsupported_ast_are_rejected(self):
        chars_limited = JargonLimits(max_expr_chars=5)
        chars_result = StructuredJargonInterpreter(limits=chars_limited).run("PRINT 123456")
        self.assertEqual(chars_result["status"], "limit_exceeded")
        self.assertIn("max_expr_chars", chars_result["limits_hit"])

        nodes_limited = JargonLimits(max_expr_nodes=3)
        nodes_result = StructuredJargonInterpreter(limits=nodes_limited).run("PRINT 1 + 2 + 3")
        self.assertEqual(nodes_result["status"], "limit_exceeded")
        self.assertIn("max_expr_nodes", nodes_result["limits_hit"])

        unsupported_result = self.run_code("PRINT [x for x in [1, 2, 3]]")
        self.assertEqual(unsupported_result["status"], "error")
        self.assertTrue(any("ListComp" in error for error in unsupported_result["errors"]))

    def test_bad_arithmetic_and_division_by_zero_are_controlled(self):
        type_result = self.run_code('PRINT "x" - 1')
        self.assertEqual(type_result["status"], "error")
        self.assertTrue(any("Binary operation failed" in error for error in type_result["errors"]))

        zero_result = self.run_code("PRINT 1 / 0")
        self.assertEqual(zero_result["status"], "error")
        self.assertTrue(any("division by zero" in error for error in zero_result["errors"]))

    def test_or_inside_comparison_phrase_is_not_logical_or(self):
        result = self.run_code(
            """
            SET grade (45)
            IF grade is greater than or equal to 90 THEN
                PRINT "Excellent"
            ELSE
                IF grade is greater than or equal to 60 THEN
                    PRINT "Pass"
                ELSE
                    PRINT "Fail"
                END
            END
            """
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["output"], ["Fail"])

        less_result = self.run_code(
            """
            SET temp (5)
            IF temp is less than or equal to 10 THEN
                PRINT "Cold"
            END
            """
        )

        self.assertEqual(less_result["status"], "ok")
        self.assertEqual(less_result["output"], ["Cold"])

    def test_huge_collections_ranges_and_strings_are_rejected(self):
        collection_result = self.run_code("PRINT [0] * 10000000")
        self.assertEqual(collection_result["status"], "limit_exceeded")
        self.assertIn("max_collection_items", collection_result["limits_hit"])

        range_result = self.run_code("PRINT range(1000000000000)")
        self.assertEqual(range_result["status"], "limit_exceeded")
        self.assertIn("max_collection_items", range_result["limits_hit"])

        list_range_result = self.run_code("PRINT list(range(1000000000000))")
        self.assertEqual(list_range_result["status"], "limit_exceeded")
        self.assertIn("max_collection_items", list_range_result["limits_hit"])

        sorted_range_result = self.run_code("PRINT sorted(range(1000000000000))")
        self.assertEqual(sorted_range_result["status"], "limit_exceeded")
        self.assertIn("max_collection_items", sorted_range_result["limits_hit"])

        string_result = self.run_code('PRINT "x" * 10000000')
        self.assertEqual(string_result["status"], "limit_exceeded")
        self.assertIn("max_string_chars", string_result["limits_hit"])

    def test_power_operator_is_bounded(self):
        result = self.run_code("PRINT 16 ** 0.5")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["output"], ["4.0"])

        huge_result = self.run_code("PRINT 2 ** 100000")
        self.assertEqual(huge_result["status"], "limit_exceeded")
        self.assertIn("max_number_abs", huge_result["limits_hit"])

    def test_output_and_error_logs_are_capped(self):
        output_limited = JargonLimits(max_output_items=2, max_steps=20)
        output_result = StructuredJargonInterpreter(limits=output_limited).run(
            """
            PRINT 1
            PRINT 2
            PRINT 3
            """
        )

        self.assertTrue(output_result["truncated"])
        self.assertIn("max_output_items", output_result["limits_hit"])
        self.assertLessEqual(len(output_result["output"]), 2)

        item_limited = JargonLimits(max_output_chars_per_item=20)
        item_result = StructuredJargonInterpreter(limits=item_limited).run('PRINT "abcdefghijklmnopqrstuvwxyz"')
        self.assertTrue(item_result["truncated"])
        self.assertIn("max_output_chars_per_item", item_result["limits_hit"])

        errors_limited = JargonLimits(max_errors=1, max_steps=20)
        errors_result = StructuredJargonInterpreter(limits=errors_limited).run(
            """
            UNKNOWN
            STILL_UNKNOWN
            """
        )
        self.assertTrue(errors_result["truncated"])
        self.assertIn("max_errors", errors_result["limits_hit"])
        self.assertLessEqual(len(errors_result["errors"]), 1)

    def test_huge_repeat_counts_and_empty_loops_are_limited(self):
        huge_repeat = self.run_code(
            """
            REPEAT 10000000 times
            END
            """
        )
        self.assertEqual(huge_repeat["status"], "limit_exceeded")
        self.assertIn("max_loop_iterations", huge_repeat["limits_hit"])

        empty_loop_limited = JargonLimits(max_loop_iterations=3, max_steps=100)
        empty_loop = StructuredJargonInterpreter(limits=empty_loop_limited).run(
            """
            REPEAT_UNTIL False
            END
            """
        )
        self.assertEqual(empty_loop["status"], "limit_exceeded")
        self.assertIn("max_loop_iterations", empty_loop["limits_hit"])

    def test_host_objects_in_inputs_are_rejected_without_crashing(self):
        class Hostile:
            def __str__(self):
                raise RuntimeError("should not stringify")

        preset_result = self.run_code("PRINT value", preset_answers={"value": Hostile()})
        self.assertEqual(preset_result["status"], "error")
        self.assertTrue(any("Unsupported value type" in error for error in preset_result["errors"]))

        answer_result = self.run_code(
            """
            ASK "Value?" as value
            PRINT value
            """,
            answers=[Hostile()],
        )
        self.assertEqual(answer_result["status"], "error")
        self.assertTrue(any("Unsupported value type" in error for error in answer_result["errors"]))

    def test_random_garbage_never_raises(self):
        rng = random.Random(12345)
        alphabet = string.ascii_letters + string.digits + string.punctuation + " \n\t"

        for _ in range(100):
            code = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 200)))
            try:
                result = self.run_code(code)
            except Exception as exc:
                self.fail(f"Interpreter raised {type(exc).__name__} for fuzz input {code!r}")
            self.assertIn(result["status"], {"ok", "error", "limit_exceeded", "waiting_for_input"})

    def test_legacy_example_wrapper_can_be_extracted_and_run(self):
        text = """
        Name: Selection Sort

        Jargon Code:
        SET nums ([3, 1, 2])
        SET sorted ([])
        REPEAT_UNTIL nums is equal to []
            SET j (0)
            SET min_index (0)
            REPEAT_UNTIL j reaches end of nums
                IF nums[j] is less than nums[min_index] THEN
                    SET min_index (j)
                END
                SET j (j + 1)
            END
            ADD nums[min_index] to sorted
            SET new_nums ([])
            SET k (0)
            REPEAT_UNTIL k reaches end of nums
                IF k is not equal to min_index THEN
                    ADD nums[k] to new_nums
                END
                SET k (k + 1)
            END
            SET nums (new_nums)
        END
        PRINT sorted

        Expected Output:
        [1, 2, 3]

        Explanation:
        Lesson prose goes here.
        """

        code = extract_code(text)
        self.assertNotIn("Name:", code)
        self.assertNotIn("Expected Output:", code)

        result = self.run_code(code)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["output"], ["[1, 2, 3]"])

    def test_legacy_example_file_loader(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.txt"
            path.write_text(
                """
                Code:
                SET grade (45)
                IF grade is greater than or equal to 60 THEN
                    PRINT "Pass"
                ELSE
                    PRINT "Fail"
                END

                Expected Output:
                Fail
                """,
                encoding="utf-8",
            )

            example = load_example(path)
            self.assertEqual(example.title, "sample")
            self.assertEqual(example.expected_output, "Fail")
            self.assertEqual(run_example(example)["output"], ["Fail"])

    def test_sandbox_success_and_metadata(self):
        result = run_sandboxed("PRINT 2 + 3", timeout_seconds=2, memory_mb=256)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["output"], ["5"])
        self.assertIn("sandbox", result)
        self.assertEqual(result["sandbox"]["timeout_seconds"], 2)

    def test_sandbox_timeout(self):
        limits = JargonLimits(max_loop_iterations=10000000, max_steps=10000000)
        result = run_sandboxed(
            """
            REPEAT_UNTIL False
            END
            """,
            limits=limits,
            timeout_seconds=0.05,
            memory_mb=256,
        )

        self.assertEqual(result["status"], "sandbox_error")
        self.assertIn("sandbox_timeout", result["limits_hit"])

    def test_sandbox_rejects_bad_payload_and_bounds_output(self):
        class NotJson:
            pass

        rejected = run_sandboxed("PRINT value", preset_answers={"value": NotJson()}, memory_mb=256)
        self.assertEqual(rejected["status"], "sandbox_error")
        self.assertIn("sandbox_input", rejected["limits_hit"])

        limited = JargonLimits(max_output_chars_per_item=30)
        bounded = run_sandboxed('PRINT "x" * 1000', limits=limited, memory_mb=256)
        self.assertEqual(bounded["status"], "limit_exceeded")
        self.assertLessEqual(len(bounded["output"][0]), 30)


if __name__ == "__main__":
    unittest.main()
