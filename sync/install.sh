#!/bin/bash
# Installs the sync agent as a launchd job. Idempotent.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="uk.robski.today-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ENV_FILE="$HOME/.today-robski.env"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# today.robski.uk sync agent. Keep this file out of git.
SYNC_KEY=paste-your-sync-key-here
TODAY_API=https://today.robski.uk
TANA_MCP_URL=http://127.0.0.1:8262/mcp
TANA_MCP_TOKEN=paste-your-tana-mcp-token-here
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE - fill in SYNC_KEY and TANA_MCP_TOKEN, then run this again."
  exit 0
fi

if grep -q 'paste-your' "$ENV_FILE"; then
  echo "$ENV_FILE still has placeholders in it. Fill them in first."
  exit 1
fi

chmod +x "$REPO/sync/run-sync.sh"
mkdir -p "$HOME/Library/LaunchAgents"

sed -e "s|REPO_PATH|$REPO|g" -e "s|HOME_PATH|$HOME|g" \
  "$REPO/sync/$LABEL.plist" > "$PLIST"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "Installed. Syncing every 15 minutes."
echo "  logs:    tail -f ~/Library/Logs/today-sync.log"
echo "  stop:    launchctl bootout gui/$UID/$LABEL"
echo "  run now: launchctl kickstart -k gui/$UID/$LABEL"
