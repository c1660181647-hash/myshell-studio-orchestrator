# AI CanvasPro Studio Integration

This folder vendors AI CanvasPro and embeds it inside MyShell Studio through
`frontend/src/pages/CanvasPro.tsx`.

## Runtime Shape

CanvasPro still owns the canvas runtime. Studio adds a thin bridge layer:

- `index.html` loads `main.js` first, then `studio-bridge.js`.
- `studio-bridge.js` reads CanvasPro state through `window.CanvasTabManager` and `graphStore`.
- The React page talks to the bridge with `window.postMessage`.
- The bridge does not modify renderer, interaction, minimap, node, or edge internals.

## Bridge Messages

Studio sends:

```ts
{
  type: 'aicanvas-studio:request',
  id: string,
  action:
    | 'getStatus'
    | 'saveSnapshot'
    | 'exportPackage'
    | 'importPackage'
    | 'getSelectedContext'
    | 'openShortcuts',
  payload?: Record<string, unknown>
}
```

CanvasPro responds:

```ts
{
  type: 'aicanvas-studio:response',
  id: string,
  ok: boolean,
  payload?: unknown,
  error?: string
}
```

CanvasPro also emits:

- `aicanvas-studio:ready`
- `aicanvas-studio:autosave`

## Offline Snapshot

The bridge stores browser-side recovery snapshots in IndexedDB:

- database: `myshell-studio-ai-canvaspro`
- store: `projects`
- key: `window.currentProjectId || "default_v2_project"`

Autosave is debounced and triggered by graph changes, dirty-state events, boot, and `pagehide`.
This is a Studio fallback only. The original CanvasPro server save flow is preserved.

## Project Package

Studio package export creates an uncompressed ZIP with:

- `manifest.json`: package metadata, project name, bridge version, node/edge counts
- `projects.json`: CanvasPro multi-canvas data
- `assets-manifest.json`: asset JSON paths, collected files, skipped local-only references
- `assets/*`: fetchable `data:`, `blob:`, same-origin, or CORS-accessible remote assets
- `README.txt`: package note

Absolute local filesystem paths are not read by the browser. They remain listed in
`assets-manifest.json` as skipped references so the project JSON stays honest.

## Import

The bridge imports:

- `.canvaspro.zip` / `.zip`: reads `projects.json`
- `.json`: imports CanvasPro-compatible project data

When `window.CanvasTabManager.init()` is available, import reinitializes the multi-canvas
workspace. If not, the bridge falls back to `graphStore.hydrateTrustedSnapshot()` or
`graphStore.loadState()` for the active canvas.

## Selected Context

`getSelectedContext` returns the selected nodes from the active canvas plus internal edges between
those selected nodes. The Studio shell currently copies this JSON to the clipboard; the same action
can later be wired to an orchestrator/chat endpoint without changing CanvasPro internals.

## License Note

`basketikun/infinite-canvas` was used as a product and architecture reference only. Do not copy code
from that AGPL-3.0 project into this vendored CanvasPro integration unless the resulting license
obligations are reviewed.
