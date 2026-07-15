#!/usr/bin/env python3
"""Scripted conversational E2E for the chat edge function (Flow v3+).

Drives POST /functions/v1/chat through YAML-ish JSON scenarios and asserts ONLY
deterministic envelope surfaces (current_activity_id, continue_offer, turn_kind,
navigation) — never reply prose, which is nondeterministic at conversation temp.

Usage:
    python3 tools/e2e_chat_script.py \
        --url https://<ref>.supabase.co --anon-key <key> \
        --email student2@gmail.com --password <pw> \
        --scenario tests/e2e_scenarios/continue_gate.json

Scenario file shape (JSON; kept trivially hand-editable):
    {
      "lesson_id": "itf-f-ch1-l1",
      "steps": [
        {"send": {"text": "hello there"},
         "expect": {"advanced": false, "continue_offer": true}},
        {"send": {"control": "continue"},
         "expect": {"advanced": true}},
        {"send": {"text": "why is that true?"},
         "expect": {"advanced": false, "turn_kind": "question"}}
      ]
    }

Each step's `expect` supports: advanced (bool — did current_activity_id change from the
previous turn), continue_offer (bool — pill offered), turn_kind (exact string),
navigation_mode ("revisit" | "resume" | null — the envelope's navigation frame), and
completed (bool — session complete). Paced to respect the 30-turns/60s session limit.

NOTE: must run from a network that can reach the Supabase project (CI or a dev machine;
the remote agent container's proxy blocks *.supabase.co).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request


def post_json(url: str, headers: dict[str, str], body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode())


def sign_in(base: str, anon_key: str, email: str, password: str) -> str:
    data = post_json(
        f"{base}/auth/v1/token?grant_type=password",
        {"apikey": anon_key},
        {"email": email, "password": password},
    )
    token = data.get("access_token")
    if not token:
        raise SystemExit(f"sign-in failed: {data}")
    return token


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--anon-key", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--pace-seconds", type=float, default=2.5)
    args = ap.parse_args()

    scenario = json.loads(open(args.scenario).read())
    token = sign_in(args.url, args.anon_key, args.email, args.password)
    headers = {"apikey": args.anon_key, "Authorization": f"Bearer {token}"}
    chat_url = f"{args.url}/functions/v1/chat"

    session_id: str | None = None
    previous_activity: str | None = None
    failures: list[str] = []

    for index, step in enumerate(scenario["steps"], start=1):
        send = step.get("send", {})
        body: dict = {
            "lesson_id": scenario["lesson_id"],
            "mentor_preferences": {"mode": "guide"},
        }
        if session_id:
            body["session_id"] = session_id
        if "control" in send:
            body["control"] = {"type": send["control"]}
            if send.get("target_activity_id"):
                body["control"]["target_activity_id"] = send["target_activity_id"]
            body["answer"] = {"mode": "text", "text": ""}
        elif "choice" in send:
            body["answer"] = {"mode": "multiple_choice", "choice_id": send["choice"]}
        else:
            body["answer"] = {"mode": "text", "text": send.get("text", "")}

        envelope = post_json(chat_url, headers, body)
        session_id = envelope.get("session_id") or session_id
        current = (envelope.get("session") or {}).get("current_activity_id")

        expect = step.get("expect", {})
        checks: list[tuple[str, bool]] = []
        if "advanced" in expect:
            moved = previous_activity is not None and current != previous_activity
            checks.append((f"advanced={expect['advanced']}", moved == expect["advanced"]))
        if "continue_offer" in expect:
            offered = bool(envelope.get("continue_offer"))
            checks.append(
                (f"continue_offer={expect['continue_offer']}", offered == expect["continue_offer"])
            )
        if "turn_kind" in expect:
            checks.append(
                (f"turn_kind={expect['turn_kind']}", envelope.get("turn_kind") == expect["turn_kind"])
            )
        if "navigation_mode" in expect:
            nav = envelope.get("navigation")
            mode = nav.get("mode") if isinstance(nav, dict) else None
            checks.append(
                (f"navigation_mode={expect['navigation_mode']}", mode == expect["navigation_mode"])
            )
        if "completed" in expect:
            done = envelope.get("stage") == "complete" or (
                (envelope.get("session") or {}).get("status") == "complete"
            )
            checks.append((f"completed={expect['completed']}", done == expect["completed"]))

        for label, ok in checks:
            marker = "PASS" if ok else "FAIL"
            print(f"turn {index}: {marker} {label} (activity={current})")
            if not ok:
                failures.append(f"turn {index}: {label}")
        previous_activity = current
        time.sleep(args.pace_seconds)

    if failures:
        print(f"\n{len(failures)} assertion(s) failed:")
        for failure in failures:
            print(" -", failure)
        return 1
    print("\nscenario passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
