#!/usr/bin/env python3
"""Validate jargon-book-manifest/v1 chunk files and emit an idempotent seed migration.

Usage:
    python3 tools/import_book_manifest.py docs/curriculum/bookf/itf-f-ch*.json
    python3 tools/import_book_manifest.py --emit-sql supabase/migrations/X_seed.sql <chunks...>

Validation is fail-closed: any error exits 1 and (with --emit-sql) nothing is written.
Every practice/code step is executed through the real interpreter and its output diffed
against expected_output, so a broken program can never reach the database.

The emitted SQL mirrors the repo's seed-migration pattern (0005_curriculum_hierarchy.sql):
insert-on-conflict-update on text-slug primary keys, global catalog scope
(organization_id NULL, everything published). Migrations re-apply on every backend
deploy, so the output is strictly idempotent: fixed ids, fixed positions (global lesson
positions pinned at GLOBAL_POSITION_BASE + n, above the seeded jargon-foundations spine).

activity_type/response_mode are PINNED from mode exactly as curriculum-admin's upsert_step
does (supabase/functions/curriculum-admin/index.ts) so seeded rows match studio-authored
rows byte for byte.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from jargon_interpreter import run_sandboxed  # noqa: E402

MODES = {"explanation", "media", "reflection", "practice", "assignment", "inquiry", "assessment", "revision"}
MODE_TYPES = {"practice": {"code", "applied"}, "assessment": {"mcq", "open_ended"}, "revision": {"recall"}}
STAGES = {"intro", "teach", "practice", "assessment", "review"}
HELP_CEILINGS = {"clarify", "hints", "guided", "worked_example", "feedback", "study"}
FINAL_ANSWER = {"never", "after_attempt", "allowed"}
RESPONSE_MODES = {"text", "code", "multiple_choice", "file"}
LESSON_TYPES = {"discussion", "code", "reflection", "multiple_choice", "file"}
SKILLS = set(
    """process.purpose systems.input systems.process systems.output signals.conversion
    signals.exchange memory.storage logic.sequence jargon.set jargon.print jargon.if
    jargon.list jargon.loop itf.computers.categories itf.signals.types
    itf.hardware.performance itf.hardware.energy itf.hardware.portability
    itf.software.instructions itf.software.types itf.logic.conditionals itf.logic.repetition
    itf.data.structures itf.data.addressing itf.data.searching itf.data.sorting
    itf.data.queue itf.data.stack""".split()
)
CHUNK_LESSONS = {
    "itf-f-ch1": ["itf-f-ch1-l1", "itf-f-ch1-l2", "itf-f-ch1-l3", "itf-f-ch1-l4", "itf-f-ch1-l5"],
    "itf-f-ch2": ["itf-f-ch2-l1", "itf-f-ch2-l2", "itf-f-ch2-l3"],
    "itf-f-ch3": ["itf-f-ch3-l1", "itf-f-ch3-l2", "itf-f-ch3-l3", "itf-f-ch3-l4"],
    "itf-f-ch4": ["itf-f-ch4-l1", "itf-f-ch4-l2", "itf-f-ch4-l3", "itf-f-ch4-l4", "itf-f-ch4-l5"],
}
# Global lesson-spine positions sit above the seeded catalog (jargon-foundations ends at 10).
GLOBAL_POSITION_BASE = 100
MODULE_LABEL = "IT Frontiers"


def pin_shapes(mode: str, mode_type: str | None) -> tuple[str, str]:
    """Replicate curriculum-admin upsert_step's mode pinning: (response_mode, activity_type)."""
    if mode == "practice" and mode_type != "applied":
        return "code", "code"
    if mode == "assessment" and mode_type != "open_ended":
        return "multiple_choice", "multiple_choice"
    if mode == "reflection":
        return "text", "reflection"
    return "text", "discussion"


