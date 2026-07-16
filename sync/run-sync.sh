#!/bin/bash
# Wrapper launchd calls. Keeps SYNC_KEY out of the repo and out of the plist:
# it lives in ~/.today-robski.env, chmod 600, gitignored.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.today-robski.env"

# launchd runs with a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin), so node is not
# on it. Put the usual install dirs back before anything tries to find it.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

if [ ! -f "$ENV_FILE" ]; then
  echo "$(date -Iseconds) missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# Tana's MCP bridge only answers while the desktop app is running. No app, no sync.
if ! curl -sf -o /dev/null --max-time 4 \
     -H "Authorization: Bearer ${TANA_MCP_TOKEN:-}" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}' \
     "${TANA_MCP_URL:-http://127.0.0.1:8262/mcp}"; then
  echo "$(date -Iseconds) Tana not reachable, skipping" >&2
  exit 0
fi

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ]; then
  echo "$(date -Iseconds) node not found on PATH; set NODE_BIN in $ENV_FILE" >&2
  exit 1
fi

exec "$NODE_BIN" "$REPO/sync/sync.js"
