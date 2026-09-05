#!/bin/bash
set -u
set -o pipefail
umask 077

readonly HEARTBEAT_INTERVAL_SECONDS=120
readonly HOOK_VERSION="2"
readonly CHILD_RETENTION_SECONDS=86400
readonly MAX_CHILD_IDENTITIES=512

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

# Extract only bounded identifiers before any value can become an argv entry.
# Raw prompts/tool results may exceed Linux's per-argument limit.
input="$(/usr/bin/jq -c '
  def bounded($limit): if . == null then "" elif type == "string" and length <= $limit
    then . else error("invalid lifecycle identifier") end;
  {session_id: ((.session_id // .sessionId) | bounded(160)),
   agent_id: ((.agent_id // .agentId) | bounded(200)),
   task_id: ((.task_id // .taskId) | bounded(200)),
   teammate_name: (.teammate_name | bounded(200)),
   agent_type: ((.agent_type // .agentType) | bounded(80)),
   tool_use_id: ((.tool_use_id // .toolUseId) | bounded(240)),
   elicitation_id: ((.elicitation_id // .elicitationId) | bounded(240))}
  | with_entries(select(.value != ""))' 2>/dev/null)" || {
  /usr/bin/printf 'Cent Com Claude hook: invalid lifecycle payload\n' >&2
  exit 0
}
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
last_attempt_epoch=0
attention=""
attention_key=""
health="null"
children='{}'
if [[ -f "$state_file" ]]; then
  if ! /usr/bin/jq -e 'type == "object" and (.turnId | type == "string")
    and (.eventSequence | type == "number") and ((.children // {}) | type == "object")' "$state_file" >/dev/null 2>&1; then
    release_lock
    /usr/bin/printf 'Cent Com Claude hook: invalid local state\n' >&2
    exit 0
  fi
  turn_id="$(/usr/bin/jq -r '.turnId // empty' "$state_file" 2>/dev/null || true)"
  event_sequence="$(/usr/bin/jq -r '.eventSequence // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  last_start_epoch="$(/usr/bin/jq -r '.lastStartEpoch // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  last_heartbeat_epoch="$(/usr/bin/jq -r '.lastHeartbeatEpoch // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  last_attempt_epoch="$(/usr/bin/jq -r '.lastAttemptEpoch // 0' "$state_file" 2>/dev/null || /usr/bin/printf '0')"
  attention="$(/usr/bin/jq -r '.attention // empty' "$state_file" 2>/dev/null || true)"
  attention_key="$(/usr/bin/jq -r '.attentionKey // empty' "$state_file" 2>/dev/null || true)"
  health="$(/usr/bin/jq -c '.health // null' "$state_file" 2>/dev/null || /usr/bin/printf 'null')"
  children="$(/usr/bin/jq -c --argjson cutoff "$((now_epoch - CHILD_RETENTION_SECONDS))" \
    '(.children // {}) | with_entries(select(.value.seenAt >= $cutoff))' "$state_file" 2>/dev/null || /usr/bin/printf '{}')"
fi
[[ "$event_sequence" =~ ^[0-9]+$ ]] || event_sequence=0
[[ "$last_start_epoch" =~ ^[0-9]+$ ]] || last_start_epoch=0
[[ "$last_heartbeat_epoch" =~ ^[0-9]+$ ]] || last_heartbeat_epoch=0
[[ "$last_attempt_epoch" =~ ^[0-9]+$ ]] || last_attempt_epoch=0

if [[ "$event" == "user_prompt_submit" ]]; then
  # Capture runs before Claude continues; delivery alone is asynchronous.
  # Two real prompts less than two seconds apart are still distinct turns.
  turn_id="$(new_turn_id)"
  last_start_epoch="$now_epoch"
  last_attempt_epoch=0
  last_heartbeat_epoch=0
  attention=""
  attention_key=""
elif [[ -z "$turn_id" ]]; then
  # Existing sessions may first encounter protocol v2 on a non-start hook.
  # The server will accept exact attention but will not invent work from a
  # heartbeat or terminal event.
  turn_id="$(new_turn_id)"
fi

child_id="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '
  if (.agent_id // .agentId // null) != null then (.agent_id // .agentId)
  elif (.task_id // .taskId // null) != null then (.task_id // .taskId)
  elif (.teammate_name // null) != null then .teammate_name
  else "" end | if type == "string" then . else "" end
' 2>/dev/null)"
agent_type="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '(.agent_type // .agentType // .teammate_name // "") | if type == "string" then . else "" end' 2>/dev/null)"
unique_input_id="$(/usr/bin/printf '%s' "$input" | /usr/bin/jq -r '(.tool_use_id // .toolUseId // .elicitation_id // .elicitationId // .agent_id // .agentId // .task_id // .taskId // .teammate_name // "") | if type == "string" then . else "" end' 2>/dev/null)"

root_state="$(/usr/bin/jq -cn --arg turnId "$turn_id" --arg attention "$attention" --arg attentionKey "$attention_key" \
  --argjson health "$health" --argjson lastStartEpoch "$last_start_epoch" \
  --argjson lastHeartbeatEpoch "$last_heartbeat_epoch" --argjson lastAttemptEpoch "$last_attempt_epoch" \
  '{turnId:$turnId,attention:$attention,attentionKey:$attentionKey,health:$health,lastStartEpoch:$lastStartEpoch,
    lastHeartbeatEpoch:$lastHeartbeatEpoch,lastAttemptEpoch:$lastAttemptEpoch}')"
child_key=""
child_kind=""
if [[ -n "$child_id" ]]; then
  child_key="$(/usr/bin/printf '%s' "$child_id" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
  child_state="$(/usr/bin/jq -c --arg key "$child_key" '.[$key] // null' <<<"$children")"
  if [[ "$child_state" == "null" ]]; then
    # Unknown/expired child events cannot safely borrow the current root turn.
    # Retain completed mappings too, so duplicate or delayed stops stay exact.
    if [[ "$event" != "subagent_start" ]] || (( $(/usr/bin/jq 'length' <<<"$children") >= MAX_CHILD_IDENTITIES )); then
      release_lock
      /usr/bin/printf 'Cent Com Claude hook: child identity unavailable\n' >&2
      exit 0
    fi
    child_state="$(/usr/bin/jq -cn --arg turnId "$turn_id" '{turnId:$turnId,childKind:"subagent"}')"
  fi
  turn_id="$(/usr/bin/jq -r '.turnId' <<<"$child_state")"
  child_kind="$(/usr/bin/jq -r '.childKind // "subagent"' <<<"$child_state")"
  attention="$(/usr/bin/jq -r '.attention // ""' <<<"$child_state")"
  attention_key="$(/usr/bin/jq -r '.attentionKey // ""' <<<"$child_state")"
  health="$(/usr/bin/jq -c '.health // null' <<<"$child_state")"
  last_start_epoch="$(/usr/bin/jq -r --argjson now "$now_epoch" '.lastStartEpoch // $now' <<<"$child_state")"
  last_attempt_epoch="$(/usr/bin/jq -r '.lastAttemptEpoch // 0' <<<"$child_state")"
  last_heartbeat_epoch="$(/usr/bin/jq -r '.lastHeartbeatEpoch // 0' <<<"$child_state")"
fi

transport_event="$event"
if [[ "$event" == "heartbeat" ]]; then
  if [[ "$attention" == "permission" ]]; then
    transport_event="resumed"
  elif (( now_epoch - last_attempt_epoch < HEARTBEAT_INTERVAL_SECONDS )); then
    release_lock
    exit 0
  else
    last_attempt_epoch="$now_epoch"
  fi
fi

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
if ! builtin printf '%s' "$children" | /usr/bin/jq -ec \
  --arg turnId "$turn_id" \
  --arg attention "$attention" \
  --arg attentionKey "$attention_key" \
  --argjson health "$health" \
  --argjson eventSequence "$event_sequence" \
  --argjson lastStartEpoch "$last_start_epoch" \
  --argjson lastHeartbeatEpoch "$last_heartbeat_epoch" \
  --argjson lastAttemptEpoch "$last_attempt_epoch" \
  --arg childKey "$child_key" --arg childKind "$child_kind" \
  --argjson rootState "$root_state" --argjson seenAt "$now_epoch" \
  '{turnId:$turnId,lastStartEpoch:$lastStartEpoch,
    lastHeartbeatEpoch:$lastHeartbeatEpoch,lastAttemptEpoch:$lastAttemptEpoch,
    attention:$attention,attentionKey:$attentionKey,health:$health} as $worker
    | . as $children | $rootState + {eventSequence:$eventSequence,children:$children}
    | if $childKey == "" then . + $worker
      else .children[$childKey] = ($worker + {childKind:$childKind,seenAt:$seenAt}) end' >"$tmp_state"; then
  /bin/rm -f "$tmp_state"
  release_lock
  /usr/bin/printf 'Cent Com Claude hook: state serialization failed\n' >&2
  exit 0
fi
if ! /bin/chmod 600 "$tmp_state" || ! /bin/mv -f "$tmp_state" "$state_file"; then
  /bin/rm -f "$tmp_state"
  release_lock
  /usr/bin/printf 'Cent Com Claude hook: state replacement failed\n' >&2
  exit 0
fi
release_lock

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

# This is a one-shot handoff, not a retry queue. No raw hook input or token is
# written to it; the worker removes it on exit. Do not set async in settings:
# that would postpone identity capture itself and let an old Stop take a new ID.
packet="$(/usr/bin/mktemp "$state_directory/delivery.XXXXXX")" || exit 0
/usr/bin/jq -cn --argjson arguments "$arguments" --arg stateFile "$state_file" \
  --arg attentionKey "$attention_key" --arg childKey "$child_key" --argjson epoch "$now_epoch" \
  '{arguments:$arguments,stateFile:$stateFile,attentionKey:$attentionKey,childKey:$childKey,epoch:$epoch}' >"$packet"
worker="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/athenaeum-agent-deliver.sh"
/usr/bin/nohup /bin/bash "$worker" "$packet" </dev/null >/dev/null 2>&1 &
exit 0
