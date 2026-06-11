#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANVASPRO_REPO_URL="${AI_CANVASPRO_REPO_URL:-https://github.com/ashuoAI/AI-CanvasPro.git}"
CANVASPRO_DIR="${AI_CANVASPRO_SERVER_DIR:-$ROOT_DIR/.external/AI-CanvasPro}"
CANVASPRO_REF="${AI_CANVASPRO_REF:-}"
UPDATE_EXISTING="${AI_CANVASPRO_UPDATE:-0}"

if [ -z "${PYTHON_BOOTSTRAP_BIN:-}" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BOOTSTRAP_BIN="python3"
  else
    PYTHON_BOOTSTRAP_BIN="python"
  fi
fi

if [ -z "${AI_CANVASPRO_PYTHON_BIN:-}" ]; then
  CANVASPRO_PYTHON_BIN="$CANVASPRO_DIR/.venv/bin/python"
else
  CANVASPRO_PYTHON_BIN="$AI_CANVASPRO_PYTHON_BIN"
fi

case "$UPDATE_EXISTING" in
  1|true|True|TRUE|yes|Yes|YES)
    UPDATE_EXISTING="1"
    ;;
  *)
    UPDATE_EXISTING="0"
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command git
require_command "$PYTHON_BOOTSTRAP_BIN"

mkdir -p "$(dirname "$CANVASPRO_DIR")"

if [ -d "$CANVASPRO_DIR/.git" ]; then
  echo "AI CanvasPro checkout exists at ${CANVASPRO_DIR}"
  if [ "$UPDATE_EXISTING" = "1" ]; then
    echo "Updating AI CanvasPro"
    git -C "$CANVASPRO_DIR" pull --ff-only
  fi
else
  echo "Cloning AI CanvasPro into ${CANVASPRO_DIR}"
  git clone "$CANVASPRO_REPO_URL" "$CANVASPRO_DIR"
fi

if [ -n "$CANVASPRO_REF" ]; then
  echo "Checking out AI CanvasPro ref: ${CANVASPRO_REF}"
  git -C "$CANVASPRO_DIR" fetch --tags origin
  git -C "$CANVASPRO_DIR" checkout "$CANVASPRO_REF"
fi

if [ ! -f "$CANVASPRO_DIR/server.py" ]; then
  echo "server.py was not found in ${CANVASPRO_DIR}"
  exit 1
fi

if [ -z "${AI_CANVASPRO_PYTHON_BIN:-}" ]; then
  if [ ! -x "$CANVASPRO_PYTHON_BIN" ]; then
    echo "Creating AI CanvasPro virtual environment at ${CANVASPRO_DIR}/.venv"
    "$PYTHON_BOOTSTRAP_BIN" -m venv "$CANVASPRO_DIR/.venv"
  fi
else
  require_command "$CANVASPRO_PYTHON_BIN"
fi

if [ -f "$CANVASPRO_DIR/requirements.txt" ]; then
  echo "Installing AI CanvasPro Python dependencies with ${CANVASPRO_PYTHON_BIN}"
  "$CANVASPRO_PYTHON_BIN" -m pip install -r "$CANVASPRO_DIR/requirements.txt"
else
  echo "requirements.txt was not found; skipping Python dependency install."
fi

bash "$ROOT_DIR/scripts/prepare-canvaspro-static.sh" --optional

echo
echo "AI CanvasPro is ready."
echo "Start the integrated Studio with:"
echo "  AI_CANVASPRO_SERVER_DIR=\"$CANVASPRO_DIR\" AI_CANVASPRO_PYTHON_BIN=\"$CANVASPRO_PYTHON_BIN\" npm run dev"
