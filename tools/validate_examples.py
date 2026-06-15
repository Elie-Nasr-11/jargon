#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jargon_examples import iter_example_files, load_example, run_example
from jargon_interpreter import JargonLimits

ASK_RE = re.compile(r'ASK\s+"(.+?)"\s+as\s+([A-Za-z_]\w*)', re.IGNORECASE)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Jargon example text files through the interpreter.")
    parser.add_argument("paths", nargs="+", help="Example file or directory paths.")
    parser.add_argument("--answer", action="append", default=[], help="Extra fallback ASK answer. May be repeated.")
    parser.add_argument("--no-smart-answers", action="store_true", help="Disable prompt-based canned ASK answers.")
    parser.add_argument("--max-steps", type=int, default=10000)
    parser.add_argument("--max-loop-iterations", type=int, default=5000)
    parser.add_argument("--show-ok", action="store_true", help="Print successful files too.")
    args = parser.parse_args()

    limits = JargonLimits(max_steps=args.max_steps, max_loop_iterations=args.max_loop_iterations)
    files = []
    for raw_path in args.paths:
        files.extend(iter_example_files(Path(raw_path)))

    counts: Counter[str] = Counter()
    failures = []

    for path in sorted(files):
        example = load_example(path)
        answers = [] if args.no_smart_answers else infer_answers(example.code)
        answers.extend(args.answer)
        result = run_example(example, answers=answers, limits=limits)
        counts[result["status"]] += 1
        if result["status"] == "ok":
            if args.show_ok:
                print(f"OK {path}")
            continue
        failures.append((path, result))
        first_error = result["errors"][0] if result["errors"] else "no error detail"
        print(f"{result['status'].upper()} {path}: {first_error}")

    print()
    print(f"Checked {len(files)} file(s).")
    for status, count in sorted(counts.items()):
        print(f"{status}: {count}")

    return 1 if failures else 0


def infer_answers(code: str) -> list[str]:
    return [_infer_answer(prompt, variable) for prompt, variable in ASK_RE.findall(code)]


def _infer_answer(prompt: str, variable: str) -> str:
    text = f"{prompt} {variable}".lower()
    if "password" in text:
        return "open"
    if "username" in text:
        return "bob"
    if "favorite color" in text or variable.lower() == "color":
        return "blue"
    if "first number" in text:
        return "5"
    if "second number" in text:
        return "3"
    if "age" in text:
        return "18"
    if "grade" in text:
        return "75"
    if "countdown" in text or variable.lower() == "count":
        return "3"
    if "guess" in text:
        return "7"
    if "number" in text or variable.lower() in {"input", "num"}:
        return "6"
    if "word" in text or variable.lower() == "text":
        return "hello"
    if "name:" in text or "your name" in text:
        return "Bob"
    if "name" in text:
        return "Fatima"
    return "yes"


if __name__ == "__main__":
    raise SystemExit(main())
