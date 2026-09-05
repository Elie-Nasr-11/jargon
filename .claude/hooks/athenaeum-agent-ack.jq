# Accept JSON or SSE framing, then require exactly one matching RPC result.
def rpc:
  try fromjson catch (
    [splits("\r?\n\r?\n")
      | [splits("\r?\n") | select(startswith("data:")) | ltrimstr("data:") | ltrimstr(" ")] | join("\n")
      | fromjson? | select(.id == 1)]
    | if length == 1 then .[0] else error("malformed") end
  );
try (
  rpc
  | if .jsonrpc != "2.0" or .id != 1 then "malformed"
    elif .error != null or .result.isError == true then "rejected"
    else [.result.content[]? | select(.type == "text") | .text | fromjson?]
      | if length != 1 then "malformed"
        elif .[0].protocolVersion != 2 or .[0].eventId != $eventId then "malformed"
        else .[0].disposition
          | if . == "accepted" or . == "duplicate" or . == "ignored" then . else "malformed" end
        end
    end
) catch "malformed"
