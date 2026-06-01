# Orchestrator Backend

The backend exposes the Studio API for MyShell page and agent dispatch. It keeps projects, segments, jobs, auth status, and evidence trails in a SQLite store so a backend restart can recover active Studio state.

## Core Surfaces

- `GET /api/health` reports backend, SQLite storage, Chrome CDP, MyShell cookie, and Dreamy delegated-auth state.
- `GET /api/pages` lists registered page adapters and miniapp navigation surfaces, including `dreamy-miniapp`, `myshell-art`, Explore, Upload, Tag Generator, Library, Energy, Earn, Settings, and Checkin.
- `GET /api/agents` lists the dispatch graph agents.
- `POST /api/studio/run` routes a prompt, creates a persisted job, and streams Studio SSE events.
- `GET /api/studio/projects` lists recent persisted projects for Studio restore.
- `GET /api/studio/jobs` lists the persisted queue with optional `project_id` and `status` filters.
- `GET /api/studio/jobs/{job_id}` and `/evidence` return current state plus evidence history.
- `POST /api/studio/jobs/{job_id}/cancel` and `/retry` manage persisted jobs. Retry returns an `executionRequest` for client-side miniapp execution when needed.

## Evidence Rules

The backend never marks placeholder media as complete. Generation `done` is accepted only when a fresh media URL or task result is registered. Navigation pages complete with accepted route evidence and a `navigationPath`. Missing cookies become `auth_missing`; long-running or failed adapters become `timeout` or `error`.

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