def validate(chunks: dict[str, dict]) -> list[str]:
    errs: list[str] = []
    subj_course = None
    for chunk_slug, expected_lessons in CHUNK_LESSONS.items():
        m = chunks.get(chunk_slug)
        if m is None:
            errs.append(f"{chunk_slug}: chunk file missing")
            continue
        sc = json.dumps([m.get("subject"), m.get("course")], sort_keys=True)
        if subj_course is None:
            subj_course = sc
        elif sc != subj_course:
            errs.append(f"{chunk_slug}: subject/course differ from first chunk")
        units = m.get("units", [])
        if len(units) != 1:
            errs.append(f"{chunk_slug}: expected exactly 1 unit, got {len(units)}")
            continue
        unit = units[0]
        if unit.get("slug") != chunk_slug:
            errs.append(f"{chunk_slug}: unit slug {unit.get('slug')!r}")
        got = [l.get("slug") for l in unit.get("lessons", [])]
        if got != expected_lessons:
            errs.append(f"{chunk_slug}: lesson slugs {got} != slug table")
        for lesson in unit.get("lessons", []):
            ls = lesson.get("slug", "?")
            for field in ("title", "level", "lesson_type", "tutor_prompt", "policy", "milestone", "steps"):
                if field not in lesson:
                    errs.append(f"{ls}: missing {field}")
            if lesson.get("lesson_type") not in LESSON_TYPES:
                errs.append(f"{ls}: lesson_type {lesson.get('lesson_type')!r}")
            pol = lesson.get("policy", {})
            if pol.get("help_ceiling") not in HELP_CEILINGS:
                errs.append(f"{ls}: help_ceiling {pol.get('help_ceiling')!r}")
            if pol.get("final_answer_policy") not in FINAL_ANSWER:
                errs.append(f"{ls}: final_answer_policy {pol.get('final_answer_policy')!r}")
            mil = lesson.get("milestone", {})
            if not mil.get("objective"):
                errs.append(f"{ls}: milestone objective missing")
            if not set(mil.get("allowed_response_modes", ["text"])) <= RESPONSE_MODES:
                errs.append(f"{ls}: allowed_response_modes invalid")
            for key in list(mil.get("skill_keys", [])):
                if key not in SKILLS:
                    errs.append(f"{ls}: unknown milestone skill key {key!r}")
            steps = lesson.get("steps", [])
            if not (1 <= len(steps) <= 8):
                errs.append(f"{ls}: {len(steps)} steps (cap 8)")
            for i, step in enumerate(steps, 1):
                ss = step.get("slug", "?")
                if step.get("slug") != f"{ls}-s{i}":
                    errs.append(f"{ss}: slug out of order (expected {ls}-s{i})")
                mode, mt = step.get("mode"), step.get("mode_type")
                if mode not in MODES:
                    errs.append(f"{ss}: mode {mode!r}")
                    continue
                if mode in MODE_TYPES:
                    if mt not in MODE_TYPES[mode]:
                        errs.append(f"{ss}: mode_type {mt!r} invalid for {mode}")
                elif mt:
                    errs.append(f"{ss}: stray mode_type {mt!r} on {mode}")
                if step.get("stage") not in STAGES:
                    errs.append(f"{ss}: stage {step.get('stage')!r}")
                if not str(step.get("prompt", "")).strip():
                    errs.append(f"{ss}: empty prompt")
                for key in list(step.get("skill_keys", [])):
                    if key not in SKILLS:
                        errs.append(f"{ss}: unknown skill key {key!r}")
                if mode == "assessment" and mt == "mcq":
                    choices = step.get("choices", [])
                    quiz = step.get("quiz", {})
                    ids = [c.get("id") for c in choices]
                    if not (2 <= len(choices) <= 8):
                        errs.append(f"{ss}: {len(choices)} choices")
                    if len(set(ids)) != len(ids):
                        errs.append(f"{ss}: duplicate choice ids")
                    if quiz.get("choices") != choices:
                        errs.append(f"{ss}: quiz.choices != step.choices")
                    correct = quiz.get("correct_choice_ids", [])
                    if not correct or not set(correct) <= set(ids):
                        errs.append(f"{ss}: correct_choice_ids invalid")
                if mode == "practice" and mt == "code":
                    src = step.get("starter_code", "")
                    expected = step.get("expected_output")
                    if not src or expected is None:
                        errs.append(f"{ss}: code step missing starter_code/expected_output")
                        continue
                    if "ASK" in src:
                        errs.append(f"{ss}: ASK in graded code step")
                    result = run_sandboxed(src)
                    actual = "\n".join(result.get("output", []))
                    if result.get("status") != "ok":
                        errs.append(f"{ss}: engine status={result.get('status')} ({actual[:60]!r})")
                    elif actual not in (expected, expected.strip()):
                        errs.append(f"{ss}: output mismatch expected={expected!r} actual={actual!r}")
    return errs


