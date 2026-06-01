#!/bin/bash

# Launch Chrome headless in background (don't block server startup)
google-chrome-stable \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir=/app/chrome-data \
  --window-size=1280,900 \
  > /dev/null 2>&1 &

# Inject cookies in background after Chrome is ready
(
  for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:9222/json > /dev/null 2>&1; then
      echo "Chrome ready, injecting cookies..."
      python3 /app/inject_cookies.py 2>&1 || echo "Cookie injection failed"
      break
    fi
    sleep 1
  done
) &

# Start the Python backend immediately (don't wait for Chrome)
exec python3 main.py
