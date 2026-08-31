#!/bin/bash
# This committed hook runs only in Claude Code web's Linux container. Local
# sessions use the user-level macOS hook, preventing duplicate lifecycle events.
set -u

readonly ENDPOINT="https://daily-focus-dashboard.onrender.com/api/mcp"
readonly HEARTBEAT_INTERVAL_SECONDS=120

event="${1:-}"
project_label="${2:-}"

[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0

case "$event" in
  user_prompt_submit|heartbeat|permission_request|needs_input|subagent_start|subagent_stop|task_created|task_completed|stop|stop_failure|session_end) ;;
  *)
    /usr/bin/printf 'Cent Com Claude hook: unsupported lifecycle event\n' >&2
    exit 0
    ;;
esac

input="$(/bin/cat)"
arguments="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -ce \
  --arg event "$event" \
  --arg projectLabel "$project_label" '
    (.session_id // .sessionId // empty) as $sessionId |
    select(($sessionId | type) == "string" and ($sessionId | length) > 0 and ($sessionId | length) <= 160) |
    (.agent_id // .agentId // .task_id // .taskId // "") as $childId |
    (.agent_type // .agentType // "") as $agentType |
    (if ($event == "subagent_start" or $event == "subagent_stop" or $event == "needs_input")
      then "subagent"
      elif ($event == "task_created" or $event == "task_completed")
      then "task"
      else ""
    end) as $childKind |
    {sessionId: $sessionId, event: $event} +
    (if ($projectLabel | length) > 0 then {projectLabel: ($projectLabel[0:120])} else {} end) +
    (if ($childId | type) == "string" and ($childId | length) > 0 then {childId: ($childId[0:160])} else {} end) +
    (if ($childKind | length) > 0 and ($childId | type) == "string" and ($childId | length) > 0
      then {childKind: $childKind} else {} end) +
    (if ($agentType | type) == "string" and ($agentType | length) > 0
      then {agentType: ($agentType[0:80])} else {} end) +
    (if $event == "stop_failure" then {errorCategory: "hook_failure"} else {} end)
  ' 2>/dev/null)" || {
    /usr/bin/printf 'Cent Com Claude hook: invalid lifecycle payload\n' >&2
    exit 0
  }

session_id="$(/usr/bin/printf '%s' "$arguments" | /usr/bin/jq -r '.sessionId')"
session_hash="$(/usr/bin/printf '%s' "$session_id" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

if [[ "$event" == "heartbeat" ]]; then
  heartbeat_directory="${TMPDIR:-/tmp}/centcom-athenaeum-heartbeats"
  heartbeat_file="$heartbeat_directory/$session_hash"
  /bin/mkdir -p "$heartbeat_directory"
  now_epoch="$(/bin/date '+%s')"
  previous_epoch=0
  if [[ -f "$heartbeat_file" ]]; then
    previous_epoch="$(/usr/bin/stat -c '%Y' "$heartbeat_file" 2>/dev/null || /usr/bin/stat -f '%m' "$heartbeat_file" 2>/dev/null || /usr/bin/printf '0')"
    [[ "$previous_epoch" =~ ^[0-9]+$ ]] || previous_epoch=0
  fi
  if (( now_epoch - previous_epoch < HEARTBEAT_INTERVAL_SECONDS )); then
    exit 0
  fi
  /usr/bin/touch "$heartbeat_file"
fi

if [[ -z "${ATHENAEUM_MCP_TOKEN:-}" ]]; then
  /usr/bin/printf 'Cent Com Claude hook: Athenaeum credential missing\n' >&2
  exit 0
fi

payload="$(/usr/bin/jq -cn \
  --argjson arguments "$arguments" \
  '{jsonrpc: "2.0", id: 1, method: "tools/call",
    params: {name: "athenaeum_agent_event", arguments: $arguments}}')"

http_status="$(/usr/bin/curl -sS \
  --connect-timeout 2 \
  --max-time 4 \
  -o /dev/null \
  -w '%{http_code}' \
  -H "Authorization: Bearer $ATHENAEUM_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data-binary "$payload" \
  "$ENDPOINT")"
curl_status=$?

if [[ $curl_status -ne 0 || "$http_status" != 2* ]]; then
  /usr/bin/printf 'Cent Com Claude hook: delivery failed\n' >&2
fi
exit 0
