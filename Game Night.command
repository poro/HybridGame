#!/bin/zsh
# Double-click to start HybridGame for a play session on this Mac.
# Keeps the Mac awake while the server runs. Close this window (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

if lsof -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "HybridGame is already running. Opening the lobby."
  open "http://localhost:8787"
  exit 0
fi

echo "Starting HybridGame (lobby: http://localhost:8787)…"
( sleep 3 && open "http://localhost:8787" ) &
caffeinate -i npm start
