import ast
import json
import math
import operator
import os
import re
import subprocess
import sys
from collections.abc import Iterable, Sized
from dataclasses import asdict, dataclass, fields
from typing import Optional, Sequence


@dataclass(frozen=True)
class JargonLimits:
    max_source_chars: int = 50000
    max_lines: int = 2000
    max_line_chars: int = 1000
    max_block_depth: int = 64
    max_expr_chars: int = 500
    max_expr_nodes: int = 200
    max_expr_depth: int = 40
    max_steps: int = 1000
    max_loop_iterations: int = 1000
    max_collection_items: int = 10000
    max_string_chars: int = 10000
    max_number_abs: int = 10**12
    max_output_items: int = 500
    max_output_chars_per_item: int = 2000
    max_total_output_chars: int = 50000
    max_errors: int = 200

    def __post_init__(self):
        for field in fields(self):
            value = getattr(self, field.name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ValueError(f"{field.name} must be a non-negative integer")


class AskException(Exception):
    def __init__(self, prompt, variable):
        super().__init__(prompt)
        self.prompt = prompt
        self.variable = variable


class BreakSignal(Exception):
    pass


class EvaluationError(Exception):
    pass


class LimitExceeded(EvaluationError):
    pass


class ExecutionLimitExceeded(LimitExceeded):
    pass


class SourceError(Exception):
    pass


class StructuredJargonInterpreter:
    SET_INDEXED_RE = re.compile(r"SET\s+([A-Za-z_]\w*)\[(.+?)\]\s*\((.*)\)\s*$", re.IGNORECASE)
    SET_SIMPLE_RE = re.compile(r"SET\s+([A-Za-z_]\w*)\s*\((.*)\)\s*$", re.IGNORECASE)
    ASK_RE = re.compile(r'ASK\s+"(.+?)"\s+as\s+([A-Za-z_]\w*)\s*$', re.IGNORECASE)
    ADD_RE = re.compile(r"ADD\s+(.+?)\s+to\s+([A-Za-z_]\w*)\s*$", re.IGNORECASE)
    REMOVE_RE = re.compile(r"REMOVE\s+(.+?)\s+from\s+([A-Za-z_]\w*)\s*$", re.IGNORECASE)
    IF_RE = re.compile(r"IF\s+(.+?)(?:\s+THEN)?\s*$", re.IGNORECASE)
    REPEAT_RE = re.compile(r"REPEAT\s+(.+?)\s+times\s*$", re.IGNORECASE)
    REPEAT_FOR_EACH_RE = re.compile(r"REPEAT_FOR_EACH\s+([A-Za-z_]\w*)\s+in\s+(.+)\s*$", re.IGNORECASE)
    VAR_RE = re.compile(r"[A-Za-z_]\w*\Z")

    BLOCK_STARTERS = ("IF ", "REPEAT_UNTIL", "REPEAT ", "REPEAT_FOR_EACH")

    BIN_OPS = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv,
        ast.Mod: operator.mod,
        ast.Pow: operator.pow,
    }

    UNARY_OPS = {
        ast.UAdd: operator.pos,
        ast.USub: operator.neg,
        ast.Not: operator.not_,
    }

    COMPARE_OPS = {
        ast.Eq: operator.eq,
        ast.NotEq: operator.ne,
        ast.Lt: operator.lt,
        ast.LtE: operator.le,
        ast.Gt: operator.gt,
        ast.GtE: operator.ge,
        ast.In: lambda a, b: a in b,
        ast.NotIn: lambda a, b: a not in b,
    }

    ALLOWED_AST_TYPES = (
        ast.Constant,
        ast.Name,
        ast.List,
        ast.Tuple,
        ast.Dict,
        ast.BinOp,
        ast.UnaryOp,
        ast.BoolOp,
        ast.Compare,
        ast.Subscript,
        ast.Slice,
        ast.Call,
        ast.Load,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.FloorDiv,
        ast.Mod,
        ast.Pow,
        ast.UAdd,
        ast.USub,
        ast.Not,
        ast.And,
        ast.Or,
        ast.Eq,
        ast.NotEq,
        ast.Lt,
        ast.LtE,
        ast.Gt,
        ast.GtE,
        ast.In,
        ast.NotIn,
    )

    def __init__(self, max_steps=1000, limits: Optional[JargonLimits] = None):
        self.limits = limits if limits is not None else JargonLimits(max_steps=max_steps)
        self.max_steps = self.limits.max_steps
        self.memory = {}
        self.output_log = []
        self.error_log = []
        self.pending_ask = None
        self.pending_question = None
        self.answers = []
        self.answer_index = 0
        self.lines = []
        self.step_count = 0
        self.loop_depth = 0
        self.truncated = False
        self.limits_hit = []
        self._limits_hit_set = set()
        self._expr_cache = {}
        self._total_output_chars = 0
        self._output_truncation_reported = False
        self._error_truncation_reported = False

    def run(self, code: str, preset_answers: Optional[dict] = None, answers: Optional[Sequence] = None):
        self._reset_run_state()

        try:
            self.memory.update(self._sanitize_preset_answers(preset_answers))
            self.answers = self._sanitize_answers(answers)
            self.lines = self.parse_lines(code)
            self._validate_block_depth(self.lines)
            self.execute_block(self.lines)
        except AskException as e:
            self.pending_ask = e
            self.pending_question = {"prompt": e.prompt, "variable": e.variable}
        except BreakSignal:
            self._error("BREAK used outside of a loop.")
        except ExecutionLimitExceeded as e:
            self._error(str(e) or "Execution stopped: too many steps (possible infinite loop).")
        except LimitExceeded as e:
            self._error(str(e))
        except SourceError as e:
            self._error(str(e))
        except (EvaluationError, RecursionError, OverflowError, TypeError, ValueError) as e:
            self._error(f"Execution failed: {e}")
        except Exception as e:
            self._error(f"Internal interpreter error: {type(e).__name__}: {e}")

        return self._result()

    def parse_lines(self, code: str) -> list[str]:
        if not isinstance(code, str):
            raise SourceError("Source code must be a string.")
        if len(code) > self.limits.max_source_chars:
            self._raise_limit(
                "max_source_chars",
                f"Source is too large: {len(code)} characters exceeds {self.limits.max_source_chars}.",
            )

        lines = []
        for line_number, raw_line in enumerate(code.splitlines(), start=1):
            if len(raw_line) > self.limits.max_line_chars:
                self._raise_limit(
                    "max_line_chars",
                    f"Line {line_number} is too long: {len(raw_line)} characters exceeds {self.limits.max_line_chars}.",
                )

            line = self._strip_comment(raw_line).strip()
            if not line:
                continue
            lines.append(line)
            if len(lines) > self.limits.max_lines:
                self._raise_limit(
                    "max_lines",
                    f"Program has too many executable lines: exceeds {self.limits.max_lines}.",
                )
        return lines

    def execute_block(self, block):
        i = 0
        while i < len(block):
            line = block[i]
            self._tick()

            if self._is_command(line, "BREAK"):
                if self.loop_depth > 0:
                    raise BreakSignal()
                self._error("BREAK used outside of a loop.")
                i += 1
                continue
            if self._is_command(line, "END"):
                self._error("Unexpected END.")
                i += 1
                continue
            if self._is_command(line, "ELSE"):
                self._error("Unexpected ELSE.")
                i += 1
                continue

            if self._starts_command(line, "SET"):
                self.handle_set(line)
            elif self._starts_command(line, "PRINT"):
                self.handle_print(line)
            elif self._starts_command(line, "ADD"):
                self.handle_add(line)
            elif self._starts_command(line, "REMOVE"):
                self.handle_remove(line)
            elif self._starts_command(line, "ASK"):
                self.handle_ask(line)
            elif self._starts_command(line, "IF"):
                sub_block, jump_to = self.collect_block(block, i)
                self.handle_if_else(sub_block)
                i = jump_to - 1
            elif self._starts_command(line, "REPEAT_UNTIL"):
                sub_block, jump_to = self.collect_block(block, i)
                self.handle_repeat_until(sub_block)
                i = jump_to - 1
            elif self._starts_command(line, "REPEAT_FOR_EACH"):
                sub_block, jump_to = self.collect_block(block, i)
                self.handle_repeat_for_each(sub_block)
                i = jump_to - 1
            elif self._starts_command(line, "REPEAT"):
                sub_block, jump_to = self.collect_block(block, i)
                self.handle_repeat_n_times(sub_block)
                i = jump_to - 1
            else:
                self._error(f"Unknown command: {line}")
            i += 1

    def collect_block(self, lines, start):
        block = [lines[start]]
        i = start + 1
        nested = 1

        while i < len(lines):
            line = lines[i]
            if self._is_block_start(line):
                nested += 1
            elif self._is_command(line, "END"):
                nested -= 1
                block.append(line)
                if nested == 0:
                    return block, i + 1
                i += 1
                continue

            block.append(line)
            i += 1

        self._error(f"Missing END for block starting with: {lines[start]}")
        return block, len(lines)

    def handle_set(self, line):
        match_indexed = self.SET_INDEXED_RE.fullmatch(line)
        match_simple = self.SET_SIMPLE_RE.fullmatch(line)

        if match_indexed:
            var, index_expr, value_expr = match_indexed.groups()
            try:
                index = self._eval_expr(index_expr)
                value = self._eval_expr(value_expr)
                self._validate_index(index, f"{var} index")
            except EvaluationError as e:
                self._eval_error(e, line)
                return

            if not isinstance(self.memory.get(var), list):
                self._error(f"{var} is not a list.")
                return

            try:
                self.memory[var][index] = value
            except IndexError:
                self._error(f"Index {index} is out of range for {var}.")
            return

        if match_simple:
            var, expr = match_simple.groups()
            try:
                self.memory[var] = self._eval_expr(expr)
            except EvaluationError as e:
                self._eval_error(e, line)
            return

        self._error(f"Invalid SET syntax: {line}")

    def handle_print(self, line):
        expr = line[5:].strip()
        if not expr:
            self._error(f"Invalid PRINT syntax: {line}")
            return
        try:
            self._append_output(self._format_value(self._eval_expr(expr)))
        except EvaluationError as e:
            self._eval_error(e, line)

    def handle_add(self, line):
        match = self.ADD_RE.fullmatch(line)
        if not match:
            self._error(f"Invalid ADD syntax: {line}")
            return

        value_expr, list_name = match.groups()
        try:
            value = self._eval_expr(value_expr)
        except EvaluationError as e:
            self._eval_error(e, line)
            return

        if list_name not in self.memory:
            self.memory[list_name] = []
        if not isinstance(self.memory[list_name], list):
            self._error(f"{list_name} is not a list.")
            return
        if len(self.memory[list_name]) >= self.limits.max_collection_items:
            self._error(f"{list_name} cannot exceed {self.limits.max_collection_items} items.")
            self._hit_limit("max_collection_items")
            return
        self.memory[list_name].append(value)

    def handle_remove(self, line):
        match = self.REMOVE_RE.fullmatch(line)
        if not match:
            self._error(f"Invalid REMOVE syntax: {line}")
            return

        value_expr, list_name = match.groups()
        try:
            value = self._eval_expr(value_expr)
        except EvaluationError as e:
            self._eval_error(e, line)
            return

        if not isinstance(self.memory.get(list_name), list):
            self._error(f"{list_name} is not a list or not defined.")
            return
        try:
            self.memory[list_name].remove(value)
        except ValueError:
            self._error(f"Value {value!r} not found in {list_name}.")

    def handle_ask(self, line):
        match = self.ASK_RE.fullmatch(line)
        if not match:
            self._error(f"Invalid ASK syntax: {line}")
            return

        prompt, var = match.groups()
        if var in self.memory:
            return
        if self.answer_index < len(self.answers):
            try:
                self.memory[var] = self._coerce_answer(self.answers[self.answer_index])
            except EvaluationError as e:
                self._eval_error(e, line)
                return
            self.answer_index += 1
            return

        self.pending_question = {"prompt": prompt, "variable": var}
        raise AskException(prompt, var)

    def handle_if_else(self, block):
        if not self._validate_closed_block(block):
            return

        match = self.IF_RE.fullmatch(block[0])
        if not match:
            self._error(f"Invalid IF syntax: {block[0]}")
            return

        condition = match.group(1).strip()
        true_block, false_block = self._split_if_body(block[1:-1])
        try:
            should_run_true_block = self.evaluate_condition(condition)
            self.execute_block(true_block if should_run_true_block else false_block)
        except BreakSignal:
            raise
        except EvaluationError as e:
            self._eval_error(e, block[0])

    def handle_repeat_until(self, block):
        if not self._validate_closed_block(block):
            return

        condition = block[0][len("REPEAT_UNTIL") :].strip()
        if not condition:
            self._error(f"Invalid REPEAT_UNTIL syntax: {block[0]}")
            return

        iterations = 0
        while True:
            try:
                condition_met = self.evaluate_condition(condition)
            except EvaluationError as e:
                self._eval_error(e, block[0])
                break
            if condition_met:
                break

            iterations += 1
            if iterations > self.limits.max_loop_iterations:
                self._error(f"Loop exceeded max iterations ({self.limits.max_loop_iterations}).")
                self._hit_limit("max_loop_iterations")
                break
            try:
                self._execute_loop_body(block[1:-1])
            except BreakSignal:
                break

    def handle_repeat_n_times(self, block):
        if not self._validate_closed_block(block):
            return

        match = self.REPEAT_RE.fullmatch(block[0])
        if not match:
            self._error(f"Invalid REPEAT syntax: {block[0]}")
            return

        try:
            times = self._eval_expr(match.group(1))
        except EvaluationError as e:
            self._eval_error(e, block[0])
            return

        if not isinstance(times, int) or isinstance(times, bool):
            self._error(f"REPEAT count must be an integer, got {type(times).__name__}.")
            return
        if times < 0:
            self._error("REPEAT count cannot be negative.")
            return
        if times > self.limits.max_loop_iterations:
            self._error(f"REPEAT count {times} exceeds max loop iterations ({self.limits.max_loop_iterations}).")
            self._hit_limit("max_loop_iterations")
            return

        for _ in range(times):
            try:
                self._execute_loop_body(block[1:-1])
            except BreakSignal:
                break

    def handle_repeat_for_each(self, block):
        if not self._validate_closed_block(block):
            return

        match = self.REPEAT_FOR_EACH_RE.fullmatch(block[0])
        if not match:
            self._error(f"Invalid REPEAT_FOR_EACH syntax: {block[0]}")
            return

        var, iterable_expr = match.groups()
        try:
            values = self._eval_expr(iterable_expr)
        except EvaluationError as e:
            self._eval_error(e, block[0])
            return

        if not isinstance(values, Iterable) or isinstance(values, (str, bytes, dict)):
            self._error(f"REPEAT_FOR_EACH target must be a non-string list-like iterable, got {type(values).__name__}.")
            return

        values = list(values)
        if len(values) > self.limits.max_loop_iterations:
            self._error(f"REPEAT_FOR_EACH target exceeds max loop iterations ({self.limits.max_loop_iterations}).")
            self._hit_limit("max_loop_iterations")
            return

        for item in values:
            self.memory[var] = self._sanitize_value(item, "loop item")
            try:
                self._execute_loop_body(block[1:-1])
            except BreakSignal:
                break

    def safe_eval(self, expr):
        try:
            return self._eval_expr(expr)
        except EvaluationError as e:
            self._eval_error(e, f"({expr})")
            return None

    def evaluate_condition(self, text: str) -> bool:
        text = self._strip_outer_parens(text.strip())
        if not text:
            raise EvaluationError("Empty condition.")

        or_parts = self._split_logical(text, "OR")
        if len(or_parts) > 1:
            return any(self.evaluate_condition(part) for part in or_parts)

        and_parts = self._split_logical(text, "AND")
        if len(and_parts) > 1:
            return all(self.evaluate_condition(part) for part in and_parts)

        not_prefix = re.match(r"NOT\s+(.+)$", text, re.IGNORECASE)
        if not_prefix:
            return not self.evaluate_condition(not_prefix.group(1))

        unary_conditions = {
            "is even": lambda value: value % 2 == 0,
            "is odd": lambda value: value % 2 == 1,
        }
        for phrase, predicate in unary_conditions.items():
            parts = self._split_phrase(text, phrase)
            if parts:
                left, right = parts
                if right:
                    raise EvaluationError(f"Unexpected text after '{phrase}': {right}")
                try:
                    return bool(predicate(self._eval_expr(left)))
                except EvaluationError:
                    raise
                except Exception as e:
                    raise EvaluationError(f"Condition evaluation failed: {e}") from e

        binary_conditions = [
            ("is greater than or equal to", operator.ge),
            ("is less than or equal to", operator.le),
            ("is not equal to", operator.ne),
            ("is equal to", operator.eq),
            ("is greater than", operator.gt),
            ("is less than", operator.lt),
            ("is not in", lambda a, b: a not in b),
            ("is in", lambda a, b: a in b),
            ("reaches end of", lambda a, b: a >= len(b)),
        ]
        for phrase, predicate in binary_conditions:
            parts = self._split_phrase(text, phrase)
            if parts:
                left, right = parts
                try:
                    return bool(predicate(self._eval_expr(left), self._eval_expr(right)))
                except EvaluationError:
                    raise
                except Exception as e:
                    raise EvaluationError(f"Condition evaluation failed: {e}") from e

        try:
            return bool(self._eval_expr(text))
        except EvaluationError as e:
            raise EvaluationError(f"Unrecognized condition: {text}. {e}") from e

    def _eval_expr(self, expr):
        expr = str(expr).strip()
        if not expr:
            raise EvaluationError("Empty expression.")
        if len(expr) > self.limits.max_expr_chars:
            self._raise_limit(
                "max_expr_chars",
                f"Expression is too long: {len(expr)} characters exceeds {self.limits.max_expr_chars}.",
            )

        tree = self._expr_cache.get(expr)
        if tree is None:
            try:
                tree = ast.parse(expr, mode="eval")
            except SyntaxError as e:
                raise EvaluationError(f"Invalid expression syntax: {e.msg}") from e
            self._validate_ast(tree.body)
            self._expr_cache[expr] = tree

        return self._sanitize_value(self._eval_ast(tree.body), "expression result")

    def _eval_ast(self, node):
        if isinstance(node, ast.Constant):
            return self._sanitize_value(node.value, "literal")
        if isinstance(node, ast.Name):
            if node.id in self.memory:
                return self.memory[node.id]
            raise EvaluationError(f"Unknown variable: {node.id}")
        if isinstance(node, ast.List):
            if len(node.elts) > self.limits.max_collection_items:
                self._raise_limit("max_collection_items", "List literal exceeds max collection size.")
            return [self._eval_ast(item) for item in node.elts]
        if isinstance(node, ast.Tuple):
            if len(node.elts) > self.limits.max_collection_items:
                self._raise_limit("max_collection_items", "Tuple literal exceeds max collection size.")
            return [self._eval_ast(item) for item in node.elts]
        if isinstance(node, ast.Dict):
            if len(node.keys) > self.limits.max_collection_items:
                self._raise_limit("max_collection_items", "Dict literal exceeds max collection size.")
            result = {}
            for key_node, value_node in zip(node.keys, node.values):
                key = self._eval_ast(key_node)
                if not isinstance(key, str):
                    raise EvaluationError("Dict keys must be strings.")
                result[key] = self._eval_ast(value_node)
            return result
        if isinstance(node, ast.BinOp):
            return self._apply_binary_op(type(node.op), self._eval_ast(node.left), self._eval_ast(node.right))
        if isinstance(node, ast.UnaryOp):
            op_type = type(node.op)
            if op_type not in self.UNARY_OPS:
                raise EvaluationError(f"Unary operator {op_type.__name__} is not allowed.")
            try:
                return self.UNARY_OPS[op_type](self._eval_ast(node.operand))
            except Exception as e:
                raise EvaluationError(f"Unary operation failed: {e}") from e
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                for value in node.values:
                    if not self._eval_ast(value):
                        return False
                return True
            if isinstance(node.op, ast.Or):
                for value in node.values:
                    if self._eval_ast(value):
                        return True
                return False
            raise EvaluationError(f"Boolean operator {type(node.op).__name__} is not allowed.")
        if isinstance(node, ast.Compare):
            left = self._eval_ast(node.left)
            for op_node, comparator_node in zip(node.ops, node.comparators):
                op_type = type(op_node)
                if op_type not in self.COMPARE_OPS:
                    raise EvaluationError(f"Comparison {op_type.__name__} is not allowed.")
                right = self._eval_ast(comparator_node)
                try:
                    comparison_ok = self.COMPARE_OPS[op_type](left, right)
                except Exception as e:
                    raise EvaluationError(f"Comparison failed: {e}") from e
                if not comparison_ok:
                    return False
                left = right
            return True
        if isinstance(node, ast.Subscript):
            value = self._eval_ast(node.value)
            index = self._eval_slice(node.slice)
            try:
                result = value[index]
            except Exception as e:
                raise EvaluationError(f"Invalid subscript access: {e}") from e
            return self._sanitize_value(result, "subscript result")
        if isinstance(node, ast.Call):
            return self._eval_call(node)

        raise EvaluationError(f"Expression element {type(node).__name__} is not allowed.")

    def _eval_call(self, node):
        if not isinstance(node.func, ast.Name):
            raise EvaluationError("Attribute calls are not allowed.")
        if node.keywords:
            raise EvaluationError("Keyword arguments are not supported.")

        function_name = node.func.id
        args = [self._eval_ast(arg) for arg in node.args]
        safe_functions = {
            "abs": self._safe_abs,
            "bool": self._safe_bool,
            "float": self._safe_float,
            "int": self._safe_int,
            "len": self._safe_len,
            "list": self._safe_list,
            "max": self._safe_max,
            "min": self._safe_min,
            "range": self._safe_range,
            "round": self._safe_round,
            "sorted": self._safe_sorted,
            "str": self._safe_str,
            "sum": self._safe_sum,
        }
        if function_name not in safe_functions:
            raise EvaluationError(f"Function {function_name!r} is not allowed.")

        try:
            return self._sanitize_value(safe_functions[function_name](*args), f"{function_name} result")
        except EvaluationError:
            raise
        except Exception as e:
            raise EvaluationError(f"Function {function_name!r} failed: {e}") from e

    def _eval_slice(self, node):
        if isinstance(node, ast.Slice):
            lower = self._eval_ast(node.lower) if node.lower else None
            upper = self._eval_ast(node.upper) if node.upper else None
            step = self._eval_ast(node.step) if node.step else None
            for name, value in (("lower", lower), ("upper", upper), ("step", step)):
                if value is not None:
                    self._validate_index(value, f"slice {name}")
            if step == 0:
                raise EvaluationError("Slice step cannot be zero.")
            return slice(lower, upper, step)
        index = self._eval_ast(node)
        self._validate_index(index, "subscript index")
        return index

    def _apply_binary_op(self, op_type, left, right):
        if op_type not in self.BIN_OPS:
            raise EvaluationError(f"Operator {op_type.__name__} is not allowed.")
        if op_type is ast.Mult and self._is_repeat_operand(left, right):
            return self._safe_repeat(left, right)
        if op_type is ast.Pow:
            return self._safe_power(left, right)

        try:
            result = self.BIN_OPS[op_type](left, right)
        except Exception as e:
            raise EvaluationError(f"Binary operation failed: {e}") from e
        return self._sanitize_value(result, "binary operation result")

    def _safe_power(self, left, right):
        if (
            not isinstance(left, (int, float))
            or isinstance(left, bool)
            or not isinstance(right, (int, float))
            or isinstance(right, bool)
        ):
            raise EvaluationError("Power operation requires numeric operands.")
        if not math.isfinite(float(left)) or not math.isfinite(float(right)):
            raise EvaluationError("Power operation requires finite operands.")
        if abs(right) > 64:
            self._raise_limit("max_number_abs", "Power exponent is too large.")
        try:
            result = operator.pow(left, right)
        except Exception as e:
            raise EvaluationError(f"Power operation failed: {e}") from e
        return self._sanitize_value(result, "power operation result")

    def _safe_repeat(self, left, right):
        if isinstance(left, (list, str)) and isinstance(right, int) and not isinstance(right, bool):
            value, count = left, right
        elif isinstance(right, (list, str)) and isinstance(left, int) and not isinstance(left, bool):
            value, count = right, left
        else:
            raise EvaluationError("Repeat operation requires a list/string and an integer.")

        if count < 0:
            raise EvaluationError("Repeat count cannot be negative.")
        result_size = len(value) * count
        if isinstance(value, str):
            if result_size > self.limits.max_string_chars:
                self._raise_limit("max_string_chars", "String repeat exceeds max string size.")
        elif result_size > self.limits.max_collection_items:
            self._raise_limit("max_collection_items", "List repeat exceeds max collection size.")
        try:
            return value * count
        except Exception as e:
            raise EvaluationError(f"Repeat operation failed: {e}") from e

    def _is_repeat_operand(self, left, right):
        return (
            isinstance(left, (list, str))
            and isinstance(right, int)
            and not isinstance(right, bool)
        ) or (
            isinstance(right, (list, str))
            and isinstance(left, int)
            and not isinstance(left, bool)
        )

    def _safe_abs(self, value):
        return abs(value)

    def _safe_bool(self, value=False):
        return bool(value)

    def _safe_float(self, value=0):
        return float(value)

    def _safe_int(self, value=0):
        if isinstance(value, str) and len(value.strip()) > len(str(self.limits.max_number_abs)) + 1:
            self._raise_limit("max_number_abs", "Integer string is too large.")
        return int(value)

    def _safe_len(self, value):
        if not isinstance(value, Sized):
            raise EvaluationError(f"Object of type {type(value).__name__} has no length.")
        return len(value)

    def _safe_list(self, value=None):
        if value is None:
            return []
        if isinstance(value, dict):
            result = list(value.keys())
        elif isinstance(value, (list, tuple, str)):
            result = list(value)
        else:
            raise EvaluationError(f"Cannot convert {type(value).__name__} to list.")
        if len(result) > self.limits.max_collection_items:
            self._raise_limit("max_collection_items", "list() result exceeds max collection size.")
        return result

    def _safe_max(self, *args):
        return self._safe_min_max(max, "max", *args)

    def _safe_min(self, *args):
        return self._safe_min_max(min, "min", *args)

    def _safe_min_max(self, fn, name, *args):
        if not args:
            raise EvaluationError(f"{name}() requires at least one argument.")
        if len(args) == 1 and isinstance(args[0], list):
            if len(args[0]) > self.limits.max_collection_items:
                self._raise_limit("max_collection_items", f"{name}() input exceeds max collection size.")
            return fn(args[0])
        if len(args) > self.limits.max_collection_items:
            self._raise_limit("max_collection_items", f"{name}() argument count exceeds max collection size.")
        return fn(*args)

    def _safe_range(self, *args):
        if not 1 <= len(args) <= 3:
            raise EvaluationError("range() expects 1 to 3 arguments.")
        if any(not isinstance(arg, int) or isinstance(arg, bool) for arg in args):
            raise EvaluationError("range() arguments must be integers.")
        try:
            range_value = range(*args)
            length = len(range_value)
        except Exception as e:
            raise EvaluationError(f"range() failed: {e}") from e
        if length > self.limits.max_collection_items:
            self._raise_limit("max_collection_items", "range() result exceeds max collection size.")
        return list(range_value)

    def _safe_round(self, *args):
        if not 1 <= len(args) <= 2:
            raise EvaluationError("round() expects 1 or 2 arguments.")
        if len(args) == 2 and (not isinstance(args[1], int) or isinstance(args[1], bool)):
            raise EvaluationError("round() precision must be an integer.")
        return round(*args)

    def _safe_sorted(self, value):
        values = self._safe_list(value)
        try:
            return sorted(values)
        except Exception as e:
            raise EvaluationError(f"sorted() failed: {e}") from e

    def _safe_str(self, value=""):
        try:
            result = str(value)
        except Exception as e:
            raise EvaluationError(f"str() failed: {e}") from e
        if len(result) > self.limits.max_string_chars:
            self._raise_limit("max_string_chars", "str() result exceeds max string size.")
        return result

    def _safe_sum(self, value):
        values = self._safe_list(value)
        try:
            return sum(values)
        except Exception as e:
            raise EvaluationError(f"sum() failed: {e}") from e

    def _validate_ast(self, root):
        count = 0

        def walk(node, depth):
            nonlocal count
            if depth > self.limits.max_expr_depth:
                self._raise_limit("max_expr_depth", "Expression nesting is too deep.")
            count += 1
            if count > self.limits.max_expr_nodes:
                self._raise_limit("max_expr_nodes", "Expression has too many syntax nodes.")
            if not isinstance(node, self.ALLOWED_AST_TYPES):
                raise EvaluationError(f"Expression element {type(node).__name__} is not allowed.")
            for child in ast.iter_child_nodes(node):
                walk(child, depth + 1)

        walk(root, 1)

    def _sanitize_preset_answers(self, preset_answers):
        if preset_answers is None:
            return {}
        if type(preset_answers) is not dict:
            raise SourceError("preset_answers must be a plain dict.")

        sanitized = {}
        for key, value in preset_answers.items():
            if not isinstance(key, str) or not self.VAR_RE.fullmatch(key):
                raise SourceError(f"Invalid preset answer variable name: {key!r}.")
            sanitized[key] = self._sanitize_value(value, f"preset answer {key}")
        return sanitized

    def _sanitize_answers(self, answers):
        if answers is None:
            return []
        if type(answers) not in (list, tuple):
            raise SourceError("answers must be a plain list or tuple.")
        if len(answers) > self.limits.max_collection_items:
            self._raise_limit("max_collection_items", "answers exceeds max collection size.")
        return [self._sanitize_value(answer, "answer") for answer in answers]

    def _sanitize_value(self, value, context, depth=0, seen=None):
        if seen is None:
            seen = set()
        if depth > self.limits.max_expr_depth:
            self._raise_limit("max_expr_depth", f"{context} is nested too deeply.")
        if value is None or type(value) is bool:
            return value
        if type(value) is int:
            if abs(value) > self.limits.max_number_abs:
                self._raise_limit("max_number_abs", f"{context} numeric value exceeds {self.limits.max_number_abs}.")
            return value
        if type(value) is float:
            if not math.isfinite(value) or abs(value) > self.limits.max_number_abs:
                self._raise_limit("max_number_abs", f"{context} float is not finite or exceeds {self.limits.max_number_abs}.")
            return value
        if type(value) is str:
            if len(value) > self.limits.max_string_chars:
                self._raise_limit("max_string_chars", f"{context} string exceeds {self.limits.max_string_chars} characters.")
            return value
        if type(value) is list:
            value_id = id(value)
            if value_id in seen:
                raise EvaluationError(f"{context} contains a cycle.")
            if len(value) > self.limits.max_collection_items:
                self._raise_limit("max_collection_items", f"{context} list exceeds {self.limits.max_collection_items} items.")
            seen.add(value_id)
            result = [self._sanitize_value(item, context, depth + 1, seen) for item in value]
            seen.remove(value_id)
            return result
        if type(value) is dict:
            value_id = id(value)
            if value_id in seen:
                raise EvaluationError(f"{context} contains a cycle.")
            if len(value) > self.limits.max_collection_items:
                self._raise_limit("max_collection_items", f"{context} dict exceeds {self.limits.max_collection_items} items.")
            seen.add(value_id)
            result = {}
            for key, item in value.items():
                if type(key) is not str:
                    raise EvaluationError(f"{context} dict keys must be strings.")
                if len(key) > self.limits.max_string_chars:
                    self._raise_limit("max_string_chars", f"{context} dict key exceeds {self.limits.max_string_chars} characters.")
                result[key] = self._sanitize_value(item, context, depth + 1, seen)
            seen.remove(value_id)
            return result
        raise EvaluationError(f"Unsupported value type in {context}: {type(value).__name__}.")

    def _coerce_answer(self, raw):
        if isinstance(raw, str):
            stripped = raw.strip()
            if re.fullmatch(r"[-+]?\d+", stripped):
                if len(stripped.lstrip("+-")) > len(str(self.limits.max_number_abs)):
                    self._raise_limit("max_number_abs", "Answer integer is too large.")
                return self._sanitize_value(int(stripped), "answer")
            try:
                return self._sanitize_value(float(stripped), "answer")
            except ValueError:
                return self._sanitize_value(raw, "answer")
        return self._sanitize_value(raw, "answer")

    def _execute_loop_body(self, body):
        self._tick()
        self.loop_depth += 1
        try:
            self.execute_block(body)
        finally:
            self.loop_depth -= 1

    def _validate_block_depth(self, lines):
        depth = 0
        for line in lines:
            if self._is_block_start(line):
                depth += 1
                if depth > self.limits.max_block_depth:
                    self._raise_limit(
                        "max_block_depth",
                        f"Block nesting exceeds max depth ({self.limits.max_block_depth}).",
                    )
            elif self._is_command(line, "END") and depth > 0:
                depth -= 1

    def _split_if_body(self, body):
        true_block = []
        false_block = []
        current_block = true_block
        nested = 0
        saw_else = False

        for line in body:
            if self._is_command(line, "ELSE") and nested == 0:
                if saw_else:
                    self._error("IF block has more than one ELSE.")
                saw_else = True
                current_block = false_block
                continue
            if self._is_block_start(line):
                nested += 1
            elif self._is_command(line, "END") and nested > 0:
                nested -= 1
            current_block.append(line)

        return true_block, false_block

    def _split_logical(self, text, operator_name):
        return self._split_word_at_top_level(text, operator_name, logical=True)

    def _split_phrase(self, text, phrase):
        parts = self._split_word_at_top_level(text, phrase)
        if len(parts) == 2:
            return parts[0].strip(), parts[1].strip()
        return None

    def _split_word_at_top_level(self, text, word, logical=False):
        word_lower = word.lower()
        result = []
        start = 0
        depth = 0
        quote = None
        i = 0

        while i < len(text):
            char = text[i]
            if quote:
                if char == quote and (i == 0 or text[i - 1] != "\\"):
                    quote = None
                i += 1
                continue
            if char in {"'", '"'}:
                quote = char
                i += 1
                continue
            if char in "([{":
                depth += 1
                i += 1
                continue
            if char in ")]}":
                depth = max(0, depth - 1)
                i += 1
                continue
            if depth == 0 and text[i : i + len(word)].lower() == word_lower:
                before = text[i - 1] if i > 0 else " "
                after_index = i + len(word)
                after = text[after_index] if after_index < len(text) else " "
                if not (before.isalnum() or before == "_") and not (after.isalnum() or after == "_"):
                    if logical and self._is_embedded_condition_word(text, i, word_lower):
                        i += 1
                        continue
                    result.append(text[start:i].strip())
                    start = after_index
                    i = after_index
                    continue
            i += 1

        if result:
            result.append(text[start:].strip())
            return result
        return [text]

    def _is_embedded_condition_word(self, text, index, word_lower):
        if word_lower != "or":
            return False
        before = text[:index].lower().rstrip()
        after = text[index + len(word_lower) :].lower().lstrip()
        return before.endswith("than") and after.startswith("equal to")

    def _strip_outer_parens(self, text):
        while text.startswith("(") and text.endswith(")") and self._outer_parens_wrap_all(text):
            text = text[1:-1].strip()
        return text

    def _outer_parens_wrap_all(self, text):
        depth = 0
        quote = None
        for i, char in enumerate(text):
            if quote:
                if char == quote and text[i - 1] != "\\":
                    quote = None
                continue
            if char in {"'", '"'}:
                quote = char
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and i != len(text) - 1:
                    return False
        return depth == 0

    def _strip_comment(self, raw_line):
        quote = None
        for i, char in enumerate(raw_line):
            if quote:
                if char == quote and (i == 0 or raw_line[i - 1] != "\\"):
                    quote = None
                continue
            if char in {"'", '"'}:
                quote = char
                continue
            if char == "#":
                return raw_line[:i]
        return raw_line

    def _is_block_start(self, line):
        return any(self._starts_command(line, starter.strip()) for starter in self.BLOCK_STARTERS)

    def _starts_command(self, line, command):
        return line.upper().startswith(command.upper() + " ") or line.upper() == command.upper()

    def _is_command(self, line, command):
        return line.upper() == command.upper()

    def _validate_closed_block(self, block):
        return bool(block) and self._is_command(block[-1], "END")

    def _validate_index(self, value, context):
        if not isinstance(value, int) or isinstance(value, bool):
            raise EvaluationError(f"{context} must be an integer, got {type(value).__name__}.")

    def _tick(self):
        self.step_count += 1
        if self.step_count > self.limits.max_steps:
            self._hit_limit("max_steps")
            raise ExecutionLimitExceeded("Execution stopped: too many steps (possible infinite loop).")

    def _error(self, message):
        message = self._bounded_plain_text(str(message), self.limits.max_output_chars_per_item)
        if len(self.error_log) < self.limits.max_errors:
            self.error_log.append(message)
        else:
            self._hit_limit("max_errors")
            self.truncated = True
            if not self._error_truncation_reported and self.limits.max_errors > 0:
                self.error_log[-1] = "Further errors truncated."
                self._error_truncation_reported = True
        self._append_output(f"[ERROR] {message}")

    def _eval_error(self, error, context):
        self._error(f"Eval failed: {error} — in {context}")

    def _append_output(self, text):
        text = self._bounded_plain_text(str(text), self.limits.max_output_chars_per_item)
        if len(self.output_log) >= self.limits.max_output_items:
            self._mark_output_truncated("max_output_items")
            return

        remaining = self.limits.max_total_output_chars - self._total_output_chars
        if remaining <= 0:
            self._mark_output_truncated("max_total_output_chars")
            return
        if len(text) > remaining:
            self._hit_limit("max_total_output_chars")
            self.truncated = True
            suffix = "... [truncated]"
            keep = max(0, remaining - len(suffix))
            text = text[:keep] + suffix

        self.output_log.append(text)
        self._total_output_chars += len(text)

    def _bounded_plain_text(self, text, limit):
        if len(text) <= limit:
            return text
        self._hit_limit("max_output_chars_per_item")
        self.truncated = True
        if limit <= 15:
            return text[:limit]
        return text[: limit - 15] + "... [truncated]"

    def _mark_output_truncated(self, limit_name):
        self._hit_limit(limit_name)
        self.truncated = True
        if self._output_truncation_reported:
            return
        self._output_truncation_reported = True
        marker = "[TRUNCATED] Output limit reached."
        if self.limits.max_output_items <= 0:
            return
        if len(self.output_log) < self.limits.max_output_items:
            self.output_log.append(marker)
            self._total_output_chars += len(marker)
        elif self.output_log:
            self.output_log[-1] = marker

    def _hit_limit(self, name):
        if name not in self._limits_hit_set:
            self._limits_hit_set.add(name)
            self.limits_hit.append(name)

    def _raise_limit(self, name, message):
        self._hit_limit(name)
        raise LimitExceeded(message)

    def _format_value(self, value):
        try:
            return str(value)
        except Exception as e:
            raise EvaluationError(f"Failed to format value: {e}") from e

    def _snapshot_memory(self):
        snapshot = {}
        for key, value in list(self.memory.items()):
            if not isinstance(key, str):
                continue
            try:
                snapshot[key] = self._sanitize_value(value, f"memory value {key}")
            except EvaluationError:
                snapshot[key] = "[Unavailable]"
        return snapshot

    def _result(self):
        if self.pending_question:
            status = "waiting_for_input"
        elif self.limits_hit:
            status = "limit_exceeded"
        elif self.error_log:
            status = "error"
        else:
            status = "ok"

        return {
            "output": list(self.output_log) if self.output_log else ["[No output returned]"],
            "memory": self._snapshot_memory(),
            "errors": list(self.error_log),
            "ask": self.pending_question["prompt"] if self.pending_question else None,
            "ask_var": self.pending_question["variable"] if self.pending_question else None,
            "status": status,
            "truncated": self.truncated,
            "limits_hit": list(self.limits_hit),
        }

    def _reset_run_state(self):
        self.memory.clear()
        self.output_log.clear()
        self.error_log.clear()
        self.pending_ask = None
        self.pending_question = None
        self.answers = []
        self.answer_index = 0
        self.lines = []
        self.step_count = 0
        self.loop_depth = 0
        self.truncated = False
        self.limits_hit = []
        self._limits_hit_set = set()
        self._expr_cache.clear()
        self._total_output_chars = 0
        self._output_truncation_reported = False
        self._error_truncation_reported = False


