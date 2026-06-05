#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/orchestrator/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [ -z "${PYTHON_BIN:-}" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    PYTHON_BIN="python"
  fi
fi

NPM_BIN="${NPM_BIN:-npm}"
BACKEND_PORT="${BACKEND_PORT:-${PORT:-8090}}"
FRONTEND_PORT="${FRONTEND_PORT:-5174}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
AI_CANVASPRO_PROXY_TARGET="${VITE_AI_CANVASPRO_PROXY_TARGET:-${AI_CANVASPRO_API_BASE:-http://127.0.0.1:8777}}"

BACKEND_PID=""
FRONTEND_PID=""
BACKEND_MANAGED="0"
FRONTEND_MANAGED="0"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [ "$FRONTEND_MANAGED" = "1" ] && [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [ "$BACKEND_MANAGED" = "1" ] && [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if [ "$FRONTEND_MANAGED" = "1" ] && [ -n "$FRONTEND_PID" ]; then
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [ "$BACKEND_MANAGED" = "1" ] && [ -n "$BACKEND_PID" ]; then
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_frontend_deps() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "Frontend dependencies are not installed."
    echo "Run: cd frontend && npm install"
    exit 1
  fi
}

require_backend_deps() {
  if ! "$PYTHON_BIN" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    echo "Backend dependencies are not installed for ${PYTHON_BIN}."
    echo "Run: cd orchestrator/backend && ${PYTHON_BIN} -m pip install -r requirements.txt"
    exit 1
  fi
}

wait_for_backend() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "Backend exited before becoming ready."
      wait "$BACKEND_PID" || true
      exit 1
    fi

    sleep 0.5
  done

  echo "Backend did not become ready at ${BACKEND_URL}."
  exit 1
}

require_command "$PYTHON_BIN"
require_command "$NPM_BIN"
require_command curl
require_frontend_deps
require_backend_deps

trap cleanup EXIT INT TERM

echo "Starting MyShell Studio local dev environment"
echo "Backend:  ${BACKEND_URL}"
echo "Frontend: ${FRONTEND_URL}"
echo "CanvasPro API proxy: ${AI_CANVASPRO_PROXY_TARGET}"
echo

if curl -fsS "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
  echo "Backend already ready"
else
  (
    cd "$BACKEND_DIR"
    PORT="$BACKEND_PORT" "$PYTHON_BIN" main.py
  ) &
  BACKEND_PID=$!
  BACKEND_MANAGED="1"

  wait_for_backend
  echo "Backend ready"
fi

(
  cd "$FRONTEND_DIR"
  VITE_DREAMY_ORCHESTRATOR_BASE_URL="${VITE_DREAMY_ORCHESTRATOR_BASE_URL:-}" \
  VITE_DREAMY_ORCHESTRATOR_PROXY_TARGET="$BACKEND_URL" \
  VITE_AI_CANVASPRO_PROXY_TARGET="$AI_CANVASPRO_PROXY_TARGET" \
  "$NPM_BIN" run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
) &
FRONTEND_PID=$!
FRONTEND_MANAGED="1"

echo "Frontend starting"
echo
echo "Open Studio: ${FRONTEND_URL}/dreamy"
echo "CanvasPro is available inside the Studio workspace switch."
echo "Press Ctrl+C to stop both services."
echo

while true; do
  if [ "$BACKEND_MANAGED" = "1" ]; then
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "Backend process stopped."
      wait "$BACKEND_PID" || true
      exit 1
    fi
  elif ! curl -fsS "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
    echo "Backend at ${BACKEND_URL} is no longer reachable."
    exit 1
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend process stopped."
    wait "$FRONTEND_PID" || true
    exit 1
  fi

  sleep 1
done
