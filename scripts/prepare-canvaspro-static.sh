#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/frontend/public/ai-canvaspro"
BRIDGE_SRC="$ROOT_DIR/frontend/public/studio/canvaspro/studio-bridge.js"
OPTIONAL="0"
FORCE="0"
CLEAN="0"

for arg in "$@"; do
  case "$arg" in
    --optional)
      OPTIONAL="1"
      ;;
    --force)
      FORCE="1"
      ;;
    --clean)
      CLEAN="1"
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/prepare-canvaspro-static.sh [--optional] [--force] [--clean]

Creates the ignored frontend/public/ai-canvaspro local mount from an external
AI CanvasPro checkout. The third-party source stays outside git.

Environment:
  AI_CANVASPRO_STATIC_DIR   External static app directory with index.html
  AI_CANVASPRO_SERVER_DIR   Existing AI-CanvasPro checkout fallback
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

find_canvaspro_static_dir() {
  local candidate
  if [ -n "${AI_CANVASPRO_STATIC_DIR:-}" ]; then
    if [ -f "$AI_CANVASPRO_STATIC_DIR/index.html" ]; then
      printf "%s\n" "$AI_CANVASPRO_STATIC_DIR"
      return 0
    fi
    echo "AI_CANVASPRO_STATIC_DIR is set, but index.html was not found: $AI_CANVASPRO_STATIC_DIR" >&2
  fi

  if [ -n "${AI_CANVASPRO_SERVER_DIR:-}" ] && [ -f "$AI_CANVASPRO_SERVER_DIR/index.html" ]; then
    printf "%s\n" "$AI_CANVASPRO_SERVER_DIR"
    return 0
  fi

  for candidate in \
    "$ROOT_DIR/.external/AI-CanvasPro" \
    "$ROOT_DIR/.external/AI-CanvasPro-static" \
    "$ROOT_DIR/.external/ai-canvaspro" \
    "$ROOT_DIR/../AI-CanvasPro" \
    "$ROOT_DIR/../AI-CanvasPro-main" \
    "$ROOT_DIR/../ai-canvaspro"; do
    if [ -f "$candidate/index.html" ]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  return 1
}

reset_target_dir() {
  if [ -L "$TARGET_DIR" ]; then
    rm "$TARGET_DIR"
  elif [ -e "$TARGET_DIR" ]; then
    if [ "$FORCE" != "1" ] && [ ! -f "$TARGET_DIR/.studio-generated" ]; then
      echo "Refusing to replace non-generated directory: $TARGET_DIR" >&2
      echo "Move it away or rerun with --force if it is safe to regenerate." >&2
      exit 1
    fi
    rm -rf "$TARGET_DIR"
  fi
  mkdir -p "$TARGET_DIR"
  touch "$TARGET_DIR/.studio-generated"
}

clean_target_dir() {
  if [ -L "$TARGET_DIR" ]; then
    rm "$TARGET_DIR"
  elif [ -e "$TARGET_DIR" ]; then
    if [ ! -f "$TARGET_DIR/.studio-generated" ]; then
      echo "Refusing to remove non-generated directory: $TARGET_DIR" >&2
      exit 1
    fi
    rm -rf "$TARGET_DIR"
  fi
}

write_placeholder() {
  reset_target_dir
  cat > "$TARGET_DIR/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI CanvasPro unavailable</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d12; color: #f7f7fb; }
      main { width: min(520px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 24px; background: rgba(255,255,255,.05); }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0; color: rgba(247,247,251,.72); line-height: 1.6; }
      code { color: #ff7aa8; }
    </style>
  </head>
  <body data-canvaspro-placeholder="1">
    <main>
      <h1>AI CanvasPro is not installed locally</h1>
      <p>Run <code>bash scripts/setup-canvaspro.sh</code> from the repository root, then restart Studio. The CanvasPro source stays in <code>.external/</code> and is not committed.</p>
    </main>
  </body>
</html>
HTML
  cat > "$TARGET_DIR/README.local.txt" <<'TEXT'
This directory is generated locally by scripts/prepare-canvaspro-static.sh.
It is intentionally ignored by git. Do not commit AI CanvasPro source here.
TEXT
}

link_static_app() {
  local source_dir="$1"
  local item
  local base
  reset_target_dir

  for item in "$source_dir"/* "$source_dir"/.[!.]* "$source_dir"/..?*; do
    [ -e "$item" ] || continue
    base="$(basename "$item")"
    case "$base" in
      .|..|.git|.github|.venv|venv|node_modules|__pycache__|.DS_Store)
        continue
        ;;
      server.py|requirements.txt|requirements-dev.txt|pyproject.toml|poetry.lock|Pipfile|Pipfile.lock)
        continue
        ;;
      studio-bridge.js|STUDIO_INTEGRATION.md)
        continue
        ;;
      *.py|*.pyc|*.pyo|*.log|*.pid|*.tsbuildinfo)
        continue
        ;;
    esac
    ln -s "$item" "$TARGET_DIR/$base"
  done

  if [ -f "$BRIDGE_SRC" ]; then
    ln -s "$BRIDGE_SRC" "$TARGET_DIR/studio-bridge.js"
  fi

  cat > "$TARGET_DIR/README.local.txt" <<TEXT
This directory is generated locally by scripts/prepare-canvaspro-static.sh.
Static source: $source_dir
The third-party AI CanvasPro source is intentionally kept outside git.
TEXT
}

if [ "$CLEAN" = "1" ]; then
  clean_target_dir
  exit 0
fi

STATIC_DIR="$(find_canvaspro_static_dir || true)"
if [ -z "$STATIC_DIR" ]; then
  if [ "$OPTIONAL" = "1" ]; then
    echo "AI CanvasPro static app not found; writing local placeholder."
    write_placeholder
    exit 0
  fi
  echo "AI CanvasPro static app not found." >&2
  echo "Run: bash scripts/setup-canvaspro.sh" >&2
  exit 1
fi

if [ "$(cd "$STATIC_DIR" && pwd)" = "$(cd "$(dirname "$TARGET_DIR")" && pwd)/$(basename "$TARGET_DIR")" ]; then
  echo "Static source cannot be the generated target directory: $STATIC_DIR" >&2
  exit 1
fi

link_static_app "$STATIC_DIR"
echo "AI CanvasPro static mount prepared from: $STATIC_DIR"