def run_sandboxed(code, preset_answers=None, answers=None, limits=None, timeout_seconds=2, memory_mb=128):
    try:
        effective_limits = limits if limits is not None else JargonLimits()
        if not isinstance(effective_limits, JargonLimits):
            raise ValueError("limits must be a JargonLimits instance.")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive.")
        if memory_mb <= 0:
            raise ValueError("memory_mb must be positive.")

        sanitizer = StructuredJargonInterpreter(limits=effective_limits)
        payload = {
            "code": code,
            "preset_answers": sanitizer._sanitize_preset_answers(preset_answers),
            "answers": sanitizer._sanitize_answers(answers),
            "limits": asdict(effective_limits),
        }
        payload_json = json.dumps(payload)
    except Exception as e:
        return _sandbox_error_result(f"Sandbox input rejected: {e}", "sandbox_input")

    command = [sys.executable, os.path.abspath(__file__), "--sandbox-worker"]
    metadata = {
        "timeout_seconds": timeout_seconds,
        "memory_mb": memory_mb,
        "resource_limits": "requested" if os.name == "posix" else "unavailable",
    }

    try:
        completed = subprocess.run(
            command,
            input=payload_json,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            shell=False,
            preexec_fn=_make_resource_limiter(timeout_seconds, memory_mb) if os.name == "posix" else None,
        )
    except subprocess.TimeoutExpired:
        result = _sandbox_error_result(f"Sandbox timed out after {timeout_seconds} seconds.", "sandbox_timeout")
        result["sandbox"] = metadata
        return result
    except Exception as e:
        result = _sandbox_error_result(f"Sandbox failed to start: {type(e).__name__}: {e}", "sandbox_start")
        result["sandbox"] = metadata
        return result

    if completed.returncode != 0:
        stderr = _bounded_sandbox_text(completed.stderr)
        result = _sandbox_error_result(
            f"Sandbox worker exited with code {completed.returncode}: {stderr}",
            "sandbox_worker_exit",
        )
        result["sandbox"] = metadata
        return result

    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError:
        result = _sandbox_error_result("Sandbox worker returned invalid JSON.", "sandbox_invalid_json")
        result["sandbox"] = metadata
        return result

    if not isinstance(result, dict):
        result = _sandbox_error_result("Sandbox worker returned a non-object result.", "sandbox_invalid_json")
        result["sandbox"] = metadata
        return result

    result["sandbox"] = metadata
    return result


