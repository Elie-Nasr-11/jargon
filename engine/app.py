"""Flask HTTP wrapper for the hardened Jargon interpreter.

POST /run accepts:
    {"code": "...", "answers": [...], "preset_answers": {...}}

It returns the full interpreter result shape and a back-compatible
``result`` alias equal to ``output`` for the existing editor.js.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, redirect, request
from flask_cors import CORS

try:
    from .jargon_interpreter import JargonLimits, run_sandboxed
except ImportError:  # Allows `python app.py` from inside engine/.
    from jargon_interpreter import JargonLimits, run_sandboxed


app = Flask(__name__)
CORS(app)


@app.get("/")
def index():
    app_url = os.environ.get("JARGON_APP_URL", "").strip()
    if app_url:
        return redirect(app_url, code=302)

    return jsonify(
        {
            "service": "jargon-engine",
            "status": "ok",
            "health": "/health",
            "run": "/run",
            "message": "This is the Jargon engine API, not the student app.",
        }
    )


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "jargon-engine"})


@app.post("/run")
def run():
    data = request.get_json(force=True, silent=True) or {}
    limits = _limits_from_payload(data.get("limits"))
    timeout_seconds = _float_env("JARGON_TIMEOUT_SECONDS", 2.0)
    memory_mb = _int_env("JARGON_MEMORY_MB", 128)

    result = run_sandboxed(
        data.get("code", ""),
        preset_answers=data.get("preset_answers"),
        answers=data.get("answers"),
        limits=limits,
        timeout_seconds=timeout_seconds,
        memory_mb=memory_mb,
    )
    result["result"] = result.get("output", ["[No output returned]"])
    return jsonify(result)


def _limits_from_payload(raw_limits):
    if raw_limits is None:
        return None
    if not isinstance(raw_limits, dict):
        return None
    allowed = JargonLimits.__dataclass_fields__
    values = {key: value for key, value in raw_limits.items() if key in allowed}
    try:
        return JargonLimits(**values)
    except (TypeError, ValueError):
        return None


def _float_env(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _int_env(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=_int_env("PORT", 5000))
