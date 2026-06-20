#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ ! -d "node_modules" ]; then
  npm install
fi
node src/updater.js
PORT="${PORT:-5177}"
npm start &
SERVER_PID=$!
sleep 2
if kill -0 "$SERVER_PID" 2>/dev/null; then
  open "http://localhost:${PORT}"
fi
wait "$SERVER_PID"
