#!/bin/bash
set -u

readonly ENDPOINT="https://daily-focus-dashboard.onrender.com/api/mcp"
readonly HEARTBEAT_INTERVAL_SECONDS=120
readonly HOOK_VERSION="2"

event="${1:-}"
project_label="${2:-}"

# This committed hook is for Claude Code web. Local sessions use the one
# user-level hook installed on the Mac, avoiding duplicate lifecycle events.
[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0

case "$event" in
  user_prompt_submit|heartbeat|permission_request|elicitation|elicitation_result|subagent_start|subagent_stop|task_created|task_completed|teammate_idle|stop|stop_failure|session_end) ;;
  *)
    /usr/bin/printf 'Cent Com Claude hook: unsupported lifecycle event\n' >&2
    exit 0
    ;;
esac

input="$(/bin/cat)"
session_id="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '(.session_id // .sessionId // empty) | select(type == "string")' 2>/dev/null)"
if [[ -z "$session_id" || ${#session_id} -gt 160 ]]; then
  /usr/bin/printf 'Cent Com Claude hook: invalid lifecycle payload\n' >&2
  exit 0
fi

session_hash="$(/usr/bin/printf '%s' "$session_id" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
state_directory="${TMPDIR:-/tmp}/centcom-athenaeum-state-v2"
state_file="$state_directory/$session_hash.json"
lock_directory="$state_directory/$session_hash.lock"
/bin/mkdir -p "$state_directory"
/bin/chmod 700 "$state_directory"

acquire_lock() {
  local attempt=0
  while ! /bin/mkdir "$lock_directory" 2>/dev/null; do
    attempt=$((attempt + 1))
    (( attempt < 50 )) || return 1
    /bin/sleep 0.02
  done
}

release_lock() {
  /bin/rmdir "$lock_directory" 2>/dev/null || true
}

new_turn_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]'
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    /bin/cat /proc/sys/kernel/random/uuid
  else
    /usr/bin/printf '%s' "$session_id|$(/bin/date '+%s')|$$|${RANDOM:-0}" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
  fi
}

acquire_lock || {
  /usr/bin/printf 'Cent Com Claude hook: local state unavailable\n' >&2
  exit 0
}

now_epoch="$(/bin/date '+%s')"
turn_id=""
event_sequence=0
last_start_epoch=0
last_heartbeat_epoch=0
attention=""
attention_key=""
if [[ -f "$state_file" ]]; then
  turn_id="$(/usr/bin/jq -r '.turnId // empty' "$state_file" 2>/dev/null || true)"
  event_sequence="$(/usr/bin/jq -r '.eventSequence // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  last_start_epoch="$(/usr/bin/jq -r '.lastStartEpoch // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  last_heartbeat_epoch="$(/usr/bin/jq -r '.lastHeartbeatEpoch // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  attention="$(/usr/bin/jq -r '.attention // empty' "$state_file" 2>/dev/null || true)"
  attention_key="$(/usr/bin/jq -r '.attentionKey // empty' "$state_file" 2>/dev/null || true)"
fi
[[ "$event_sequence" =~ ^[0-9]+$ ]] || event_sequence=0
[[ "$last_start_epoch" =~ ^[0-9]+$ ]] || last_start_epoch=0
[[ "$last_heartbeat_epoch" =~ ^[0-9]+$ ]] || last_heartbeat_epoch=0

if [[ "$event" == "user_prompt_submit" ]]; then
  if [[ -z "$turn_id" ]] || (( now_epoch - last_start_epoch > 2 )); then
    turn_id="$(new_turn_id)"
  fi
  last_start_epoch="$now_epoch"
  attention=""
  attention_key=""
elif [[ -z "$turn_id" ]]; then
  # Existing sessions may first encounter protocol v2 on a non-start hook.
  # The server will accept exact attention but will not invent work from a
  # heartbeat or terminal event.
  turn_id="$(new_turn_id)"
fi

transport_event="$event"
if [[ "$event" == "heartbeat" ]]; then
  if [[ "$attention" == "permission" ]]; then
    transport_event="resumed"
  elif (( now_epoch - last_heartbeat_epoch < HEARTBEAT_INTERVAL_SECONDS )); then
    release_lock
    exit 0
  else
    last_heartbeat_epoch="$now_epoch"
  fi
fi

child_id="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '
  if (.agent_id // .agentId // null) != null then (.agent_id // .agentId)
  elif (.task_id // .taskId // null) != null then (.task_id // .taskId)
  elif (.teammate_name // null) != null then .teammate_name
  else "" end | if type == "string" then . else "" end
' 2>/dev/null)"
agent_type="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '(.agent_type // .agentType // .teammate_name // "") | if type == "string" then . else "" end' 2>/dev/null)"
unique_input_id="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '(.tool_use_id // .toolUseId // .elicitation_id // .elicitationId // .agent_id // .agentId // .task_id // .taskId // .teammate_name // "") | if type == "string" then . else "" end' 2>/dev/null)"

case "$transport_event" in
  permission_request)
    attention="permission"
    attention_key="${unique_input_id:-permission-$event_sequence}"
    ;;
  elicitation)
    attention="elicitation"
    attention_key="${unique_input_id:-elicitation-$event_sequence}"
    ;;
esac

event_sequence=$((event_sequence + 1))
tmp_state="$state_file.$$"
/usr/bin/jq -cn \
  --arg turnId "$turn_id" \
  --arg attention "$attention" \
  --arg attentionKey "$attention_key" \
  --argjson eventSequence "$event_sequence" \
  --argjson lastStartEpoch "$last_start_epoch" \
  --argjson lastHeartbeatEpoch "$last_heartbeat_epoch" \
  '{turnId:$turnId,eventSequence:$eventSequence,lastStartEpoch:$lastStartEpoch,
    lastHeartbeatEpoch:$lastHeartbeatEpoch,attention:$attention,attentionKey:$attentionKey}' >"$tmp_state"
/bin/chmod 600 "$tmp_state"
/bin/mv -f "$tmp_state" "$state_file"
release_lock

child_kind=""
case "$transport_event" in
  subagent_start|subagent_stop) child_kind="subagent" ;;
  task_created|task_completed) child_kind="task" ;;
  teammate_idle) child_kind="teammate" ;;
