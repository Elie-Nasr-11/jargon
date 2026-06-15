from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent
from typing import Iterable, Optional, Sequence

from jargon_interpreter import JargonLimits, StructuredJargonInterpreter


CODE_MARKERS = ("Jargon Code:", "Code:")
STOP_MARKERS = (
    "Expected Output:",
    "Output:",
    "Explanation:",
    "Expected Output",
    "Explanation",
)
TITLE_PREFIXES = (
    "Algorithm ",
    "JARGON ALGORITHM ",
    "Name:",
    "Title:",
    "Example ",
)
COMMAND_PREFIXES = (
    "SET ",
    "PRINT ",
    "ADD ",
    "REMOVE ",
    "ASK ",
    "IF ",
    "ELSE",
    "END",
    "REPEAT ",
    "REPEAT_UNTIL",
    "REPEAT_FOR_EACH",
    "BREAK",
)


@dataclass(frozen=True)
class JargonExample:
    path: Path
    title: str
    code: str
    expected_output: Optional[str] = None
    explanation: Optional[str] = None


def iter_example_files(root: str | Path) -> Iterable[Path]:
    root = Path(root)
    if root.is_file():
        yield root
        return
    for path in sorted(root.rglob("*.txt")):
        if path.name.startswith("."):
            continue
        yield path


def load_example(path: str | Path) -> JargonExample:
    path = Path(path)
    text = path.read_text(encoding="utf-8", errors="replace")
    title = _extract_title(text, path)
    code = extract_code(text)
    expected_output = _extract_section(text, "Expected Output:")
    explanation = _extract_section(text, "Explanation:")
    return JargonExample(path=path, title=title, code=code, expected_output=expected_output, explanation=explanation)


def extract_code(text: str) -> str:
    lines = text.splitlines()
    start = _find_code_start(lines)
    if start is not None:
        lines = lines[start:]
    else:
        lines = _drop_leading_metadata(lines)

    code_lines: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if _is_stop_marker(line):
            break
        if _is_title_line(line):
            continue
        if not line:
            code_lines.append("")
            continue
        if line.startswith("#") or _is_command_line(line):
            code_lines.append(raw_line)

    return _trim_blank_edges("\n".join(code_lines))


def run_example(
    example: JargonExample | str | Path,
    *,
    answers: Optional[Sequence] = None,
    limits: Optional[JargonLimits] = None,
):
    loaded = load_example(example) if not isinstance(example, JargonExample) else example
    return StructuredJargonInterpreter(limits=limits).run(loaded.code, answers=answers)


def _find_code_start(lines: list[str]) -> Optional[int]:
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if any(line.lower() == marker.lower() for marker in CODE_MARKERS):
            return index + 1
    return None


def _drop_leading_metadata(lines: list[str]) -> list[str]:
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line or line.startswith("#") or _is_title_line(line):
            continue
        if _is_command_line(line):
            return lines[index:]
    return lines


def _extract_title(text: str, path: Path) -> str:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if _is_stop_marker(line) or any(line.lower() == marker.lower() for marker in CODE_MARKERS):
            break
        if _is_command_line(line):
            break
        return line
    return path.stem.replace("_", " ")


def _extract_section(text: str, marker: str) -> Optional[str]:
    lines = text.splitlines()
    marker_lower = marker.lower()
    for index, raw_line in enumerate(lines):
        if raw_line.strip().lower() == marker_lower:
            section_lines: list[str] = []
            for section_line in lines[index + 1 :]:
                stripped = section_line.strip()
                if _is_stop_marker(stripped) and stripped.lower() != marker_lower:
                    break
                section_lines.append(section_line)
            value = _trim_blank_edges("\n".join(section_lines))
            return value or None
    return None


def _is_command_line(line: str) -> bool:
    upper = line.upper()
    return any(upper == prefix.rstrip() or upper.startswith(prefix) for prefix in COMMAND_PREFIXES)


def _is_title_line(line: str) -> bool:
    return any(line.startswith(prefix) for prefix in TITLE_PREFIXES)


def _is_stop_marker(line: str) -> bool:
    if not line:
        return False
    normalized = line.lstrip("#").strip()
    return any(normalized.lower() == marker.lower() for marker in STOP_MARKERS)


def _trim_blank_edges(text: str) -> str:
    lines = dedent(text).splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)
