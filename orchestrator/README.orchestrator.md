# Orchestrator Backend

The backend exposes the Studio API for MyShell page and agent dispatch. It keeps projects, segments, jobs, auth status, and evidence trails in a SQLite store so a backend restart can recover active Studio state.

## Core Surfaces

- `GET /api/health` reports backend, SQLite storage, Chrome CDP, MyShell cookie, cookie injection, and Dreamy delegated-auth state.
- `GET /api/pages` lists registered page adapters and miniapp navigation surfaces, including `dreamy-miniapp`, `myshell-art`, Explore, AI Picks, Bot Detail, Upload, Tag Generator, Library, Library Detail, Energy, Energy History, Earn, Share Invite, Settings, Profile, and Checkin.
- `GET /api/agents` lists the dispatch graph agents.
- `POST /api/studio/run` routes a prompt, creates a persisted job, and streams Studio SSE events.
- `GET /api/studio/delivery-audit` returns machine-readable acceptance status, requirements, operator `actions`, artifacts, and embedded reports for deployment handoff. Artifacts include both stable template `endpoint` values and concrete `url` values with project/session/source context filled in. Add `download=1` to receive `myshell-studio-audit-{project_id|current}.json` as a JSON attachment.
- `POST /api/studio/actions/resolve` executes safe audit actions such as targeted `verify-ready`, or returns explicit `manual_required` instructions for every handoff/audit operator action.
- `POST /api/studio/actions/resolve-batch` executes multiple safe audit actions, preserves every manual operator action with instructions, and returns a refreshed audit.
- `GET /api/studio/projects` lists recent persisted projects for Studio restore.
- `GET /api/studio/projects/{project_id}/delivery-bundle?download=1` returns the operator handoff bundle as a downloadable JSON attachment.
- `GET /api/studio/jobs` lists the persisted queue with optional `project_id` and `status` filters.
- `GET /api/studio/jobs/{job_id}` and `/evidence` return current state plus evidence history.
- `POST /api/studio/jobs/{job_id}/cancel` and `/retry` manage persisted jobs. Retry returns an `executionRequest` for client-side miniapp execution when needed.

When `/api/studio/run` receives the default Dreamy page selection, the backend can infer registered miniapp navigation targets from the prompt, for example Library, Upload, Tag Generator, Settings, Energy, Earn, Share Invite, Explore, AI Picks, Bot Detail, or Checkin. Explicit non-default `page_id` values always take priority over prompt inference.

`POST /api/studio/run` accepts optional `agent_id`. Registered agent ids are persisted on the job and included in route/execution/retry payloads; unknown ids fall back to the default executor agent for the selected page.

Miniapp navigation pages are loaded from `backend/studio_pages_manifest.json`. Set `STUDIO_PAGES_MANIFEST=/path/to/pages.json` to extend or replace the page set per environment. Manifest entries support `id`, `name`, `appRoute`, `capabilities`, optional `routeParams`, optional `routeDefaults`, and optional `intentKeywords`; matching intent keywords join the same prompt router used by the default page selection. `routeDefaults` are merged into the generated navigation query before dynamic values like `slug_id` and `img`, unless a route uses a matching path placeholder such as `/library/:id`, in which case Studio replaces the placeholder before computing `missingRouteParams`.

## Evidence Rules

The backend never marks placeholder media as complete. Generation `done` is accepted only when a fresh media URL or task result is registered. Navigation pages complete with accepted route evidence and return `clientAction: navigate` plus `navigationPath` for the Studio frontend to execute while keeping the return dock available. Missing cookies become `auth_missing`; long-running or failed adapters become `timeout` or `error`.

Contextual navigation pages can declare `routeParams`. The current registry uses this to append `slug_id` for Bot Detail, Upload, and Tag Generator, add `img` for Tag Generator when source media exists, and replace the `id` path parameter for Library Detail.

## Local Backend

```bash
cd orchestrator/backend
python -m pip install -r requirements.txt
PORT=8090 python main.py
```

## MyShell Art CDP

Start Chrome with remote debugging and provide cookies:

```bash
google-chrome-stable --remote-debugging-port=9222 --user-data-dir=/tmp/myshell-chrome
export MYSHELL_COOKIES='[{"name":"...","value":"...","domain":".myshell.ai"}]'
```

Without cookies, MyShell Art jobs are visible in Studio but stop as `auth_missing`.

## Tests

```bash
cd orchestrator
python -m unittest discover -s backend/tests -v
```