esac

event_identity="$turn_id|$transport_event|$child_id"
case "$transport_event" in
  heartbeat) event_identity="$event_identity|$((now_epoch / HEARTBEAT_INTERVAL_SECONDS))" ;;
  resumed) event_identity="$event_identity|${attention_key:-permission}" ;;
  permission_request|elicitation|elicitation_result) event_identity="$event_identity|${unique_input_id:-$event_sequence}" ;;
esac
event_id="$(/usr/bin/printf '%s' "$session_id|$event_identity" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
observed_at="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"

arguments="$(/usr/bin/jq -cn \
  --arg sessionId "$session_id" \
  --arg turnId "$turn_id" \
  --arg eventId "$event_id" \
  --arg hookVersion "$HOOK_VERSION" \
  --arg event "$transport_event" \
  --arg projectLabel "$project_label" \
  --arg childId "$child_id" \
  --arg childKind "$child_kind" \
  --arg agentType "$agent_type" \
  --arg observedAt "$observed_at" \
  --argjson eventSequence "$event_sequence" '
    {sessionId:$sessionId,turnId:$turnId,eventId:$eventId,eventSequence:$eventSequence,
      hookVersion:$hookVersion,event:$event,observedAt:$observedAt} +
    (if ($projectLabel|length)>0 then {projectLabel:($projectLabel[0:100])} else {} end) +
    (if ($childId|length)>0 then {childId:($childId[0:200])} else {} end) +
    (if ($childKind|length)>0 and ($childId|length)>0 then {childKind:$childKind} else {} end) +
    (if ($agentType|length)>0 then {agentType:($agentType[0:80])} else {} end) +
    (if $event=="stop_failure" then {errorCategory:"hook_failure"} else {} end)
  ')"

if [[ -z "${ATHENAEUM_MCP_TOKEN:-}" ]]; then
  /usr/bin/printf 'Cent Com Claude hook: Athenaeum credential missing\n' >&2
  exit 0
fi

payload="$(/usr/bin/jq -cn --argjson arguments "$arguments" \
  '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"athenaeum_agent_event",arguments:$arguments}}')"

http_status="$(/usr/bin/curl -sS --connect-timeout 2 --max-time 4 -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $ATHENAEUM_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data-binary "$payload" "$ENDPOINT")"
curl_status=$?

if [[ $curl_status -eq 0 && "$http_status" == 2* ]]; then
  if [[ "$transport_event" == "resumed" || "$transport_event" == "elicitation_result" ]]; then
    acquire_lock || exit 0
    if [[ -f "$state_file" ]] && [[ "$(/usr/bin/jq -r '.turnId // empty' "$state_file" 2>/dev/null)" == "$turn_id" ]]; then
      tmp_state="$state_file.$$"
      /usr/bin/jq '.attention="" | .attentionKey=""' "$state_file" >"$tmp_state" 2>/dev/null && /bin/mv -f "$tmp_state" "$state_file"
    fi
    release_lock
  fi
  exit 0
fi

/usr/bin/printf 'Cent Com Claude hook: delivery failed\n' >&2
exit 0
