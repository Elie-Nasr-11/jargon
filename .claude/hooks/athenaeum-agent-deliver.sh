#!/bin/bash
set -u
umask 077
readonly ENDPOINT="https://daily-focus-dashboard.onrender.com/api/mcp"
packet="${1:?A captured lifecycle packet is required}"
response="$packet.reply"
trap '/bin/rm -f "$packet" "$response"' EXIT
arguments="$(/usr/bin/jq -c '.arguments' "$packet")" || exit 0
state_file="$(/usr/bin/jq -r '.stateFile' "$packet")"
event_id="$(/usr/bin/jq -r '.eventId' <<<"$arguments")"
turn_id="$(/usr/bin/jq -r '.turnId' <<<"$arguments")"
sequence="$(/usr/bin/jq -r '.eventSequence' <<<"$arguments")"
event="$(/usr/bin/jq -r '.event' <<<"$arguments")"
epoch="$(/usr/bin/jq -r '.epoch' "$packet")"
attention_key="$(/usr/bin/jq -r '.attentionKey' "$packet")"
child_key="$(/usr/bin/jq -r '.childKey // ""' "$packet")"
lock_directory="${state_file%.json}.lock"

# The only persistent diagnostic is bounded local health, never server text.
finish() {
  local category="$1" attempt=0 tmp_state="$state_file.delivery.$$"
  while ! /bin/mkdir "$lock_directory" 2>/dev/null; do
    attempt=$((attempt + 1))
    (( attempt < 50 )) || exit 0
    /bin/sleep 0.02
  done
  /usr/bin/jq --arg category "$category" --arg turnId "$turn_id" --arg event "$event" \
    --arg attentionKey "$attention_key" --arg childKey "$child_key" --argjson sequence "$sequence" --argjson epoch "$epoch" '
      def updateWorker:
        if .turnId != $turnId then . else
        (if $sequence >= (.health.sequence // 0) then
          .health = {category:$category,sequence:$sequence,attemptedAt:$epoch,
            lastSuccessAt:(if $category == "accepted" or $category == "duplicate" then $epoch else (.health.lastSuccessAt // null) end)}
         else . end)
        | if $category == "accepted" or $category == "duplicate" then
            (if $event == "heartbeat" then .lastHeartbeatEpoch = ([.lastHeartbeatEpoch, $epoch] | max) else . end)
            | if ($event == "resumed" or $event == "elicitation_result") and .attentionKey == $attentionKey
              then .attention="" | .attentionKey="" else . end
          else . end
        end;
      if $childKey == "" then updateWorker
      elif .children[$childKey] != null then .children[$childKey] |= updateWorker
      else . end' "$state_file" >"$tmp_state" 2>/dev/null && /bin/mv -f "$tmp_state" "$state_file"
  /bin/rm -f "$tmp_state"
  /bin/rmdir "$lock_directory" 2>/dev/null || true
  exit 0
}

[[ -n "${ATHENAEUM_MCP_TOKEN:-}" ]] || finish credential_missing
# Pass headers through stdin: no token in process arguments or temporary files.
payload="$(/usr/bin/jq -cn --argjson arguments "$arguments" \
  '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"athenaeum_agent_event",arguments:$arguments}}')"
http_status="$(builtin printf 'Authorization: Bearer %s\nContent-Type: application/json\nAccept: application/json, text/event-stream\n' "$ATHENAEUM_MCP_TOKEN" \
  | /usr/bin/curl -s --connect-timeout 2 --max-time 4 --max-filesize 65536 \
      -o "$response" -w '%{http_code}' -H @- --data-binary "$payload" "$ENDPOINT")"
curl_status=$?
[[ $curl_status -ne 28 ]] || finish timed_out
[[ $curl_status -eq 0 ]] || finish transport_failed
[[ "$http_status" == 2* ]] || finish rejected
[[ $(/usr/bin/wc -c <"$response") -le 65536 ]] || finish malformed
parser="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/athenaeum-agent-ack.jq"
category="$(/usr/bin/jq -Rrs --arg eventId "$event_id" -f "$parser" "$response" 2>/dev/null)" || category=malformed
case "$category" in accepted|duplicate|ignored|rejected|malformed) finish "$category" ;; *) finish malformed ;; esac