def sql_str(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def sql_arr(values: list[str]) -> str:
    if not values:
        return "'{}'::text[]"
    return "ARRAY[" + ", ".join(sql_str(v) for v in values) + "]::text[]"


def sql_json(value) -> str:
    return sql_str(json.dumps(value, ensure_ascii=False, sort_keys=True)) + "::jsonb"


def upsert(table: str, row: dict[str, str], update_cols: list[str], touch: bool = False) -> str:
    """insert-on-conflict-update. touch=True also stamps updated_at = now() on conflict
    (only for tables that have the column)."""
    cols = ", ".join(row.keys())
    vals = ", ".join(row.values())
    sets = ",\n  ".join(f"{c} = excluded.{c}" for c in update_cols)
    if touch:
        sets += ",\n  updated_at = now()"
    return (
        f"insert into public.{table} ({cols})\nvalues ({vals})\n"
        f"on conflict (id) do update set\n  {sets};\n"
    )


def emit_sql(chunks: dict[str, dict]) -> str:
    first = chunks["itf-f-ch1"]
    subject, course = first["subject"], first["course"]
    version_id = f"{course['slug']}-v1"
    out: list[str] = [
        "-- IT Frontiers Book F seed (generated by tools/import_book_manifest.py from",
        "-- docs/curriculum/bookf/itf-f-ch*.json — regenerate there; do not hand-edit).",
        "-- Global catalog content (organization_id NULL), everything published. Idempotent:",
        "-- migrations re-apply on every backend deploy.",
        "",
    ]
    out.append(upsert("subjects", {
        "id": sql_str(subject["slug"]),
        "title": sql_str(subject["title"]),
        "description": sql_str(subject.get("description", "")),
        "status": "'published'",
    }, ["title", "description", "status"], touch=True))
    out.append(upsert("courses", {
        "id": sql_str(course["slug"]),
        "subject_id": sql_str(subject["slug"]),
        "title": sql_str(course["title"]),
        "description": sql_str(course.get("description", "")),
        "status": "'published'",
    }, ["subject_id", "title", "description", "status"], touch=True))
    # is_current is set on first insert only — NOT re-forced on conflict, so a future v2
    # made current in the studio survives redeploys of this seed.
    out.append(upsert("course_versions", {
        "id": sql_str(version_id),
        "course_id": sql_str(course["slug"]),
        "version_label": "'v1'",
        "status": "'published'",
        "is_current": "true",
    }, ["course_id", "version_label", "status"], touch=True))

    position = GLOBAL_POSITION_BASE
    for unit_pos, chunk_slug in enumerate(CHUNK_LESSONS, start=1):
        unit = chunks[chunk_slug]["units"][0]
        out.append(upsert("units", {
            "id": sql_str(unit["slug"]),
            "course_version_id": sql_str(version_id),
            "position": str(unit_pos),
            "title": sql_str(unit["title"]),
            "description": sql_str(unit.get("description", "")),
        }, ["course_version_id", "position", "title", "description"], touch=True))
        for unit_position, lesson in enumerate(unit["lessons"], start=1):
            position += 1
            ls = lesson["slug"]
            milestone_id = f"{ls}-milestone"
            pol = lesson["policy"]
            mil = lesson["milestone"]
            metadata = {
                "course_id": course["slug"],
                "course_version_id": version_id,
                "lesson_type": lesson["lesson_type"],
            }
            out.append(upsert("lessons", {
                "id": sql_str(ls),
                "position": str(position),
                "title": sql_str(lesson["title"]),
                "tutor_prompt": sql_str(lesson["tutor_prompt"]),
                "sample_code": sql_str(lesson.get("sample_code", "")),
                "module": sql_str(MODULE_LABEL),
                "level": sql_str(lesson["level"]),
                "unit_id": sql_str(unit["slug"]),
                "unit_position": str(unit_position),
                "publication_status": "'published'",
                "help_ceiling": sql_str(pol["help_ceiling"]),
                "require_attempt_first": "true" if pol.get("require_attempt_first", True) else "false",
                "final_answer_policy": sql_str(pol["final_answer_policy"]),
                "tutor_tone": sql_str(pol["tutor_tone"]) if pol.get("tutor_tone") else "null",
                "tutor_pace": sql_str(pol["tutor_pace"]) if pol.get("tutor_pace") else "null",
                "grade_band": sql_str(pol["grade_band"]) if pol.get("grade_band") else "null",
                "curriculum_metadata": sql_json(metadata),
            }, [
                "position", "title", "tutor_prompt", "sample_code", "module", "level",
                "unit_id", "unit_position", "publication_status", "help_ceiling",
                "require_attempt_first", "final_answer_policy", "tutor_tone", "tutor_pace",
                "grade_band", "curriculum_metadata",
            ]))
            out.append(upsert("milestones", {
                "id": sql_str(milestone_id),
                "lesson_id": sql_str(ls),
                "position": "1",
                "title": sql_str(mil.get("title") or lesson["title"]),
                "objective": sql_str(mil["objective"]),
                "level": sql_str(lesson["level"]),
                "skill_keys": sql_arr(mil.get("skill_keys", [])),
                "allowed_response_modes": sql_arr(mil.get("allowed_response_modes", ["text"])),
            }, [
                "lesson_id", "position", "title", "objective", "level", "skill_keys",
                "allowed_response_modes",
            ], touch=True))
            out.append(
                f"update public.lessons set milestone_id = {sql_str(milestone_id)} "
                f"where id = {sql_str(ls)};\n"
            )
            for step_position, step in enumerate(lesson["steps"], start=1):
                ss = step["slug"]
                mode, mode_type = step["mode"], step.get("mode_type")
                response_mode, activity_type = pin_shapes(mode, mode_type)
                out.append(upsert("lesson_activities", {
                    "id": sql_str(ss),
                    "lesson_id": sql_str(ls),
                    "milestone_id": sql_str(milestone_id),
                    "position": str(step_position),
                    "title": sql_str(step["title"]),
                    "activity_type": sql_str(activity_type),
                    "stage": sql_str(step["stage"]),
                    "prompt": sql_str(step["prompt"]),
                    "response_mode": sql_str(response_mode),
                    "starter_code": sql_str(step.get("starter_code", "")),
                    "expected_output": sql_str(step["expected_output"]) if step.get("expected_output") else "null",
                    "choices": sql_json(step.get("choices", [])),
                    "rubric": sql_json({}),
                    "skill_keys": sql_arr(step.get("skill_keys", [])),
                    "pass_score": str(step.get("pass_score", 1)),
                    "mode": sql_str(mode),
                    "mode_type": sql_str(mode_type) if mode_type else "null",
                }, [
                    "lesson_id", "milestone_id", "position", "title", "activity_type",
                    "stage", "prompt", "response_mode", "starter_code", "expected_output",
                    "choices", "rubric", "skill_keys", "pass_score", "mode", "mode_type",
                ]))
                if mode == "assessment" and mode_type == "mcq":
                    quiz = step["quiz"]
                    out.append(upsert("quiz_items", {
                        "id": sql_str(f"{ss}-quiz"),
                        "lesson_id": sql_str(ls),
                        "milestone_id": sql_str(milestone_id),
                        "activity_id": sql_str(ss),
                        "position": str(step_position),
                        "prompt": sql_str(quiz.get("prompt") or step["prompt"]),
                        "question_type": "'multiple_choice'",
                        "choices": sql_json(quiz["choices"]),
                        "correct_choice_ids": sql_arr(quiz["correct_choice_ids"]),
                        "rubric": sql_json({}),
                        "skill_keys": sql_arr(step.get("skill_keys", [])),
                        "status": "'published'",
                    }, [
                        "lesson_id", "milestone_id", "activity_id", "position", "prompt",
                        "question_type", "choices", "correct_choice_ids", "rubric",
                        "skill_keys", "status",
                    ], touch=True))
    return "\n".join(out)


def main(argv: list[str]) -> int:
    args = list(argv)
    sql_path: Path | None = None
    if "--emit-sql" in args:
        i = args.index("--emit-sql")
        sql_path = Path(args[i + 1])
        del args[i : i + 2]
    if not args:
        print("usage: import_book_manifest.py [--emit-sql out.sql] chunk1.json [chunk2.json ...]")
        return 2
    chunks: dict[str, dict] = {}
    for path in args:
        data = json.loads(Path(path).read_text())
        chunks[data.get("chunk") or data["units"][0]["slug"]] = data
    errs = validate(chunks)
    lessons = sum(len(c["units"][0]["lessons"]) for c in chunks.values())
    steps = sum(len(l["steps"]) for c in chunks.values() for l in c["units"][0]["lessons"])
    print(f"validated: {len(chunks)} chunks, {lessons} lessons, {steps} steps, {len(errs)} errors")
    for e in errs:
        print("  ERROR:", e)
    if errs:
        return 1
    if sql_path:
        sql_path.write_text(emit_sql(chunks))
        print(f"wrote {sql_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
