#!/bin/bash

export MYSHELL_CDP_URL="${MYSHELL_CDP_URL:-http://127.0.0.1:9222}"
MYSHELL_CDP_URL="${MYSHELL_CDP_URL%/}"
MYSHELL_CDP_ENDPOINT="${MYSHELL_CDP_URL#http://}"
MYSHELL_CDP_ENDPOINT="${MYSHELL_CDP_ENDPOINT#https://}"
MYSHELL_CDP_HOST="${MYSHELL_CDP_ENDPOINT%%[:/]*}"
MYSHELL_CDP_REMAINDER="${MYSHELL_CDP_ENDPOINT#"$MYSHELL_CDP_HOST"}"
MYSHELL_CDP_PORT="9222"
if [[ "$MYSHELL_CDP_REMAINDER" =~ ^:([0-9]+) ]]; then
  MYSHELL_CDP_PORT="${BASH_REMATCH[1]}"
fi

# Launch Chrome headless in background (don't block server startup)
google-chrome-stable \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=${MYSHELL_CDP_PORT} \
  --remote-debugging-address=${MYSHELL_CDP_HOST} \
  --user-data-dir=/app/chrome-data \
  --window-size=1280,900 \
  > /dev/null 2>&1 &

# Inject cookies in background after Chrome is ready
(
  for i in $(seq 1 30); do
    if curl -s "$MYSHELL_CDP_URL/json" > /dev/null 2>&1; then
      echo "Chrome ready, injecting cookies..."
      python3 /app/inject_cookies.py 2>&1 || echo "Cookie injection failed"
      break
    fi
    sleep 1
  done
) &

# Start the Python backend immediately (don't wait for Chrome)
exec python3 main.py