def _make_resource_limiter(timeout_seconds, memory_mb):
    def limit_resources():
        try:
            import resource

            memory_bytes = int(memory_mb) * 1024 * 1024
            if hasattr(resource, "RLIMIT_AS"):
                resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            cpu_seconds = max(1, int(math.ceil(timeout_seconds)))
            if hasattr(resource, "RLIMIT_CPU"):
                resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        except Exception:
            pass

    return limit_resources


def _sandbox_worker_main():
    try:
        payload = json.loads(sys.stdin.read())
        limit_values = payload.get("limits") or {}
        allowed_limit_names = {field.name for field in fields(JargonLimits)}
        filtered_limits = {key: value for key, value in limit_values.items() if key in allowed_limit_names}
        limits = JargonLimits(**filtered_limits)
        result = StructuredJargonInterpreter(limits=limits).run(
            payload.get("code"),
            preset_answers=payload.get("preset_answers"),
            answers=payload.get("answers"),
        )
    except BaseException as e:
        result = _sandbox_error_result(f"Sandbox worker crashed: {type(e).__name__}: {e}", "sandbox_worker_crash")
    sys.stdout.write(json.dumps(result))


def _sandbox_error_result(message, limit_name):
    bounded = _bounded_sandbox_text(message)
    return {
        "output": [f"[ERROR] {bounded}"],
        "memory": {},
        "errors": [bounded],
        "ask": None,
        "ask_var": None,
        "status": "sandbox_error",
        "truncated": False,
        "limits_hit": [limit_name],
        "sandbox": {},
    }


def _bounded_sandbox_text(text, limit=2000):
    text = str(text)
    if len(text) <= limit:
        return text
    return text[: limit - 15] + "... [truncated]"


if __name__ == "__main__" and "--sandbox-worker" in sys.argv:
    _sandbox_worker_main()
